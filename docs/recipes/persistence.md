# Persist drafts across reloads

Long forms — multi-step onboarding, checkout, surveys — should
survive a navigation mistake or a browser refresh. Cx persists drafts
to client-side storage with a per-field opt-in.

## The threat model

Client-side storage (localStorage / sessionStorage / IndexedDB) is
unencrypted at rest, readable by any same-origin script, and
survives logouts. Persisting a benign field like a name or address
is fine. Persisting a CVV, password, SSN, or API token is a
compliance liability — HIPAA, PII, PCI-DSS, SOC2.

The cx persistence model defaults to "nothing persists" and forces
each persisted field to be announced explicitly at its `register()`
call site. Adding a sensitive field later doesn't quietly extend an
existing persistence config — its register call has to opt in, and
sensitive-named paths throw at mount unless explicitly acknowledged.

## Setup

Configure `useForm` with the operational settings (backend, key,
debounce window, version, etc.). Three input forms — pick the one
that reads best at the call site:

```ts
// Shorthand: built-in backend with library defaults
useForm({ schema, key: 'signup', persist: 'local' })

// Shorthand: custom FormStorage adapter with library defaults
useForm({ schema, key: 'signup', persist: encryptedStorage })

// Full options: needed when you want to override anything beyond the backend
useForm({
  schema,
  key: 'signup',
  persist: { storage: 'local', debounceMs: 500, version: 3 },
})
```

The shorthand forms are equivalent to `{ storage: 'local' }` and
`{ storage: encryptedStorage }` — purely ergonomic sugar for the
common "I just want to pick a backend" case.

Then opt each field into persistence at its `register()` call site:

```vue
<input v-register="register('email', { persist: true })" />
<input v-register="register('phone', { persist: true })" />
<!-- This input does NOT persist — no opt-in. Value lives in memory only. -->
<input v-register="register('cvv')" />
```

Every typed character in an opted-in field debounces a write to the
chosen backend. On next mount, those fields hydrate from the saved
payload; non-opted fields fall back to schema defaults.

On a successful submit, the draft is cleared.

## Reactive opt-in

The `persist` flag is reactive — flip a remember-me toggle to add or
remove the opt-in at runtime:

```vue
<script setup lang="ts">
  const rememberMe = ref(false)
</script>

<template>
  <input v-register="register('email', { persist: rememberMe })" />
  <label><input type="checkbox" v-model="rememberMe" /> Remember me</label>
</template>
```

When `rememberMe` flips false → true, the directive's update hook
adds the opt-in. Future writes from THIS input persist. Flip it back
and the opt-in is removed; writes go in-memory only.

## Sensitive-name protection

A small built-in heuristic flags sensitive-looking path names:

```text
password, passwd, pwd, cvv, cvc, ssn, social-security, dob,
date-of-birth, pin, token, secret, api-key, private-key,
card-number, card, iban, routing-number, account-number, passport,
driver-license, mfa-secret, recovery-code
```

Opting one of these into persistence throws
`SensitivePersistFieldError` at mount:

```vue
<!-- Throws SensitivePersistFieldError -->
<input v-register="register('password', { persist: true })" />
```

If the persistence is genuinely intentional (a custom encrypted
storage adapter, an internal tool with very narrow scope), pass
`acknowledgeSensitive: true` to silence the throw:

```vue
<input v-register="register('password', { persist: true, acknowledgeSensitive: true })" />
```

The override forces a code-review trigger every time the binding is
authored. The heuristic is a speed bump, not a soundness guarantee —
adversarially named paths (`'pswd'`, `'sensitive_data'`) can slip
through. The defence is the per-field opt-in itself; the heuristic
catches the obvious cases.

## Imperative checkpoint via `form.persist()`

For "Save Draft" buttons, `beforeunload` handlers, or multi-step
wizards that want a checkpoint at section boundaries, call
`form.persist(path)` directly:

```ts
const form = useForm({ schema, key: 'wizard', persist: { storage: 'local' } })

async function onSaveStep() {
  await form.persist('step1')
  await form.persist('step2')
}
```

