// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { createApp, defineComponent, h, nextTick, type App } from 'vue'
import { z as zV4 } from 'zod'
import { z as zV3 } from 'zod-v3'
import { useForm as useFormV4 } from '../../src/zod-v4'
import { useForm as useFormV3 } from '../../src/zod-v3'
import { createAttaform } from '../../src/runtime/core/plugin'

/**
 * Path-local validation contract — ancestor re-runs.
 *
 * Per-field validation only re-validates the touched path. Two
 * classes of constraint depend on state OUTSIDE that path and
 * therefore need ancestor re-runs after a mutation:
 *
 *   1. Array shape constraints (`.min`/`.max`/`.nonempty`/`.length`)
 *      depend on the array's length — which changes on every
 *      append/remove/insert/move/swap. After a structural mutation
 *      the array PATH must re-validate the array's own checks.
 *
 *   2. Object refinements (`.refine`/`.superRefine` on a parent
 *      object) depend on sibling field values. After a leaf mutation
 *      the parent's path must re-run the refinement.
 *
 * Both bugs were observed by a consumer dogfooding 0.16.3:
 *   - Bug 1: `.min(1)` array error never re-appears after
 *     `form.remove()` empties the array.
 *   - Bug 2: with `.refine()` on the parent object, clearing a
 *     leaf does not restore the leaf's `.min(1)` error.
 *
 * Scope: both adapters (v3 and v4). Same runtime contract —
 * `validateAtPath(value, path)` must surface every check that
 * applies AT `path`, including checks that live on the schema node
 * itself (array shape, object refines). If either adapter strips
 * checks during slim/path-walk, the bug surfaces here.
 */

const apps: App[] = []
afterEach(() => {
  while (apps.length > 0) apps.pop()?.unmount()
  document.body.innerHTML = ''
})

function mountWithApp<T>(setup: () => T): T {
  const handle: { captured?: T } = {}
  const App = defineComponent({
    setup() {
      handle.captured = setup()
      return () => h('div')
    },
  })
  const app = createApp(App).use(createAttaform({ override: true }))
  const root = document.createElement('div')
  document.body.appendChild(root)
  app.mount(root)
  apps.push(app)
  if (handle.captured === undefined) throw new Error('mountWithApp: setup never returned')
  return handle.captured
}

// `scheduleFieldValidation` runs through `Promise.resolve().then(...)` +
// adapter `safeParseAsync`. The chain is several microtasks deep —
// flush aggressively until the in-flight counter drops to zero so the
// assertion sees the post-validation state.
async function flushValidations(form: { meta: { validating: boolean } }): Promise<void> {
  for (let i = 0; i < 20; i++) {
    await nextTick()
    if (!form.meta.validating) break
  }
  // Two extra ticks so the final `.then` writing schemaErrors flushes
  // through Vue's reactive subscribers before the assertion reads.
  await nextTick()
  await nextTick()
}

type ErrorAtPath = (p: string) => Array<{ message: string }> | undefined
function errorsAt(form: { errors: unknown }): ErrorAtPath {
  return form.errors as unknown as ErrorAtPath
}

// -----------------------------------------------------------------------------
// Bug 1 — Array structural mutations re-validate parent array constraints
// -----------------------------------------------------------------------------

