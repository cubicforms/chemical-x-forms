# Persistence (draft state across reloads)

Forms that take the user more than a minute to fill — multi-step
onboarding, checkout, long surveys — should survive a navigation
mistake or a browser refresh. Chemical X ships a `persist` option
that writes the form state to the chosen backend on every mutation
(debounced) and reads it back on mount.

## Enabling it

```ts
const form = useForm({
  schema,
  key: 'signup',
  persist: { storage: 'local' },
})
```

That's the 80% case: `localStorage`, default debounce, `clearOnSubmitSuccess`
default on. Full shape:

```ts
persist: {
  storage: 'local' | 'session' | 'indexeddb' | FormStorage,
  key?: string,                    // default: chemical-x-forms:${formKey}
  debounceMs?: number,             // default 300
  include?: 'form' | 'form+errors', // default 'form'
  version?: number,                // default 1 — bump to invalidate old entries
  clearOnSubmitSuccess?: boolean,  // default true
}
```

## Picking a backend

| Backend          | Quota                              | Sync/async | Serialisation       | Best for                                                                  |
| ---------------- | ---------------------------------- | ---------- | ------------------- | ------------------------------------------------------------------------- |
| `'local'`        | ~5 MB (browser-dependent)          | sync       | JSON string         | small forms, widest compatibility. Shared across tabs for the same origin. |
| `'session'`      | ~5 MB                              | sync       | JSON string         | tab-scoped scratch state — closing the tab drops the entry.                |
| `'indexeddb'`    | 50%+ of disk (tens-to-hundreds MB) | async      | structured clone    | large forms, `Date` / `Map` / `Set` / typed-array values, cross-tab state. |
| `FormStorage`    | caller-defined                     | caller-defined (Promise-returning) | caller-defined | encrypted stores, cookie-backed stores, native-mobile bridges.             |

### Size tradeoffs

All three built-in backends are dynamically imported — a consumer
who picks `'local'` never pulls IndexedDB code into their bundle
(Rollup's side-effect-free graph tree-shakes the unused adapters).
Pick the smallest that fits.

### JSON vs. structured clone

`'local'` and `'session'` use `JSON.stringify` / `JSON.parse`:
`Date` / `Map` / `Set` / typed arrays round-trip as strings or
objects. `'indexeddb'` uses the browser's structured-clone algorithm
— fidelity is preserved. If your form has non-JSON leaves, pick
`'indexeddb'`.

## The "flash of default state"

`IndexedDB` (and any custom async `FormStorage`) reads are async.
`useForm` is synchronous inside Vue's setup context, so on mount
the first render shows schema defaults — the persisted payload
arrives one microtask later and swaps in via `applyFormReplacement`.

For tiny forms where this matters (2-3 fields above the fold), use
`'local'` or `'session'` — their reads are synchronous under the
hood and the swap completes before paint. For larger forms,
structure your UI so the flash is invisible: show a spinner until
`isDirty` has a meaningful value, or default to rendering the form
`display:none` until an `onMounted` + `nextTick` tick.

## Versioning

Any time you change the form's shape in a schema-incompatible way
(rename a field, change a type), bump `persist.version`. Readers
compare `v` on the payload and drop mismatched entries — the form
starts from schema defaults instead of trying to parse stale data
into a changed shape.

```ts
persist: {
  storage: 'local',
  version: 2,   // was 1; old entries are discarded on read
}
```

## Clear-on-submit

Default behaviour: a successful submit removes the persisted entry.
If the user's form "worked", there's no draft to recover on next
mount.

To keep the entry (wizards with review pages, recover-from-refresh
scenarios where submit returns a server error you want to retry),
pass `clearOnSubmitSuccess: false`.

## Custom `FormStorage`

The escape hatch: implement the three-method contract and pass the
object directly.

```ts
import type { FormStorage } from '@chemical-x/forms'

const encryptedStorage: FormStorage = {
  async getItem(key) {
    const raw = await fetch(`/api/drafts/${key}`).then((r) => r.json() as Promise<unknown>)
    return raw
  },
  async setItem(key, value) {
    await fetch(`/api/drafts/${key}`, { method: 'PUT', body: JSON.stringify(value) })
  },
  async removeItem(key) {
    await fetch(`/api/drafts/${key}`, { method: 'DELETE' })
  },
}

useForm({ schema, key: 'signup', persist: { storage: encryptedStorage } })
```

`getItem` returns `unknown` so the adapter can hand back structured-
cloned values (IDB) or parsed JSON (local/session) without a forced
cast. The payload shape the library writes is versioned — your
storage only has to round-trip whatever it receives from `setItem`.

## Including errors

Default: `include: 'form'`. Errors on reload are usually stale —
fresh validation fires on mount anyway, and reloading with a `422`
in the store is just noise.

Set `include: 'form+errors'` when the server-side error context is
expensive to reconstruct (complex cross-field refinements, a
multi-step wizard that validates server-side on each step). The
adapter re-hydrates `fieldErrors` from the persisted entry.

## SSR safety

`persist` is gated behind `registry.isSSR`. On the server, no reads
or writes happen — the first client render hydrates from SSR state
(if any), then the persisted payload races in on the next microtask
and wins if present. The hydration precedence is: **SSR state >
persisted payload > schema defaults**.

## What it doesn't do

- **Cross-form coordination.** Each form persists independently.
- **Per-field granularity.** The whole form (plus optionally
  errors) is one blob.
- **Schema migrations.** Bumping `version` drops the old payload
  wholesale. For in-place migration (rename a field without
  losing state), keep `version` stable and write your own hydration
  path that reads the raw entry and massages it before `reset()`.
- **Encryption.** The built-in backends write plain JSON or
  structured-cloned values. Anything sensitive in a draft needs a
  custom `FormStorage` that encrypts on write.

## Caveats

- **`localStorage` is synchronous — large writes block the main
  thread.** Keep forms modest, or pick `'indexeddb'` if a single
  write starts to exceed ~50 ms on a cold device.
- **Safari private mode.** `localStorage.setItem` can throw a
  `SecurityError` in some older Safari private-mode builds. The
  adapter swallows it silently — the form keeps working; writes
  just don't land. Document this for your Safari-heavy users.
- **IndexedDB version bumps.** The library opens a shared DB
  (`chemical-x-forms`) at version 1. Consumers who need a different
  schema should wire a custom `FormStorage` (IDB is deliberately
  minimal in the built-in adapter; we ship no indexes, no cursors,
  no version upgrade hooks).
