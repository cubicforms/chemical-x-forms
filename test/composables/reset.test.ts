// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { createApp, defineComponent, h, type App } from 'vue'
import { useForm } from '../../src'
import { attachRegistryToApp, createRegistry } from '../../src/runtime/core/registry'
import type { UseFormReturnType } from '../../src/runtime/types/types-api'
import { fakeSchema } from '../utils/fake-schema'

/**
 * Runtime coverage for Phase 8.4 — reset() and resetField(path).
 *
 * Reset is the odd one out in the public API: it has to coordinate a
 * whole-form replacement, a rebuild of the originals baseline (so
 * dirty re-computes from the new baseline), a clear of the errors
 * map, a clear of the per-field touched/focused/blurred flags, and a
 * clear of the submission lifecycle refs. These tests pin each piece
 * independently so a future change that forgets one surface is caught.
 */

type SignupForm = {
  email: string
  password: string
  profile: {
    name: string
    age: number
  }
}

const defaults: SignupForm = {
  email: '',
  password: '',
  profile: { name: '', age: 0 },
}

function harness(initial?: Partial<SignupForm>) {
  let captured!: UseFormReturnType<SignupForm>
  const Probe = defineComponent({
    setup() {
      captured = useForm<SignupForm>({
        schema: fakeSchema<SignupForm>({
          ...defaults,
          ...initial,
          profile: { ...defaults.profile, ...(initial?.profile ?? {}) },
        }),
        key: `reset-${Math.random().toString(36).slice(2)}`,
      })
      return () => h('div')
    },
  })
  const app = createApp(Probe)
  attachRegistryToApp(app, createRegistry())
  app.mount(document.createElement('div'))
  return { app, form: captured }
}

describe('useForm — reset()', () => {
  const apps: App[] = []
  afterEach(() => {
    while (apps.length > 0) apps.pop()?.unmount()
  })

  it('restores every leaf to the initial schema state', () => {
    const { app, form } = harness()
    apps.push(app)
    form.setValue('email', 'user@example.com')
    form.setValue('profile.name', 'alice')

    form.reset()
    expect(form.values()).toEqual(defaults)
  })

  it('applies new constraints over schema defaults when given a partial', () => {
    const { app, form } = harness()
    apps.push(app)
    form.reset({ profile: { name: 'seeded' } })
    expect(form.values.profile.name).toBe('seeded')
    // Unconstrained siblings fall back to schema defaults.
    expect(form.values.email).toBe('')
    expect(form.values.profile.age).toBe(0)
  })

  it('clears errors pre-populated via setFieldErrors', () => {
    const { app, form } = harness()
    apps.push(app)
    form.setFieldErrors([
      { path: ['email'], message: 'taken', formKey: form.key, code: 'api:validation' },
    ])
    expect(form.meta.valid).toBe(false)

    form.reset()
    expect(form.meta.valid).toBe(true)
    expect(form.errors.email).toBeUndefined()
    expect(form.errors.password).toBeUndefined()
  })

  it('flips dirty back to false after a mutation + reset', () => {
    const { app, form } = harness()
    apps.push(app)
    form.setValue('email', 'dirty@example.com')
    expect(form.meta.dirty).toBe(true)

    form.reset()
    expect(form.meta.dirty).toBe(false)
  })

  it('rebaselines originals so a post-reset mutation flips dirty', () => {
    const { app, form } = harness()
    apps.push(app)
    // Reset with a new baseline.
    form.reset({ email: 'baseline@example.com' })
    expect(form.meta.dirty).toBe(false)
    // Mutating back to the schema default is now a dirtying move — the
    // new baseline is the constrained value, not the original schema default.
    form.setValue('email', '')
    expect(form.meta.dirty).toBe(true)
  })

  it('clears submission lifecycle (count, error, in-flight)', async () => {
    const { app, form } = harness()
    apps.push(app)
    // Run a failing submit to populate submitCount + submitError.
    const handler = form.handleSubmit(async () => {
      throw new Error('boom')
    })
    await expect(handler()).rejects.toThrow('boom')
    expect(form.meta.submitCount).toBe(1)
    expect(form.meta.submitError).toBeInstanceOf(Error)

    form.reset()
    expect(form.meta.submitCount).toBe(0)
    expect(form.meta.submitError).toBeNull()
    expect(form.meta.submitting).toBe(false)
  })
})

