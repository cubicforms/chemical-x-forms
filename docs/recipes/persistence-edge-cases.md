# Persistence edge cases

Imperative checkpoint and clear APIs, the four component-binding
patterns, and the gotchas that come up under unusual storage
conditions.

## Imperative checkpoint via `form.persist()`

For "Save Draft" buttons, `beforeunload` handlers, or wizard
section boundaries:

```ts
const form = useForm({ schema, key: 'wizard', persist: { storage: 'local' } })

async function onSaveStep() {
  await form.persist('step1')
  await form.persist('step2')
}
```

A one-shot read-merge-write:

- Bypasses the per-element opt-in gate.
- Bypasses the debouncer — flushes pending writes first.
- Preserves untouched paths in storage.
- Throws `SensitivePersistFieldError` on heuristic-matched paths
  unless `{ acknowledgeSensitive: true }`.
- Silent no-op when `persist:` isn't configured.

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

## Keeping the draft after submit

Default: a successful submit clears the entry wholesale. Set
`clearOnSubmitSuccess: false` to keep it (useful for wizards with
review pages, or if submit might return a retryable server error).

## Cross-tab semantics

`localStorage` writes from two tabs race; the library does NOT
coordinate — **last-write-wins**. Two cases:

- Tab A is mid-debounce; Tab B writes; Tab A's debounce overwrites.
- The library doesn't subscribe to the `storage` event — fresh
  writes from another tab don't replay into the live form.

If multi-tab consistency matters, use `'session'` (tab-scoped) or a
custom `FormStorage` adapter that coordinates via
`BroadcastChannel`.

## Storage degradation

Backend failures (quota exceeded, Safari private mode, IndexedDB
blocked) log a one-shot `console.warn` per form in dev mode and are
silently swallowed in production — no user-visible recovery path.

Check `console` in dev if persistence appears to drop writes.

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

When the component wraps a native input in styling, call
`useRegister()` in the child's setup and re-bind `v-register` onto
an inner native element:

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

The parent directive detects the `useRegister` sentinel and skips
listener attachment on the component root; the inner
`v-register="register"` gets the full lifecycle — listeners,
element registration, focus/blur/touched, persistence.

`useRegister()` returns `ComputedRef<RegisterValue | undefined>`. A
standalone child (no parent passing `v-register`) gets a no-op
binding plus a dev-warn, not a crash.

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

## Dev-mode warnings

Two symmetric warnings catch "wired half the pipeline" footguns
(once per form in dev, silenced in production):

- **`persist:` configured but no field opts in** — drafts never save.
- **`register({ persist: true })` but no `persist:` on the form** —
  opt-ins recorded, no writes land.

The warnings include the form key and (where applicable) the path
that triggered them.

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

## See also

- [Persistence walkthrough](/docs/recipes/persistence) — the basics
- [Persistence policy](/docs/recipes/persistence-policy) — what gets stored, schema-change invalidation
- [Persistence backends](/docs/recipes/persistence-backends) — picking and configuring storage
