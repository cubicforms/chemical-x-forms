# `attaform/nuxt`

A Nuxt module that installs the plugin, registers the node
transforms, and auto-imports `useForm`. Add to `nuxt.config.ts`:

```ts
export default defineNuxtConfig({
  modules: ['attaform/nuxt'],
})
```

Under Nuxt, `useForm` is globally available — no explicit import
needed.
