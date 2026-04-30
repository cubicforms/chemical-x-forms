// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { createApp, defineComponent, h, nextTick, type App } from 'vue'
import { z } from 'zod'
import { z as zV3 } from 'zod-v3'
import { useForm } from '../../src/zod'
import { useForm as useFormV3 } from '../../src/zod-v3'
import { CxErrorCode } from '../../src/runtime/core/error-codes'
import { createChemicalXForms } from '../../src/runtime/core/plugin'
import type { UseAbstractFormReturnType } from '../../src/runtime/types/types-api'

/**
 * Discriminated-union variant switch — when the discriminator value
 * changes, the storage at the union's parent path must reshape to
 * the active variant's slim default.
 *
 * Without this, `setValue('notify.channel', 'sms')` against an
 * `{ channel: 'email', address: 'a@b' }` storage leaves `address`
 * sitting next to `channel: 'sms'` — a shape no variant matches.
 *
 * The contract:
 *   1. Foreign keys (only present in the OLD variant) are removed.
 *   2. Keys belonging to the NEW variant that are missing get the
 *      schema's slim default at that sub-path.
 *   3. The discriminator key carries the new value.
 *   4. Numeric / bigint leaves of the new variant auto-mark blank
 *      (storage / display divergence — the same rule that governs
 *      mount-time blank).
 */

const profileSchema = z.object({
  name: z.string(),
  notify: z.discriminatedUnion('channel', [
    z.object({ channel: z.literal('email'), address: z.string().min(3) }),
    z.object({ channel: z.literal('sms'), number: z.string().min(7) }),
  ]),
})
// Loose API type — tests deliberately exercise cross-variant paths
// (`setValue('notify.address', ...)` while the active variant is sms,
// and vice versa) which are correctly rejected by the strict
// inferred type. The runtime shape under test is what matters here.
// Cast `setValue` to a permissive signature so individual call sites
// don't each need a `never` cast.
type ProfileApi = Omit<UseAbstractFormReturnType<z.output<typeof profileSchema>>, 'setValue'> & {
  setValue: (path: string, value: unknown) => boolean
  values: {
    name: string
    notify: { channel: string } & Record<string, unknown>
  }
}

function mountProfile(): { app: App; api: ProfileApi } {
  const handle: { api?: ProfileApi } = {}
  const App = defineComponent({
    setup() {
      handle.api = useForm({
        schema: profileSchema,
        key: 'du-variant-switch',
        defaultValues: {
          name: '',
          notify: { channel: 'email', address: '' },
        },
      }) as unknown as ProfileApi
      return () => h('div')
    },
  })
  const app = createApp(App).use(createChemicalXForms({ override: true }))
  app.mount(document.createElement('div'))
  return { app, api: handle.api as ProfileApi }
}

describe('discriminated-union variant switch — storage reshape', () => {
  const apps: App[] = []
  afterEach(() => {
    while (apps.length > 0) apps.pop()?.unmount()
  })

  it("removes the old variant's foreign keys when the discriminator changes", async () => {
    const { app, api } = mountProfile()
    apps.push(app)

    api.setValue('notify.address', 'old@example.com')
    await nextTick()
    expect(api.values.notify).toEqual({ channel: 'email', address: 'old@example.com' })

    api.setValue('notify.channel', 'sms')
    await nextTick()

    // `address` belongs to the email variant only — must not survive
    // the switch.
    expect((api.values.notify as Record<string, unknown>)['address']).toBeUndefined()
  })

  it("fills the new variant's missing keys with the schema's slim defaults", async () => {
    const { app, api } = mountProfile()
    apps.push(app)

    api.setValue('notify.channel', 'sms')
    await nextTick()

    // `number` is a `z.string().min(7)` — slim default is `''`.
    // Refinement-class errors are not tested here; this assertion
    // proves the structural shape was reshaped.
    expect(api.values.notify).toEqual({ channel: 'sms', number: '' })
  })

  it('preserves the new discriminator value', async () => {
    const { app, api } = mountProfile()
    apps.push(app)

    api.setValue('notify.channel', 'sms')
    await nextTick()
    expect(api.values.notify.channel).toBe('sms')

    api.setValue('notify.channel', 'email')
    await nextTick()
    expect(api.values.notify.channel).toBe('email')
  })

  it('round-trips between variants without leaking keys across both directions', async () => {
    const { app, api } = mountProfile()
    apps.push(app)

    api.setValue('notify.address', 'first@example.com')
    api.setValue('notify.channel', 'sms')
    await nextTick()
    // sms has no prior memory; falls back to slim default — and the
    // email-only `address` does not leak across the switch.
    expect(api.values.notify).toEqual({ channel: 'sms', number: '' })

    api.setValue('notify.number', '5551234')
    api.setValue('notify.channel', 'email')
    await nextTick()
    // Memory restores the previously-typed `address` (variant memory
    // is on by default). The sms-only `number` does not leak.
    expect(api.values.notify).toEqual({ channel: 'email', address: 'first@example.com' })
  })

  it('writing the same discriminator value is a no-op (no spurious reshape)', async () => {
    const { app, api } = mountProfile()
    apps.push(app)

    api.setValue('notify.address', 'kept@example.com')
    await nextTick()
    const before = api.values.notify

    api.setValue('notify.channel', 'email')
    await nextTick()

    expect(api.values.notify).toEqual({ channel: 'email', address: 'kept@example.com' })
    // Identity short-circuit: no replacement when the discriminator
    // didn't actually change.
    expect(api.values.notify).toBe(before)
  })

  it('does not interfere with non-discriminator writes inside the union', async () => {
    const { app, api } = mountProfile()
    apps.push(app)

    api.setValue('notify.address', 'no-reshape@example.com')
    await nextTick()
    expect(api.values.notify).toEqual({ channel: 'email', address: 'no-reshape@example.com' })
  })

  it('peer fields outside the union are not touched by the reshape', async () => {
    const { app, api } = mountProfile()
    apps.push(app)

    api.setValue('name', 'Ada')
    api.setValue('notify.channel', 'sms')
    await nextTick()

    expect(api.values.name).toBe('Ada')
  })
})

