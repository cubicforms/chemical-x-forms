// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { createApp, defineComponent, h, nextTick, type App } from 'vue'
import { z } from 'zod'
import { unset, useForm } from '../../src/zod'
import { createChemicalXForms } from '../../src/runtime/core/plugin'
import type { UseAbstractFormReturnType, ValidationError } from '../../src/runtime/types/types-api'

/**
 * Regression coverage for failure modes observed in spike-cx.vue
 * (`profileSchema`) when the user toggles the discriminated-union
 * channel back and forth (email → sms → email):
 *
 * 1. Errors at the new variant's required leaf land at the WRONG key
 *    in the schemaErrors store. Pre-fix, the field-validation pipeline
 *    wrote ALL DU child errors under the SCHEDULED path key
 *    (`['notify']`) rather than each error's own leaf path — so the
 *    materialised tree showed `notify: [errors]` instead of
 *    `notify: { number: [errors] }`, and per-leaf reads
 *    (`form.errors('notify.number')`) missed because the canonical
 *    key lookup expected `["notify","number"]`.
 *
 * 2. Stale leaf errors from a previous variant survived re-validation:
 *    after email→sms, a `notify.address` entry written by the
 *    email-variant pass kept living in `schemaErrors` because the
 *    container-key clear (`schemaErrors.delete(["notify"])`) didn't
 *    touch descendants. `form.meta.errors` leaked the ghost.
 *
 * 3. `notify.address`'s blank-mark (set via `unset` at mount) didn't
 *    survive a round-trip — both the keying bug and the ghost-entry
 *    bug compounded, hiding the "No value supplied" derived error
 *    from the materialised tree on the way back to email.
 *
 * Fixed by leaf-keying schemaErrors writes in `scheduleFieldValidation`
 * + clearing the entire descendant subtree of the scheduled path
 * before each write. See `applySchemaErrorsForSubtree` in
 * create-form-store.ts.
 *
 * Mirrors the spike schema: `notify.address` is `z.email()` (so an
 * empty string fails format), `notify.number` is `z.string().min(7)`,
 * `notify.address` mounts as `unset` to seed the blank derived error.
 */

const profileSchema = z.object({
  name: z.string().min(1, 'Required.'),
  notify: z.discriminatedUnion('channel', [
    z.object({ channel: z.literal('email'), address: z.email() }),
    z.object({ channel: z.literal('sms'), number: z.string().min(7) }),
  ]),
})

// Loose API type — these tests cross variants via setValue, which
// the strict inferred type doesn't permit (variant-only keys aren't
// in the WriteShape). The runtime accepts the calls; we widen the
// surface here so each call site doesn't need a per-line cast.
type ProfileApi = Omit<UseAbstractFormReturnType<z.output<typeof profileSchema>>, 'setValue'> & {
  setValue: (path: string, value: unknown) => boolean
}

type MountResult = {
  app: App
  api: ProfileApi
  warnings: string[]
  errorsObserved: unknown[]
}

function mount(
  defaultValues: NonNullable<Parameters<typeof useForm<typeof profileSchema>>[0]['defaultValues']>
): MountResult {
  const handle: { api?: ProfileApi } = {}
  const warnings: string[] = []
  const errorsObserved: unknown[] = []
  const App = defineComponent({
    setup() {
      handle.api = useForm({
        schema: profileSchema,
        key: `du-error-regression-${Math.random().toString(36).slice(2)}`,
        defaultValues,
        // Immediate field validation so tests don't have to flush a
        // Disable debouncing so the test sees the schema's verdict on
        // the same tick as the write. Behaviour under test (error-
        // keying after reshape, blank-mark round-trip, recursion)
        // doesn't depend on the debounce — it depends on what
        // schema-validation does to the stores once it runs.
        updateOn: 'change',
        debounceMs: 0,
      }) as unknown as ProfileApi
      return () => h('div')
    },
  })
  const app = createApp(App).use(createChemicalXForms({ override: true }))
  app.config.warnHandler = (msg: string) => {
    warnings.push(msg)
  }
  app.config.errorHandler = (err: unknown) => {
    errorsObserved.push(err)
  }
  const root = document.createElement('div')
  document.body.appendChild(root)
  app.mount(root)
  return { app, api: handle.api as ProfileApi, warnings, errorsObserved }
}

/** Flush microtasks + a debounce-resilient real-timer wait. */
async function flushValidations(): Promise<void> {
  await nextTick()
  await new Promise<void>((r) => setTimeout(r, 0))
  await nextTick()
}

