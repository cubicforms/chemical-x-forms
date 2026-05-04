<script setup lang="ts">
  import { Repl, useStore } from '@vue/repl'
  import MonacoEditor from '@vue/repl/monaco-editor'
  import '@vue/repl/style.css'

  // Sizing + lifecycle (SSR skeleton, deferred mount, route-leave
  // guard) live on the parent `<DemoRepl>` shell. This component is
  // pure editor: it expects to be mounted only when the host wrapper
  // is in the DOM and the page transition has settled, so the
  // Sandbox-iframe race documented at the top of `<DemoRepl>` can't
  // fire here.

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
  const appCode = `<${'script'} setup lang="ts">
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

      <div class="field" :class="{ invalid: form.fields.email.touched && form.errors.email?.[0] }">
        <label for="email">Email</label>
        <input
          v-register="form.register('email')"
          id="email"
          type="email"
          autocomplete="email"
          placeholder="you@company.com"
        />
        <small class="error">
          {{ (form.fields.email.touched && form.errors.email?.[0]?.message) || '' }}
        </small>
      </div>

      <div class="field" :class="{ invalid: form.fields.password.touched && form.errors.password?.[0] }">
        <label for="password">Password</label>
        <input
          v-register="form.register('password')"
          id="password"
          type="password"
          autocomplete="new-password"
          placeholder="At least 8 characters"
        />
        <small class="error">
          {{ (form.fields.password.touched && form.errors.password?.[0]?.message) || '' }}
        </small>
      </div>

      <button
        class="submit"
        type="submit"
        :disabled="form.meta.isSubmitting || !form.meta.isValid"
      >
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
  display: block;
  font-size: 0.8125rem;
  line-height: 1.125rem;
  min-height: 1.125rem;
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
  // Volar (via @vue/repl's Monaco bundle) needs THREE callbacks wired up
  // on `resourceLinks` for self-hosted type bundles to work. Missing any
  // one of them silently falls back to unpkg, which doesn't have our
  // pre-release attaform — so symbols resolve to nothing.
  //
  //   - pkgFileTextUrl: returns the URL for a single file inside the
  //     package (`<pkg>/<path>`). The LSP fetches package.json, .d.ts
  //     entries, and stub runtime entries through this.
  //   - pkgDirUrl: returns the URL for a JSON directory listing of the
  //     package (the file is `meta.json`, format `{ files: [...] }`,
  //     mimicking unpkg's `?meta` endpoint). Volar's worker uses this
  //     for EVERY file-existence check via _stat — without it, the LSP
  //     can't confirm `attaform/zod.d.ts` exists and resolution fails.
  //   - pkgLatestVersionUrl: returns a URL whose JSON exposes a
  //     `version` field. Defaults to unpkg's "@latest/package.json".
  //     We point it at our package.json. Strictly speaking this gets
  //     skipped when `dependencyVersion` (below) pins the version, but
  //     leaving it in keeps the fallback path local-only.
  //
  // Anything outside our allowlist falls through to @vue/repl's default
  // unpkg resolver. That happens occasionally for transitive type-only
  // deps; we accept the CDN fetch there.
  //
  // Two non-obvious constraints, both imposed by @vue/repl shipping
  // these resolvers string-serialized to the type-checking worker:
  //
  //   1. Must be an arrow function (or function expression). The worker
  //      reconstructs via `Function('return ' + str)()` (vue.worker.js
  //      `createFunc`). Method-shorthand `name(...) { ... }` gives
  //      `return name(...) { ... }` — a syntax error.
  //   2. No closure over outer scope. The reconstructed function runs
  //      in the worker's global scope; module-scoped consts become
  //      ReferenceErrors. Inline the package allowlist in each body.
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
    pkgDirUrl: (pkgName: string, _pkgVersion: string | undefined, _pkgPath: string) => {
      if (pkgName === 'attaform' || pkgName === 'vue' || pkgName === 'zod') {
        return `/lib/types/${pkgName}/meta.json`
      }
      return `https://unpkg.com/${pkgName}@${_pkgVersion || 'latest'}/${_pkgPath}/?meta`
    },
    pkgLatestVersionUrl: (pkgName: string) => {
      if (pkgName === 'attaform' || pkgName === 'vue' || pkgName === 'zod') {
        return `/lib/types/${pkgName}/package.json`
      }
      return `https://unpkg.com/${pkgName}@latest/package.json`
    },
  })

  // Pin the versions Volar uses when constructing CDN-style URLs. Without
  // this, the worker treats every package as "latest" and round-trips
  // through pkgLatestVersionUrl (slow, and unpkg doesn't have our
  // pre-release attaform). The values flow into the worker's
  // `dependencies` map and short-circuit the latest-version lookup.
  //
  // Versions come from `runtimeConfig.public.replDependencyVersion`,
  // populated in nuxt.config.ts by reading attaform's, vue's, and
  // zod's actual package.json files. That way a `pnpm version` bump
  // updates everything in lockstep, including what `bundle-repl-deps.mjs`
  // writes into each virtual package.json — no hard-coded literal
  // here to forget about when the lib promotes from -rc.x to stable.
  const { replDependencyVersion } = useRuntimeConfig().public
  const dependencyVersion = ref(replDependencyVersion)

  // Monaco theme follows the site's color mode via the `<Repl>`
  // component's reactive `theme` prop ('light' | 'dark'). The
  // Monaco preset internally maps that to Shiki's bundled
  // `light-plus` / `dark-plus` and re-applies on change via
  // `editor.updateOptions`. Don't set `theme` in `monacoOptions`
  // here — it spreads AFTER the prop-derived default at construct
  // time and would never change again because the preset's watcher
  // only listens on the `<Repl>` prop.
  const colorMode = useColorMode()
  const replTheme = computed(() => (colorMode.value === 'dark' ? 'dark' : 'light'))
  const monacoOptions = {
    fontSize: 13,
    fontFamily:
      "'JetBrains Mono', ui-monospace, SFMono-Regular, 'Fira Code', Menlo, Consolas, monospace",
    fontLigatures: true,
    minimap: { enabled: false },
    scrollBeyondLastLine: false,
    renderLineHighlight: 'gutter' as const,
    smoothScrolling: true,
  }
  // `showErrorText: false` and `autoSaveText: false` opt out of the
  // "Show Error" / "Auto Save" toggle buttons @vue/repl floats in the
  // bottom-right of the editor pane (`.editor-floating` strip in
  // EditorContainer.vue). The toggles are gated on
  // `editorOptions.showErrorText !== false` / `autoSaveText !== false`,
  // so passing literal `false` short-circuits both renders. Auto-save
  // stays on by default for the underlying store, so the editor still
  // commits on each keystroke; we just don't surface the toggle.
  const editorOptions = {
    monacoOptions,
    showErrorText: false as const,
    autoSaveText: false as const,
  }

  const store = useStore({
    builtinImportMap: ref(importMap),
    resourceLinks,
    dependencyVersion,
  })

  store.setFiles({ 'src/App.vue': appCode }, 'src/App.vue')
</script>

<template>
  <Repl
    :store="store"
    :editor="MonacoEditor"
    :theme="replTheme"
    :preview-options="previewOptions"
    :editor-options="editorOptions"
    :show-compile-output="false"
    :show-import-map="false"
    :show-tsconfig="false"
  />
</template>

<!-- Visual overrides for the rendered Repl (error overlay tone, hidden
     "+" file-add button, "preview" → "Preview" tab label) live on the
     SSR-rendered parent `<DemoRepl>` so they're in the page stylesheet
     before this client-only component hydrates and renders. -->
