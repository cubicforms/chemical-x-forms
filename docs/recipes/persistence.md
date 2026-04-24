# Persist drafts across reloads

Long forms — multi-step onboarding, checkout, surveys — should
survive a navigation mistake or a browser refresh. Opt in with one
line:

```ts
useForm({
  schema,
  key: 'signup',
  persist: { storage: 'local' },
})
```

Every mutation writes (debounced) to the chosen backend; on next
mount, the form hydrates from the saved payload. On a successful
submit, the entry is cleared.

## Full options

```ts
persist: {
  storage: 'local' | 'session' | 'indexeddb' | FormStorage,
  key?: string,                     // default: chemical-x-forms:${formKey}
  debounceMs?: number,              // default 300
  include?: 'form' | 'form+errors', // default 'form'
  version?: number,                 // default 1 — bump to invalidate old entries
  clearOnSubmitSuccess?: boolean,   // default true
}
```

## Picking a backend

| Backend       | Size budget                 | Sync/async | Best for                                                                |
| ------------- | --------------------------- | ---------- | ----------------------------------------------------------------------- |
| `'local'`     | ~5 MB                       | sync       | Small forms, widest compatibility. Shared across same-origin tabs.      |
| `'session'`   | ~5 MB                       | sync       | Tab-scoped scratch state. Closes with the tab.                          |
| `'indexeddb'` | 50%+ of disk                | async      | Large forms. `Date` / `Map` / `Set` / typed arrays round-trip verbatim. |
| `FormStorage` | You decide                  | You decide | Encrypted stores, cookie-backed, native-mobile bridges.                 |

`'local'` and `'session'` go through `JSON.stringify` — non-JSON
leaves lose fidelity. `'indexeddb'` uses the browser's structured-
clone algorithm, so those leaves round-trip cleanly.

Only the backend you choose is bundled. Pick `'local'`, don't pay
for the IndexedDB code.

## Bumping the version on schema change

When you rename a field or change a type, bump `persist.version`.
Old payloads are dropped on read — users start from schema defaults
instead of crashing on a shape mismatch.

```ts
persist: { storage: 'local', version: 2 }
```

## Keeping the draft after submit

Default: a successful submit clears the entry. Set
`clearOnSubmitSuccess: false` to keep it (useful for wizards with
review pages, or if submit might return a retryable server error).

## Including errors

Default `include: 'form'` persists just the values. Server-side
validation errors on reload are usually stale and confusing.

For multi-step wizards where reconstructing errors is expensive,
`include: 'form+errors'` persists and re-hydrates `fieldErrors`.

## Custom backend

The escape hatch — implement the three-method contract and pass the
object directly:

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

All three methods are Promise-returning so sync and async backends
share one shape. `getItem` returns `unknown` so your backend can
hand back whatever `setItem` received.

## Async backends + the "flash of default state"

IndexedDB (and any async custom `FormStorage`) can't deliver a value
in time for the first render. Users see schema defaults for one
microtask, then the persisted payload swaps in.

For small forms where that flash is jarring, stick to `'local'` or
`'session'`. For larger forms, gate rendering on an `onMounted`
tick or show a spinner until the first mutation settles.

## SSR

Persistence is automatically skipped on the server — no reads, no
writes. On the client, SSR-hydrated state wins over persisted state
if both are present.

## Not included

- **Encryption.** Built-in backends write plaintext. Sensitive
  drafts need a custom `FormStorage` that encrypts on write.
- **Schema migrations.** Bumping `version` drops old payloads
  wholesale. If you need to rename a field without losing state,
  read the raw entry yourself and massage it before calling
  `reset()`.
- **Cross-form coordination.** Each form persists independently.

## Gotchas

- **`localStorage` blocks the main thread** on large writes. If
  your writes exceed ~50 ms on a cold device, switch to
  `'indexeddb'`.
- **Safari private mode** can throw `SecurityError` on
  `localStorage.setItem`. The adapter swallows it — the form stays
  usable; writes just don't land.
