/**
 * Phase 9.10 bench: full submit lifecycle — validate + handleSubmit +
 * setFieldErrorsFromApi.
 *
 * The keystroke bench measures a single-leaf mutation in isolation.
 * Real forms do more: validate on submit, maybe receive a 422 from the
 * backend, hydrate errors, show them. This bench times the round-trip
 * of those steps on a moderate form so regressions in
 * `process-form.ts` / `hydrate-api-errors.ts` surface in CI without
 * needing a user to complain.
 *
 * Reported absolute throughput; no regression floor gating yet.
 */
import { bench, describe } from 'vitest'
import { createSSRApp, defineComponent, h } from 'vue'
import { renderToString } from '@vue/server-renderer'
import { z } from 'zod'
import { useForm } from '../src/runtime/adapters/zod-v4'
import { createChemicalXForms } from '../src/runtime/core/plugin'

const schema = z.object({
  email: z.string(),
  password: z.string(),
  profile: z.object({
    firstName: z.string(),
    lastName: z.string(),
    age: z.number(),
  }),
  preferences: z.object({
    newsletter: z.boolean(),
    theme: z.enum(['light', 'dark']),
  }),
})

function mount() {
  let captured: ReturnType<typeof useForm<typeof schema>> | undefined
  const App = defineComponent({
    setup() {
      captured = useForm({ schema, key: `bench-submit-${Math.random()}` })
      return () => h('div')
    },
  })
  const app = createSSRApp(App)
  app.use(createChemicalXForms({ override: true }))
  void renderToString(app)
  if (captured === undefined) throw new Error('useForm setup did not run')
  return captured
}

describe('submit-lifecycle: validate → handleSubmit → setFieldErrorsFromApi', () => {
  const form = mount()
  // Seed a plausible-looking form value so validation hits the happy
  // path; the API error hydration is the work we're really measuring.
  form.setValue('email', 'a@b.co')
  form.setValue('password', 'hunter2!!')
  form.setValue('profile.firstName', 'A')
  form.setValue('profile.lastName', 'B')
  form.setValue('profile.age' as never, 30 as never)

  const handler = form.handleSubmit(
    // eslint-disable-next-line @typescript-eslint/require-await
    async (_values) => {
      form.setFieldErrorsFromApi({
        email: 'already taken',
        'profile.age': 'must be 18+',
      })
    }
  )

  bench('full submit cycle: validate + onSubmit + API error hydrate', async () => {
    await handler()
  })
})