describe('discriminated-union variant switch — error reactivity', () => {
  const apps: App[] = []
  afterEach(() => {
    while (apps.length > 0) apps.pop()?.unmount()
  })

  it("surfaces the new variant's required-field errors after submit replays validation", async () => {
    const { app, api } = mountProfile()
    apps.push(app)

    // Fill the email variant cleanly so validation passes there.
    api.setValue('name', 'Ada')
    api.setValue('notify.address', 'ada@example.com')
    await nextTick()

    // Switch to sms — `notify.number` is now required and ''
    // (failing `.min(7)`). The schema validation pipeline (here:
    // handleSubmit) re-parses against the new effective shape.
    api.setValue('notify.channel', 'sms')
    await nextTick()

    const submit = api.handleSubmit(
      () => {},
      () => {}
    )
    await submit()
    await nextTick()

    // schemaErrors gets populated with the refinement issue against
    // the new variant's required string.
    expect(api.errors['notify.number']).toBeDefined()
  })

  it('validateAsync reflects the new variant in the returned response', async () => {
    const { app, api } = mountProfile()
    apps.push(app)

    api.setValue('name', 'Ada')
    api.setValue('notify.address', 'ada@example.com')
    api.setValue('notify.channel', 'sms')
    await nextTick()

    const response = await api.validateAsync()
    expect(response.success).toBe(false)
    expect(response.errors?.some((e) => e.path.join('.') === 'notify.number')).toBe(true)
  })
})

describe('discriminated-union variant switch — numeric variant blank auto-mark', () => {
  const numericVariantSchema = z.object({
    payout: z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('flat'), amount: z.string() }),
      z.object({ kind: z.literal('tiered'), threshold: z.number() }),
    ]),
  })
  // Loose API type for the same reason as ProfileApi above —
  // cross-variant writes during the switch.
  type NumericApi = Omit<
    UseAbstractFormReturnType<z.output<typeof numericVariantSchema>>,
    'setValue'
  > & {
    setValue: (path: string, value: unknown) => boolean
    values: { payout: { kind: string } & Record<string, unknown> }
  }

  const apps: App[] = []
  afterEach(() => {
    while (apps.length > 0) apps.pop()?.unmount()
  })

  function mountNumeric(): NumericApi {
    const handle: { api?: NumericApi } = {}
    const App = defineComponent({
      setup() {
        handle.api = useForm({
          schema: numericVariantSchema,
          key: 'du-numeric-variant',
          defaultValues: { payout: { kind: 'flat', amount: 'one-time' } },
        }) as unknown as NumericApi
        return () => h('div')
      },
    })
    const app = createApp(App).use(createChemicalXForms({ override: true }))
    app.mount(document.createElement('div'))
    apps.push(app)
    return handle.api as NumericApi
  }

  it('switching into a variant whose required leaf is numeric auto-marks blank + emits a derived error', async () => {
    const api = mountNumeric()

    // Initially flat / amount — string leaf, no auto-mark.
    expect(api.errors['payout.threshold']).toBeUndefined()

    api.setValue('payout.kind', 'tiered')
    await nextTick()

    // After the switch, `payout.threshold` exists with slim default `0`
    // and storage / display diverge — auto-mark fires, derived error
    // appears reactively.
    expect((api.values.payout as Record<string, unknown>)['threshold']).toBe(0)
    expect(api.errors['payout.threshold']?.[0]?.code).toBe(CxErrorCode.NoValueSupplied)
  })
})

describe('discriminated-union variant switch — whole-union write', () => {
  const apps: App[] = []
  afterEach(() => {
    while (apps.length > 0) apps.pop()?.unmount()
  })

  it("writing the union wholesale doesn't leak the OLD variant's keys", async () => {
    const { app, api } = mountProfile()
    apps.push(app)

    api.setValue('notify.address', 'first@example.com')
    await nextTick()

    // Replace the union's parent with a complete sms-variant value.
    // This is a normal whole-object write at the union path — the
    // runtime must use the SMS variant's default to fill structural
    // gaps, not fall back to the first (email) variant. Otherwise
    // `address: ''` from the email default leaks back in.
    api.setValue('notify', { channel: 'sms', number: '5551234' })
    await nextTick()

    expect(api.values.notify).toEqual({ channel: 'sms', number: '5551234' })
  })

  it('whole-union write fills missing variant-specific keys from the matched variant default', async () => {
    const { app, api } = mountProfile()
    apps.push(app)

    // Consumer specifies discriminator only; the variant default
    // fills the rest.
    api.setValue('notify', { channel: 'sms' })
    await nextTick()

    expect(api.values.notify).toEqual({ channel: 'sms', number: '' })
  })
})

