// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { createApp, defineComponent, h, nextTick, type App } from 'vue'
import { z } from 'zod'
import { useForm } from '../../src/zod'
import { createChemicalXForms } from '../../src/runtime/core/plugin'
import type { UseAbstractFormReturnType } from '../../src/runtime/types/types-api'

/**
 * `form.meta.errors` iterates the schemaErrors Map in insertion order.
 * Per-field re-validation must preserve that order — typing into an
 * already-failing field shouldn't shuffle siblings to the top of the
 * aggregate. The previous `applySchemaErrorsForSubtree` deleted the
 * scheduled key before re-inserting, which moved it to the END of the
 * Map and re-ordered every aggregate read.
 *
 * Repro mirrors the spike's anonymous form (test #1):
 *   - email + password schema, both leaves invalid at construction.
 *   - whole-form validate seeds errors in adapter order (email first).
 *   - typing into `email` re-validates only that leaf and used to flip
 *     the aggregate to [password, email].
 */

type ApiFor<Schema extends z.ZodObject> = Omit<
  UseAbstractFormReturnType<z.output<Schema>>,
  'setValue'
> & {
  setValue: (path: string, value: unknown) => boolean
}

function mountForm<Schema extends z.ZodObject>(
  schema: Schema,
  defaultValues: NonNullable<Parameters<typeof useForm<Schema>>[0]['defaultValues']>
): { app: App; api: ApiFor<Schema> } {
  const handle: { api?: ApiFor<Schema> } = {}
  const App = defineComponent({
    setup() {
      handle.api = useForm({
        schema,
        key: `meta-order-${Math.random().toString(36).slice(2)}`,
        defaultValues,
        fieldValidation: { on: 'change', debounceMs: 0 },
      }) as unknown as ApiFor<Schema>
      return () => h('div')
    },
  })
  const app = createApp(App).use(createChemicalXForms({ override: true }))
  app.config.warnHandler = () => {}
  app.config.errorHandler = () => {}
  app.mount(document.createElement('div'))
  return { app, api: handle.api as ApiFor<Schema> }
}

async function flushValidations(): Promise<void> {
  await nextTick()
  await new Promise<void>((r) => setTimeout(r, 0))
  await nextTick()
}

describe('form.meta.errors — insertion-order stability across per-field re-validation', () => {
  const apps: App[] = []
  afterEach(() => {
    while (apps.length > 0) apps.pop()?.unmount()
  })

  const schema = z.object({
    email: z.email(),
    password: z.string().min(8, 'At least 8 characters.'),
  })

  it('per-field re-validation on the FIRST schema-declared field preserves aggregate order', async () => {
    const { app, api } = mountForm(schema, { email: '', password: '' })
    apps.push(app)

    // Seed the aggregate via a whole-form validation. handleSubmit's
    // failed branch calls setAllSchemaErrors with the full issue list
    // — that's what populates the Map in adapter (= schema-declaration)
    // order: email, then password.
    const handler = api.handleSubmit(
      async () => {},
      async () => {}
    )
    await handler()
    await flushValidations()

    const initialPaths = api.meta.errors.map((e) => e.path.join('.'))
    expect(initialPaths).toEqual(['email', 'password'])

    // Type into the FIRST-declared field. Without the fix, the
    // per-field re-validation would `delete('email')` then `set('email',
    // ...)` — moving email to the END of the Map's insertion order, so
    // the aggregate flips to [password, email].
    api.setValue('email', 'a')
    await flushValidations()

    const afterTypePaths = api.meta.errors.map((e) => e.path.join('.'))
    expect(afterTypePaths).toEqual(initialPaths)
  })

  it('multiple per-field re-validations on the same field do not shuffle siblings', async () => {
    const { app, api } = mountForm(schema, { email: '', password: '' })
    apps.push(app)

    const handler = api.handleSubmit(
      async () => {},
      async () => {}
    )
    await handler()
    await flushValidations()

    const initialPaths = api.meta.errors.map((e) => e.path.join('.'))

    api.setValue('email', 'a')
    await flushValidations()
    api.setValue('email', 'ab')
    await flushValidations()
    api.setValue('email', 'abc')
    await flushValidations()

    expect(api.meta.errors.map((e) => e.path.join('.'))).toEqual(initialPaths)
  })

  it('re-validating a passing field clears its slot but preserves remaining order', async () => {
    const { app, api } = mountForm(schema, { email: '', password: '' })
    apps.push(app)

    const handler = api.handleSubmit(
      async () => {},
      async () => {}
    )
    await handler()
    await flushValidations()

    expect(api.meta.errors.map((e) => e.path.join('.'))).toEqual(['email', 'password'])

    // Fix email → its key drops out. Password stays where it was.
    api.setValue('email', 'valid@example.com')
    await flushValidations()

    expect(api.meta.errors.map((e) => e.path.join('.'))).toEqual(['password'])

    // Break email again → it appends at the end (it's a "new" key now).
    // This is acceptable churn: insertion-order stability is for keys
    // that survive a re-validation, not for keys that come and go.
    api.setValue('email', 'a')
    await flushValidations()

    expect(api.meta.errors.map((e) => e.path.join('.'))).toEqual(['password', 'email'])
  })
})
