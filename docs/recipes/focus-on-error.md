# Focus (and scroll) to the first error

When a form fails validation, dropping the user at the top of the
page isn't helpful — they want to see which field is wrong and
start fixing. Two ways to wire it up.

## Declarative (most forms)

```ts
const { handleSubmit } = useForm({
  schema,
  key: 'signup',
  onInvalidSubmit: 'focus-first-error',
})
```

Four policies:

| Policy                    | What happens                                                                                                           |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `'none'`                  | Default. No-op. Wire your own via `onError`.                                                                           |
| `'focus-first-error'`     | Calls `.focus()` on the first errored field. The browser may scroll.                                                   |
| `'scroll-to-first-error'` | Calls `.scrollIntoView()` on it. No focus change.                                                                      |
| `'both'`                  | Scrolls first, then focuses with `{ preventScroll: true }` so the browser doesn't re-scroll and undo the explicit one. |

The policy fires after `errors` is populated and before your
`onError` callback — `onError` can override it by calling `.focus()`
on something else.

## Imperative (server errors, manual flows)

For errors that don't come through `handleSubmit` — a 422 from your
API, a custom "validate + continue" button — call the helpers
directly:

```vue
<script setup lang="ts">
  import { useForm, parseApiErrors } from 'decant'

  const form = useForm({ schema, key: 'signup' })
  const { handleSubmit, setFieldErrors, scrollToFirstError, focusFirstError } = form

  const onSubmit = handleSubmit(async (values) => {
    try {
      await $fetch('/api/signup', { method: 'POST', body: values })
    } catch (err) {
      if (err.statusCode === 422) {
        const result = parseApiErrors(err.data, { formKey: form.key })
        if (result.ok) {
          setFieldErrors(result.errors)
          scrollToFirstError({ block: 'center', behavior: 'smooth' })
          focusFirstError({ preventScroll: true })
        }
      }
    }
  })
</script>
```

Both helpers return a boolean:

- `true` — an element was acted on.
- `false` — no errored field had a mounted, visible element (common when the bad field is behind a `v-if="false"`).

## How "first" is picked

The library walks errors in the order your schema reported them and
acts on the first field that's:

1. Registered via `v-register` (or a manual `registerElement` call).
2. Currently in the DOM.
3. Visible (`display:none` and ancestor `display:none` are skipped).

Fields hidden via `visibility: hidden`, `opacity: 0`, or `aria-hidden`
count as "visible" — they occupy layout. If that's wrong for your
UI, inspect `errors` yourself and focus the right element.

## Edge cases

- **Errors on a conditional field**: the element isn't registered,
  so both helpers return `false` and `onInvalidSubmit` silently
  no-ops. Gate your own fallback on the return value.
- **Array-of-objects forms**: each array index registers its own
  element; "first" follows schema order, which usually matches
  render order.
- **Multiple elements at the same path** (a radio-group, say): the
  first registered element wins.

## When to use which

- **Declarative** for the 90% case. Set it once per form.
- **Imperative** for server errors, multi-step flows, or when you
  want to combine focus with a toast / ARIA announcement.