describe('DU variant switch — error materialisation regressions', () => {
  const apps: App[] = []
  afterEach(() => {
    while (apps.length > 0) apps.pop()?.unmount()
    document.body.innerHTML = ''
  })

  it('after email→sms switch, errors at notify.number land at the correct nested path', async () => {
    const { app, api } = mount({
      name: 'Ada',
      notify: { channel: 'email', address: 'a@b.com' },
    })
    apps.push(app)

    // Switch to sms — number is empty, .min(7) fails. The reshape
    // triggers scheduleFieldValidation at the DU container path
    // ['notify']. Expectation: errors land keyed at the leaf path
    // ['notify','number'] so the materialised tree is
    // `{ notify: { number: [errors] } }` and per-leaf reads work.
    api.setValue('notify.channel', 'sms')
    await flushValidations()

    // Per-leaf read: the canonical key lookup must hit. Today this
    // returns undefined because the schemaErrors store has the entry
    // keyed at `["notify"]`, not `["notify","number"]`.
    const numberErrors = (api.errors as unknown as (p: string) => ValidationError[] | undefined)(
      'notify.number'
    )
    expect(numberErrors).toBeDefined()
    expect(numberErrors).toHaveLength(1)
    expect(numberErrors?.[0]?.path).toEqual(['notify', 'number'])

    // Materialised tree: `notify` must be a NESTED OBJECT shape, not
    // a flat array of error objects directly at the `notify` key.
    const tree = JSON.parse(JSON.stringify(api.errors)) as Record<string, unknown>
    expect(Array.isArray(tree['notify'])).toBe(false)
    expect(tree['notify']).toMatchObject({
      number: [{ path: ['notify', 'number'] }],
    })
  })

  it('after email→sms switch, drilling form.errors.notify.number works (per-leaf parity)', async () => {
    const { app, api } = mount({
      name: 'Ada',
      notify: { channel: 'email', address: 'a@b.com' },
    })
    apps.push(app)

    api.setValue('notify.channel', 'sms')
    await flushValidations()

    // Dot-access path — same store lookup as the callable form.
    const drilled = (api.errors as unknown as { notify: { number?: ValidationError[] } }).notify
      .number
    expect(drilled).toBeDefined()
    expect(drilled?.[0]?.message).toMatch(/^Too small/i)
  })

  it('parent-path re-validation clears stale leaf-path errors from a previous variant', async () => {
    // Contract: when scheduleFieldValidation runs at a parent path
    // (e.g. the DU container after a discriminator change), every
    // schemaErrors entry that descended from the parent path BEFORE
    // the run gets cleared. New errors land at their own leaf path
    // keys. Prevents stale `notify.address` entries surviving an
    // email→sms switch and ghost-shadowing the new variant's errors.
    const { app, api } = mount({
      name: 'Ada',
      notify: { channel: 'email', address: 'not-an-email' }, // produces an `notify.address` error
    })
    apps.push(app)
    await flushValidations()

    // Confirm the email-variant error landed.
    const addressBefore = (api.errors as unknown as (p: string) => ValidationError[] | undefined)(
      'notify.address'
    )
    expect(addressBefore?.[0]?.code).toMatch(/zod:/)

    // Switch to sms — re-validation runs at `['notify']`. The stale
    // `notify.address` schemaErrors entry must clear (active-path
    // filter would also hide it from `form.errors`, but the store
    // entry itself should not survive the re-validation either, or
    // `form.meta.errors` will leak it).
    api.setValue('notify.channel', 'sms')
    await flushValidations()

    // The stale leaf entry must NOT show up anywhere — not in the
    // active-path-filtered surface, not in the unfiltered aggregate.
    const addressAfter = (api.errors as unknown as (p: string) => ValidationError[] | undefined)(
      'notify.address'
    )
    expect(addressAfter).toBeUndefined()

    const metaPathStrings = api.meta.errors.map((e) => e.path.join('.'))
    expect(metaPathStrings).not.toContain('notify.address')
    // The new variant's leaf error IS keyed correctly.
    expect(metaPathStrings).toContain('notify.number')
  })

  it('email→sms→email round-trip preserves the blank-mark on notify.address (unset at mount)', async () => {
    // Construction-time blank: notify.address is `unset`, surfacing a
    // derived "No value supplied" for the required string. The mark
    // belongs to the consumer's intent — round-tripping through sms
    // and back to email must not silently clear it.
    const { app, api } = mount({
      name: 'Ada',
      notify: { channel: 'email', address: unset },
    })
    apps.push(app)
    await flushValidations()

    const initial = (api.errors as unknown as (p: string) => ValidationError[] | undefined)(
      'notify.address'
    )
    expect(initial?.some((e) => e.code === 'cx:no-value-supplied')).toBe(true)

    // Switch to sms — address is no longer in the active variant.
    api.setValue('notify.channel', 'sms')
    await flushValidations()

    // Switch back — variant memory should restore `address` AND the
    // construction-time `unset` intent (preserved as blankPaths
    // membership). The derived blank error must reappear.
    api.setValue('notify.channel', 'email')
    await flushValidations()

    const restored = (api.errors as unknown as (p: string) => ValidationError[] | undefined)(
      'notify.address'
    )
    expect(restored?.some((e) => e.code === 'cx:no-value-supplied')).toBe(true)

    // Materialised tree: same expectation through JSON.stringify so a
    // template like `{{ JSON.stringify(form.errors) }}` shows the
    // blank error explicitly.
    const tree = JSON.parse(JSON.stringify(api.errors)) as {
      notify?: { address?: Array<{ code: string }> }
    }
    expect(tree.notify?.address?.some((e) => e.code === 'cx:no-value-supplied')).toBe(true)
  })
})
