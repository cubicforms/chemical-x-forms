<script setup lang="ts">
  import { Repl, useStore } from '@vue/repl'
  import CodeMirrorEditor from '@vue/repl/codemirror-editor'
  import '@vue/repl/style.css'

  const props = withDefaults(
    defineProps<{
      height?: string
    }>(),
    { height: '600px' }
  )

  const importMap = {
    imports: {
      vue: '/lib/vue.esm-browser.prod.js',
      zod: '/lib/zod.js',
      attaform: '/lib/attaform.js',
      'attaform/zod': '/lib/attaform-zod.js',
    },
  }

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
  <form @submit.prevent="onSubmit" style="display: flex; flex-direction: column; gap: 1rem; max-width: 360px;">
    <label style="display: flex; flex-direction: column; gap: 0.25rem;">
      <span>Email</span>
      <input v-register="form.register('email')" type="email" placeholder="you@example.com" />
      <small v-if="form.errors.email?.[0]" style="color: #dc2626;">
        {{ form.errors.email[0].message }}
      </small>
    </label>

    <label style="display: flex; flex-direction: column; gap: 0.25rem;">
      <span>Password</span>
      <input v-register="form.register('password')" type="password" />
      <small v-if="form.errors.password?.[0]" style="color: #dc2626;">
        {{ form.errors.password[0].message }}
      </small>
    </label>

    <button :disabled="form.meta.isSubmitting" type="submit" style="margin-top: 0.5rem;">
      Sign up
    </button>
  </form>
</template>`

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
    class="demo-repl overflow-hidden rounded-lg border border-(--color-border)"
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
