// @vitest-environment jsdom
import { createApp, defineComponent, h } from 'vue'
import { describe, expect, expectTypeOf, it } from 'vitest'
import { z } from 'zod-v3'
import { useForm } from '../../src/zod-v3'
import { useForm as useFormUnified } from '../../src/zod'
import { createAttaform } from '../../src/runtime/core/plugin'

/**
 * Storage-shape invariant probes — Zod v3 mirror of
 * `values-storage-shape.test.ts`. Same invariant ("`form.values.<path>`
 * always returns the resolved concrete type storage holds"), pinned
 * against the v3 adapter via `ReadShape<Schema>` from
 * `src/runtime/adapters/zod-v3/types-read-shape.ts`.
 *
 * v3 ReadShape peels wrappers (`ZodDefault` / `ZodOptional` /
 * `ZodNullable` / `ZodEffects` / `ZodReadonly` / `ZodCatch`) at the
 * top level of an object's shape and descends one further level into
 * nested `ZodObject` / `ZodArray`. Deeper-nested wrapper peeling
 * intentionally stays at `z.input<Inner>` to keep TS instantiation
 * depth bounded — see the doc on `ReadShape` for the rationale.
 *
 * v3's `useForm` has multiple overloads, so the proxy-based
 * `UseFormReturn<...>` pattern used by the v4 matrix
 * doesn't resolve consistently. We mount each scenario and run both
 * type-level (`expectTypeOf(api.values.X)`) and runtime
 * (`expect(api.values.X)`) assertions against the live API instance.
 */

function mountWith<R>(setup: () => R): { api: R; unmount: () => void } {
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
  if (captured === undefined) throw new Error('mountWith: setup never returned')
  return {
    api: captured,
    unmount: () => {
      app.unmount()
      document.body.removeChild(root)
    },
  }
}

function uniqueKey(prefix: string): string {
  return `v3-${prefix}-${Math.random().toString(36).slice(2)}`
}

// ──────────────────────────────────────────────────────────────────────
// ZodDefault — type peels `| undefined`; runtime resolves the default.
// ──────────────────────────────────────────────────────────────────────

const defaultsSchema = z.object({
  flag: z.boolean().default(true),
  count: z.number().default(0),
  name: z.string().default('attaform'),
  tags: z.array(z.string()).default([]),
})