describe('discriminated-union variant switch — wrapped DU', () => {
  const apps: App[] = []
  afterEach(() => {
    while (apps.length > 0) apps.pop()?.unmount()
  })

  // `notify` itself is `DU(...)` wrapped in `.default(...)`. Wrapping
  // is structurally transparent — the variant-switch reshape must
  // peel through wrappers when locating the union one level above
  // the discriminator key.
  it('reshapes when the DU is wrapped in `.default(...)`', async () => {
    const wrappedSchema = z.object({
      notify: z
        .discriminatedUnion('channel', [
          z.object({ channel: z.literal('email'), address: z.string() }),
          z.object({ channel: z.literal('sms'), number: z.string() }),
        ])
        .default({ channel: 'email', address: '' }),
    })
    type WrappedApi = Omit<
      UseAbstractFormReturnType<z.output<typeof wrappedSchema>>,
      'setValue'
    > & {
      setValue: (path: string, value: unknown) => boolean
      values: { notify: { channel: string } & Record<string, unknown> }
    }

    const handle: { api?: WrappedApi } = {}
    const App = defineComponent({
      setup() {
        handle.api = useForm({
          schema: wrappedSchema,
          key: 'du-wrapped-default',
        }) as unknown as WrappedApi
        return () => h('div')
      },
    })
    const app = createApp(App).use(createChemicalXForms({ override: true }))
    app.mount(document.createElement('div'))
    apps.push(app)
    const api = handle.api as WrappedApi

    api.setValue('notify.address', 'before@example.com')
    await nextTick()

    api.setValue('notify.channel', 'sms')
    await nextTick()

    expect(api.values.notify).toEqual({ channel: 'sms', number: '' })
  })
})

describe('discriminated-union variant switch — DU inside an array', () => {
  const arraySchema = z.object({
    events: z.array(
      z.discriminatedUnion('type', [
        z.object({ type: z.literal('click'), x: z.number() }),
        z.object({ type: z.literal('text'), value: z.string() }),
      ])
    ),
  })
  type ArrayApi = Omit<UseAbstractFormReturnType<z.output<typeof arraySchema>>, 'setValue'> & {
    setValue: (path: string, value: unknown) => boolean
    values: { events: Array<{ type: string } & Record<string, unknown>> }
  }

  const apps: App[] = []
  afterEach(() => {
    while (apps.length > 0) apps.pop()?.unmount()
  })

  it("switching a DU element's discriminator inside an array reshapes that element only", async () => {
    const handle: { api?: ArrayApi } = {}
    const App = defineComponent({
      setup() {
        handle.api = useForm({
          schema: arraySchema,
          key: 'du-array',
          defaultValues: {
            events: [
              { type: 'click', x: 5 },
              { type: 'text', value: 'a' },
            ],
          },
        }) as unknown as ArrayApi
        return () => h('div')
      },
    })
    const app = createApp(App).use(createChemicalXForms({ override: true }))
    app.mount(document.createElement('div'))
    apps.push(app)
    const api = handle.api as ArrayApi

    api.setValue('events.0.type', 'text')
    await nextTick()

    expect(api.values.events[0]).toEqual({ type: 'text', value: '' })
    // Sibling elements unchanged.
    expect(api.values.events[1]).toEqual({ type: 'text', value: 'a' })
  })
})

describe('discriminated-union variant switch — zod v3 adapter', () => {
  const v3Schema = zV3.object({
    notify: zV3.discriminatedUnion('channel', [
      zV3.object({ channel: zV3.literal('email'), address: zV3.string() }),
      zV3.object({ channel: zV3.literal('sms'), number: zV3.string() }),
    ]),
  })
  type V3Api = Omit<UseAbstractFormReturnType<zV3.infer<typeof v3Schema>>, 'setValue'> & {
    setValue: (path: string, value: unknown) => boolean
    values: { notify: { channel: string } & Record<string, unknown> }
  }

  const apps: App[] = []
  afterEach(() => {
    while (apps.length > 0) apps.pop()?.unmount()
  })

  function mountV3(): V3Api {
    const handle: { api?: V3Api } = {}
    const App = defineComponent({
      setup() {
        handle.api = useFormV3({
          schema: v3Schema,
          key: 'du-variant-switch-v3',
          defaultValues: { notify: { channel: 'email', address: '' } },
        }) as unknown as V3Api
        return () => h('div')
      },
    })
    const app = createApp(App).use(createChemicalXForms({ override: true }))
    app.mount(document.createElement('div'))
    apps.push(app)
    return handle.api as V3Api
  }

  it('reshapes storage on discriminator change in v3', async () => {
    const api = mountV3()

    api.setValue('notify.address', 'old@example.com')
    await nextTick()

    api.setValue('notify.channel', 'sms')
    await nextTick()

    expect(api.values.notify).toEqual({ channel: 'sms', number: '' })
  })

  it('round-trip restores typed data with the v3 adapter (parity with v4)', async () => {
    const api = mountV3()

    api.setValue('notify.address', 'remembered@example.com')
    api.setValue('notify.channel', 'sms')
    await nextTick()
    expect(api.values.notify).toEqual({ channel: 'sms', number: '' })

    api.setValue('notify.channel', 'email')
    await nextTick()
    expect(api.values.notify).toEqual({
      channel: 'email',
      address: 'remembered@example.com',
    })
  })
})

/**
 * Variant memory — per-form-instance side-channel that snapshots the
 * outgoing variant's subtree on a discriminated-union switch and
 * restores it on switch-back. On by default (`rememberVariants: true`),
 * opt out via `useForm({ rememberVariants: false })`.
 *
 * Memory is keyed by absolute union path (`PathKey`), so every DU at
 * every nesting depth gets its own independent memory map. Memory
 * never reaches `form.value`, never serializes, and clears on
 * `reset()` / whole-form replace / `resetField` of an ancestor.
 */

function mountProfileWith(options: { rememberVariants?: boolean } = {}): {
  app: App
  api: ProfileApi
} {
  const handle: { api?: ProfileApi } = {}
  const App = defineComponent({
    setup() {
      handle.api = useForm({
        schema: profileSchema,
        key: `du-variant-memory-${Math.random().toString(36).slice(2)}`,
        defaultValues: {
          name: '',
          notify: { channel: 'email', address: '' },
        },
        ...(options.rememberVariants !== undefined
          ? { rememberVariants: options.rememberVariants }
          : {}),
      }) as unknown as ProfileApi
      return () => h('div')
    },
  })
  const app = createApp(App).use(createChemicalXForms({ override: true }))
  app.mount(document.createElement('div'))
  return { app, api: handle.api as ProfileApi }
}

