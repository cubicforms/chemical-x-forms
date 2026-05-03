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
debounce window, etc.). Three input forms — pick the one that reads
best at the call site:

```ts
// Shorthand: built-in backend with library defaults
useForm({ schema, key: 'signup', persist: 'local' })

// Shorthand: custom FormStorage adapter with library defaults
useForm({ schema, key: 'signup', persist: encryptedStorage })

// Full options: needed when you want to override anything beyond the backend
useForm({
  schema,
  key: 'signup',
  persist: { storage: 'local', debounceMs: 500 },
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

## Sparse payloads

The persisted payload contains only opted-in paths:

```ts
// Schema: { email: string, phone: string, cvv: string }
// register('email', { persist: true })
// register('phone', { persist: true })
// register('cvv')                     ← no opt-in

// Persisted payload, written under key attaform:signup:${fingerprint}
{
  v: 4,                                          // cx-internal envelope version
  data: { form: { email: '…', phone: '…' } }     // no `cvv`
}
```

The `v` field on the envelope is internal to cx — it tracks the
on-disk format and is bumped only when cx itself changes the
serialised shape. Consumers don't (and now can't) set it. Drafts
saved against a stale envelope version are dropped with a one-time
dev-warn on read.

The envelope also round-trips the form's `blankPaths` set when
populated, so a numeric field cleared by the user stays visually
empty after reload (storage holds the slim default; the
displayed-empty state survives).

On hydration, opted-in fields restore from storage; non-opted fields
come from schema defaults. The opt-in set can change between mounts
— a previously-persisted path that's no longer opted in stays in
storage until the next write (which won't include it) or an explicit
`form.clearPersistedDraft(path)`.

## Including errors

Default `include: 'form'` persists just the values. Server-side
validation errors on reload are usually stale and confusing.

For multi-step wizards where reconstructing errors is expensive,
`include: 'form+errors'` persists and re-hydrates `errors`.

Errors on non-opted-in paths are dropped from the persisted envelope
— a persisted error without a persisted value would dangle on
rehydration.

## Auto-invalidation on schema change

Storage keys carry the schema's structural fingerprint:

```text
attaform:signup:7c3a0b   ← key on disk
                       └────┘
                       fingerprint of the current schema
```

When the schema changes shape — adding / removing / renaming a
field, changing a leaf type, restructuring nested objects — the
fingerprint changes. New writes go to a new key
(`attaform:signup:9d2b1f`); the old key
(`attaform:signup:7c3a0b`) becomes unreachable.

On the next mount, the orphan-cleanup pass enumerates keys under
`attaform:signup` (via `FormStorage.listKeys`), keeps the
current-fingerprint entry, and removes the rest. No manual `version`
bump, no possibility of forgetting it, no draft drops when only
refinement logic changed (refinements collapse to opaque sentinels
in the fingerprint).

The same orphan pass also wipes pre-fingerprint legacy entries
written by older library versions, so upgrading from 0.11 to 0.12
cleans up cleanly on the next mount.

Malformed-shape entries (corrupted JSON, cx-internal envelope-version
mismatch, anything that doesn't match the expected payload contract)
are wiped on read. "Truly absent" entries (the key was never set)
are a no-op — the wipe only fires when there's actually something to
clean.

If you need to force-invalidate a draft without changing the schema
(e.g. shipping an unrelated field-validation tweak that you want
users to retest from scratch), call `form.clearPersistedDraft()` at
mount or wrap the schema in a thin no-op layer that perturbs the
fingerprint. The library deliberately doesn't expose a
"force-version" knob — most consumers don't need it, and the schema
fingerprint already captures every legitimate "shape changed"
signal.

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

Custom adapters can't be enumerated by the runtime, but cx still
calls each custom adapter's `listKeys(prefix)` for orphan-suffix
sweeping on the configured backend itself (see
[Auto-invalidation on schema change](#auto-invalidation-on-schema-change)).
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
problem one step further. Cx sweeps all three standard backends for
the form's default key whenever `useForm()` is called without a
`persist:` option, so a deployment that disables persistence (for
compliance, simplification, whatever) actually clears the on-disk
artifact instead of leaving a stale entry under
`attaform:${formKey}` indefinitely.

Caveat: only the default key is reachable. If a previous deployment
used a custom `persist.key`, that's an explicit migration on the
consumer.

## Keeping the draft after submit

Default: a successful submit clears the entry wholesale. Set
`clearOnSubmitSuccess: false` to keep it (useful for wizards with
review pages, or if submit might return a retryable server error).

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
- **Schema migrations.** Schema changes auto-invalidate old payloads
  via the fingerprint (the old key becomes unreachable and is swept
  on the next mount). If you need to rename a field without losing
  state, read the raw entry yourself before the schema change ships
  and massage it into the new shape before calling `reset()`. The
  library deliberately doesn't ship a renaming-aware migration
  helper — schemas are the contract; renames are a write-once
  transformation the consumer owns.

## Cross-tab semantics

`localStorage` is shared across same-origin tabs; two tabs of the
same app reading and writing the same persisted key will race.
The library does NOT implement cross-tab coordination — it's
**last-write-wins**. Two scenarios in particular:

- Tab A is mid-debounce on a write; Tab B writes the same key
  first; Tab A's debounce fires and overwrites Tab B's data.
- The library does not subscribe to the `storage` event, so a
  fresh write from another tab does NOT replay into the live form
  on the first tab.

**If multi-tab consistency matters,** use `'session'` (tab-scoped),
or build a custom `FormStorage` adapter that coordinates writes
(e.g., via a `BroadcastChannel`). For most form drafts, last-write-
wins is acceptable; the user typing in two tabs of the same draft
is a vanishingly rare case.

## Storage degradation: what surfaces, what stays silent

Each backend can fail on the consumer's device for reasons outside
the library's control:

- **localStorage / sessionStorage.** Quota exceeded (~5 MB), or
  Safari private mode rejecting `setItem` with a `SecurityError`.
  In dev mode, the adapter logs a one-shot `console.warn` on the
  FIRST failure for a given form (subsequent failures stay silent
  to avoid spamming the console with one warn per keystroke). In
  production, failures are silently swallowed — by design, since
  there's no user-visible recovery path the form can offer.
- **IndexedDB.** The DB-open phase can fail (`onerror`) or be
  blocked (`onblocked`, another tab holds an older version). One-
  shot dev warning, same pattern as above. Per-write failures
  surface as `transaction.onabort` (most often quota exceeded);
  again, one-shot dev warning.

Check `console` in dev mode if persistence appears to silently
drop writes.

## Component support

`<MyComponent v-register="register('name')" />` is supported through
four patterns, each appropriate for different component shapes. The
recommended pattern (for most cases) is `useRegister()`.

### 1. Native form-element root

When `MyComponent`'s root is `<input>` / `<select>` / `<textarea>`,
the directive lands on the rendered DOM root and persistence /
focus / blur tracking apply directly with no extra wiring.

```vue
<!-- MyInput.vue -->
<script setup lang="ts">
  defineOptions({ inheritAttrs: false })
