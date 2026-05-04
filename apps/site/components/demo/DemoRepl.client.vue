<script setup lang="ts">
  import { Repl, useStore } from '@vue/repl'
  import CodeMirrorEditor from '@vue/repl/codemirror-editor'
  import '@vue/repl/style.css'

  const props = withDefaults(
    defineProps<{
      height?: string
    }>(),
    { height: '37.5rem' }
  )

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
  const appCode = `<script setup lang="ts">
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
  padding: 32px 16px;
}

/* ─── Card ─── */

.form {
  width: 100%;
  max-width: 400px;
  display: flex;
  flex-direction: column;
  gap: 20px;
  padding: 32px;
  background: #FFFFFF;
  border: 1px solid #EAECF0;
  border-radius: 12px;
  box-shadow:
    0 1px 3px 0 rgb(16 24 40 / 0.10),
    0 1px 2px -1px rgb(16 24 40 / 0.06);
}

.form-header {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-bottom: 4px;
}

.form-header h1 {
  margin: 0;
  font-size: 24px;
  font-weight: 600;
  letter-spacing: -0.012em;
  color: #101828;
}

.form-header p {
  margin: 0;
  font-size: 14px;
  color: #667085;
}

/* ─── Field ─── */

.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.field label {
  font-size: 14px;
  font-weight: 500;
  color: #344054;
}

.field input {
  height: 40px;
  padding: 0 14px;
  border: 1px solid #D0D5DD;
  border-radius: 8px;
  background: #FFFFFF;
  color: #101828;
  font: inherit;
  font-size: 16px;
  outline: none;
  box-shadow: 0 1px 2px 0 rgb(16 24 40 / 0.05);
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
    0 0 0 4px #EBE9FE,
    0 1px 2px 0 rgb(16 24 40 / 0.05);
}

.field.invalid input {
  border-color: #FDA29B;
}

.field.invalid input:focus {
  box-shadow:
    0 0 0 4px #FEE4E2,
    0 1px 2px 0 rgb(16 24 40 / 0.05);
}

.field .error {
  font-size: 14px;
  color: #B42318;
}

/* ─── Submit button ─── */

.submit {
  height: 40px;
  margin-top: 4px;
  padding: 0 18px;
  border: none;
  border-radius: 8px;
  background: #6938EF;
  color: #FFFFFF;
  font: inherit;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  box-shadow: 0 1px 2px 0 rgb(16 24 40 / 0.05);
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
    0 0 0 4px #EBE9FE,
    0 1px 2px 0 rgb(16 24 40 / 0.05);
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

  const store = useStore({
    builtinImportMap: ref(importMap),
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
      :editor="CodeMirrorEditor"
      :preview-options="previewOptions"
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
    border-width: 0 0 0 3px;
    border-radius: 4px;
    backdrop-filter: blur(6px);
    font-size: 0.8125rem;
    max-height: 6rem;
    overflow: auto;
  }
  .demo-repl .msg.err pre {
    padding: 8px 12px;
  }
  .demo-repl .fade-enter-active {
    transition-delay: 600ms;
  }
  .demo-repl .fade-leave-active {
    transition-delay: 0ms;
  }
</style>