describe('variant memory — round-trip preserves typed data', () => {
  const apps: App[] = []
  afterEach(() => {
    while (apps.length > 0) apps.pop()?.unmount()
  })

  it('email → sms → email restores the typed address', async () => {
    const { app, api } = mountProfileWith()
    apps.push(app)

    api.setValue('notify.address', 'foo@bar.com')
    api.setValue('notify.channel', 'sms')
    await nextTick()
    expect(api.values.notify).toEqual({ channel: 'sms', number: '' })

    api.setValue('notify.channel', 'email')
    await nextTick()
    expect(api.values.notify).toEqual({ channel: 'email', address: 'foo@bar.com' })
  })

  it('sms → email → sms restores the typed number', async () => {
    const { app, api } = mountProfileWith()
    apps.push(app)

    api.setValue('notify.channel', 'sms')
    api.setValue('notify.number', '5551234')
    api.setValue('notify.channel', 'email')
    await nextTick()
    expect(api.values.notify).toEqual({ channel: 'email', address: '' })

    api.setValue('notify.channel', 'sms')
    await nextTick()
    expect(api.values.notify).toEqual({ channel: 'sms', number: '5551234' })
  })

  it('three-way variants round-trip correctly', async () => {
    const triSchema = z.object({
      pick: z.discriminatedUnion('kind', [
        z.object({ kind: z.literal('a'), av: z.string() }),
        z.object({ kind: z.literal('b'), bv: z.string() }),
        z.object({ kind: z.literal('c'), cv: z.string() }),
      ]),
    })
    type TriApi = Omit<UseAbstractFormReturnType<z.output<typeof triSchema>>, 'setValue'> & {
      setValue: (path: string, value: unknown) => boolean
      values: { pick: { kind: string } & Record<string, unknown> }
    }
    const handle: { api?: TriApi } = {}
    const App = defineComponent({
      setup() {
        handle.api = useForm({
          schema: triSchema,
          key: 'du-variant-memory-tri',
          defaultValues: { pick: { kind: 'a', av: '' } },
        }) as unknown as TriApi
        return () => h('div')
      },
    })
    const app = createApp(App).use(createChemicalXForms({ override: true }))
    app.mount(document.createElement('div'))
    apps.push(app)
    const api = handle.api as TriApi

    api.setValue('pick.av', 'aaa')
    api.setValue('pick.kind', 'b')
    api.setValue('pick.bv', 'bbb')
    api.setValue('pick.kind', 'c')
    api.setValue('pick.cv', 'ccc')
    await nextTick()

    api.setValue('pick.kind', 'a')
    await nextTick()
    expect(api.values.pick).toEqual({ kind: 'a', av: 'aaa' })

    api.setValue('pick.kind', 'b')
    await nextTick()
    expect(api.values.pick).toEqual({ kind: 'b', bv: 'bbb' })

    api.setValue('pick.kind', 'c')
    await nextTick()
    expect(api.values.pick).toEqual({ kind: 'c', cv: 'ccc' })
  })

  it('successive round-trips capture the latest typed value, not a stale earlier one', async () => {
    // Implicit reactivity-detachment check: if the snapshot were a
    // live Vue proxy into the orphaned subtree, successive switches
    // could surface earlier or mutated values. Each round-trip must
    // see the value typed in the immediately-prior occupancy of the
    // variant.
    const { app, api } = mountProfileWith()
    apps.push(app)

    for (const candidate of ['first@x.io', 'second@y.io', 'third@z.io']) {
      api.setValue('notify.address', candidate)
      api.setValue('notify.channel', 'sms')
      await nextTick()
      api.setValue('notify.channel', 'email')
      await nextTick()
      expect(api.values.notify).toEqual({ channel: 'email', address: candidate })
    }
  })
})

describe('variant memory — Case B whole-union write', () => {
  const apps: App[] = []
  afterEach(() => {
    while (apps.length > 0) apps.pop()?.unmount()
  })

  it('partial whole-union write restores from memory + applies overrides', async () => {
    const { app, api } = mountProfileWith()
    apps.push(app)

    api.setValue('notify.address', 'kept@example.com')
    api.setValue('notify.channel', 'sms')
    await nextTick()

    // Whole-union back to email with only the discriminator. Memory
    // baseline (`address: 'kept@example.com'`) survives; consumer
    // doesn't override it.
    api.setValue('notify', { channel: 'email' })
    await nextTick()
    expect(api.values.notify).toEqual({ channel: 'email', address: 'kept@example.com' })
  })

  it('whole-union write with all keys overrides memory', async () => {
    const { app, api } = mountProfileWith()
    apps.push(app)

    api.setValue('notify.address', 'old@example.com')
    api.setValue('notify.channel', 'sms')
    await nextTick()

    // Consumer explicitly provides the full email shape — overrides
    // win over the memory baseline.
    api.setValue('notify', { channel: 'email', address: 'override@example.com' })
    await nextTick()
    expect(api.values.notify).toEqual({ channel: 'email', address: 'override@example.com' })
  })
})

