// @vitest-environment jsdom
import { createApp, defineComponent, h } from 'vue'
import { describe, expect, expectTypeOf, it } from 'vitest'
import { z } from 'zod'
import { useForm } from '../../src/zod'
import { createAttaform } from '../../src/runtime/core/plugin'
import type { ValidationError } from '../../src/runtime/types/types-api'

/**
 * Storage-shape invariant probes (feedback §1.2).
 *
 * The invariant: `form.values.<path>` always returns the resolved
 * concrete type that storage holds. `.default()` has fired,
 * preprocess has normalised, blank-path synthesis has filled the
 * skeleton. Reads NEVER produce `undefined` for a slot the schema
 * resolved to a concrete type — and the static type SHOULD agree.
 *
 * Type-level assertions pin the surface so a future regression to
 * `z.input<Schema>`-only typing (or any drift in `ReadShape<>`) trips
 * `expectTypeOf` at compile time. Runtime assertions confirm the
 * storage invariant holds end-to-end; together the matrix is the
 * cross-check that the static type and the runtime agree.
 *
 * Out-of-scope edges (kept here as guardrails, not bugs):
 *  - `ZodOptional<T>` without a default — genuinely optional; type
 *    correctly carries `| undefined`.
 *  - `ZodNullable<T>` — type carries `| null`.
 *  - Array index access past `length` — tainted by
 *    `noUncheckedIndexedAccess`, not by the storage invariant.
 *  - `.transform()` — storage holds pre-transform input; post-transform
 *    output is exposed via `handleSubmit` / `form.process()`.
 */

function makeFormProxy<T>(): T {
  const handler: ProxyHandler<() => unknown> = {
    get: () => proxy,
    apply: () => proxy,
  }
  const proxy: unknown = new Proxy(() => undefined, handler)
  return proxy as T
}

function mountForm<R>(setup: () => R): { api: R; unmount: () => void } {
  let captured: R | undefined
  const App = defineComponent({
    setup() {
      captured = setup()
      return () => h('div')
    },
  })
  const app = createApp(App).use(createAttaform())
  const root = document.createElement('div')
  document.body.appendChild(root)
  app.mount(root)
  if (captured === undefined) throw new Error('mountForm: setup never returned')
  return {
    api: captured,
    unmount: () => {
      app.unmount()
      document.body.removeChild(root)
    },
  }
}