</script>

<template>
  <input v-bind="$attrs" />
</template>
```

```vue
<!-- consumer -->
<MyInput v-register="register('name')" />
```

### 2. Non-form root → `useRegister()` (recommended)

When the component wraps a native input in styling (a `<div>`
container, a `<label>` wrapper, etc.), call `useRegister()` in the
child's setup and re-bind v-register onto an inner native element:

```vue
<!-- StyledInput.vue -->
<script setup lang="ts">
  import { useRegister } from 'attaform'
  const register = useRegister()
</script>

<template>
  <div class="wrapper">
    <input v-register="register" />
  </div>
</template>
```

```vue
<!-- consumer -->
<StyledInput v-register="register('email', { persist: true })" />
```

The directive on the parent's `<StyledInput>` detects the
`useRegister` sentinel and skips listener attachment on the
component's root. The inner `<input v-register="register">` gets
the full directive lifecycle — listener attachment, FormStore
element registration, focus / blur / touched tracking, persistence
opt-in. The form-state contract aligns with where DOM events
originate.

`useRegister()` returns `ComputedRef<RegisterValue | undefined>`.
The `| undefined` is intentional: a child rendered standalone (no
parent passing `v-register`) gets a no-op binding plus a dev-warn,
not a crash.

### 3. Compound components → `injectForm`

For components that touch multiple fields (e.g. an `AddressBlock`
with its own `street`, `city`, `zip` inputs), use the existing
`injectForm` API and call `ctx.register('a.b.c')` directly:

```vue
<!-- AddressBlock.vue -->
<script setup lang="ts">
  import { injectForm } from 'attaform'
  type SignupForm = { address: { street: string; city: string; zip: string } }
  const ctx = injectForm<SignupForm>('signup')
</script>

<template>
  <div v-if="ctx">
    <input v-register="ctx.register('address.street')" />
    <input v-register="ctx.register('address.city')" />
    <input v-register="ctx.register('address.zip')" />
  </div>
</template>
```

`useRegister` is a single-purpose ambient hook — it never accepts a
key or path. Compound use-cases belong on `injectForm`, which
already handles typed sub-paths, structured paths, `fields`,
and the rest.

### 4. `assignKey` low-level escape hatch

For Web Components (real custom elements that aren't Vue
components) or unusual binding targets, install the assigner
directly on the element:

```ts
import { assignKey } from 'attaform'
elRef.value[assignKey] = (newValue) => emit('update:modelValue', newValue)
```

A companion directive ordered first in `withDirectives` lets the
assigner land before `vRegister.created` runs, suppressing the
unsupported-element warn. The directive also respects a pre-
installed `assignKey` and won't clobber it. Use this only when
`useRegister` doesn't fit (typically Web Components).

### Dev-warn

The first time the directive sees a non-input / select / textarea
root WITHOUT a `useRegister` sentinel and WITHOUT an `assignKey`
override, it logs a one-shot warning pointing at this recipe.

## Gotchas

- **`localStorage` blocks the main thread** on large writes. If
  your writes exceed ~50 ms on a cold device, switch to
  `'indexeddb'`.
- **Safari private mode** can throw `SecurityError` on
  `localStorage.setItem`. The adapter swallows it — the form stays
  usable; writes just don't land. See the dev-warning section
  above.
- **Re-mounting an opted-in input** with a fresh DOM element issues
  a new element ID; the prior opt-in (tied to the old element's ID)
  was already removed at unmount. Rapid mount/unmount cycles are
  fine — the registry tracks elements via WeakMap, which auto-GCs
  when the DOM node is dropped.
- **`acknowledgeSensitive: true` is a code-review trigger, not a
  soundness boundary.** It silences the throw for paths that match
  the sensitive-name heuristic, but the heuristic doesn't catch
  alias-typed paths (`register('pswd' as 'password')`), abbreviated
  variants not in the list, or schemas with deliberately innocuous
  keys for sensitive data. Treat the override as an explicit
  decision worth a second pair of eyes; don't treat its absence
  as a security guarantee.
