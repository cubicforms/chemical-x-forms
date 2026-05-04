<script setup lang="ts">
  import { Repl, useStore } from '@vue/repl'
  import MonacoEditor from '@vue/repl/monaco-editor'
  import '@vue/repl/style.css'

  const props = withDefaults(
    defineProps<{
      height?: string
    }>(),
    { height: '37.5rem' }
  )

  // Worker URL override — runs once at module load on the client.
  //
  // The Monaco preset bundles its workers and spawns them via
  // `new Worker(new URL("assets/<chunk>.js", import.meta.url), { type: 'module' })`.
  // In dev, Vite injects its `@vite/client` HMR bootstrap into those
  // worker files — and @vite/client's module-level WebSocket setup
  // fails to handshake from a worker context, killing every worker
  // at startup. The `bundle-repl-deps.mjs` script copies clean
  // copies of those worker chunks to `/lib/repl-workers/`, served
  // by Nitro as static files (no Vite injection).
  //
  // We can't replace `MonacoEnvironment.getWorker` directly: the
  // @vue/repl bundle's getWorker does a non-trivial init handshake
  // for the Vue worker (postMessage of resourceLinks, tsVersion,
  // etc.) that our override would have to reimplement against the
  // store. Instead, monkey-patch the `Worker` constructor itself —
  // intercept only the `assets/(editor|vue).worker-*.js` URLs and
  // rewrite them to the static copies, leaving every other Worker
  // construction alone. The init handshake then runs unchanged
  // because @vue/repl doesn't care which URL the worker came from.
  if (import.meta.client && !('__attaformReplWorkerPatched' in self)) {
    Object.defineProperty(self, '__attaformReplWorkerPatched', { value: true })
    const Original = self.Worker
    const REPL_WORKER_RE = /assets\/(editor|vue)\.worker-[^/]+\.js(?:[?#]|$)/
    self.Worker = new Proxy(Original, {
      construct(target, args: ConstructorParameters<typeof Worker>) {
        const [src, options] = args
        const href = src instanceof URL ? src.href : String(src)
        const match = REPL_WORKER_RE.exec(href)
        if (match) {
          const label = match[1]
          return new target(`/lib/repl-workers/${label}.worker.js`, options)
        }
        return new target(src, options)
      },
    })
  }

  const importMap = {
    imports: {
      vue: '/lib/vue.esm-browser.prod.js',
      zod: '/lib/zod.js',
      attaform: '/lib/attaform.js',
      'attaform/zod': '/lib/attaform-zod.js',
    },
  }

  // Sample app served by the REPL preview iframe. Hand-written here
  // (rather than imported from a fixture file) because @vue/repl reads
  // it as a single string. The closing script + style tags inside the
  // template literal are split via interpolation (e.g. ${'</' + 'script>'})
  // so the HTML parser of the *outer* SFC doesn't terminate this
  // script block early. Visual styling lives in a dedicated style
  // block at the end of the example — the template uses semantic
  // class names (form, field, submit, …) so a reader can see the
  // form structure without parsing inline declarations.
  //
  // The top-of-file comment is intentional: it invites the visitor
  // to hover the highlighted symbols once Monaco loads, surfacing
  // the typed shapes that schema-first forms produce. That's the
  // marquee demonstration of the library — types you can see, not
  // types you have to take on faith.
  const appCode = `<${'script'} setup lang="ts">
// 👇 Hover \`useForm\`, \`form.register\`, or \`form.errors\` to see
//    the inferred types — every path and value below is derived
//    from the schema, no manual type plumbing.

import { z } from 'zod'
import { useForm } from 'attaform/zod'

const schema = z.object({
  email: z.email(),
  password: z.string().min(8, 'At least 8 characters'),
})

const form = useForm({ schema, key: 'signup' })

const onSubmit = form.handleSubmit(async (values) => {
  alert('Submitted: ' + JSON.stringify(values, null, 2))
})
${'</'}script>

<template>
  <div class="page">
    <form class="form" @submit.prevent="onSubmit">
      <header class="form-header">
        <h1>Create your account</h1>
        <p>Free forever · No credit card required</p>
      </header>

      <div class="field" :class="{ invalid: form.errors.email?.[0] }">
        <label for="email">Email</label>
        <input
          v-register="form.register('email')"
          id="email"
          type="email"
          autocomplete="email"
          placeholder="you@company.com"
        />
        <small v-if="form.errors.email?.[0]" class="error">
          {{ form.errors.email[0].message }}
        </small>
      </div>

      <div class="field" :class="{ invalid: form.errors.password?.[0] }">
        <label for="password">Password</label>
        <input
          v-register="form.register('password')"
          id="password"
          type="password"
          autocomplete="new-password"
          placeholder="At least 8 characters"
        />
        <small v-if="form.errors.password?.[0]" class="error">
          {{ form.errors.password[0].message }}
        </small>
      </div>

      <button class="submit" type="submit" :disabled="form.meta.isSubmitting">
        {{ form.meta.isSubmitting ? 'Creating account…' : 'Create account' }}
      </button>
    </form>
  </div>
</template>

<style>
* { box-sizing: border-box; }

body {
  margin: 0;
  padding: 0;
  background: #F9FAFB;
  font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
  font-feature-settings: 'cv11', 'ss01', 'ss03';
  color: #101828;
  -webkit-font-smoothing: antialiased;
}

.page {
  display: flex;
  align-items: flex-start;
  justify-content: center;
  min-height: 100vh;
  padding: 2rem 1rem;
}

/* ─── Card ─── */

.form {
  width: 100%;
  max-width: 25rem;
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
  padding: 2rem;
  background: #FFFFFF;
  border: 0.0625rem solid #EAECF0;
  border-radius: 0.75rem;
  box-shadow:
    0 0.0625rem 0.1875rem 0 rgb(16 24 40 / 0.10),
    0 0.0625rem 0.125rem -0.0625rem rgb(16 24 40 / 0.06);
}

.form-header {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  margin-bottom: 0.25rem;
}

.form-header h1 {
  margin: 0;
  font-size: 1.5rem;
  font-weight: 600;
  letter-spacing: -0.012em;
  color: #101828;
}

.form-header p {
  margin: 0;
  font-size: 0.875rem;
  color: #667085;
}

/* ─── Field ─── */

.field {
  display: flex;
  flex-direction: column;
  gap: 0.375rem;
}

.field label {
  font-size: 0.875rem;
  font-weight: 500;
  color: #344054;
}

.field input {
  height: 2.5rem;
  padding: 0 0.875rem;
  border: 0.0625rem solid #D0D5DD;
  border-radius: 0.5rem;
  background: #FFFFFF;
  color: #101828;
  font: inherit;
  font-size: 1rem;
  outline: none;
  box-shadow: 0 0.0625rem 0.125rem 0 rgb(16 24 40 / 0.05);
  transition:
    border-color 120ms cubic-bezier(0.165, 0.84, 0.44, 1),
    box-shadow 120ms cubic-bezier(0.165, 0.84, 0.44, 1);
}

.field input::placeholder {
  color: #98A2B3;
}

.field input:hover {
  border-color: #98A2B3;
}

.field input:focus {
  border-color: #BDB4FE;
  box-shadow:
    0 0 0 0.25rem #EBE9FE,
    0 0.0625rem 0.125rem 0 rgb(16 24 40 / 0.05);
}

.field.invalid input {
  border-color: #FDA29B;
}

.field.invalid input:focus {
  box-shadow:
    0 0 0 0.25rem #FEE4E2,
    0 0.0625rem 0.125rem 0 rgb(16 24 40 / 0.05);
}

.field .error {
  font-size: 0.875rem;
  color: #B42318;
}

/* ─── Submit button ─── */

.submit {
  height: 2.5rem;
  margin-top: 0.25rem;
  padding: 0 1.125rem;
  border: none;
  border-radius: 0.5rem;
  background: #6938EF;
  color: #FFFFFF;
  font: inherit;
  font-size: 0.875rem;
  font-weight: 600;
  cursor: pointer;
  box-shadow: 0 0.0625rem 0.125rem 0 rgb(16 24 40 / 0.05);
  transition:
    background-color 120ms cubic-bezier(0.165, 0.84, 0.44, 1),
    box-shadow 120ms cubic-bezier(0.165, 0.84, 0.44, 1);
}

.submit:hover:not(:disabled) {
  background: #5925DC;
}

.submit:focus-visible {
  outline: none;
  box-shadow:
    0 0 0 0.25rem #EBE9FE,
    0 0.0625rem 0.125rem 0 rgb(16 24 40 / 0.05);
}

.submit:disabled {
  background: #F2F4F7;
  color: #98A2B3;
  box-shadow: none;
  cursor: not-allowed;
}
${'</'}style>`

  // @vue/repl auto-creates the Vue app and mounts it from `mainFile`. To
  // install our plugin we use previewOptions.customCode — `importCode`
  // appends to the iframe's import block, `useCode` runs after
  // `const app = createApp(AppComponent)` and before `app.mount('#app')`.
  // Without this the REPL boots a bare Vue app and `useForm()` throws
  // "Registry not found" because createAttaform()'s plugin never runs.
  const previewOptions = {
    customCode: {
      importCode: `import { createAttaform } from 'attaform'`,
      useCode: `app.use(createAttaform())`,
    },
  }

  // Route the three packages we self-host through their /lib/types/ URLs.
  // Volar (via @vue/repl's Monaco bundle) calls `pkgFileTextUrl(pkgName,
  // pkgVersion, pkgPath)` whenever the language service needs a file
  // from a package — package.json, the entry .d.ts, or any deeply-
  // imported sibling. We answer with our own origin so the editor never
  // hits a CDN.
  //
  // Anything outside our allowlist falls through to @vue/repl's default
  // jsdelivr resolver. That happens occasionally for type-only deps
  // Volar wants to peek at (e.g. transitive @types/* packages); we
  // accept the CDN fetch there because shipping the long tail ourselves
  // isn't worth the build complexity.
  //
  // Two non-obvious constraints, both imposed by @vue/repl shipping
  // the resolver string-serialized to the type-checking worker:
  //
  //   1. Must be an arrow function (or function expression). The worker
  //      reconstructs via `Function('return ' + str)()` (vue.worker.js
  //      `createFunc`). Method-shorthand `pkgFileTextUrl(...) { ... }`
  //      gives `return pkgFileTextUrl(...) { ... }` — a syntax error.
  //   2. No closure over outer scope. The reconstructed function runs
  //      in the worker's global scope; references to module-scoped
  //      consts (e.g. `SELF_HOSTED_PKGS`) become ReferenceErrors.
  //      Inline the package allowlist into the function body.
  //
  // useStore types `resourceLinks` as a Ref so consumers can swap the
  // resolver at runtime (e.g. on a "load my own types" toggle). We
  // never reassign it, but the type still demands a Ref wrapper.
  const resourceLinks = ref({
    pkgFileTextUrl: (pkgName: string, _pkgVersion: string | undefined, pkgPath: string) => {
      if (pkgName === 'attaform' || pkgName === 'vue' || pkgName === 'zod') {
        return `/lib/types/${pkgName}/${pkgPath}`
      }
      return `https://cdn.jsdelivr.net/npm/${pkgName}/${pkgPath}`
    },
  })

  // Monaco theme follows the site's color mode. @vue/repl's Monaco
  // preset uses Shiki for highlighting, so theme names are Shiki's
  // (`dark-plus` / `light-plus`, the VSCode Dark+/Light+ defaults
  // bundled into the @vue/repl Monaco preset). Passing Monaco's stock
  // `vs` / `vs-dark` here throws `ShikiError: Theme not found` at
  // editor mount because Shiki has nothing registered under those
  // names.
  const colorMode = useColorMode()
  const monacoOptions = computed(() => ({
    theme: colorMode.value === 'dark' ? 'dark-plus' : 'light-plus',
    fontSize: 13,
    fontFamily:
      "'JetBrains Mono', ui-monospace, SFMono-Regular, 'Fira Code', Menlo, Consolas, monospace",
    fontLigatures: true,
    minimap: { enabled: false },
    scrollBeyondLastLine: false,
    renderLineHighlight: 'gutter' as const,
    smoothScrolling: true,
  }))
  const editorOptions = computed(() => ({
    monacoOptions: monacoOptions.value,
  }))

  const store = useStore({
    builtinImportMap: ref(importMap),
    resourceLinks,
  })

  store.setFiles({ 'src/App.vue': appCode }, 'src/App.vue')
</script>

<template>
  <div
    class="demo-repl overflow-hidden rounded-xl border bg-bg shadow-sm"
    :style="{ height: props.height }"
  >
    <Repl
      :store="store"
      :editor="MonacoEditor"
      :preview-options="previewOptions"
      :editor-options="editorOptions"
      :show-compile-output="false"
    />
  </div>
</template>

<style>
  /* @vue/repl's default compile-error overlay (.msg.err) is alarm-red
     and instant — every keystroke that lands on incomplete TS flashes
     a giant red panel across the bottom of the iframe. For a demo on a
     marketing page that's hostile UX. Two changes:

     1. Defer fade-in to ~600ms so transient mid-keystroke errors don't
        get a chance to flash before the next character makes it valid
        again. Genuine "I left it broken" errors still surface, just
        without the strobe effect.
     2. Tone the palette down — a small bottom strip with a left
        accent bar instead of the full-width alarmscape, so when it
        does show it reads as feedback rather than failure. */
  .demo-repl .msg.err {
    --color: var(--color-fg-muted);
    --bg-color: color-mix(in oklch, var(--color-surface), transparent 10%);
    border-width: 0 0 0 0.1875rem;
    border-radius: 0.25rem;
    backdrop-filter: blur(0.375rem);
    font-size: 0.8125rem;
    max-height: 6rem;
    overflow: auto;
  }
  .demo-repl .msg.err pre {
    padding: 0.5rem 0.75rem;
  }
  .demo-repl .fade-enter-active {
    transition-delay: 600ms;
  }
  .demo-repl .fade-leave-active {
    transition-delay: 0ms;
  }
</style>
