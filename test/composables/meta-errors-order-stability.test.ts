// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { createApp, defineComponent, h, nextTick, type App } from 'vue'
import { z } from 'zod'
import { useForm } from '../../src/zod'
import { createAttaform } from '../../src/runtime/core/plugin'
import type { UseFormReturnType } from '../../src/runtime/types/types-api'

/**
 * `form.meta.errors` is sorted by a stable schema-declaration ordinal.
 * The ordinal is assigned the FIRST time a path is seen (construction-
 * time walk for paths in the schema's slim default; lazy first-encounter
 * for DU variant-2 paths and dynamic array indices) and never lost.
 *
 * This means:
 *   1. Per-field re-validation doesn't shuffle siblings (the underlying
 *      Map's insertion-order churn is now invisible — sort runs at the
 *      computed-aggregate boundary).
 *   2. Resurrecting an error returns it to its original slot, NOT the
 *      end of the aggregate — clearing `email` then breaking it again
 *      produces `[email, password]`, not `[password, email]`.
 *
 * The repro that drove this design was the spike's anonymous form
 * (test #1): email + password, both invalid at construction; whole-form
 * validation seeded errors in adapter order; typing `a` into email used
 * to flip the aggregate to [password, email] before the schemaErrors
 * delete-then-set fix (b702c91), and used to land [password, email]
 * AFTER clear-and-re-introduce until this drop.
 */

type ApiFor<Schema extends z.ZodObject> = Omit<UseFormReturnType<z.output<Schema>>, 'setValue'> & {
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
        validateOn: 'change',
        debounceMs: 0,
      }) as unknown as ApiFor<Schema>
      return () => h('div')
    },
  })
  const app = createApp(App).use(createAttaform({ override: true }))
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

describe('form.meta.errors — schema-declaration ordinal sort', () => {
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

  it('resurrected error returns to its schema-declared slot', async () => {
    const { app, api } = mountForm(schema, { email: '', password: '' })
    apps.push(app)

    const handler = api.handleSubmit(
      async () => {},
      async () => {}
    )
    await handler()
    await flushValidations()

    expect(api.meta.errors.map((e) => e.path.join('.'))).toEqual(['email', 'password'])

    // Fix email → its key drops out of the underlying Map. Password
    // stays in its original slot.
    api.setValue('email', 'valid@example.com')
    await flushValidations()

    expect(api.meta.errors.map((e) => e.path.join('.'))).toEqual(['password'])

    // Re-break email. The path's ordinal was assigned at construction
    // (slot 0, ahead of password's slot 1) and the ordinal map never
    // shrinks — so the resurrected error sorts back to the front.
    api.setValue('email', 'a')
    await flushValidations()

    expect(api.meta.errors.map((e) => e.path.join('.'))).toEqual(['email', 'password'])
  })

  it('breaks land in declaration order regardless of which field broke first', async () => {
    // Mount with valid defaults — no errors at construction. Trigger
    // failures one at a time. Whichever field breaks first, the final
    // aggregate sorts by schema-declaration ordinal.
    const { app, api } = mountForm(schema, {
      email: 'valid@example.com',
      password: 'long-enough-password',
    })
    apps.push(app)
    await flushValidations()

    expect(api.meta.errors).toEqual([])

    // Break password FIRST (the second-declared field).
    api.setValue('password', 'a')
    await flushValidations()
    expect(api.meta.errors.map((e) => e.path.join('.'))).toEqual(['password'])

    // Then break email. Even though password was first temporally,
    // email's ordinal is lower (assigned at construction in
    // declaration order), so it sorts ahead.
    api.setValue('email', 'a')
    await flushValidations()
    expect(api.meta.errors.map((e) => e.path.join('.'))).toEqual(['email', 'password'])
  })

  it('reset preserves ordinals across re-trigger', async () => {
    const { app, api } = mountForm(schema, { email: '', password: '' })
    apps.push(app)

    const handler = api.handleSubmit(
      async () => {},
      async () => {}
    )
    await handler()
    await flushValidations()

    const beforeReset = api.meta.errors.map((e) => e.path.join('.'))
    expect(beforeReset).toEqual(['email', 'password'])

    api.reset()
    await flushValidations()
    expect(api.meta.errors).toEqual([])

    // Re-submit with the same default-empty state.
    await handler()
    await flushValidations()
    expect(api.meta.errors.map((e) => e.path.join('.'))).toEqual(beforeReset)
  })

  it('user-injected error at the same path sorts at the same slot as the schema error', async () => {
    const { app, api } = mountForm(schema, { email: '', password: '' })
    apps.push(app)

    const handler = api.handleSubmit(
      async () => {},
      async () => {}
    )
    await handler()
    await flushValidations()

    // Inject a user error AT password — same path as the existing
    // schema "too small" error. Both should end up in password's slot
    // (ordinal 1), in schema-then-user per-store order. email's
    // schema error stays at ordinal 0 in front.
    api.addFieldErrors([
      {
        path: ['password'],
        message: 'reused recently',
        formKey: api.key,
        code: 'user:reused',
      },
    ])
    await flushValidations()

    const codes = api.meta.errors.map((e) => `${e.path.join('.')}:${e.code}`)
    expect(codes).toEqual([
      'email:zod:invalid_format',
      'password:zod:too_small',
      'password:user:reused',
    ])
  })

  it('lazy-assigned paths get ordinals after construction-time leaves', async () => {
    // DU schema: variant 1 has `n` (numeric leaf, seeded at
    // construction). Variant 2 has `t` (string leaf — not numeric, so
    // not auto-blank, but its ordinal is still assigned at
    // construction by the diffAndApply walk if the slim default is
    // variant 1 only). `t` won't be in the slim default, so its
    // ordinal is assigned lazily on first error.
    const duSchema = z.object({
      notify: z.discriminatedUnion('kind', [
        z.object({ kind: z.literal('num'), n: z.number().min(1, 'must be >= 1') }),
        z.object({ kind: z.literal('txt'), t: z.string().min(3, 'must be >= 3 chars') }),
      ]),
      age: z.number().min(0),
    })
    const { app, api } = mountForm(duSchema, {
      notify: { kind: 'num', n: 0 },
      age: 0,
    })
    apps.push(app)
    await flushValidations()

    // Trigger errors on the variant-1 path first.
    const handler = api.handleSubmit(
      async () => {},
      async () => {}
    )
    await handler()
    await flushValidations()

    // notify.n declared first inside the union; age declared second
    // at the root. Both seeded at construction.
    const v1Errors = api.meta.errors.map((e) => e.path.join('.'))
    expect(v1Errors).toContain('notify.n')

    // Switch to variant 2. `notify.t` is a NEW path the construction
    // walk didn't visit — its ordinal is assigned lazily on first
    // metaErrors read after the variant write.
    api.setValue('notify', { kind: 'txt', t: '' })
    await flushValidations()
    await handler()
    await flushValidations()

    const v2Paths = api.meta.errors.map((e) => e.path.join('.'))
    expect(v2Paths).toContain('notify.t')
    // notify.t lands AFTER age (notify.t got the next available
    // ordinal, which is higher than every construction-seeded path).
    expect(v2Paths.indexOf('age')).toBeLessThan(v2Paths.indexOf('notify.t'))
  })
})