describe('v3 — ZodDefault peels `| undefined`, runtime resolves the default', () => {
  it('z.boolean().default(true) → boolean / runtime true', () => {
    const { api, unmount } = mountWith(() =>
      useForm({ schema: defaultsSchema, key: uniqueKey('zd-bool') })
    )
    try {
      expectTypeOf(api.values.flag).toEqualTypeOf<boolean>()
      expect(api.values.flag).toBe(true)
    } finally {
      unmount()
    }
  })

  it('z.number().default(0) → number / runtime 0', () => {
    const { api, unmount } = mountWith(() =>
      useForm({ schema: defaultsSchema, key: uniqueKey('zd-num') })
    )
    try {
      expectTypeOf(api.values.count).toEqualTypeOf<number>()
      expect(api.values.count).toBe(0)
    } finally {
      unmount()
    }
  })

  it('z.string().default("attaform") → string / runtime "attaform"', () => {
    const { api, unmount } = mountWith(() =>
      useForm({ schema: defaultsSchema, key: uniqueKey('zd-str') })
    )
    try {
      expectTypeOf(api.values.name).toEqualTypeOf<string>()
      expect(api.values.name).toBe('attaform')
    } finally {
      unmount()
    }
  })

  it('z.array(z.string()).default([]) → string[] / runtime []', () => {
    const { api, unmount } = mountWith(() =>
      useForm({ schema: defaultsSchema, key: uniqueKey('zd-arr') })
    )
    try {
      expectTypeOf(api.values.tags).toEqualTypeOf<string[]>()
      expect(api.values.tags).toEqual([])
    } finally {
      unmount()
    }
  })

  it('reset restores defaults', () => {
    const { api, unmount } = mountWith(() =>
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
// Bare-required fields — synthesis resolves to falsy concrete.
// ──────────────────────────────────────────────────────────────────────

const bareRequiredSchema = z.object({
  s: z.string(),
  n: z.number(),
  b: z.boolean(),
  arr: z.array(z.string()),
})

describe('v3 — Bare-required fields resolve to a falsy concrete value', () => {
  it('plain primitives — type + runtime', () => {
    const { api, unmount } = mountWith(() =>
      useForm({ schema: bareRequiredSchema, key: uniqueKey('bare') })
    )
    try {
      expectTypeOf(api.values.s).toEqualTypeOf<string>()
      expectTypeOf(api.values.n).toEqualTypeOf<number>()
      expectTypeOf(api.values.b).toEqualTypeOf<boolean>()
      expectTypeOf(api.values.arr).toEqualTypeOf<string[]>()
      expect(api.values.s).toBe('')
      expect(api.values.n).toBe(0)
      expect(api.values.b).toBe(false)
      expect(api.values.arr).toEqual([])
    } finally {
      unmount()
    }
  })
})

// ──────────────────────────────────────────────────────────────────────
// Nested object descent — one level deep is peeled at the type level.
// ──────────────────────────────────────────────────────────────────────

const nestedSchema = z.object({
  user: z.object({
    name: z.string(),
    age: z.number().default(0),
  }),
})

describe('v3 — Nested object descent (one level)', () => {
  it('nested leaves keep their peeled types and resolve at runtime', () => {
    const { api, unmount } = mountWith(() =>
      useForm({ schema: nestedSchema, key: uniqueKey('nested') })
    )
    try {
      expectTypeOf(api.values.user.name).toEqualTypeOf<string>()
      expectTypeOf(api.values.user.age).toEqualTypeOf<number>()
      expect(api.values.user.name).toBe('')
      expect(api.values.user.age).toBe(0)
    } finally {
      unmount()
    }
  })
})

// ──────────────────────────────────────────────────────────────────────
// Genuinely uncertain — invariant does NOT promise to peel.
// ──────────────────────────────────────────────────────────────────────

describe('v3 — Genuinely uncertain edges', () => {
  it('z.string().optional() keeps `| undefined`', () => {
    const schema = z.object({ bio: z.string().optional() })
    const { api, unmount } = mountWith(() => useForm({ schema, key: uniqueKey('opt') }))
    try {
      expectTypeOf(api.values.bio).toEqualTypeOf<string | undefined>()
    } finally {
      unmount()
    }
  })

  it('z.string().nullable() keeps `| null`', () => {
    const schema = z.object({ ref: z.string().nullable() })
    const { api, unmount } = mountWith(() => useForm({ schema, key: uniqueKey('nul') }))
    try {
      expectTypeOf(api.values.ref).toEqualTypeOf<string | null>()
    } finally {
      unmount()
    }
  })
})

// ──────────────────────────────────────────────────────────────────────
// Unified entry (`attaform/zod`) + v3 schema. The unified entry's
// `StorageShape` previously resolved against v4's `_zod.def.*`
// discriminant only — v3 schemas missed every branch and collapsed
// `form.values` to `never`. These probes pin that regression: v3
// schemas reaching the unified entry must resolve through v3's own
// storage-shape via the discriminating dispatch in
// `src/runtime/adapters/unified/types-storage-shape.ts`.
// ──────────────────────────────────────────────────────────────────────

describe('Unified entry — v3 schema inference (Friction 1 regression)', () => {
  it('boolean.default + array — form.values resolves concretely, not never', () => {
    const schema = z.object({
      flag: z.boolean().default(true),
      items: z.array(z.string()),
    })
    const { api, unmount } = mountWith(() =>
      useFormUnified({ schema, key: uniqueKey('unified-v3-simple') })
    )
    try {
      expectTypeOf(api.values.flag).toEqualTypeOf<boolean>()
      expectTypeOf(api.values.items).toEqualTypeOf<string[]>()
      expect(api.values.flag).toBe(true)
      expect(api.values.items).toEqual([])
    } finally {
      unmount()
    }
  })

  it('nested object descent resolves under the v3 storage-shape', () => {
    const schema = z.object({
      user: z.object({
        name: z.string(),
        age: z.number().default(0),
      }),
    })
    const { api, unmount } = mountWith(() =>
      useFormUnified({ schema, key: uniqueKey('unified-v3-nested') })
    )
    try {
      expectTypeOf(api.values.user.name).toEqualTypeOf<string>()
      expectTypeOf(api.values.user.age).toEqualTypeOf<number>()
      expect(api.values.user.name).toBe('')
      expect(api.values.user.age).toBe(0)
    } finally {
      unmount()
    }
  })
})

// ──────────────────────────────────────────────────────────────────────
// Depth-pressure regression — multi-step booking schema (v3 mirror of
// the shipment-demo probe in `values-storage-shape.test.ts`). The v3
// `StorageShape` is a single mapped type with a per-key conditional
// (`ZodEffects | ZodPipeline` vs not). This probe holds the TS2589
// canary: if instantiation depth ever explodes through the unified
// entry's v3 branch, this is where it surfaces first.
// ──────────────────────────────────────────────────────────────────────

describe('Depth pressure — multi-step booking schema (unified entry + v3)', () => {
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

  it('top-level scalars resolve without TS2589', () => {
    const { api, unmount } = mountWith(() =>
      useFormUnified({
        schema: shipmentSchema,
        key: uniqueKey('unified-v3-shipment'),
        defaultValues: {
          reference: 'SHP-V3-0001',
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
      expectTypeOf(api.values.reference).toEqualTypeOf<string>()
      expectTypeOf(api.values.useSameDeliveryAddress).toEqualTypeOf<boolean>()
      expect(api.values.reference).toBe('SHP-V3-0001')
      expect(api.values.useSameDeliveryAddress).toBe(false)
    } finally {
      unmount()
    }
  })

  it('nested address objects descend through the v3 storage-shape', () => {
    const { api, unmount } = mountWith(() =>
      useFormUnified({
        schema: shipmentSchema,
        key: uniqueKey('unified-v3-shipment-nested'),
        defaultValues: {
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
      expectTypeOf(api.values.pickup.city).toEqualTypeOf<string>()
      expectTypeOf(api.values.delivery.region).toEqualTypeOf<string>()
      expectTypeOf(api.values.notes).toEqualTypeOf<string | undefined>()
    } finally {
      unmount()
    }
  })
})

// ──────────────────────────────────────────────────────────────────────
// `handleSubmit` callback data — must match `z.output<Schema>`, not
// `TypeWithNullableDynamicKeys<Schema>`. Previously the v3
// `useForm`'s second generic defaulted to the widening type,
// surfacing `(T | undefined)[]` for any array leaf post-parse — a
// type-lie at the most consumer-facing surface in the v3 path.
// ──────────────────────────────────────────────────────────────────────

describe('v3 — handleSubmit callback data matches z.output<Schema> (Friction 2 regression)', () => {
  it('z.array(z.string().transform(...)) — data is string[], not (string | undefined)[]', () => {
    const schema = z.object({
      urls: z
        .array(
          z.string().transform((val, ctx) => {
            if (!/^https?:\/\//.test(val)) {
              ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Invalid URL' })
              return z.NEVER
            }
            return val
          })
        )
        .min(1),
    })
    const { api: _api, unmount } = mountWith(() => useForm({ schema, key: uniqueKey('hs-urls') }))
    try {
      type CallbackData = Parameters<Parameters<typeof _api.handleSubmit>[0]>[0]
      expectTypeOf<CallbackData>().toEqualTypeOf<z.output<typeof schema>>()
    } finally {
      unmount()
    }
  })

  it('nested record / array combinations — data matches z.output, no `| undefined` widening', () => {
    const schema = z.object({
      tags: z.array(z.string()),
      meta: z.record(z.string(), z.number()),
    })
    const { api: _api, unmount } = mountWith(() => useForm({ schema, key: uniqueKey('hs-tags') }))
    try {
      type CallbackData = Parameters<Parameters<typeof _api.handleSubmit>[0]>[0]
      expectTypeOf<CallbackData>().toEqualTypeOf<z.output<typeof schema>>()
    } finally {
      unmount()
    }
  })
})