describe('variant memory — same-discriminator Case B', () => {
  const apps: App[] = []
  afterEach(() => {
    while (apps.length > 0) apps.pop()?.unmount()
  })

  it('whole-union write with same discriminator does NOT touch memory', async () => {
    // Setup memory: typed address, switch to sms (memory captures
    // email = { channel: email, address: 'baseline@x.io' }).
    const { app, api } = mountProfileWith()
    apps.push(app)
    api.setValue('notify.address', 'baseline@x.io')
    api.setValue('notify.channel', 'sms')
    api.setValue('notify.number', '7777777')
    await nextTick()

    // Same-discriminator Case B: setValue('notify', { channel: 'sms', ... })
    // while already on sms. Memory must NOT be consulted (no restore
    // to a prior sms value); just the merge.
    api.setValue('notify', { channel: 'sms', number: '8888888' })
    await nextTick()
    expect(api.values.notify).toEqual({ channel: 'sms', number: '8888888' })

    // Verify the email memory is intact: switching back must restore
    // the originally-typed address, not anything affected by the
    // same-disc Case B above.
    api.setValue('notify.channel', 'email')
    await nextTick()
    expect(api.values.notify).toEqual({ channel: 'email', address: 'baseline@x.io' })
  })

  it('subsequent switch-out captures the post-merge state, not pre-merge', async () => {
    const { app, api } = mountProfileWith()
    apps.push(app)
    api.setValue('notify.channel', 'sms')
    api.setValue('notify.number', '1111111')
    await nextTick()

    // Same-disc Case B updates number to '2222222'.
    api.setValue('notify', { channel: 'sms', number: '2222222' })
    await nextTick()
    expect(api.values.notify).toEqual({ channel: 'sms', number: '2222222' })

    // Switch out (sms → email) snapshots the LIVE state ('2222222'),
    // and a switch back must restore that value.
    api.setValue('notify.channel', 'email')
    api.setValue('notify.channel', 'sms')
    await nextTick()
    expect(api.values.notify).toEqual({ channel: 'sms', number: '2222222' })
  })
})

describe('variant memory — opt-out (rememberVariants: false)', () => {
  const apps: App[] = []
  afterEach(() => {
    while (apps.length > 0) apps.pop()?.unmount()
  })

  it('does NOT preserve typed data across switches', async () => {
    const { app, api } = mountProfileWith({ rememberVariants: false })
    apps.push(app)

    api.setValue('notify.address', 'foo@bar.com')
    api.setValue('notify.channel', 'sms')
    await nextTick()
    expect(api.values.notify).toEqual({ channel: 'sms', number: '' })

    api.setValue('notify.channel', 'email')
    await nextTick()
    // Memory disabled — the previously-typed address is gone, slim
    // default `address: ''` returns.
    expect(api.values.notify).toEqual({ channel: 'email', address: '' })
  })

  it('falls back to slim default on every switch-back across many round-trips', async () => {
    const { app, api } = mountProfileWith({ rememberVariants: false })
    apps.push(app)

    for (const candidate of ['a@x.io', 'b@y.io', 'c@z.io']) {
      api.setValue('notify.address', candidate)
      api.setValue('notify.channel', 'sms')
      await nextTick()
      api.setValue('notify.channel', 'email')
      await nextTick()
      // Each round-trip resets to slim default — no accumulation.
      expect(api.values.notify).toEqual({ channel: 'email', address: '' })
    }
  })
})

describe('variant memory — reset clears memory', () => {
  const apps: App[] = []
  afterEach(() => {
    while (apps.length > 0) apps.pop()?.unmount()
  })

  it('reset() drops all variant memory entries', async () => {
    const { app, api } = mountProfileWith()
    apps.push(app)

    api.setValue('notify.address', 'will-be-forgotten@example.com')
    api.setValue('notify.channel', 'sms')
    await nextTick()

    api.reset()
    await nextTick()

    // After reset, switch sms → email must NOT surface the
    // pre-reset memory entry.
    api.setValue('notify.channel', 'sms')
    api.setValue('notify.channel', 'email')
    await nextTick()
    expect(api.values.notify).toEqual({ channel: 'email', address: '' })
  })

  it("resetField at the union path drops that union's memory", async () => {
    const { app, api } = mountProfileWith()
    apps.push(app)

    api.setValue('notify.address', 'pre-reset@example.com')
    api.setValue('notify.channel', 'sms')
    await nextTick()

    api.resetField('notify')
    await nextTick()

    // Switch sms → email — memory was cleared at union path, so
    // restoration falls back to slim default.
    api.setValue('notify.channel', 'sms')
    api.setValue('notify.channel', 'email')
    await nextTick()
    expect(api.values.notify).toEqual({ channel: 'email', address: '' })
  })

  it("resetField on a leaf INSIDE a variant does NOT clear that union's memory", async () => {
    const { app, api } = mountProfileWith()
    apps.push(app)

    // Type then switch out — memory captures email with the typed value.
    api.setValue('notify.address', 'remembered@example.com')
    api.setValue('notify.channel', 'sms')
    await nextTick()

    // Switch back, type something fresh, reset just the leaf —
    // memory at ['notify'] is preserved by design (it self-corrects
    // on the next switch-out).
    api.setValue('notify.channel', 'email')
    await nextTick()
    expect(api.values.notify).toEqual({ channel: 'email', address: 'remembered@example.com' })

    api.setValue('notify.address', 'fresh@example.com')
    api.resetField('notify.address')
    await nextTick()
    expect(api.values.notify).toEqual({ channel: 'email', address: '' })

    // Self-correction: switch out + back should now reflect the
    // post-reset baseline (''), not the older 'remembered@…' that
    // was in memory before.
    api.setValue('notify.channel', 'sms')
    api.setValue('notify.channel', 'email')
    await nextTick()
    expect(api.values.notify).toEqual({ channel: 'email', address: '' })
  })
})

const flowSchema = z.object({
  flow: z.discriminatedUnion('step', [
    z.object({
      step: z.literal('choose-type'),
      type: z.discriminatedUnion('kind', [
        z.object({ kind: z.literal('A'), a: z.string() }),
        z.object({ kind: z.literal('B'), b: z.string() }),
      ]),
    }),
    z.object({ step: z.literal('review'), notes: z.string() }),
  ]),
})
type FlowApi = Omit<UseAbstractFormReturnType<z.output<typeof flowSchema>>, 'setValue'> & {
  setValue: (path: string, value: unknown) => boolean
  values: { flow: { step: string } & Record<string, unknown> }
}

