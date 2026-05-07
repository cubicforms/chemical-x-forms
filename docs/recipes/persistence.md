# Persist drafts across reloads

Long forms — multi-step onboarding, checkout, surveys — should
survive a navigation mistake or a browser refresh. Attaform persists drafts
to client-side storage with a per-field opt-in.

## Security: what not to persist

Client-side storage is unencrypted at rest, readable by any
same-origin script, and survives logouts. Persisting a name is
fine; a CVV, password, SSN, or API token is a compliance liability.

Defaults are "nothing persists" — every persisted field must opt
in at its `register()` call site, and sensitive-named paths throw
at mount unless acknowledged.

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

If the persistence is intentional (custom encrypted adapter,
narrow-scope internal tool), pass `acknowledgeSensitive: true`:

```vue
<input v-register="register('password', { persist: true, acknowledgeSensitive: true })" />
```

The heuristic is a speed bump, not a soundness guarantee —
adversarially named paths slip through. The real defence is the
per-field opt-in.

## Reset

`form.reset()` and `form.resetField(path)` wipe the persisted draft
alongside the in-memory clear. Opt-ins survive — the next keystroke
from a still-mounted opted-in input re-populates storage.

For "wipe storage but keep in-memory," use `form.clearPersistedDraft()`.

## Going further

- [Persistence policy](/docs/recipes/persistence-policy) — sparse
  payloads, error inclusion, schema-change auto-invalidation, what
  persistence is NOT for.
- [Persistence backends](/docs/recipes/persistence-backends) —
  picking `'local'` / `'session'` / `'indexeddb'`, full options
  bag, switching backends safely, custom `FormStorage` adapters,
  SSR considerations.
- [Persistence edge cases](/docs/recipes/persistence-edge-cases) —
  imperative `form.persist()` and `clearPersistedDraft()`, the
  four component-binding patterns, cross-tab semantics, dev-mode
  warnings, gotchas.
