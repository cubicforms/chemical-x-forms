# Persistence backends

How to pick a storage backend, configure operational options, and
plug in a custom `FormStorage` adapter.

## Picking a backend

| Backend       | Size budget  | Sync/async | Best for                                                                |
| ------------- | ------------ | ---------- | ----------------------------------------------------------------------- |
| `'local'`     | ~5 MB        | sync       | Small forms, widest compatibility. Shared across same-origin tabs.      |
| `'session'`   | ~5 MB        | sync       | Tab-scoped scratch state. Closes with the tab.                          |
| `'indexeddb'` | 50%+ of disk | async      | Large forms. `Date` / `Map` / `Set` / typed arrays round-trip verbatim. |
| `FormStorage` | You decide   | You decide | Encrypted stores, cookie-backed, native-mobile bridges.                 |

`'local'` and `'session'` go through `JSON.stringify` — non-JSON
leaves lose fidelity. `'indexeddb'` uses the browser's structured-
clone algorithm, so those leaves round-trip cleanly.

Only the backend you choose is bundled. Pick `'local'`, don't pay
for the IndexedDB code.

## Full options

```ts
persist: {
  storage: 'local' | 'session' | 'indexeddb' | FormStorage,
  key?: string,                     // default: attaform:${formKey}
                                    // (the resolved storage key adds a :${fingerprint} suffix automatically)
  debounceMs?: number,              // default 300
  include?: 'form' | 'form+errors', // default 'form'
  clearOnSubmitSuccess?: boolean,   // default true
}
```

Note what's NOT here. There's no `fields:` allowlist, no `paths:`
allowlist, no `redactFields:` blocklist, and no `version:` knob.
Persisted fields are announced at the `register()` call site —
that's the entire opt-in surface. Schema-change invalidation flows
from the schema's fingerprint, not a manual version field. The
form-level `persist:` config is operational only.

## Switching backends safely

The configured `storage` is the source of truth for "where the draft
lives now." On every mount, the orphan-cleanup pass scans the three
standard backends (`'local'`, `'session'`, `'indexeddb'`) under the
form's `key` prefix and removes anything that doesn't match the
configured backend's current-fingerprint entry. So if a form was
persisting to `'local'` and you switch to `'session'` (or to a custom
encrypted adapter), the stale `'local'` entry can't orphan PII or
sensitive fields.

```ts
// Before:
useForm({ schema, key: 'signup', persist: 'local' })

// After (next deploy): mount-time sweep wipes the old 'local' entry.
useForm({ schema, key: 'signup', persist: encryptedStorage })
```

Custom adapters can't be enumerated by the runtime, but attaform still
calls each custom adapter's `listKeys(prefix)` for orphan-suffix
sweeping on the configured backend itself (see
[Auto-invalidation on schema change](/docs/recipes/persistence-policy#auto-invalidation-on-schema-change)).
Adapters that can't enumerate (HTTP-backed, cookie-backed) return
`[]` and the sweep degrades gracefully on those backends.
Configuring a custom adapter still sweeps all three standard
backends — the dev might have migrated away from any of them.

The cleanup runs once at mount, only touches the `key` prefix your
form resolves to (default `attaform:${formKey}`), and never
touches keys outside that prefix. Entries other forms wrote to the
same backend under different keys are untouched. The exact-or-`:`-
prefix match prevents collision with sibling forms whose keys share
a string prefix (e.g. custom keys `my-form` vs `my-form-2`).

### Removing `persist:` entirely

Removing the `persist:` option from `useForm()` is the same hygiene
problem one step further. Attaform sweeps all three standard backends for
the form's default key whenever `useForm()` is called without a
`persist:` option, so a deployment that disables persistence (for
compliance, simplification, whatever) actually clears the on-disk
artifact instead of leaving a stale entry under
`attaform:${formKey}` indefinitely.

Caveat: only the default key is reachable. If a previous deployment
used a custom `persist.key`, that's an explicit migration on the
consumer.

## Custom backend

The escape hatch — implement the four-method contract and pass the
object directly:

```ts
import type { FormStorage } from 'attaform'

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
  async listKeys(prefix) {
    // Used by the orphan-cleanup pass to find stale fingerprint-suffixed keys.
    // Return every key whose name starts with `prefix`. If your backend
    // can't enumerate (no list endpoint, opaque cookies), return [].
    const r = await fetch(`/api/drafts?prefix=${encodeURIComponent(prefix)}`)
    return (await r.json()) as string[]
  },
}

useForm({ schema, key: 'signup', persist: { storage: encryptedStorage } })
```

All four methods are Promise-returning so sync and async backends
share one shape. `getItem` returns `unknown` so your backend can
hand back whatever `setItem` received.

`listKeys(prefix)` is what powers schema-change auto-invalidation:
when the schema's fingerprint changes, the orphan cleanup pass
enumerates keys under the form's `${base}` prefix and removes any
that don't match the current fingerprint. Adapters that can't
enumerate (no list endpoint, cookie-backed, native bridges without
a list API) return `[]` — orphan cleanup degrades gracefully on
those backends. Keys still rotate cleanly because writes go to the
new fingerprint key on every schema change; the only thing missed
is active sweep of the old key, which the consumer can do manually
via `form.clearPersistedDraft()` if it matters.

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

## See also

- [Persistence walkthrough](/docs/recipes/persistence) — the basics
- [Persistence policy](/docs/recipes/persistence-policy) — what gets stored, schema-change invalidation
- [Persistence edge cases](/docs/recipes/persistence-edge-cases) — imperative APIs, gotchas