function mountFlow(): { app: App; api: FlowApi } {
  const handle: { api?: FlowApi } = {}
  const App = defineComponent({
    setup() {
      handle.api = useForm({
        schema: flowSchema,
        key: `du-variant-memory-flow-${Math.random().toString(36).slice(2)}`,
        defaultValues: {
          flow: { step: 'choose-type', type: { kind: 'A', a: '' } },
        },
      }) as unknown as FlowApi
      return () => h('div')
    },
  })
  const app = createApp(App).use(createChemicalXForms({ override: true }))
  app.mount(document.createElement('div'))
  return { app, api: handle.api as FlowApi }
}

describe('variant memory — nested DUs (depth 2)', () => {
  const apps: App[] = []
  afterEach(() => {
    while (apps.length > 0) apps.pop()?.unmount()
  })

  it('inner switch round-trip preserves typed data at the inner level', async () => {
    const { app, api } = mountFlow()
    apps.push(app)

    api.setValue('flow.type.a', 'aaa')
    api.setValue('flow.type.kind', 'B')
    api.setValue('flow.type.b', 'bbb')
    api.setValue('flow.type.kind', 'A')
    await nextTick()
    expect(api.values.flow).toEqual({
      step: 'choose-type',
      type: { kind: 'A', a: 'aaa' },
    })

    api.setValue('flow.type.kind', 'B')
    await nextTick()
    expect(api.values.flow).toEqual({
      step: 'choose-type',
      type: { kind: 'B', b: 'bbb' },
    })
  })

  it('outer round-trip restores the full inner subtree byte-for-byte', async () => {
    const { app, api } = mountFlow()
    apps.push(app)

    api.setValue('flow.type.a', 'inner-a-value')
    api.setValue('flow.step', 'review')
    api.setValue('flow.notes' as never, 'review-text')
    await nextTick()
    expect(api.values.flow).toEqual({ step: 'review', notes: 'review-text' })

    api.setValue('flow.step', 'choose-type')
    await nextTick()
    expect(api.values.flow).toEqual({
      step: 'choose-type',
      type: { kind: 'A', a: 'inner-a-value' },
    })
  })

  it('inner memory persists across an outer round-trip and is consulted on inner re-flip', async () => {
    const { app, api } = mountFlow()
    apps.push(app)

    // Set up inner memory: A typed, switch to B typed, leaving inner
    // memory entries for both A and B.
    api.setValue('flow.type.a', 'inner-A')
    api.setValue('flow.type.kind', 'B')
    api.setValue('flow.type.b', 'inner-B')
    await nextTick()

    // Outer round-trip: choose-type → review → choose-type. Inner
    // memory entries were never explicitly cleared — they live at
    // absolute path `["flow","type"]` regardless of outer state.
    api.setValue('flow.step', 'review')
    await nextTick()
    api.setValue('flow.step', 'choose-type')
    await nextTick()

    // After outer-restore, the inner DU's `kind` is whatever the
    // outer snapshot captured (B). Flipping to A consults inner
    // memory and restores the typed value.
    expect((api.values.flow as Record<string, unknown>)['type']).toEqual({
      kind: 'B',
      b: 'inner-B',
    })
    api.setValue('flow.type.kind', 'A')
    await nextTick()
    expect((api.values.flow as Record<string, unknown>)['type']).toEqual({
      kind: 'A',
      a: 'inner-A',
    })
  })

  it('inner switches inside the restored outer subtree work normally', async () => {
    const { app, api } = mountFlow()
    apps.push(app)

    api.setValue('flow.type.a', 'a-text')
    api.setValue('flow.step', 'review')
    api.setValue('flow.step', 'choose-type')
    await nextTick()
    // Restored — inner is { kind: 'A', a: 'a-text' }. Inner switch
    // to B falls back to slim default (no inner memory yet for B
    // because the inner switch never happened pre-outer-toggle).
    api.setValue('flow.type.kind', 'B')
    await nextTick()
    expect((api.values.flow as Record<string, unknown>)['type']).toEqual({
      kind: 'B',
      b: '',
    })
  })
})