`form.persist(path)` is a one-shot read-merge-write:

- Bypasses the per-element opt-in gate (the consumer takes explicit
  responsibility for this checkpoint).
- Bypasses the debouncer — flushes any pending subscription write
  first, then writes immediately.
- Preserves untouched paths in storage. If an existing entry has
  `email` and `phone` opted-in values, calling `form.persist('email')`
  refreshes only the `email` slot; `phone` stays.
- Throws `SensitivePersistFieldError` if `path` matches the
  heuristic; pass `{ acknowledgeSensitive: true }` to override.
- Silent no-op when `persist:` isn't configured on the form.

## Wiping a draft via `form.clearPersistedDraft()`

```ts
// Wipe the entire draft.
await form.clearPersistedDraft()

// Wipe one path's slot.
await form.clearPersistedDraft('email')
```

`clearPersistedDraft` does NOT touch in-memory form state, and does
NOT disable any active opt-ins — future writes from opted-in
bindings will re-populate the storage entry.

## Reset

`form.reset()` and `form.resetField(path)` wipe the persisted draft
alongside the in-memory clear. Drafts are transient; "fresh start"
should mean every layer.

```ts
form.reset()
// In-memory state reset to schema defaults.
// Storage entry wiped.
// Opt-in registry preserved — next keystroke from a still-mounted
// opted-in input re-populates the entry naturally.
```

If you want the in-memory reset without touching storage (rare),
revert to manual: capture `state.form.value` before, replace it
after. The library doesn't ship a `reset({ preserveDraft: true })`
flag — most consumers want both layers in sync, and the explicit
`clearPersistedDraft()` API covers the inverse "wipe storage but keep
in-memory."

## Cross-SFC behavior

Two SFCs sharing a key share the same FormStore and the same
persistence registry. Opt-ins are per-DOM-element, not per-SFC:

- SFC A renders an input bound to `'email'` with `persist: true` →
  A's element opted in.
- SFC B renders an input bound to `'email'` without `persist` → B's
  element NOT opted in.
- Typing in A persists. Typing in B doesn't.

Unmount SFC A and B's typing stops persisting (no opt-ins remain).
Re-mount A and the new element gets a fresh opt-in. No special
coordination logic — element-level identity does the right thing.

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
  key?: string,                     // default: chemical-x-forms:${formKey}
  debounceMs?: number,              // default 300
  include?: 'form' | 'form+errors', // default 'form'
  version?: number,                 // default 2 — bump to invalidate old entries
  clearOnSubmitSuccess?: boolean,   // default true
}
```

Note what's NOT here. There's no `fields:` allowlist, no `paths:`
allowlist, no `redactFields:` blocklist. Persisted fields are
announced at the `register()` call site — that's the entire opt-in
surface. The form-level `persist:` config is operational only.

## Sparse payloads

The persisted payload contains only opted-in paths:

```ts
// Schema: { email: string, phone: string, cvv: string }
// register('email', { persist: true })
// register('phone', { persist: true })
// register('cvv')                     ← no opt-in

// Persisted payload:
{
  v: 2,
  data: { form: { email: '…', phone: '…' } }   // no `cvv`
}
```

On hydration, opted-in fields restore from storage; non-opted fields
come from schema defaults. The opt-in set can change between mounts
— a previously-persisted path that's no longer opted in stays in
storage until the next write (which won't include it) or an explicit
`form.clearPersistedDraft(path)`.

## Including errors

Default `include: 'form'` persists just the values. Server-side
validation errors on reload are usually stale and confusing.

For multi-step wizards where reconstructing errors is expensive,
`include: 'form+errors'` persists and re-hydrates `fieldErrors`.

Errors on non-opted-in paths are dropped from the persisted envelope
— a persisted error without a persisted value would dangle on
rehydration.

## Bumping the version on schema change

When you rename a field or change a type, bump `persist.version`.
Old payloads are dropped on read — users start from schema defaults
instead of crashing on a shape mismatch. The stale entry is wiped
from storage at the same time, so old field values can't linger.

```ts
persist: { storage: 'local', version: 3 }
```

The same auto-wipe handles malformed-shape entries (corrupted JSON,
wrong envelope, anything that doesn't match the expected payload
contract). "Truly absent" entries (the key was never set) are a
no-op — the wipe only fires when there's actually something to clean.

## Switching backends safely

The configured `storage` is the source of truth for "where the draft
lives now." Any standard backend NOT matching the configured one gets
a `removeItem(key)` at mount, fire-and-forget. So if a form was
persisting to `'local'` and you switch to `'session'` (or to a custom
encrypted adapter), the stale `'local'` entry can't orphan PII or
sensitive fields.

```ts
// Before:
useForm({ schema, key: 'signup', persist: 'local' })