describe('Bug 1 — array .min(1) re-validates after append/remove', () => {
  it('v3: restores the array-level error when remove empties the array', async () => {
    const schema = zV3.object({
      items: zV3.array(zV3.string()).min(1, 'At least one item required'),
    })
    const form = mountWithApp(() =>
      useFormV3({
        schema,
        key: `bug1-v3-${Math.random()}`,
        strict: false,
        defaultValues: { items: [] },
      })
    )

    // Drive the initial error via handleSubmit, mirroring the bug repro.
    await form.handleSubmit(
      () => {},
      () => {}
    )()
    expect(errorsAt(form)('items')?.[0]?.message).toBe('At least one item required')

    // Append → array now satisfies .min(1) → array-level error must clear.
    form.append('items', '')
    await flushValidations(form)
    expect(errorsAt(form)('items')).toBeUndefined()

    // Remove → array empty again → array-level error must come back.
    form.remove('items', 0)
    await flushValidations(form)
    expect(errorsAt(form)('items')?.[0]?.message).toBe('At least one item required')
  })

  it('v4: restores the array-level error when remove empties the array', async () => {
    const schema = zV4.object({
      items: zV4.array(zV4.string()).min(1, 'At least one item required'),
    })
    const form = mountWithApp(() =>
      useFormV4({
        schema,
        key: `bug1-v4-${Math.random()}`,
        strict: false,
        defaultValues: { items: [] },
      })
    )

    await form.handleSubmit(
      () => {},
      () => {}
    )()
    expect(errorsAt(form)('items')?.[0]?.message).toBe('At least one item required')

    form.append('items', '')
    await flushValidations(form)
    expect(errorsAt(form)('items')).toBeUndefined()

    form.remove('items', 0)
    await flushValidations(form)
    expect(errorsAt(form)('items')?.[0]?.message).toBe('At least one item required')
  })
})

// -----------------------------------------------------------------------------
// Bug 2 — .refine() on a parent object preserves per-field re-validation
// -----------------------------------------------------------------------------

describe('Bug 2 — parent .refine does not break per-field revalidation', () => {
  it('v3: restores the leaf .min(1) error when the field is cleared', async () => {
    // `.refine()` on a v3 ZodObject returns `ZodEffects<ZodObject>` —
    // the public `useForm` signature narrows to `ZodObject`, so cast
    // here to exercise the same wrapped shape consumers hit when they
    // attach a cross-field refinement to the form's root schema.
    const schema = zV3
      .object({
        fromCountry: zV3.string().min(1, 'Required'),
        toCountry: zV3.string().min(1, 'Required'),
      })
      .refine((v) => v.fromCountry.trim().toLowerCase() !== v.toCountry.trim().toLowerCase(), {
        message: 'From and To must differ',
      })

    const form = mountWithApp(() =>
      useFormV3({
        schema: schema as unknown as zV3.ZodObject<{
          fromCountry: zV3.ZodString
          toCountry: zV3.ZodString
        }>,
        key: `bug2-v3-${Math.random()}`,
        strict: false,
        defaultValues: { fromCountry: '', toCountry: '' },
      })
    )

    await form.handleSubmit(
      () => {},
      () => {}
    )()
    expect(errorsAt(form)('fromCountry')?.[0]?.message).toBe('Required')

    // Type a value — leaf .min(1) now passes → error must clear.
    form.setValue('fromCountry', 'a')
    await flushValidations(form)
    expect(errorsAt(form)('fromCountry')).toBeUndefined()

    // Clear the value — leaf .min(1) fails again → error must return.
    form.setValue('fromCountry', '')
    await flushValidations(form)
    expect(errorsAt(form)('fromCountry')?.[0]?.message).toBe('Required')
  })

  it('v4: restores the leaf .min(1) error when the field is cleared', async () => {
    const schema = zV4
      .object({
        fromCountry: zV4.string().min(1, 'Required'),
        toCountry: zV4.string().min(1, 'Required'),
      })
      .refine((v) => v.fromCountry.trim().toLowerCase() !== v.toCountry.trim().toLowerCase(), {
        message: 'From and To must differ',
      })

    const form = mountWithApp(() =>
      useFormV4({
        schema,
        key: `bug2-v4-${Math.random()}`,
        strict: false,
        defaultValues: { fromCountry: '', toCountry: '' },
      })
    )

    await form.handleSubmit(
      () => {},
      () => {}
    )()
    expect(errorsAt(form)('fromCountry')?.[0]?.message).toBe('Required')

    form.setValue('fromCountry', 'a')
    await flushValidations(form)
    expect(errorsAt(form)('fromCountry')).toBeUndefined()

    form.setValue('fromCountry', '')
    await flushValidations(form)
    expect(errorsAt(form)('fromCountry')?.[0]?.message).toBe('Required')
  })
})
