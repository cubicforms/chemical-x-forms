// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { createApp, defineComponent, h, type App } from 'vue'
import { z as zV4 } from 'zod'
import { z as zV3 } from 'zod-v3'
import { useForm as useFormV4 } from '../../src/zod'
import { useForm as useFormV3 } from '../../src/zod-v3'
import { fieldMeta as fieldMetaV4, withMeta as withMetaV4 } from '../../src/zod'
import { fieldMeta as fieldMetaV3, withMeta as withMetaV3 } from '../../src/zod-v3'
import { createAttaform } from '../../src/runtime/core/plugin'

/**
 * FieldState extension — `label`, `description`, `placeholder`,
 * `meta` resolve through the adapter's `getFieldMetaAtPath` with the
 * documented precedence:
 *
 *   - label:       registry → humanize(lastSegment)
 *   - description: registry → schema.description (.describe()) → undefined
 *   - placeholder: registry → undefined
 *   - meta:        registry payload (frozen) — empty object when absent
 *
 * Both adapters (Zod 4 native registry, Zod 3 WeakMap shim) flow
 * through the same `FieldState` shape so consumer code reads
 * identically across the version split.
 */

const apps: App[] = []
afterEach(() => {
  while (apps.length > 0) apps.pop()?.unmount()
  document.body.innerHTML = ''
})

function mountWithApp<T>(setup: () => T): T {
  let captured: T | undefined
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
  apps.push(app)
  if (captured === undefined) throw new Error('mountWithApp: setup never returned')
  return captured
}

