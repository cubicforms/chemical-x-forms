# SSR hydration (Nuxt + bare Vue)

Server-rendered form values, errors, and field flags round-trip to
the client automatically — no "loading → hydrated" flicker.

Two setups covered:

- **Nuxt 3 / 4** — you don't do anything. The module handles it.
- **Bare Vue 3 + `@vue/server-renderer`** — two one-liners bridge
  the server → client boundary.

## Nuxt — nothing to wire

Install the module and call `useForm` normally:

```ts
// nuxt.config.ts
export default defineNuxtConfig({
  modules: ['@chemical-x/forms/nuxt'],
})
```

```vue
<script setup lang="ts">
  const form = useForm({ schema, key: 'signup' })
</script>
```

Values, errors, and touched / focused / blurred flags survive the
server → client round-trip through `nuxtApp.payload`. Need to peek?
Open the rendered HTML and look for your Nuxt payload `<script>`;
`chemicalX` is a top-level key.

## Bare Vue — two functions

### Server (`entry-server.ts`)

```ts
import { createSSRApp } from 'vue'
import { renderToString } from '@vue/server-renderer'
import {
  createChemicalXForms,
  escapeForInlineScript,
  renderChemicalXState,
} from '@chemical-x/forms'
import App from './App.vue'

export async function render(url: string) {
  const app = createSSRApp(App)
  app.use(createChemicalXForms())

  const html = await renderToString(app)

  const chemicalXState = renderChemicalXState(app)
  // escapeForInlineScript keeps `</script>` and U+2028 / U+2029
  // separators out of the inline payload so it can't break out of
  // the <script> tag.
  const payload = escapeForInlineScript(JSON.stringify(chemicalXState))

  return { html, payload }
}
```

### Server template

```html
<body>
  <div id="app"><!--ssr-outlet--></div>
  <script>
    window.__CHEMICAL_X_STATE__ = {{{ payload }}};
  </script>
  <script type="module" src="/src/entry-client.ts"></script>
</body>
```

### Client (`entry-client.ts`)

```ts
import { createSSRApp } from 'vue'
import { createChemicalXForms, hydrateChemicalXState } from '@chemical-x/forms'
import App from './App.vue'

const app = createSSRApp(App)
app.use(createChemicalXForms())

// Replay the server's form state BEFORE mounting — forms read from
// the hydration bag during setup.
const serialized = (window as any).__CHEMICAL_X_STATE__
if (serialized !== undefined) hydrateChemicalXState(app, serialized)

app.mount('#app')
```

That's it. Every `useForm` call on the client resolves to the same
values the server rendered.

## What crosses the wire

- `form` — the current reactive value.
- `errors` — every error currently in the store.
- `fields` — touched / focused / blurred / isConnected / updatedAt
  per path.

## Common issues

**"The form is empty on the client even though the server rendered values."**

- Did you call `hydrateChemicalXState(app, payload)` before
  `app.mount(...)`? It has to land before `setup` runs.
- Does the form's `key` match between server and client? Hard-code
  it as a string literal. `uuidv4()` or `Math.random()` produces a
  fresh key per render and breaks the match.

**"Field errors from the server disappear on first interaction."**

By design. Any mutation re-runs validation, which can replace the
errors. To keep server-provided errors around until the user
dirties the field, gate the display on `form.getFieldState(path)`'s
`touched` or on `form.isDirty.value`.

**"Some fields look right, others don't."**

Forms created in `onMounted` or event handlers aren't in the SSR
snapshot. Create forms during `setup` so the server sees them.

## Reference test

The bare-Vue round-trip has an end-to-end test at
[`test/ssr-bare-vue/round-trip.test.ts`](../../test/ssr-bare-vue/round-trip.test.ts)
— reading it is faster than reconstructing the wiring from scratch.