describe('variant memory — nested DU + reset interactions', () => {
  const apps: App[] = []
  afterEach(() => {
    while (apps.length > 0) apps.pop()?.unmount()
  })

  it('reset() clears outer and inner memory entries', async () => {
    const { app, api } = mountFlow()
    apps.push(app)

    api.setValue('flow.type.a', 'inner-A')
    api.setValue('flow.type.kind', 'B')
    api.setValue('flow.type.b', 'inner-B')
    await nextTick()

    api.reset()
    await nextTick()

    // Inner switches after reset must NOT surface pre-reset values.
    api.setValue('flow.type.kind', 'A')
    await nextTick()
    expect((api.values.flow as Record<string, unknown>)['type']).toEqual({
      kind: 'A',
      a: '',
    })
    api.setValue('flow.type.kind', 'B')
    await nextTick()
    expect((api.values.flow as Record<string, unknown>)['type']).toEqual({
      kind: 'B',
      b: '',
    })
  })

  it('resetField at outer parent path clears outer + nested memory', async () => {
    const { app, api } = mountFlow()
    apps.push(app)

    api.setValue('flow.type.a', 'inner-A-pre-reset')
    api.setValue('flow.type.kind', 'B')
    api.setValue('flow.type.b', 'inner-B-pre-reset')
    await nextTick()

    api.resetField('flow')
    await nextTick()

    // After resetField('flow'), inner memory at ['flow','type'] must
    // also be gone (it sits under the reset path). A subsequent
    // inner switch must yield slim defaults, not the pre-reset
    // typed values.
    api.setValue('flow.type.kind', 'A')
    await nextTick()
    expect((api.values.flow as Record<string, unknown>)['type']).toEqual({
      kind: 'A',
      a: '',
    })
  })

  it('resetField at inner parent path clears inner memory only', async () => {
    const { app, api } = mountFlow()
    apps.push(app)

    api.setValue('flow.type.a', 'inner-A-pre-reset')
    api.setValue('flow.type.kind', 'B')
    api.setValue('flow.type.b', 'inner-B-pre-reset')
    await nextTick()

    api.resetField('flow.type')
    await nextTick()

    // Inner memory cleared — A switch falls back to slim default.
    api.setValue('flow.type.kind', 'A')
    await nextTick()
    expect((api.values.flow as Record<string, unknown>)['type']).toEqual({
      kind: 'A',
      a: '',
    })

    // Outer memory at ['flow'] is preserved — but in this test the
    // outer never switched, so there's no outer entry to consult.
    // Switching outer here just exercises the outer memory machinery.
    api.setValue('flow.type.a', 'fresh-A')
    api.setValue('flow.step', 'review')
    api.setValue('flow.step', 'choose-type')
    await nextTick()
    expect((api.values.flow as Record<string, unknown>)['type']).toEqual({
      kind: 'A',
      a: 'fresh-A',
    })
  })
})

describe('variant memory — DU nested inside an array element', () => {
  const arraySchema = z.object({
    events: z.array(
      z.discriminatedUnion('type', [
        z.object({ type: z.literal('click'), x: z.string() }),
        z.object({ type: z.literal('text'), value: z.string() }),
      ])
    ),
  })
  type ArrayApi = Omit<UseAbstractFormReturnType<z.output<typeof arraySchema>>, 'setValue'> & {
    setValue: (path: string, value: unknown) => boolean
    values: { events: Array<{ type: string } & Record<string, unknown>> }
  }

  const apps: App[] = []
  afterEach(() => {
    while (apps.length > 0) apps.pop()?.unmount()
  })

  function mountArray(): ArrayApi {
    const handle: { api?: ArrayApi } = {}
    const App = defineComponent({
      setup() {
        handle.api = useForm({
          schema: arraySchema,
          key: `du-variant-memory-array-${Math.random().toString(36).slice(2)}`,
          defaultValues: {
            events: [
              { type: 'click', x: '' },
              { type: 'text', value: '' },
            ],
          },
        }) as unknown as ArrayApi
        return () => h('div')
      },
    })
    const app = createApp(App).use(createChemicalXForms({ override: true }))
    app.mount(document.createElement('div'))
    apps.push(app)
    return handle.api as ArrayApi
  }

  it('memory entries key off events[0] separately from events[1]', async () => {
    const api = mountArray()

    // events[0]: click → text → click. Memory at ['events',0] holds
    // the click-with-x value.
    api.setValue('events.0.x', 'index-0-click')
    api.setValue('events.0.type', 'text')
    api.setValue('events.0.type', 'click')
    await nextTick()
    expect(api.values.events[0]).toEqual({ type: 'click', x: 'index-0-click' })

    // events[1] is independent — switching events[1].type must NOT
    // restore from events[0]'s memory.
    api.setValue('events.1.value', 'index-1-text')
    api.setValue('events.1.type', 'click')
    await nextTick()
    expect(api.values.events[1]).toEqual({ type: 'click', x: '' })
  })

  it("resetField on an indexed element clears only that index's memory", async () => {
    const api = mountArray()

    api.setValue('events.0.x', 'idx-0')
    api.setValue('events.0.type', 'text')
    api.setValue('events.1.value', 'idx-1')
    api.setValue('events.1.type', 'click')
    await nextTick()

    api.resetField('events.0')
    await nextTick()

    // events[0] memory cleared — switching back to click yields
    // slim default, not the typed 'idx-0'.
    api.setValue('events.0.type', 'click')
    await nextTick()
    expect(api.values.events[0]).toEqual({ type: 'click', x: '' })

    // events[1] memory preserved — switching back to text restores.
    api.setValue('events.1.type', 'text')
    await nextTick()
    expect(api.values.events[1]).toEqual({ type: 'text', value: 'idx-1' })
  })

  it('resetField on the array path clears memory for every index', async () => {
    const api = mountArray()

    api.setValue('events.0.x', 'idx-0')
    api.setValue('events.0.type', 'text')
    api.setValue('events.1.value', 'idx-1')
    api.setValue('events.1.type', 'click')
    await nextTick()

    api.resetField('events')
    await nextTick()

    api.setValue('events.0.type', 'click')
    api.setValue('events.1.type', 'text')
    await nextTick()
    expect(api.values.events[0]).toEqual({ type: 'click', x: '' })
    expect(api.values.events[1]).toEqual({ type: 'text', value: '' })
  })
})