// After (next deploy): mount-time sweep wipes the old 'local' entry.
useForm({ schema, key: 'signup', persist: encryptedStorage })
```

Custom adapters can't be enumerated, so a custom→custom migration is
on the consumer. Configuring a custom adapter sweeps all three
standard backends (the dev might have migrated away from any of them).

The cleanup runs once at mount, only touches the `key` your form
resolves to (default `chemical-x-forms:${formKey}`), and never
touches the configured backend. Entries other forms wrote to the
same backend under different keys are untouched.

### Removing `persist:` entirely

Removing the `persist:` option from `useForm()` is the same hygiene
problem one step further. Cx sweeps all three standard backends for
the form's default key whenever `useForm()` is called without a
`persist:` option, so a deployment that disables persistence (for
compliance, simplification, whatever) actually clears the on-disk
artifact instead of leaving a stale entry under
`chemical-x-forms:${formKey}` indefinitely.

Caveat: only the default key is reachable. If a previous deployment
used a custom `persist.key`, that's an explicit migration on the
consumer.

## Keeping the draft after submit

Default: a successful submit clears the entry wholesale. Set
`clearOnSubmitSuccess: false` to keep it (useful for wizards with
review pages, or if submit might return a retryable server error).

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

## Dev-mode warnings

Two symmetric warnings catch the common "wired half the pipeline"
footguns. Both fire once per form in development and are silently
no-op'd in production.

- **`persist:` configured but no field opts in.** Every `register()`
  call omits `{ persist: true }` — the framework is wired up but
  drafts mysteriously never save. Add `register(path, { persist:
true })` on at least one field, or remove the `persist:` option if
  you didn't mean to enable it.
- **`register({ persist: true })` used but no `persist:` configured.**
  A binding asks for persistence but `useForm()` has no `persist:`
  option — the opt-in is recorded, but no writes will land in any
  storage backend. Add `persist: 'local'` (or another backend) to
  your `useForm()` options.

The warnings include the form key and (where applicable) the path
that triggered them, so you can navigate to the offending call site
without grepping.

## What persistence is NOT for

- **Sensitive data.** Don't persist passwords, payment cards, SSNs,
  tokens, or anything else listed in the sensitive-name heuristic
  unless your storage adapter encrypts AND the encryption key isn't
  itself client-side derivable. The library throws at mount on
  obvious cases; the heuristic isn't exhaustive.
- **Authoritative state.** Persistence is for draft UX, not for
  source-of-truth data. The server still owns the canonical record.
- **Cross-form coordination.** Each form persists independently.
  Multiple forms can share a key (and so a FormStore + a persistence
  entry), but they're still one form to the persistence layer.
- **Schema migrations.** Bumping `version` drops old payloads
  wholesale. If you need to rename a field without losing state,
  read the raw entry yourself and massage it before calling
  `reset()`.

## Gotchas

- **`localStorage` blocks the main thread** on large writes. If
  your writes exceed ~50 ms on a cold device, switch to
  `'indexeddb'`.
- **Safari private mode** can throw `SecurityError` on
  `localStorage.setItem`. The adapter swallows it — the form stays
  usable; writes just don't land.
- **Re-mounting an opted-in input** with a fresh DOM element issues
  a new element ID; the prior opt-in (tied to the old element's ID)
  was already removed at unmount. Rapid mount/unmount cycles are
  fine — the registry tracks elements via WeakMap, which auto-GCs
  when the DOM node is dropped.