describe('FieldState metadata — Zod 4 adapter', () => {
  it('reads registered label, description, placeholder via fields proxy', () => {
    const schema = zV4.object({
      reference: withMetaV4(zV4.string().min(1), {
        label: 'Reference',
        description: 'PO or order number',
        placeholder: 'PO-12345',
      }),
    })
    const form = mountWithApp(() =>
      useFormV4({ schema, key: `meta-v4-${Math.random()}`, defaultValues: { reference: '' } })
    )
    const ref = form.fields.reference
    expect(ref.label).toBe('Reference')
    expect(ref.description).toBe('PO or order number')
    expect(ref.placeholder).toBe('PO-12345')
    expect(ref.meta).toEqual({
      label: 'Reference',
      description: 'PO or order number',
      placeholder: 'PO-12345',
    })
  })

  it('falls back to humanize(lastSegment) when no label is registered', () => {
    const schema = zV4.object({ shipmentDate: zV4.string() })
    const form = mountWithApp(() =>
      useFormV4({ schema, key: `meta-v4-${Math.random()}`, defaultValues: { shipmentDate: '' } })
    )
    expect(form.fields.shipmentDate.label).toBe('Shipment Date')
    expect(form.fields.shipmentDate.description).toBeUndefined()
    expect(form.fields.shipmentDate.placeholder).toBeUndefined()
  })

  it('falls back to schema.description (from .describe()) when only that is set', () => {
    const schema = zV4.object({
      bio: zV4.string().describe('Tell us about yourself'),
    })
    const form = mountWithApp(() =>
      useFormV4({ schema, key: `meta-v4-${Math.random()}`, defaultValues: { bio: '' } })
    )
    expect(form.fields.bio.description).toBe('Tell us about yourself')
    // Label still humanizes — description doesn't backfill it.
    expect(form.fields.bio.label).toBe('Bio')
  })

  it('registry description wins over schema.describe() when both set', () => {
    const schema = zV4.object({
      summary: withMetaV4(zV4.string().describe('legacy desc'), {
        description: 'fresh desc',
      }),
    })
    const form = mountWithApp(() =>
      useFormV4({ schema, key: `meta-v4-${Math.random()}`, defaultValues: { summary: '' } })
    )
    expect(form.fields.summary.description).toBe('fresh desc')
  })

  it('reads registered metadata via the native .register() chain', () => {
    const schema = zV4.object({
      email: zV4.string().email().register(fieldMetaV4, { label: 'Email address' }),
    })
    const form = mountWithApp(() =>
      useFormV4({ schema, key: `meta-v4-${Math.random()}`, defaultValues: { email: '' } })
    )
    expect(form.fields.email.label).toBe('Email address')
  })

  it('returns a frozen empty meta when nothing was registered', () => {
    const schema = zV4.object({ tag: zV4.string() })
    const form = mountWithApp(() =>
      useFormV4({ schema, key: `meta-v4-${Math.random()}`, defaultValues: { tag: '' } })
    )
    const meta = form.fields.tag.meta
    expect(meta).toEqual({})
    expect(Object.isFrozen(meta)).toBe(true)
  })

  it('disambiguates a shared schema registered via .register() at multiple paths', () => {
    // The canonical footgun: one address schema bound to both pickup
    // and delivery via the native .register(fieldMeta, ...) chain. The
    // chain returns the original schema (not a clone), so the registry
    // sees two writes against the same reference. The path-resolver
    // walks the schema tree counting per-schema occurrences and pairs
    // them with the registration list in declaration order — object
    // literals evaluate left-to-right, so registration order matches
    // walk order, and each path lands on its intended payload.
    const addressSchema = zV4.object({ city: zV4.string() })
    const schema = zV4.object({
      pickup: addressSchema.register(fieldMetaV4, { label: 'Pickup address' }),
      delivery: addressSchema.register(fieldMetaV4, { label: 'Delivery address' }),
    })
    const form = mountWithApp(() =>
      useFormV4({
        schema,
        key: `meta-v4-shared-${Math.random()}`,
        defaultValues: { pickup: { city: '' }, delivery: { city: '' } },
      })
    )
    expect(form.fields('pickup').label).toBe('Pickup address')
    expect(form.fields('delivery').label).toBe('Delivery address')
  })

  it('optional schema fields surface as a non-undefined FieldState wrapper', () => {
    // FieldStateMap's mapped type strips the optional flag (-?:) so
    // optional schema fields always have a FieldState record at form
    // construction. The optionality of the underlying VALUE survives
    // (FieldState<string | undefined>) — only the wrapper is locked
    // non-undefined. Without this, every reactive read on an
    // optional path would need an optional-chain in consumer code.
    const schema = zV4.object({
      required: zV4.string(),
      maybe: zV4.string().optional(),
    })
    const form = mountWithApp(() =>
      useFormV4({
        schema,
        key: `meta-v4-optional-${Math.random()}`,
        defaultValues: { required: '' },
      })
    )
    // Wrapper is present — direct dot-access works without ?.
    expect(form.fields.maybe).toBeDefined()
    expect(form.fields.maybe.label).toBe('Maybe')
    // Value carries the optional via the inner type.
    expect(form.fields.maybe.value).toBeUndefined()
  })

  it('shares a single registration across every array-element index', () => {
    // The path-walker visits an array's element schema once (with a
    // synthetic [0] index) so a single registration on lineItemSchema
    // populates the path-meta map at index 0 only. Runtime accesses
    // via [1], [2], … rely on the resolver's fallback: when the path
    // map misses, getFieldMeta(schema) on the schema reference still
    // returns the registered payload. Together that means every
    // array index reads the same metadata from one .register() call —
    // the canonical "every line item shares the schema" pattern.
    const lineItemSchema = zV4
      .object({
        sku: zV4.string().register(fieldMetaV4, { label: 'SKU' }),
      })
      .register(fieldMetaV4, { label: 'Line item' })
    const schema = zV4.object({
      items: zV4.array(lineItemSchema),
    })
    const form = mountWithApp(() =>
      useFormV4({
        schema,
        key: `meta-v4-array-${Math.random()}`,
        defaultValues: { items: [{ sku: 'A' }, { sku: 'B' }, { sku: 'C' }] },
      })
    )
    // Every index reads the same per-leaf label. Using ?. on the
    // array-index access since noUncheckedIndexedAccess (set in the
    // repo tsconfig) widens [N] reads to T | undefined for safety
    // even when v-for guarantees presence at runtime.
    expect(form.fields.items[0]?.sku.label).toBe('SKU')
    expect(form.fields.items[1]?.sku.label).toBe('SKU')
    expect(form.fields.items[2]?.sku.label).toBe('SKU')
    // Dotted-string call-form picks up the array-element container
    // label (the FieldState terminal) at any depth.
    expect(form.fields('items.0').label).toBe('Line item')
    expect(form.fields('items.2').label).toBe('Line item')
  })

  it('walks through z.lazy() to register metadata on the dereferenced inner', () => {
    // The walker's lazy case unwraps the deferred schema and recurses
    // through its body. Useful for schemas that reference shared
    // sub-shapes via lazy without forming a true self-reference (the
    // adapter rejects recursive lazy upstream). Without the lazy case
    // metadata on the inner would be unreachable.
    const inner = zV4.object({
      handle: zV4.string().register(fieldMetaV4, { label: 'Handle' }),
    })
    const schema = zV4.object({
      profile: zV4.lazy(() => inner),
    })
    const form = mountWithApp(() =>
      useFormV4({
        schema,
        key: `meta-v4-lazy-${Math.random()}`,
        defaultValues: { profile: { handle: '' } },
      })
    )
    expect(form.fields.profile.handle.label).toBe('Handle')
  })

  it('accumulates payload across mixed withMeta + .register() chains', () => {
    // withMeta clones and registers on the clone; chaining .register
    // onto that clone appends to its registration list. Both writes
    // target the SAME clone instance, so the walker visits one path
    // exactly once and would normally pick only list[0]. The
    // resolver's fallback to fieldMeta.get(schema) returns Zod's
    // native single-slot value (last-write-wins) — so chained
    // registrations on a single path resolve via the OR-fallback in
    // resolveFieldMetaAtPath: pathMap.get(...) ?? getFieldMeta(...).
    // Net effect: label survives via the path map, description
    // survives via the native single-slot read.
    const schema = zV4.object({
      reference: withMetaV4(zV4.string(), { label: 'Reference' }).register(fieldMetaV4, {
        description: 'PO or order number',
      }),
    })
    const form = mountWithApp(() =>
      useFormV4({
        schema,
        key: `meta-v4-mixed-${Math.random()}`,
        defaultValues: { reference: '' },
      })
    )
    expect(form.fields.reference.label).toBe('Reference')
    expect(form.fields.reference.description).toBe('PO or order number')
  })

  it('walks both sides of an intersection schema', () => {
    // Intersection (z.intersection / a.and(b)) folds two schemas
    // together; the walker descends into both at the same path so
    // metadata registered on either side surfaces. Verifies the
    // case branch in walkForMeta — without it, intersection
    // metadata would be silently dropped.
    const left = zV4.object({
      sku: zV4.string().register(fieldMetaV4, { label: 'SKU' }),
    })
    const right = zV4.object({
      qty: zV4.number().register(fieldMetaV4, { label: 'Quantity' }),
    })
    const schema = zV4.object({
      item: zV4.intersection(left, right),
    })
    const form = mountWithApp(() =>
      useFormV4({
        schema,
        key: `meta-v4-intersection-${Math.random()}`,
        defaultValues: { item: { sku: '', qty: 0 } },
      })
    )
    expect(form.fields.item.sku.label).toBe('SKU')
    expect(form.fields.item.qty.label).toBe('Quantity')
  })

  it('reads variant-specific metadata across discriminated-union branches', () => {
    // The walker descends into every variant of a discriminated
    // union at the same path, so leaf metadata on variant-only
    // fields (e.g. `fragile` in the dry variant, `unNumber` in the
    // hazmat variant) all register correctly. The runtime exposes
    // every variant's keys via FieldStateMapEntry's KeyofUnion
    // merge, so the consumer reads each variant's label regardless
    // of which variant is currently active.
    const dry = zV4.object({
      type: zV4.literal('dry'),
      fragile: zV4.boolean().register(fieldMetaV4, { label: 'Fragile' }),
    })
    const hazmat = zV4.object({
      type: zV4.literal('hazmat'),
      unNumber: zV4.string().register(fieldMetaV4, { label: 'UN number' }),
    })
    const schema = zV4.object({
      cargo: zV4.discriminatedUnion('type', [dry, hazmat]).register(fieldMetaV4, {
        label: 'Cargo',
      }),
    })
    const form = mountWithApp(() =>
      useFormV4({
        schema,
        key: `meta-v4-du-${Math.random()}`,
        defaultValues: { cargo: { type: 'dry', fragile: false } },
      })
    )
    // Container label resolves at the DU root.
    expect(form.fields('cargo').label).toBe('Cargo')
    // Active-variant key reads its registered label.
    expect(form.fields.cargo.fragile.label).toBe('Fragile')
    // Inactive-variant key still reads its registered label —
    // FieldStateMapEntry's union-key merge exposes every variant's
    // shape, and the walker registered metadata for both branches.
    expect(form.fields.cargo.unNumber.label).toBe('UN number')
  })
})

