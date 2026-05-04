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

  const mainCode = `import { createApp } from 'vue'
import { createAttaform } from 'attaform'
import App from './App.vue'

createApp(App).use(createAttaform()).mount('#app')`

  const store = useStore({
    builtinImportMap: ref(importMap),
  })

  store.setFiles(
    {
      'src/App.vue': appCode,
      'src/main.ts': mainCode,
    },
    'src/App.vue'
  )
</script>

<template>
  <div
    class="overflow-hidden rounded-lg border border-(--color-border)"
    :style="{ height: props.height }"
  >
    <Repl :store="store" :editor="CodeMirrorEditor" :show-compile-output="false" />
  </div>
</template>
