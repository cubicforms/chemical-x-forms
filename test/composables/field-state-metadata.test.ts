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
  const app = createApp(App).use(createAttaform({ override: true }))
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