function uniqueKey(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2)}`
}

// ──────────────────────────────────────────────────────────────────────
// ZodDefault — type should peel `| undefined`; runtime resolves the default.
// ──────────────────────────────────────────────────────────────────────

const defaultsSchema = z.object({
  flag: z.boolean().default(true),
  count: z.number().default(0),
  name: z.string().default('attaform'),
  tags: z.array(z.string()).default([]),
  config: z
    .object({
      enabled: z.boolean().default(true),
      label: z.string().default('default-label'),
    })
    .default({ enabled: true, label: 'default-label' }),
})

describe('ZodDefault — type peels `| undefined`, runtime resolves the default', () => {
  type Form = ReturnType<typeof useForm<typeof defaultsSchema>>
  const formT = makeFormProxy<Form>()

  it('z.boolean().default(true) → boolean (type)', () => {
    expectTypeOf(formT.values.flag).toEqualTypeOf<boolean>()
  })
  it('z.boolean().default(true) → true (runtime)', () => {
    const { api, unmount } = mountForm(() =>
      useForm({ schema: defaultsSchema, key: uniqueKey('zd-bool') })
    )
    try {
      expect(api.values.flag).toBe(true)
      expect(typeof api.values.flag).toBe('boolean')
    } finally {
      unmount()
    }
  })

  it('z.number().default(0) → number (type)', () => {
    expectTypeOf(formT.values.count).toEqualTypeOf<number>()
  })
  it('z.number().default(0) → 0 (runtime)', () => {
    const { api, unmount } = mountForm(() =>
      useForm({ schema: defaultsSchema, key: uniqueKey('zd-num') })
    )
    try {
      expect(api.values.count).toBe(0)
      expect(typeof api.values.count).toBe('number')
    } finally {
      unmount()
    }
  })

  it('z.string().default("attaform") → string (type)', () => {
    expectTypeOf(formT.values.name).toEqualTypeOf<string>()
  })
  it('z.string().default("attaform") → "attaform" (runtime)', () => {
    const { api, unmount } = mountForm(() =>
      useForm({ schema: defaultsSchema, key: uniqueKey('zd-str') })
    )
    try {
      expect(api.values.name).toBe('attaform')
      expect(typeof api.values.name).toBe('string')
    } finally {
      unmount()
    }
  })

  it('z.array(z.string()).default([]) → string[] (type)', () => {
    expectTypeOf(formT.values.tags).toEqualTypeOf<string[]>()
  })
  it('z.array(z.string()).default([]) → [] (runtime)', () => {
    const { api, unmount } = mountForm(() =>
      useForm({ schema: defaultsSchema, key: uniqueKey('zd-arr') })
    )
    try {
      expect(api.values.tags).toEqual([])
      expect(Array.isArray(api.values.tags)).toBe(true)
    } finally {
      unmount()
    }
  })

  it('nested ZodDefault — type resolves inner shape', () => {
    expectTypeOf(formT.values.config).toEqualTypeOf<{ enabled: boolean; label: string }>()
    expectTypeOf(formT.values.config.enabled).toEqualTypeOf<boolean>()
  })
  it('nested ZodDefault — runtime resolves the inner shape', () => {
    const { api, unmount } = mountForm(() =>
      useForm({ schema: defaultsSchema, key: uniqueKey('zd-obj') })
    )
    try {
      expect(api.values.config).toEqual({ enabled: true, label: 'default-label' })
      expect(api.values.config.enabled).toBe(true)
    } finally {
      unmount()
    }
  })

  it('reset restores defaults (sanity: ZodDefault is the source of truth)', () => {
    const { api, unmount } = mountForm(() =>
      useForm({ schema: defaultsSchema, key: uniqueKey('zd-reset') })
    )
    try {
      api.setValue('flag', false)
      api.setValue('count', 42)
      api.reset()
      expect(api.values.flag).toBe(true)
      expect(api.values.count).toBe(0)
    } finally {
      unmount()
    }
  })
})

// ──────────────────────────────────────────────────────────────────────
// Bare-required fields — synthesis resolves to a falsy concrete value.
// ──────────────────────────────────────────────────────────────────────

const bareRequiredSchema = z.object({
  s: z.string(),
  n: z.number(),
  b: z.boolean(),
  arr: z.array(z.string()),
})

describe('Synthesis — bare-required fields resolve to a falsy concrete value', () => {
  type Form = ReturnType<typeof useForm<typeof bareRequiredSchema>>
  const formT = makeFormProxy<Form>()

  it('z.string() (no default) → string (type)', () => {
    expectTypeOf(formT.values.s).toEqualTypeOf<string>()
  })
  it('z.string() (no default) → "" (runtime)', () => {
    const { api, unmount } = mountForm(() =>
      useForm({ schema: bareRequiredSchema, key: uniqueKey('synth-str') })
    )
    try {
      expect(api.values.s).toBe('')
      expect(typeof api.values.s).toBe('string')
    } finally {
      unmount()
    }
  })

  it('z.number() (no default) → number (type)', () => {
    expectTypeOf(formT.values.n).toEqualTypeOf<number>()
  })
  it('z.number() (no default) → 0 (runtime)', () => {
    const { api, unmount } = mountForm(() =>
      useForm({ schema: bareRequiredSchema, key: uniqueKey('synth-num') })
    )
    try {
      expect(api.values.n).toBe(0)
      expect(typeof api.values.n).toBe('number')
    } finally {
      unmount()
    }
  })

  it('z.boolean() (no default) → boolean (type)', () => {
    expectTypeOf(formT.values.b).toEqualTypeOf<boolean>()
  })
  it('z.boolean() (no default) → false (runtime)', () => {
    const { api, unmount } = mountForm(() =>
      useForm({ schema: bareRequiredSchema, key: uniqueKey('synth-bool') })
    )
    try {
      expect(api.values.b).toBe(false)
      expect(typeof api.values.b).toBe('boolean')
    } finally {
      unmount()
    }
  })

  it('z.array(z.string()) (no default) → string[] (type)', () => {
    expectTypeOf(formT.values.arr).toEqualTypeOf<string[]>()
  })
  it('z.array(z.string()) (no default) → [] (runtime)', () => {
    const { api, unmount } = mountForm(() =>
      useForm({ schema: bareRequiredSchema, key: uniqueKey('synth-arr') })
    )
    try {
      expect(api.values.arr).toEqual([])
      expect(Array.isArray(api.values.arr)).toBe(true)
    } finally {
      unmount()
    }
  })
})

// ──────────────────────────────────────────────────────────────────────
// Deep nested synthesis — invariant holds all the way down.
// ──────────────────────────────────────────────────────────────────────

const deepSchema = z.object({
  user: z.object({
    name: z.string(),
    profile: z.object({
      bio: z.string(),
    }),
  }),
  a: z.object({
    b: z.object({
      c: z.object({
        d: z.string(),
      }),
    }),
  }),
})

describe('Synthesis — deep nested objects resolve recursively', () => {
  type Form = ReturnType<typeof useForm<typeof deepSchema>>
  const formT = makeFormProxy<Form>()

  it('two-level descent — type stays strict', () => {
    expectTypeOf(formT.values.user.name).toEqualTypeOf<string>()
    expectTypeOf(formT.values.user.profile.bio).toEqualTypeOf<string>()
  })
  it('two-level descent — every leaf falsy-concrete at runtime', () => {
    const { api, unmount } = mountForm(() =>
      useForm({ schema: deepSchema, key: uniqueKey('deep-2') })
    )
    try {
      expect(api.values.user.name).toBe('')
      expect(api.values.user.profile.bio).toBe('')
      expect(typeof api.values.user.name).toBe('string')
      expect(typeof api.values.user.profile.bio).toBe('string')
    } finally {
      unmount()
    }
  })

  it('four-level descent — type stays strict', () => {
    expectTypeOf(formT.values.a.b.c.d).toEqualTypeOf<string>()
  })
  it('four-level descent does not short-circuit to undefined', () => {
    const { api, unmount } = mountForm(() =>
      useForm({ schema: deepSchema, key: uniqueKey('deep-4') })
    )
    try {
      expect(api.values.a.b.c.d).toBe('')
      expect(typeof api.values.a.b.c.d).toBe('string')
    } finally {
      unmount()
    }
  })
})

// ──────────────────────────────────────────────────────────────────────
// Discriminated union — stub state before the discriminator is chosen.
// ──────────────────────────────────────────────────────────────────────

const duSchema = z.object({
  tagged: z.discriminatedUnion('type', [
    z.object({ type: z.literal('a'), a: z.string() }),
    z.object({ type: z.literal('b'), b: z.number() }),
  ]),
})

describe('Discriminated union — stub state before discriminator chosen', () => {
  it('discriminator path is readable and falls in the literal union at runtime', () => {
    const { api, unmount } = mountForm(() =>
      useForm({ schema: duSchema, key: uniqueKey('du-stub') })
    )
    try {
      expect(['a', 'b']).toContain(api.values.tagged.type)
    } finally {
      unmount()
    }
  })

  it('active-variant leaf reads as its resolved falsy-concrete', () => {
    const { api, unmount } = mountForm(() =>
      useForm({ schema: duSchema, key: uniqueKey('du-leaf') })
    )
    try {
      const active = api.values.tagged
      if (active.type === 'a') {
        expect(active.a).toBe('')
        expect(typeof active.a).toBe('string')
      } else if (active.type === 'b') {
        expect(active.b).toBe(0)
        expect(typeof active.b).toBe('number')
      } else {
        throw new Error(`unexpected DU stub variant: ${String(active.type)}`)
      }
    } finally {
      unmount()
    }
  })
})

// ──────────────────────────────────────────────────────────────────────
// Genuinely uncertain — invariant does NOT promise to peel these.
// ──────────────────────────────────────────────────────────────────────

const optionalSchema = z.object({ bio: z.string().optional() })
const nullableSchema = z.object({ ref: z.string().nullable() })
const arrSchema = z.object({ tags: z.array(z.string()) })

describe('Genuinely uncertain — invariant does NOT promise to peel', () => {
  it('z.string().optional() keeps `| undefined` at the type level', () => {
    type Form = ReturnType<typeof useForm<typeof optionalSchema>>
    const formT = makeFormProxy<Form>()
    expectTypeOf(formT.values.bio).toEqualTypeOf<string | undefined>()
  })
  it('z.string().optional() — runtime behaviour documented', () => {
    const { api, unmount } = mountForm(() =>
      useForm({ schema: optionalSchema, key: uniqueKey('opt') })
    )
    try {
      // Pin whatever the runtime returns today; the assertion's role is
      // to document the synthesized value for optional-without-default,
      // not to claim a target. Flip the matcher if a future intentional
      // change in synthesis policy lands.
      expect(api.values.bio).toBeUndefined()
    } finally {
      unmount()
    }
  })

  it('z.string().nullable() keeps `| null` at the type level', () => {
    type Form = ReturnType<typeof useForm<typeof nullableSchema>>
    const formT = makeFormProxy<Form>()
    expectTypeOf(formT.values.ref).toEqualTypeOf<string | null>()
  })
  it('z.string().nullable() — runtime behaviour documented', () => {
    const { api, unmount } = mountForm(() =>
      useForm({ schema: nullableSchema, key: uniqueKey('nul') })
    )
    try {
      // Pin whatever the runtime returns today (likely null or
      // undefined); the assertion documents synthesis for nullable-
      // without-default.
      const ref: unknown = api.values.ref
      expect(ref === null || ref === undefined).toBe(true)
    } finally {
      unmount()
    }
  })

  it('array element past length is `T | undefined` — noUncheckedIndexedAccess, not storage', () => {
    type Form = ReturnType<typeof useForm<typeof arrSchema>>
    const formT = makeFormProxy<Form>()
    expectTypeOf(formT.values.tags[0]).toEqualTypeOf<string | undefined>()
  })
  it('array element past length — runtime is undefined (just the indexing edge)', () => {
    const { api, unmount } = mountForm(() =>
      useForm({ schema: arrSchema, key: uniqueKey('arr-edge') })
    )
    try {
      expect(api.values.tags[0]).toBeUndefined()
      expect(api.values.tags.length).toBe(0)
    } finally {
      unmount()
    }
  })
})

// ──────────────────────────────────────────────────────────────────────
// preprocess / transform — write-boundary vs parse-time semantics.
// ──────────────────────────────────────────────────────────────────────

const preprocessSchema = z.object({
  trimmed: z.preprocess((v) => (typeof v === 'string' ? v.trim() : v), z.string()),
})

const transformSchema = z.object({
  letterCount: z.string().transform((s) => s.length),
})

describe('preprocess / transform — write-boundary vs parse-time semantics', () => {
  it('z.preprocess(fn, z.string()) — type peels to inner-schema input', () => {
    type Form = ReturnType<typeof useForm<typeof preprocessSchema>>
    const formT = makeFormProxy<Form>()
    expectTypeOf(formT.values.trimmed).toEqualTypeOf<string>()
  })

  it('z.preprocess(fn, z.string()) — storage holds the inner-schema falsy, not undefined', () => {
    const { api, unmount } = mountForm(() =>
      useForm({ schema: preprocessSchema, key: uniqueKey('pre-synth') })
    )
    try {
      expect(api.values.trimmed).toBe('')
      expect(typeof api.values.trimmed).toBe('string')
    } finally {
      unmount()
    }
  })

  // RED today: preprocess throwing on a write leaves the field at
  // `undefined` (or whatever the throw policy is). POST-FIX, the
  // field falls back to a "reasonable value" — concrete sub-policy
  // (inner-falsy vs prior-value) settled when the implementation
  // lands. The narrow guarantee this probe pins: NEVER undefined.
  it('preprocess failure on write does not strand the field at undefined', () => {
    const throwyPreprocess = z.object({
      v: z.preprocess(() => {
        throw new Error('preprocess refused')
      }, z.string()),
    })
    const { api, unmount } = mountForm(() =>
      useForm({ schema: throwyPreprocess, key: uniqueKey('pre-throw') })
    )
    try {
      // Pre-write: synthesis path holds (inner falsy).
      expect(api.values.v).toBe('')
      // Write attempt that triggers the throw.
      try {
        api.setValue('v', 'anything')
      } catch {
        // Throw policy at the write boundary is open; the probe only
        // pins the resulting storage state.
      }
      expect(api.values.v).not.toBeUndefined()
      expect(typeof api.values.v).toBe('string')
    } finally {
      unmount()
    }
  })

  it('z.string().transform(fn) — storage holds PRE-transform input (existing rationale)', () => {
    type Form = ReturnType<typeof useForm<typeof transformSchema>>
    const formT = makeFormProxy<Form>()
    // Transforms run at parse, not at write. The storage view stays the
    // input shape — string here, not number. This is the case the §1.1
    // tightening DELIBERATELY leaves alone.
    expectTypeOf(formT.values.letterCount).toEqualTypeOf<string>()
  })

  it('z.string().transform(fn) — runtime stores the pre-transform string', () => {
    const { api, unmount } = mountForm(() =>
      useForm({ schema: transformSchema, key: uniqueKey('tx') })
    )
    try {
      expect(typeof api.values.letterCount).toBe('string')
    } finally {
      unmount()
    }
  })
})

// ──────────────────────────────────────────────────────────────────────
// Depth-pressure regression. Modelled on the cargo-shipment booking
// demo (apps/site/repl-demos/shipment-demo.vue) — the schema-shape
// that previously made the language-service hover for `useForm`
// surface TS2589 ("Type instantiation is excessively deep") even
// though tsc accepted it. Two discriminated unions, an array of
// objects, two address sub-objects, and several enums in one shape
// is the bar this probe holds.
// ──────────────────────────────────────────────────────────────────────

describe('Depth pressure — multi-step booking schema (shipment-demo shape)', () => {
  const COUNTRIES = ['US', 'CA', 'MX', 'GB', 'DE', 'FR', 'JP', 'CN', 'AU'] as const
  const HAZARD_CLASSES = ['1', '2', '3', '4', '5', '6', '7', '8', '9'] as const
  const TRUCK_TYPES = ['box', 'flatbed', 'reefer', 'tanker'] as const
  const CONTAINER_SIZES = ['20FT', '40FT', '40FTHC', '45FTHC'] as const
  const COVERAGES = ['none', 'basic', 'full'] as const

  const addressSchema = z.object({
    line1: z.string().min(1),
    line2: z.string().optional(),
    city: z.string().min(1),
    region: z.string().min(2),
    postalCode: z.string().min(3),
    country: z.enum(COUNTRIES),
  })
  const lineItemSchema = z.object({
    sku: z.string(),
    description: z.string().min(1).max(120),
    quantity: z.number().int().min(1).max(10_000),
    unitWeightLb: z.number().positive(),
  })
  const dryDetails = z.object({ type: z.literal('dry'), fragile: z.boolean() })
  const refrigeratedDetails = z.object({
    type: z.literal('refrigerated'),
    tempMinF: z.number(),
    tempMaxF: z.number(),
  })
  const hazmatDetails = z.object({
    type: z.literal('hazmat'),
    unNumber: z.string(),
    hazardClass: z.enum(HAZARD_CLASSES),
    acknowledged: z.literal(true),
  })
  const oversizedDetails = z.object({
    type: z.literal('oversized'),
    lengthIn: z.number().positive(),
    widthIn: z.number().positive(),
    heightIn: z.number().positive(),
    permitNumber: z.string().optional(),
  })
  const cargoSchema = z.object({
    items: z.array(lineItemSchema).min(1),
    details: z.discriminatedUnion('type', [
      dryDetails,
      refrigeratedDetails,
      hazmatDetails,
      oversizedDetails,
    ]),
  })
  const truckService = z.object({
    mode: z.literal('truck'),
    truckType: z.enum(TRUCK_TYPES),
    liftgate: z.boolean(),
  })
  const airService = z.object({
    mode: z.literal('air'),
    airline: z.string().min(2),
    awbPrefix: z.string(),
  })
  const oceanService = z.object({
    mode: z.literal('ocean'),
    vessel: z.string().min(2),
    containerSize: z.enum(CONTAINER_SIZES),
  })
  const serviceSchema = z.discriminatedUnion('mode', [truckService, airService, oceanService])

  const shipmentSchema = z.object({
    reference: z.string(),
    pickup: addressSchema,
    delivery: addressSchema,
    useSameDeliveryAddress: z.boolean(),
    cargo: cargoSchema,
    service: serviceSchema,
    desiredPickupDate: z.string().min(1),
    desiredDeliveryDate: z.string().min(1),
    insurance: z.object({
      declaredValueUSD: z.number().min(0),
      coverage: z.enum(COVERAGES),
    }),
    notes: z.string().max(500).optional(),
  })

  type Form = ReturnType<typeof useForm<typeof shipmentSchema>>
  const formT = makeFormProxy<Form>()

  it('top-level scalars resolve without TS2589', () => {
    expectTypeOf(formT.values.reference).toEqualTypeOf<string>()
    expectTypeOf(formT.values.useSameDeliveryAddress).toEqualTypeOf<boolean>()
  })

  it('nested address objects descend through the read-shape', () => {
    expectTypeOf(formT.values.pickup.city).toEqualTypeOf<string>()
    expectTypeOf(formT.values.pickup.line2).toEqualTypeOf<string | undefined>()
    expectTypeOf(formT.values.delivery.region).toEqualTypeOf<string>()
  })

  it('array-of-objects elements read as the inner read-shape', () => {
    expectTypeOf(formT.values.cargo.items[0]?.sku).toEqualTypeOf<string | undefined>()
  })

  it('discriminated unions read as the union of variant read-shapes', () => {
    // The discriminant variants resolve to a literal-string union on the
    // read side, then `WriteShape` widens primitive literals to their
    // primitive supertype at the `form.values` surface — the slim
    // write-time contract documented in `WriteShape`. The runtime still
    // reports the literal at parse time (handleSubmit / process), so
    // narrowing happens at the validation boundary, not on direct reads.
    expectTypeOf(formT.values.cargo.details.type).toEqualTypeOf<string>()
    expectTypeOf(formT.values.service.mode).toEqualTypeOf<string>()
  })

  it('optional leaves stay `T | undefined`', () => {
    expectTypeOf(formT.values.notes).toEqualTypeOf<string | undefined>()
  })

  it('the full schema mounts and round-trips', () => {
    const { api, unmount } = mountForm(() =>
      useForm({
        schema: shipmentSchema,
        key: uniqueKey('shipment-depth'),
        defaultValues: {
          reference: 'SHP-100001',
          cargo: { items: [], details: { type: 'dry', fragile: false } },
          service: { mode: 'truck', truckType: 'box', liftgate: false },
          insurance: { declaredValueUSD: 0, coverage: 'basic' },
          pickup: { country: 'US' },
          delivery: { country: 'US' },
          useSameDeliveryAddress: false,
        },
      })
    )
    try {
      expect(api.values.reference).toBe('SHP-100001')
      expect(api.values.cargo.details.type).toBe('dry')
      expect(api.values.service.mode).toBe('truck')
      expect(api.values.pickup.country).toBe('US')
      expect(api.values.useSameDeliveryAddress).toBe(false)
    } finally {
      unmount()
    }
  })

  // The `fields` property is the second deep mapped type on the
  // `UseFormReturnType` (`FieldStateMap<WriteShape<ReadForm>>`) — same
  // recursion-depth shape as ReadShape. These probes pin both the
  // callable surface and the proxy-descent surface against the
  // shipment-demo schema so a future regression to the single-pass
  // FieldStateMapEntry shape trips here at compile time before it
  // reaches the IDE hover.
  it('fields proxy descent resolves leaf FieldStates', () => {
    expectTypeOf(formT.fields.reference.value).toEqualTypeOf<string>()
    expectTypeOf(formT.fields.useSameDeliveryAddress.value).toEqualTypeOf<boolean>()
    expectTypeOf(formT.fields.pickup.city.value).toEqualTypeOf<string>()
    expectTypeOf(formT.fields.pickup.line2.value).toEqualTypeOf<string | undefined>()
    expectTypeOf(formT.fields.notes.value).toEqualTypeOf<string | undefined>()
  })

  it('fields callable form returns FieldState at a known path', () => {
    expectTypeOf(formT.fields(['pickup', 'city']).value).toEqualTypeOf<string>()
    expectTypeOf(formT.fields(['cargo', 'items', 0, 'sku']).value).toEqualTypeOf<string>()
  })

  it('fields runtime descent stays consistent with the static type', () => {
    const { api, unmount } = mountForm(() =>
      useForm({
        schema: shipmentSchema,
        key: uniqueKey('shipment-fields'),
        defaultValues: {
          reference: 'SHP-100002',
          cargo: { items: [], details: { type: 'dry', fragile: false } },
          service: { mode: 'truck', truckType: 'box', liftgate: false },
          insurance: { declaredValueUSD: 0, coverage: 'basic' },
          pickup: { country: 'US' },
          delivery: { country: 'US' },
          useSameDeliveryAddress: false,
        },
      })
    )
    try {
      expect(api.fields.reference.value).toBe('SHP-100002')
      expect(api.fields.pickup.city.value).toBe('')
      expect(api.fields(['pickup', 'city']).value).toBe('')
      expect(api.fields(['service', 'mode']).value).toBe('truck')
    } finally {
      unmount()
    }
  })

  // Errors proxy uses the same recursion-depth shape as fields
  // (`ErrorsProxyShape<WriteShape<ReadForm>>`). Pinning the descent
  // surfaces forces the two-pass split to keep working.
  it('errors proxy descent reaches every container path', () => {
    expectTypeOf(formT.errors.reference).toEqualTypeOf<readonly ValidationError[] | undefined>()
    expectTypeOf(formT.errors.pickup.city).toEqualTypeOf<readonly ValidationError[] | undefined>()
    expectTypeOf(formT.errors.cargo.items).toBeObject()
    expectTypeOf(formT.errors.notes).toEqualTypeOf<readonly ValidationError[] | undefined>()
  })

  it('errors callable form returns a ValidationError list at a known path', () => {
    expectTypeOf(formT.errors(['pickup', 'city'])).toEqualTypeOf<
      readonly ValidationError[] | undefined
    >()
    expectTypeOf(formT.errors('reference')).toEqualTypeOf<readonly ValidationError[] | undefined>()
  })

  // `setValue` types its `value` argument as `PathSetValuePayload<...>`,
  // which composes `DefaultValuesShape` + `NonNullable<WriteShape<...>>`
  // — both deep recursive types that we just split. The probe pins the
  // call shape so a regression collapses the payload type at TS-check
  // time rather than at IDE-hover time.
  it('setValue accepts the resolved payload type at a known path', () => {
    const setRef: (v: string) => boolean = (v) => formT.setValue('reference', v)
    const setCity: (v: string) => boolean = (v) => formT.setValue('pickup.city', v)
    const setNotes: (v: string | undefined) => boolean = (v) => formT.setValue('notes', v)
    expectTypeOf(setRef).toBeFunction()
    expectTypeOf(setCity).toBeFunction()
    expectTypeOf(setNotes).toBeFunction()
  })

  // `validate` / `validateAsync` resolve to a `ValidationResponse<Form>`
  // — the success branch carries the full Form shape (via the read-side
  // `data`). Pinning the return-type wrapper here forces the chain to
  // stay within tsserver's hover budget on deep schemas.
  it('validate / validateAsync resolve without TS2589', () => {
    expectTypeOf(formT.validate).toBeFunction()
    expectTypeOf(formT.validateAsync).toBeFunction()
    expectTypeOf(formT.validate()).toBeObject()
  })

  // FieldState aggregation flags (touched, dirty, valid, blurred,
  // focused, blank) read uniformly off every node in the descent.
  // Pinning a sampling here keeps the aggregation surface honest
  // alongside the leaf-value pin above.
  it('FieldState aggregation flags expose the typed surface at every depth', () => {
    // `touched` carries `null` for never-focused fields; `dirty` /
    // `valid` / `blank` are strict booleans. Aggregations at container
    // paths are reachable through the callable form (the proxy at a
    // container path returns a sub-proxy, not a FieldState).
    expectTypeOf(formT.fields.reference.touched).toEqualTypeOf<boolean | null>()
    expectTypeOf(formT.fields.reference.dirty).toEqualTypeOf<boolean>()
    expectTypeOf(formT.fields.reference.valid).toEqualTypeOf<boolean>()
    expectTypeOf(formT.fields.reference.blank).toEqualTypeOf<boolean>()
    expectTypeOf(formT.fields.pickup.city.touched).toEqualTypeOf<boolean | null>()
    // Root no-arg call returns the root FieldState (aggregated across
    // every active-variant leaf).
    expectTypeOf(formT.fields().dirty).toEqualTypeOf<boolean>()
  })

  // The `values` callable surface mirrors the same shape. The proxy
  // descent goes through `LiftedValueShape<WriteShape<ReadForm>>`, the
  // other deep mapped type we split.
  it('values callable form returns the form shape at a known path', () => {
    expectTypeOf(formT.values('reference')).toBeUnknown()
    expectTypeOf(formT.values(['pickup', 'city'])).toBeUnknown()
    expectTypeOf(formT.values()).toBeObject()
  })
})