describe('useForm — resetField(path)', () => {
  const apps: App[] = []
  afterEach(() => {
    while (apps.length > 0) apps.pop()?.unmount()
  })

  it('restores only the named leaf, leaves siblings untouched', () => {
    const { app, form } = harness()
    apps.push(app)
    form.setValue('email', 'dirty@example.com')
    form.setValue('password', 'still-dirty')

    form.resetField('email')
    expect(form.values.email).toBe('')
    expect(form.values.password).toBe('still-dirty')
  })

  it('clears errors on the reset path but preserves sibling errors', () => {
    const { app, form } = harness()
    apps.push(app)
    form.setFieldErrors([
      { path: ['email'], message: 'email error', formKey: form.key, code: 'api:validation' },
      { path: ['password'], message: 'password error', formKey: form.key, code: 'api:validation' },
    ])

    form.resetField('email')
    expect(form.errors.email).toBeUndefined()
    expect(form.errors.password).toHaveLength(1)
  })

  it('restores an entire sub-tree when path names a container', () => {
    const { app, form } = harness()
    apps.push(app)
    form.setValue('profile.name', 'alice')
    form.setValue('profile.age', 42)
    form.setValue('email', 'touched@example.com')

    form.resetField('profile')
    expect(form.values.profile.name).toBe('')
    expect(form.values.profile.age).toBe(0)
    // Leaf outside the sub-tree still dirty.
    expect(form.values.email).toBe('touched@example.com')
  })

  it('no-ops on an unknown path', () => {
    const { app, form } = harness()
    apps.push(app)
    const before = form.values()
    // @ts-expect-error - 'nope' is not a FlatPath of the form
    form.resetField('nope')
    expect(form.values()).toEqual(before)
  })

  it("resetField('') clears form-level errors but leaves named fields untouched", () => {
    // `''` is the form-level error bucket — the canonical home for
    // errors that don't belong to any specific field (root `.refine()`
    // messages, `setFormErrors` entries, server-emitted form errors).
    // It is one path among many, NOT a "reset everything" alias —
    // resetField on it clears that bucket only.
    const { app, form } = harness()
    apps.push(app)
    form.setValue('email', 'kept@example.com')
    form.setFormErrors([{ message: 'capacity exceeded', code: 'api:capacity' }])

    expect(form.errors('')).toHaveLength(1)

    // @ts-expect-error - `''` (form-level error bucket) is not enumerated
    // in this schema's FlatPath. The runtime accepts it as a real path —
    // see the `setFormErrors` API note that errors land at `path: ['']`.
    form.resetField('')

    // Named field untouched — `''` is its own path.
    expect(form.values.email).toBe('kept@example.com')
    // Form-level bucket cleared.
    expect(form.errors('')).toBeUndefined()
  })
})

