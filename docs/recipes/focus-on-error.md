# Focus (and scroll) to the first error

When a form fails validation, dropping the user at the top of the page
isn't helpful — they want to see which field is wrong and start
fixing. `useForm` ships two imperative helpers and one declarative
config for this.

## Declarative: `onInvalidSubmit`

The most common case: focus the first errored field when `handleSubmit`
trips validation. Pass a policy at `useForm` construction and the
library handles it without an `onError` callback:

```ts
const { handleSubmit } = useForm({
  schema,
  key: 'signup',
  onInvalidSubmit: 'focus-first-error',
})
```

Four policies:

| Policy | Behaviour |
|---|---|
| `'none'` (default) | No-op. Consumer wires their own behaviour via `onError`. |
| `'focus-first-error'` | Calls `.focus()` on the first errored field. Browser may scroll. |
| `'scroll-to-first-error'` | Calls `.scrollIntoView()` on it. No focus change. |
| `'both'` | Scrolls first, then focuses with `{ preventScroll: true }` so the browser doesn't scroll a second time and undo the explicit one. |

The policy fires **after** the error store is populated (so
`fieldErrors` reflects the failure in the same tick) and **before**
your `onError` callback (so you can override by focusing something
else inside the callback).

## Imperative: `focusFirstError()` / `scrollToFirstError()`

For flows that don't run through `handleSubmit` — a server error
hydrated via `setFieldErrorsFromApi`, a manual `validate()`, a dirty
button that runs its own logic — call the helpers directly:

```vue
<script setup lang="ts">
const { handleSubmit, setFieldErrorsFromApi, scrollToFirstError, focusFirstError } =
  useForm({ schema, key: 'signup' })

const onSubmit = handleSubmit(async (values) => {
  try {
    await $fetch('/api/signup', { method: 'POST', body: values })
  } catch (err) {
    if (err.statusCode === 422) {
      setFieldErrorsFromApi(err.data)
      // Server validation failed — bring the user to the first bad field.
      scrollToFirstError({ block: 'center', behavior: 'smooth' })
      focusFirstError({ preventScroll: true })
    }
  }
})
</script>
```

Both helpers return a boolean:

- `true` when a qualifying element was acted on.
- `false` when no errored field has a currently-mounted, visible
  element. This is common when the errored field lives behind a
  conditional (`v-if="..."`) that's currently false.

## How "first" is decided

Errors are iterated in the order the schema reported them. The
library walks that sequence and returns the first errored field whose
DOM element is:

1. Registered via `v-register` (or a manual `registerElement` call
   from a custom directive).
2. Connected to the document (`el.isConnected === true`).
3. Visible (`el.offsetParent !== null`, which excludes elements
   hidden via `display: none` or whose ancestor chain is).

Fields that are rendered but hidden via `visibility: hidden`,
`opacity: 0`, or `aria-hidden` are still considered "visible" by this
check — they occupy layout. If that's wrong for your UI, call
`getFirstErrorElement` yourself and apply your own filter.

## Edge cases

- **Errors on a conditional field**: the errored field's template is
  unmounted, so no element is registered. Both helpers return `false`
  and `onInvalidSubmit` silently no-ops. Consumers who want a fallback
  can test the return and scroll to the form itself.
- **Array-of-objects forms**: each array index's element registers
  separately. "First" follows schema-issue order, which typically
  matches render order for list inputs.
- **Multiple DOM elements at the same path** (e.g. a radio-group):
  the first registered element wins. That's consistent regardless of
  how many are in the `Set<HTMLElement>` for that path.

## When to use which

- **Declarative (`onInvalidSubmit`)**: 90% case. Set it once per
  form; forget about it.
- **Imperative helpers**: server-side errors, multi-step flows, or
  when you want to combine focus with a toast / announcement.
- **Roll your own via `getFirstErrorElement`**: only needed when the
  visibility heuristic doesn't match your layout. Most consumers will
  not reach for this.