describe('FieldState metadata — Zod 3 adapter', () => {
  it('reads registered label, description, placeholder via fields proxy', () => {
    const schema = zV3.object({
      reference: withMetaV3(zV3.string().min(1), {
        label: 'Reference',
        description: 'PO or order number',
        placeholder: 'PO-12345',
      }),
    })
    const form = mountWithApp(() =>
      useFormV3({ schema, key: `meta-v3-${Math.random()}`, defaultValues: { reference: '' } })
    )
    const ref = form.fields.reference
    expect(ref.label).toBe('Reference')
    expect(ref.description).toBe('PO or order number')
    expect(ref.placeholder).toBe('PO-12345')
  })

  it('falls back to humanize(lastSegment) when no label is registered', () => {
    const schema = zV3.object({ shipmentDate: zV3.string() })
    const form = mountWithApp(() =>
      useFormV3({ schema, key: `meta-v3-${Math.random()}`, defaultValues: { shipmentDate: '' } })
    )
    expect(form.fields.shipmentDate.label).toBe('Shipment Date')
  })

  it('falls back to schema.description (from .describe()) when only that is set', () => {
    const schema = zV3.object({
      bio: zV3.string().describe('Tell us about yourself'),
    })
    const form = mountWithApp(() =>
      useFormV3({ schema, key: `meta-v3-${Math.random()}`, defaultValues: { bio: '' } })
    )
    expect(form.fields.bio.description).toBe('Tell us about yourself')
    expect(form.fields.bio.label).toBe('Bio')
  })

  it('registry description wins over schema.describe() when both set', () => {
    const schema = zV3.object({
      summary: withMetaV3(zV3.string().describe('legacy desc'), {
        description: 'fresh desc',
      }),
    })
    const form = mountWithApp(() =>
      useFormV3({ schema, key: `meta-v3-${Math.random()}`, defaultValues: { summary: '' } })
    )
    expect(form.fields.summary.description).toBe('fresh desc')
  })

  it('reads registered metadata via fieldMeta.add() (registry-shaped surface)', () => {
    const emailSchema = zV3.string().email()
    fieldMetaV3.add(emailSchema, { label: 'Email address' })
    const schema = zV3.object({ email: emailSchema })
    const form = mountWithApp(() =>
      useFormV3({ schema, key: `meta-v3-${Math.random()}`, defaultValues: { email: '' } })
    )
    expect(form.fields.email.label).toBe('Email address')
  })

  it('returns a frozen empty meta when nothing was registered', () => {
    const schema = zV3.object({ tag: zV3.string() })
    const form = mountWithApp(() =>
      useFormV3({ schema, key: `meta-v3-${Math.random()}`, defaultValues: { tag: '' } })
    )
    const meta = form.fields.tag.meta
    expect(meta).toEqual({})
    expect(Object.isFrozen(meta)).toBe(true)
  })
})