describe('variant memory — nested DUs (depth 3)', () => {
  // wizard = DU('phase', [
  //   { phase: 'config', config: DU('mode', [
  //       { mode: 'manual', detail: DU('shape', [{ shape: 'rect', w, h }, { shape: 'circle', r }]) },
  //       { mode: 'auto', preset },
  //     ]) },
  //   { phase: 'submit', confirmed },
  // ])
  const wizardSchema = z.object({
    wizard: z.discriminatedUnion('phase', [
      z.object({
        phase: z.literal('config'),
        config: z.discriminatedUnion('mode', [
          z.object({
            mode: z.literal('manual'),
            detail: z.discriminatedUnion('shape', [
              z.object({ shape: z.literal('rect'), w: z.string(), h: z.string() }),
              z.object({ shape: z.literal('circle'), r: z.string() }),
            ]),
          }),
          z.object({ mode: z.literal('auto'), preset: z.string() }),
        ]),
      }),
      z.object({ phase: z.literal('submit'), confirmed: z.string() }),
    ]),
  })
  type WizardApi = Omit<UseAbstractFormReturnType<z.output<typeof wizardSchema>>, 'setValue'> & {
    setValue: (path: string, value: unknown) => boolean
    values: { wizard: { phase: string } & Record<string, unknown> }
  }

  const apps: App[] = []
  afterEach(() => {
    while (apps.length > 0) apps.pop()?.unmount()
  })

  function mountWizard(): WizardApi {
    const handle: { api?: WizardApi } = {}
    const App = defineComponent({
      setup() {
        handle.api = useForm({
          schema: wizardSchema,
          key: `du-variant-memory-wizard-${Math.random().toString(36).slice(2)}`,
          defaultValues: {
            wizard: {
              phase: 'config',
              config: {
                mode: 'manual',
                detail: { shape: 'rect', w: '', h: '' },
              },
            },
          },
        }) as unknown as WizardApi
        return () => h('div')
      },
    })
    const app = createApp(App).use(createChemicalXForms({ override: true }))
    app.mount(document.createElement('div'))
    apps.push(app)
    return handle.api as WizardApi
  }

  it('depth-3 inner switch preserves typed data at the deepest level', async () => {
    const api = mountWizard()

    api.setValue('wizard.config.detail.w', '100')
    api.setValue('wizard.config.detail.h', '50')
    api.setValue('wizard.config.detail.shape', 'circle')
    api.setValue('wizard.config.detail.r', '42')
    await nextTick()

    api.setValue('wizard.config.detail.shape', 'rect')
    await nextTick()
    expect((api.values.wizard as Record<string, unknown>)['config']).toEqual({
      mode: 'manual',
      detail: { shape: 'rect', w: '100', h: '50' },
    })

    api.setValue('wizard.config.detail.shape', 'circle')
    await nextTick()
    expect((api.values.wizard as Record<string, unknown>)['config']).toEqual({
      mode: 'manual',
      detail: { shape: 'circle', r: '42' },
    })
  })

  it('outer-then-middle-then-inner round-trip preserves all three levels', async () => {
    const api = mountWizard()

    // Type at the deepest level.
    api.setValue('wizard.config.detail.w', '99')
    api.setValue('wizard.config.detail.h', '11')
    await nextTick()

    // Outer switch out and back — captures the entire wizard subtree
    // including middle + deepest layers.
    api.setValue('wizard.phase', 'submit')
    api.setValue('wizard.phase', 'config')
    await nextTick()
    expect(api.values.wizard).toEqual({
      phase: 'config',
      config: { mode: 'manual', detail: { shape: 'rect', w: '99', h: '11' } },
    })

    // Middle switch out and back — captures the deepest layer.
    api.setValue('wizard.config.mode', 'auto')
    api.setValue('wizard.config.preset' as never, 'auto-preset')
    await nextTick()
    api.setValue('wizard.config.mode', 'manual')
    await nextTick()
    expect((api.values.wizard as Record<string, unknown>)['config']).toEqual({
      mode: 'manual',
      detail: { shape: 'rect', w: '99', h: '11' },
    })
  })
})

describe('variant memory — field state across round-trip', () => {
  const apps: App[] = []
  afterEach(() => {
    while (apps.length > 0) apps.pop()?.unmount()
  })

  it('typed-then-restored leaf reads back the same value (memory keeps the field consistent)', async () => {
    const { app, api } = mountProfileWith()
    apps.push(app)

    api.setValue('notify.address', 'state-check@example.com')
    api.setValue('notify.channel', 'sms')
    await nextTick()

    api.setValue('notify.channel', 'email')
    await nextTick()

    // The reactive read mirrors what was typed. Pins the contract
    // that field-level state (consumers reading via `values`) sees
    // the restored value as the current source of truth.
    expect(api.values.notify).toEqual({ channel: 'email', address: 'state-check@example.com' })
    expect((api.values.notify as Record<string, unknown>)['address']).toBe(
      'state-check@example.com'
    )
  })
})

describe('variant memory — history (undo/redo) interaction', () => {
  const apps: App[] = []
  afterEach(() => {
    while (apps.length > 0) apps.pop()?.unmount()
  })

  it('history snapshots the form value but not memory; memory remains independent of undo', async () => {
    const handle: { api?: ProfileApi } = {}
    const App = defineComponent({
      setup() {
        handle.api = useForm({
          schema: profileSchema,
          key: `du-variant-memory-history-${Math.random().toString(36).slice(2)}`,
          defaultValues: { name: '', notify: { channel: 'email', address: '' } },
          history: true,
        }) as unknown as ProfileApi
        return () => h('div')
      },
    })
    const app = createApp(App).use(createChemicalXForms({ override: true }))
    app.mount(document.createElement('div'))
    apps.push(app)
    const api = handle.api as ProfileApi

    api.setValue('notify.address', 'h1@example.com')
    api.setValue('notify.channel', 'sms')
    await nextTick()

    // Memory now holds email = { address: 'h1@example.com' }.
    // Undo restores form value to the pre-switch state. Memory is
    // not on the history stack — it stays as it is.
    api.undo()
    await nextTick()
    expect(api.values.notify).toEqual({ channel: 'email', address: 'h1@example.com' })

    // Switching to sms now re-snapshots the (undone-to) state into
    // memory[email], which already had the same value — no surprise.
    // The documented behavior: history operates on form value only.
    api.setValue('notify.channel', 'sms')
    await nextTick()
    expect(api.values.notify).toEqual({ channel: 'sms', number: '' })
  })
})
