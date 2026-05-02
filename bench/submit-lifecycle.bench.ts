/**
 * Phase 9.10 bench: full submit lifecycle — validate + handleSubmit +
 * parseApiErrors → setFieldErrors.
 *
 * The keystroke bench measures a single-leaf mutation in isolation.
 * Real forms do more: validate on submit, maybe receive a 422 from the
 * backend, parse errors, write them. This bench times the round-trip
 * of those steps on a moderate form so regressions in
 * `process-form.ts` / `parse-api-errors.ts` surface in CI without
 * needing a user to complain.
 *
 * Reported absolute throughput; no regression floor gating yet.
 */
import { bench, describe } from 'vitest'
import { createSSRApp, defineComponent, h } from 'vue'
import { renderToString } from '@vue/server-renderer'
import { z } from 'zod'
import { useForm } from '../src/runtime/adapters/zod-v4'
import { parseApiErrors } from '../src/runtime/core/parse-api-errors'
import { createDecant } from '../src/runtime/core/plugin'

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
  app.use(createDecant({ override: true }))
  void renderToString(app)
  if (captured === undefined) throw new Error('useForm setup did not run')
  return captured
}

describe('submit-lifecycle: validate → handleSubmit → parseApiErrors → setFieldErrors', () => {
  const form = mount()
  // Seed a plausible-looking form value so validation hits the happy
  // path; the API error parse + write is the work we're really measuring.
  form.setValue('email', 'a@b.co')
  form.setValue('password', 'hunter2!!')
  form.setValue('profile.firstName', 'A')
  form.setValue('profile.lastName', 'B')
  form.setValue('profile.age' as never, 30 as never)

  const handler = form.handleSubmit(
    // eslint-disable-next-line @typescript-eslint/require-await
    async (_values) => {
      const result = parseApiErrors(
        {
          email: 'already taken',
          'profile.age': 'must be 18+',
        },
        { formKey: form.key }
      )
      if (result.ok) form.setFieldErrors(result.errors)
    }
  )

  bench('full submit cycle: validate + onSubmit + parse + setFieldErrors', async () => {
    await handler()
  })
})
