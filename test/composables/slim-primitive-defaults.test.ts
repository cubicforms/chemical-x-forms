// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { createApp, defineComponent, h, nextTick, type App } from 'vue'
import { z } from 'zod'
import { useForm } from '../../src/zod'
import { createChemicalXForms } from '../../src/runtime/core/plugin'

/**
 * `useForm({ defaultValues })` aligns with the runtime write contract:
 * primitive-correct values pass through unchanged; refinement-invalid
 * values pass through too (validation surfaces the error). Only
 * wrong-primitive defaults get fixed via the schema's primitive
 * default — the form must mount with a usable starting state.
 *
 * This is a behavior change from the previous "validate-then-fix
 * loop strips anything that fails the slim parse." The motivation:
 *
 *   1. Honest types — what consumers read MUST be what's storable.
 *      If `setValue('color', 'magenta')` is allowed at runtime,
 *      `defaultValues: { color: 'magenta' }` must also land
 *      unchanged.
 *   2. Saved-form rehydration — autosave / SSR / server-restore
 *      flows preserve refinement-invalid values that became invalid
 *      after the schema tightened. Today's strip behavior silently
 *      clobbers these.
 *   3. Visible failure — refinement errors surface via the strict-
 *      mode validation pass at construction. Silent rewriting is
 *      replaced with explicit error display.
 */

async function flush(): Promise<void> {
  for (let i = 0; i < 4; i++) {
    await Promise.resolve()
    await nextTick()
  }
}

function mountWith<S extends z.ZodObject>(
  schema: S,
  defaults: Partial<z.infer<S>>,
  strict: boolean = false
): { api: ReturnType<typeof useForm<S>>; app: App } {
  const captured: { api?: ReturnType<typeof useForm<S>> } = {}
  const App = defineComponent({
    setup() {
      const config = {
        schema,
        key: `slim-defaults-${Math.random().toString(36).slice(2)}`,
        strict,
        defaultValues: defaults,
      }
      captured.api = (useForm as (cfg: unknown) => ReturnType<typeof useForm<S>>)(config)
      return () => h('div')
    },
  })
  const app = createApp(App).use(createChemicalXForms())
  const root = document.createElement('div')
  document.body.appendChild(root)
  app.mount(root)
  return { api: captured.api as ReturnType<typeof useForm<S>>, app }
}

describe('slim-primitive defaults — refinement-invalid passes through', () => {
  const apps: App[] = []
  afterEach(async () => {
    while (apps.length > 0) apps.pop()?.unmount()
    await flush()
  })

  it("defaultValues: { color: 'teal' } against z.enum lands as 'teal'", async () => {
    const schema = z.object({ color: z.enum(['red', 'green', 'blue']) })
    const { api, app } = mountWith(schema, { color: 'teal' as 'red' })
    apps.push(app)
    expect(api.values.color).toBe('teal')
  })

  it("defaultValues: { email: 'luigi' } against z.string().email() lands as 'luigi'", async () => {
    const schema = z.object({ email: z.string().email() })
    const { api, app } = mountWith(schema, { email: 'luigi' })
    apps.push(app)
    expect(api.values.email).toBe('luigi')
  })

  it('defaultValues with too-short string against z.string().min(8) lands as the short string', async () => {
    const schema = z.object({ password: z.string().min(8) })
    const { api, app } = mountWith(schema, { password: 'abc' })
    apps.push(app)
    expect(api.values.password).toBe('abc')
  })

  it("defaultValues against z.literal('on'): 'off' passes through", async () => {
    const schema = z.object({ mode: z.literal('on') })
    const { api, app } = mountWith(schema, { mode: 'off' as 'on' })
    apps.push(app)
    expect(api.values.mode).toBe('off')
  })
})

describe('slim-primitive defaults — wrong-primitive fixed to schema default', () => {
  const apps: App[] = []
  afterEach(async () => {
    while (apps.length > 0) apps.pop()?.unmount()
    await flush()
  })

  it("defaultValues: { color: 1 } against z.enum lands as the schema default ('red')", async () => {
    const schema = z.object({ color: z.enum(['red', 'green', 'blue']) })
    const { api, app } = mountWith(schema, { color: 1 as unknown as 'red' })
    apps.push(app)
    expect(api.values.color).toBe('red')
  })

  it("defaultValues: { email: 1 } against z.string().email() lands as ''", async () => {
    const schema = z.object({ email: z.string().email() })
    const { api, app } = mountWith(schema, { email: 1 as unknown as string })
    apps.push(app)
    expect(api.values.email).toBe('')
  })

  it('defaultValues with wrong primitive nested in object: only the offending leaf is fixed', async () => {
    const schema = z.object({
      user: z.object({
        name: z.string(),
        age: z.number(),
      }),
    })
    const { api, app } = mountWith(schema, {
      user: { name: 'Bob', age: 'twenty' as unknown as number },
    })
    apps.push(app)
    // name passes through ('Bob'); age gets primitive-fixed (0).
    expect(api.values.user.name).toBe('Bob')
    expect(api.values.user.age).toBe(0)
  })
})

describe('slim-primitive defaults — strict-mode surfaces refinement errors at construction', () => {
  const apps: App[] = []
  afterEach(async () => {
    while (apps.length > 0) apps.pop()?.unmount()
    await flush()
  })

  it('strict mount with refinement-invalid default surfaces a field error', async () => {
    const schema = z.object({ color: z.enum(['red', 'green', 'blue']) })
    const { api, app } = mountWith(schema, { color: 'teal' as 'red' }, true)
    apps.push(app)
    // Strict-mode runs the FULL schema's safeParse at construction
    // and surfaces refinement errors. The form value is still 'teal'
    // (passes through), but fieldErrors/color is populated.
    expect(api.values.color).toBe('teal')
    const errs = api.errors.color
    expect(errs).toBeDefined()
    expect(errs?.length).toBeGreaterThan(0)
  })
})
