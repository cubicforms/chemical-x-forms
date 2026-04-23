# SSR hydration (bare Vue 3 and Nuxt)

`@chemical-x/forms` works under two SSR entry points:

- **Nuxt 3 / Nuxt 4** — the Nuxt module takes care of payload
  round-trip automatically. Forms mounted during `renderToString`
  serialise into `nuxtApp.payload`; on the client the plugin replays
  them so the rehydrated form's value, errors, and touched flags match
  what the server rendered.
- **Bare Vue 3 + `@vue/server-renderer`** — you call
  `renderChemicalXState(app)` on the server and
  `hydrateChemicalXState(app, payload)` on the client. Nothing magic;
  two one-liners bridge the boundary.

This recipe walks through the bare-Vue case in full, then notes how
Nuxt differs.

## The bare-Vue flow

**Server (entry-server.ts):**

```ts
import { createSSRApp } from 'vue'
import { renderToString } from '@vue/server-renderer'
import { createChemicalXForms, renderChemicalXState } from '@chemical-x/forms'
import App from './App.vue'

/**
 * Escape a JSON string so it's safe to embed inside an inline <script> tag.
 * `JSON.stringify` alone is unsafe — a form value containing the literal
 * substring `</script>` would break out of the script tag and let arbitrary
 * markup take over. The five characters below are the well-known set; this
 * is the same approach React's `serialize-javascript` and Nuxt's payload
 * serialiser take.
 */
function escapeForInlineScript(json: string): string {
  return json.replace(/[<>&\u2028\u2029]/g, (char) => {
    switch (char) {
      case '<':
        return '\\u003c'
      case '>':
        return '\\u003e'
      case '&':
        return '\\u0026'
      case '\u2028':
        return '\\u2028'
      case '\u2029':
        return '\\u2029'
      default:
        return char
    }
  })
}

export async function render(url: string) {
  const app = createSSRApp(App)
  app.use(createChemicalXForms())

  const html = await renderToString(app)

  // Serialise every form currently in the registry, then escape so the
  // payload is safe to inline inside <script>...</script>.
  const chemicalXState = renderChemicalXState(app)
  const payload = escapeForInlineScript(JSON.stringify(chemicalXState))

  return { html, payload }
}
```

**Server template:**

```html
<body>
  <div id="app"><!--ssr-outlet--></div>
  <script>
    // The escape above keeps `</script>` (and U+2028 / U+2029 line
    // separators that would otherwise terminate the script) out of the
    // inline payload.
    window.__CHEMICAL_X_STATE__ = {{{ payload }}};
  </script>
  <script type="module" src="/src/entry-client.ts"></script>
</body>
```

**Client (entry-client.ts):**

```ts
import { createSSRApp } from 'vue'
import { createChemicalXForms, hydrateChemicalXState } from '@chemical-x/forms'
import App from './App.vue'

const app = createSSRApp(App)
app.use(createChemicalXForms())

// Replay the server's form state BEFORE mounting. The order matters:
// forms read from the hydration bag during setup(), so we have to
// populate the bag before setup() runs.
const serialized = (window as any).__CHEMICAL_X_STATE__
if (serialized !== undefined) hydrateChemicalXState(app, serialized)

app.mount('#app')
```

That's it. Every `useForm` call on the client resolves to the same
`form.value`, `fieldErrors`, and `getFieldState` values the server
rendered. No "loading → hydrated" flicker.

## Why we need a payload at all

Vue's built-in SSR round-trip serialises the rendered HTML and runs
`hydrate()` on the client, which walks the DOM and attaches event
listeners. But our reactive form state lives outside the DOM — it's
closure state inside `useForm`. Nothing about the rendered HTML tells
the client "this form's `email` field is currently `'alice@example.com'`
because the server set it". The payload is what restores that.

Specifically, `renderChemicalXState` captures per form:

- `form` — the current reactive value.
- `errors` — the full error map (not just what's rendered).
- `fields` — per-path `FieldRecord` state (`touched`, `focused`,
  `blurred`, `isConnected`, `updatedAt`).

Originals are NOT serialised — `hydrateChemicalXState` rebuilds them on
the client from the schema's defaults, so `isDirty` computations
survive the boundary.

## Nuxt specifics

Under Nuxt, the module registers a Nuxt plugin that calls
`renderChemicalXState` during the server-side response and writes into
`nuxtApp.payload.chemicalX`. On the client, a companion plugin reads
from `nuxtApp.payload.chemicalX` and calls `hydrateChemicalXState`
before components mount. You don't wire any of this by hand.

If you need to inspect the payload during development (to confirm a
field's server value made it across), open the page source and look for
the `<script>` tag containing your Nuxt payload — `chemicalX` is a
top-level key.

## Common issues

**"The form is empty on the client even though the server rendered
values."** Two causes:

1. You forgot to call `hydrateChemicalXState` before `app.mount(...)`.
2. The form's `key` differs between server and client. Hard-code the
   key as a string literal, not a generated value like `uuidv4()` or
   `Math.random()`.

**"Field errors from the server disappear on first interaction."** By
design. Any mutation triggers the normal `handleSubmit` /
`validate()` pipeline, which re-runs schema validation and can replace
the errors. If you want server-provided errors to persist until the
field is dirtied, check `form.isDirty.value` before displaying them.

**"Some fields look right, others don't."** Compare the payload against
what you set on the server. `renderChemicalXState` runs against every
form currently in the registry — if a form was created after the
snapshot was taken, it won't be in the payload. Most consumers avoid
this by creating forms during setup (not in `onMounted` or event
handlers).

## Verifying the round-trip

The bare-Vue round-trip has an end-to-end test in
[`test/ssr-bare-vue/round-trip.test.ts`](../../test/ssr-bare-vue/round-trip.test.ts).
Reading it is faster than re-discovering the setup from scratch when
you're wiring a new project.