describe('useForm — reset() re-derives schema errors against the post-reset state', () => {
  const apps: App[] = []
  afterEach(() => {
    while (apps.length > 0) apps.pop()?.unmount()
  })

  it('reset() to invalid defaults re-populates schemaErrors (not silent-clear)', async () => {
    // Bug surfaced via the docs-site stepper demo: open the form
    // (gray step titles because defaults are invalid), press reset,
    // step titles flip green. Reset clears schemaErrors but never
    // re-runs validation — the form is sitting on the same INVALID
    // defaults it mounted with, but the error store is empty.
    // `field.valid` falls through to `true` because errors aggregate
    // over an empty schemaErrors map.
    //
    // Pre-fix: errors empty after reset → `valid: true` on every leaf.
    // Post-fix: validation re-derives against post-reset defaults →
    // errors match construction-time output.
    const { useForm } = await import('../../src/zod')
    const { createAttaform } = await import('../../src/runtime/core/plugin')
    const { z } = await import('zod')

    const schema = z.object({
      name: z.string().min(1),
      email: z.email(),
    })

    let captured!: ReturnType<typeof useForm<typeof schema>>
    const Probe = defineComponent({
      setup() {
        captured = useForm({
          schema,
          key: `reset-revalidate-${Math.random().toString(36).slice(2)}`,
          defaultValues: { name: '', email: '' },
        })
        return () => h('div')
      },
    })
    const app = createApp(Probe).use(createAttaform())
    app.mount(document.createElement('div'))
    apps.push(app)
    const form = captured

    // Mount baseline: defaults are invalid (empty strings fail
    // `.min(1)` / email format). Construction-time validation
    // populated schemaErrors at mount.
    expect(form.fields.name.valid).toBe(false)
    expect(form.fields.email.valid).toBe(false)
    const mountedErrorCount = form.meta.errors.length
    expect(mountedErrorCount).toBeGreaterThan(0)

    // User types something (still invalid — under min length / not
    // an email yet). The exact intermediate state doesn't matter;
    // what matters is what reset() produces below.
    form.setValue('name', 'x')

    form.reset()

    // The defaults are STILL invalid. Every leaf-level validity
    // and the aggregated form-level meta must reflect that.
    expect(form.fields.name.valid).toBe(false)
    expect(form.fields.email.valid).toBe(false)
    expect(form.meta.valid).toBe(false)
    // Error count after reset matches what mount produced — same
    // defaults, same validation verdict.
    expect(form.meta.errors.length).toBe(mountedErrorCount)
  })

  it('reset(payload) re-derives schemaErrors against the payload, not construction defaults', async () => {
    // The fix routes through `schema.getDefaultValues({ constraints })`,
    // and `constraints` is `nextDefaultValues ?? defaultValues` — so
    // a reset payload IS what gets validated. Two arms:
    //   (a) invalid payload over invalid defaults → errors re-derived
    //       against THE PAYLOAD (not silently empty, not stale from
    //       mount).
    //   (b) valid payload → errors clear (no spurious errors clinging
    //       from the pre-reset state).
    const { useForm } = await import('../../src/zod')
    const { createAttaform } = await import('../../src/runtime/core/plugin')
    const { z } = await import('zod')

    const schema = z.object({
      name: z.string().min(3),
      email: z.email(),
    })

    let captured!: ReturnType<typeof useForm<typeof schema>>
    const Probe = defineComponent({
      setup() {
        captured = useForm({
          schema,
          key: `reset-payload-${Math.random().toString(36).slice(2)}`,
          defaultValues: { name: '', email: '' },
        })
        return () => h('div')
      },
    })
    const app = createApp(Probe).use(createAttaform())
    app.mount(document.createElement('div'))
    apps.push(app)
    const form = captured

    // Arm (a): payload is still invalid (name='xx' fails .min(3)).
    form.reset({ name: 'xx' })
    expect(form.meta.errors.length).toBeGreaterThan(0)
    // The post-reset value reflects the payload merge over defaults.
    expect(form.values.name).toBe('xx')
    expect(form.fields.name.valid).toBe(false)

    // Arm (b): fully-valid payload — every required field satisfied.
    form.reset({ name: 'Alice', email: 'a@example.com' })
    expect(form.meta.errors).toEqual([])
    expect(form.meta.valid).toBe(true)
    expect(form.fields.name.valid).toBe(true)
    expect(form.fields.email.valid).toBe(true)
  })

  it('reset() re-derives errors at descendant leaves; container aggregation reflects them', async () => {
    // Demo-faithful repro: a multi-step form with container paths whose
    // descendant leaves violate the schema in their defaults. The
    // stepper UI reads `form.fields(containerPath).valid` for each
    // step's paths; if container aggregation doesn't reflect descendant
    // errors after reset, step titles flip green incorrectly.
    const { useForm } = await import('../../src/zod')
    const { createAttaform } = await import('../../src/runtime/core/plugin')
    const { z } = await import('zod')

    const addressSchema = z.object({
      line1: z.string().min(1),
      city: z.string().min(1),
      region: z.string().min(2),
      country: z.string(),
    })

    const schema = z.object({
      reference: z.string(),
      pickup: addressSchema,
      delivery: addressSchema,
    })

    let captured!: ReturnType<typeof useForm<typeof schema>>
    const Probe = defineComponent({
      setup() {
        captured = useForm({
          schema,
          key: `reset-container-${Math.random().toString(36).slice(2)}`,
          defaultValues: {
            reference: 'SHP-100001',
            pickup: { country: 'US' },
            delivery: { country: 'US' },
          },
        })
        return () => h('div')
      },
    })
    const app = createApp(Probe).use(createAttaform())
    app.mount(document.createElement('div'))
    apps.push(app)
    const form = captured

    // Mount: pickup + delivery container fields are INVALID because
    // their descendant line1/city/region defaults are empty. Use the
    // call-form (`form.fields('path')`) for container reads — the
    // property-access form descends to leaves only.
    expect(form.fields('pickup').valid).toBe(false)
    expect(form.fields('delivery').valid).toBe(false)

    // Snapshot the mount-time validity so we can assert post-reset
    // matches exactly. Capture descendant values too — the
    // `aggregateErrorsAt` filter drops errors at paths that don't
    // exist in `form.value`, so any post-reset disappearance of the
    // descendant keys (line1 / city / region absent from
    // form.values.pickup) would silently mask the error count.
    const mountedErrorCount = form.meta.errors.length
    const mountedDescendantsExist =
      typeof form.values.pickup.line1 === 'string' &&
      typeof form.values.pickup.city === 'string' &&
      typeof form.values.pickup.region === 'string'
    expect(mountedErrorCount).toBeGreaterThan(0)
    expect(mountedDescendantsExist).toBe(true)

    // Trigger an unrelated value tick.
    form.setValue('reference', 'SHP-999')

    form.reset()

    // Post-reset: descendant leaves must STILL exist in form.values
    // so the schemaErrors at those leaves don't get filtered out
    // by `aggregateErrorsAt`'s `hasAtPath` gate.
    const postResetDescendantsExist =
      typeof form.values.pickup.line1 === 'string' &&
      typeof form.values.pickup.city === 'string' &&
      typeof form.values.pickup.region === 'string'
    expect(postResetDescendantsExist).toBe(true)

    // Error count after reset must match mount exactly — same
    // defaults, same validation verdict.
    expect(form.meta.errors.length).toBe(mountedErrorCount)

    // Container fields must STILL be invalid — descendants are still
    // empty. This is the bug surface: pre-fix, container `.valid`
    // came up `true` because aggregateErrorsAt walked an empty
    // schemaErrors map.
    expect(form.fields('pickup').valid).toBe(false)
    expect(form.fields('delivery').valid).toBe(false)

    // CRITICAL no-flash property: errors must be populated
    // SYNCHRONOUSLY by reset() — not on a deferred microtask. If
    // they only arrive async, the UI flashes "valid" between reset
    // and the async pass settling (the docs-site stepper turns
    // green for ~600ms before going back to red). Pin that the
    // count is correct the instant reset() returns.
    expect(form.meta.errors.length).toBeGreaterThan(0)
  })

  it('reset() re-derives errors for array-min violations (demo step 2 shape)', async () => {
    // Demo step 2 has just ['cargo'] in STEP_PATHS; cargo.items is
    // `z.array(...).min(1)` with default `[]`. The empty array
    // violates `.min(1)` → error at path `['cargo', 'items']`.
    // Container `'cargo'` should aggregate this error → invalid.
    const { useForm } = await import('../../src/zod')
    const { createAttaform } = await import('../../src/runtime/core/plugin')
    const { z } = await import('zod')

    const itemSchema = z.object({ sku: z.string().min(1), qty: z.number().min(1) })
    const schema = z.object({
      cargo: z.object({
        items: z.array(itemSchema).min(1),
        details: z.object({ type: z.string(), fragile: z.boolean() }),
      }),
    })

    let captured!: ReturnType<typeof useForm<typeof schema>>
    const Probe = defineComponent({
      setup() {
        captured = useForm({
          schema,
          key: `reset-arrmin-${Math.random().toString(36).slice(2)}`,
          defaultValues: {
            cargo: { items: [], details: { type: 'dry', fragile: false } },
          },
        })
        return () => h('div')
      },
    })
    const app = createApp(Probe).use(createAttaform())
    app.mount(document.createElement('div'))
    apps.push(app)
    const form = captured

    expect(form.fields('cargo').valid).toBe(false)
    const mountedErrorCount = form.meta.errors.length
    expect(mountedErrorCount).toBeGreaterThan(0)

    form.reset()

    expect(form.fields('cargo').valid).toBe(false)
    expect(form.meta.errors.length).toBe(mountedErrorCount)
  })

  it('reset() restores the firstValidationDone gate — no `valid: true` flash on async-refining schemas', async () => {
    // Live-demo bug surface (confirmed by JSON-stringified diagnostic
    // dump):
    //
    //   BEFORE      : pickup.valid=false (5 errors from mount async pass)
    //   AFTER sync  : pickup.valid=TRUE  (0 errors, flash window — BUG)
    //   AFTER +1.5s : pickup.valid=false (5 errors, async pass landed)
    //
    // The window is ~600ms–1.5s in real browsers — long enough for
    // the user to read step titles flipping green and even click
    // Next.
    //
    // Why the post-reset sync re-derive can't surface refinement
    // errors here:
    //   - zod-v4 adapter's `getDefaultValues` STRIPS refinements
    //     (slim parse) → returns success:true with no .min / .email
    //     errors.
    //   - `schema.validateAtPath(form, undefined, { sync: true })`
    //     calls `rootSchema.safeParse(data)` which THROWS when the
    //     schema contains an always-running async refine (the
    //     demo's `cargo.items.superRefine(async ...)`). The
    //     adapter's catch falls through to async-only — returns
    //     Promise — and the library's sync-validate skips.
    //
    // So `schemaErrors` stays empty between sync reset() return and
    // the re-queued async pass landing. The ONLY thing keeping
    // container `.valid` false during that window is the
    // `firstValidationDone` gate, which mount inits to `false` and
    // the watch flips to `true` after activeValidations returns to
    // 0. Reset must restore the flag to its construction-time
    // value; otherwise the gate stays lifted → flash.
    const { useForm } = await import('../../src/zod')
    const { createAttaform } = await import('../../src/runtime/core/plugin')
    const { waitUntil } = await import('../utils/form-harness')
    const { z } = await import('zod')

    // Schema with an async refine whose precondition (sync .email
    // check) is ALWAYS satisfied by the defaults — so the async
    // refine runs at mount, produces an error, and forces safeParse
    // to throw on every subsequent sync pass. Mirrors the property
    // pinned by `initial-validation-seed.test.ts` for the
    // construction-time seed.
    const schema = z.object({
      email: z
        .email()
        .refine(async (v) => v !== 'taken@example.com', 'That email is already registered.'),
    })

    let captured!: ReturnType<typeof useForm<typeof schema>>
    const Probe = defineComponent({
      setup() {
        captured = useForm({
          schema,
          key: `reset-flash-${Math.random().toString(36).slice(2)}`,
          defaultValues: { email: 'taken@example.com' },
        })
        return () => h('div')
      },
    })
    const app = createApp(Probe).use(createAttaform())
    app.mount(document.createElement('div'))
    apps.push(app)
    const form = captured

    // Mount's construction-time async pass populates the refine
    // error and flips firstValidationDone to `true` — the
    // precondition for the bug.
    await waitUntil(() => (form.meta.errors.length > 0 ? true : null))
    expect(form.fields.email.valid).toBe(false)

    form.reset()
    // SYNCHRONOUS read. With the gate restored on reset (the fix),
    // `email.valid` reads `false` because the gate covers it.
    // Without the fix, `firstValidationDone` stays `true` and the
    // gate is lifted; errors are empty (sync re-derive can't
    // surface async-only verdicts); leaf reads `valid: true`.
    expect(form.fields.email.valid).toBe(false)
    expect(form.meta.valid).toBe(false)
  })

  it('reset() re-queues the async validation pass so async errors return', async () => {
    // Demo's pickup.postalCode has both `.min(3)` (sync) and
    // `.refine(async lookupPostalCode)` (async). At MOUNT the sync
    // pass populates `.min(3)` errors AND a queued async pass
    // populates `.refine` errors. Reset() must re-queue the async
    // pass too — otherwise async-only verdicts vanish post-reset
    // (the live-demo "step titles flip green" bug — sync errors
    // didn't exist in the demo's defaults; the only thing making the
    // form invalid was the async refines that mount surfaced).
    //
    // Schema pattern + default mirror `initial-validation-seed.test.ts`
    // which pins the construction-time seed for the same shape.
    const { useForm } = await import('../../src/zod')
    const { createAttaform } = await import('../../src/runtime/core/plugin')
    const { waitUntil } = await import('../utils/form-harness')
    const { z } = await import('zod')

    const schema = z.object({
      email: z
        .email()
        .refine(async (v) => v !== 'taken@example.com', 'That email is already registered.'),
    })

    let captured!: ReturnType<typeof useForm<typeof schema>>
    const Probe = defineComponent({
      setup() {
        captured = useForm({
          schema,
          key: `reset-async-${Math.random().toString(36).slice(2)}`,
          defaultValues: { email: 'taken@example.com' },
        })
        return () => h('div')
      },
    })
    const app = createApp(Probe).use(createAttaform())
    app.mount(document.createElement('div'))
    apps.push(app)
    const form = captured

    // Wait for the construction-time async pass to settle.
    const mountErr = await waitUntil(() => form.errors.email?.[0]?.message ?? null)
    expect(mountErr).toBe('That email is already registered.')

    form.reset()
    // Async re-queue lands on the next microtask. The error should
    // come back without any user input — same property
    // `initial-validation-seed.test.ts` pins at mount.
    const postResetErr = await waitUntil(() => form.errors.email?.[0]?.message ?? null)
    expect(postResetErr).toBe('That email is already registered.')
  })

  it('reset() with `strict: false` leaves schemaErrors empty (opt-out preserved)', async () => {
    // Construction-time validation is gated on `strict: true` (the
    // default). A form that explicitly opted out of strict mounts
    // without populated schemaErrors. Reset must honor the same gate
    // — re-running validation post-reset would violate the explicit
    // opt-out. Pins that the re-derive fix in the other probe is
    // strict-gated correctly.
    const { useForm } = await import('../../src/zod')
    const { createAttaform } = await import('../../src/runtime/core/plugin')
    const { z } = await import('zod')

    const schema = z.object({ name: z.string().min(1) })

    let captured!: ReturnType<typeof useForm<typeof schema>>
    const Probe = defineComponent({
      setup() {
        captured = useForm({
          schema,
          key: `reset-nonstrict-${Math.random().toString(36).slice(2)}`,
          strict: false,
          defaultValues: { name: '' },
        })
        return () => h('div')
      },
    })
    const app = createApp(Probe).use(createAttaform())
    app.mount(document.createElement('div'))
    apps.push(app)
    const form = captured

    expect(form.meta.errors.length).toBe(0)
    form.setValue('name', 'something')
    form.reset()
    // Still empty — strict: false opts out of the re-derive too.
    expect(form.meta.errors.length).toBe(0)
  })
})