describe('FieldState metadata — wrapper registrations resolve symmetrically', () => {
  // The path walker returns the wrapper at terminal positions and
  // peels at intermediate descent. The adapter's two-stage lookup
  // (target schema first, peeled inner as fallback) means BOTH
  // registration styles surface the same payload. These tests pin
  // the equivalence so a future walker / resolver change that breaks
  // one ordering trips the suite.
  it('Zod 4: register-before-wrapping reads back through the form', () => {
    const inner = zV4.string()
    withMetaV4(inner, { label: 'Reference' })
    const schema = zV4.object({ reference: inner.optional() })
    const form = mountWithApp(() =>
      useFormV4({
        schema,
        key: `meta-v4-wrap-${Math.random()}`,
        defaultValues: { reference: '' },
      })
    )
    // `reference` typed as optional in the parent shape narrows
    // dot-access to `FieldState<…> | undefined`. The runtime
    // always returns a leaf-view proxy at this path; assert
    // through the call-form to keep the test-side type-clean.
    const ref = (form.fields as unknown as (p: string) => { label: string })('reference')
    expect(ref.label).toBe('Reference')
  })

  it('Zod 4: register-after-wrapping reads back through the form', () => {
    const wrapped = zV4.string().optional()
    withMetaV4(wrapped, { label: 'Reference' })
    const schema = zV4.object({ reference: wrapped })
    const form = mountWithApp(() =>
      useFormV4({
        schema,
        key: `meta-v4-wrap-${Math.random()}`,
        defaultValues: { reference: '' },
      })
    )
    const ref = (form.fields as unknown as (p: string) => { label: string })('reference')
    expect(ref.label).toBe('Reference')
  })

  it('Zod 3: register-before-wrapping reads back through the form', () => {
    const inner = zV3.string()
    withMetaV3(inner, { label: 'Reference' })
    const schema = zV3.object({ reference: inner.optional() })
    const form = mountWithApp(() =>
      useFormV3({
        schema,
        key: `meta-v3-wrap-${Math.random()}`,
        defaultValues: { reference: '' },
      })
    )
    // Cast through the call-form's `unknown` return — the runtime
    // always returns a leaf-view proxy at this path; the cast is
    // the test-side acknowledgement of that runtime guarantee.
    const ref = (form.fields as unknown as (p: string) => { label: string })('reference')
    expect(ref.label).toBe('Reference')
  })

  it('Zod 3: register-after-wrapping reads back through the form', () => {
    const wrapped = zV3.string().optional()
    withMetaV3(wrapped, { label: 'Reference' })
    const schema = zV3.object({ reference: wrapped })
    const form = mountWithApp(() =>
      useFormV3({
        schema,
        key: `meta-v3-wrap-${Math.random()}`,
        defaultValues: { reference: '' },
      })
    )
    const ref = (form.fields as unknown as (p: string) => { label: string })('reference')
    expect(ref.label).toBe('Reference')
  })
})
