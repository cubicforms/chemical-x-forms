// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { createApp, defineComponent, h, type App } from 'vue'
import { z } from 'zod'
import { useForm } from '../../src/zod'
import { createChemicalXForms } from '../../src/runtime/core/plugin'

/**
 * Coverage for the leaf-aware drillable callable Proxy machinery
 * shared by `form.values`, `form.errors`, and `form.fields`.
 *
 * The pivotal behaviour: `FIELD_STATE_KEYS` (`value`, `dirty`,
 * `errors`, `isConnected`, …) inject ONLY at leaf paths, not at
 * every depth. A schema field literally named `dirty` at depth 2+
 * stays reachable as a descent target.
 */

const apps: App[] = []
afterEach(() => {
  while (apps.length > 0) apps.pop()?.unmount()
  document.body.innerHTML = ''
})

function mount<Schema extends z.ZodObject>(
  schema: Schema,
  defaultValues: z.infer<Schema>
): ReturnType<typeof useForm<Schema>> {
  let captured: unknown
  const App = defineComponent({
    setup() {
      captured = (useForm as unknown as (config: unknown) => unknown)({
        schema,
        key: `surface-proxy-${Math.random().toString(36).slice(2)}`,
        defaultValues,
      })
      return () => h('div')
    },
  })
  const app = createApp(App).use(createChemicalXForms({ override: true }))
  const root = document.createElement('div')
  document.body.appendChild(root)
  app.mount(root)
  apps.push(app)
  if (captured === undefined) throw new Error('useForm did not return')
  return captured as ReturnType<typeof useForm<Schema>>
}

describe('form.fields — shadowing immunity (FIELD_STATE_KEYS only inject at leaves)', () => {
  it('schema field named "dirty" at depth 2 is reachable as a descent target', () => {
    const schema = z.object({
      address: z.object({
        dirty: z.boolean(),
        city: z.string(),
      }),
    })
    const form = mount(schema, { address: { dirty: false, city: 'NYC' } })

    // address is a container → descend without injection.
    // address.dirty is a leaf (boolean) → returns the leaf-view.
    // The leaf-view's own .dirty prop is the FieldStateView's dirty boolean.
    expect(form.fields.address.dirty.value).toBe(false)
    expect(form.fields.address.dirty.dirty).toBe(false) // the leaf's pristine state

    form.setValue('address.dirty', true)
    expect(form.fields.address.dirty.value).toBe(true)
    expect(form.fields.address.dirty.dirty).toBe(true) // now dirty per the FieldStateView
  })

  it('schema field named "isValid" at depth 2 is reachable; .isValid drilling works', () => {
    const schema = z.object({
      address: z.object({
        isValid: z.boolean(),
        city: z.string(),
      }),
    })
    const form = mount(schema, { address: { isValid: true, city: 'NYC' } })

    // address.isValid is a leaf (boolean) — exposed as a FieldStateLeaf.
    expect(form.fields.address.isValid.value).toBe(true)
    expect(form.fields.address.isValid.path).toEqual(['address', 'isValid'])
  })

  it('schema field named "errors" at depth 2 reads the schema field, not aggregate', () => {
    const schema = z.object({
      submission: z.object({
        errors: z.string(),
        body: z.string(),
      }),
    })
    const form = mount(schema, { submission: { errors: 'none', body: 'hi' } })

    // submission.errors is a leaf (string) → leaf-view.
    expect(form.fields.submission.errors.value).toBe('none')
    // The leaf-view's OWN .errors (the FieldStateView's errors array) is empty.
    expect(form.fields.submission.errors.errors).toEqual([])
  })
})

describe('form.fields — callable form', () => {
  const schema = z.object({
    email: z.string().email(),
    address: z.object({ city: z.string(), zip: z.string() }),
  })

  it('form.fields("path") matches form.fields.path for leaves', () => {
    const form = mount(schema, { email: 'a@b.com', address: { city: 'NYC', zip: '10001' } })
    const fromDot = form.fields.email
    const fromCall = (form.fields as unknown as (p: string) => unknown)('email')
    expect(fromDot).toBe(fromCall)
  })

  it('form.fields("a.b.c") walks chained paths', () => {
    const form = mount(schema, { email: 'a@b.com', address: { city: 'NYC', zip: '10001' } })
    const fromDot = form.fields.address.city
    const fromCall = (form.fields as unknown as (p: string) => unknown)('address.city')
    expect(fromDot).toBe(fromCall)
  })

  it('form.fields([...path]) accepts array paths', () => {
    const form = mount(schema, { email: 'a@b.com', address: { city: 'NYC', zip: '10001' } })
    const fromDot = form.fields.address.city
    const fromCall = (form.fields as unknown as (p: readonly string[]) => unknown)([
      'address',
      'city',
    ])
    expect(fromDot).toBe(fromCall)
  })

  it('form.fields() returns the root proxy', () => {
    const form = mount(schema, { email: 'a@b.com', address: { city: 'NYC', zip: '10001' } })
    const root = (form.fields as unknown as () => unknown)()
    // No-arg returns the SAME root proxy (referential equality preserved).
    expect(root).toBe(form.fields)
  })
})

describe('form.values — callable form', () => {
  const schema = z.object({
    email: z.string(),
    address: z.object({ city: z.string() }),
  })

  it('form.values() returns the whole-form value (object)', () => {
    const form = mount(schema, { email: 'a@b.com', address: { city: 'NYC' } })
    const root = (form.values as unknown as () => unknown)()
    expect(root).toEqual({ email: 'a@b.com', address: { city: 'NYC' } })
  })

  it('form.values("path") walks to the leaf', () => {
    const form = mount(schema, { email: 'a@b.com', address: { city: 'NYC' } })
    expect((form.values as unknown as (p: string) => unknown)('email')).toBe('a@b.com')
    expect((form.values as unknown as (p: string) => unknown)('address.city')).toBe('NYC')
  })

  it('form.values supports container access (drillable AND useful)', () => {
    const form = mount(schema, { email: 'a@b.com', address: { city: 'NYC' } })
    expect(form.values.address).toEqual({ city: 'NYC' })
    expect(form.values.address.city).toBe('NYC')
  })

  it('JSON.stringify(form.values) serialises the form data (toJSON path)', () => {
    const form = mount(schema, { email: 'a@b.com', address: { city: 'NYC' } })
    expect(JSON.parse(JSON.stringify(form.values))).toEqual({
      email: 'a@b.com',
      address: { city: 'NYC' },
    })
  })
})

describe('form.errors — callable form', () => {
  const schema = z.object({
    email: z.string(),
    address: z.object({ city: z.string() }),
  })

  it('form.errors("path") returns the leaf array', () => {
    const form = mount(schema, { email: 'a@b.com', address: { city: 'NYC' } })
    form.setFieldErrors([
      { path: ['email'], message: 'taken', formKey: form.key, code: 'api:validation' },
    ])
    expect((form.errors as unknown as (p: string) => unknown)('email')).toEqual([
      { path: ['email'], message: 'taken', formKey: form.key, code: 'api:validation' },
    ])
  })

  it('form.errors() with no arg returns the root proxy (drillable)', () => {
    const form = mount(schema, { email: 'a@b.com', address: { city: 'NYC' } })
    const root = (form.errors as unknown as () => unknown)()
    expect(root).toBe(form.errors)
  })

  it('form.errors at a container is descend-only (JSON.stringify → {})', () => {
    const form = mount(schema, { email: 'a@b.com', address: { city: 'NYC' } })
    form.setFieldErrors([
      { path: ['address', 'city'], message: 'bad', formKey: form.key, code: 'api:validation' },
    ])
    // Container — no leaf-key injection, no terminal.
    expect(JSON.parse(JSON.stringify(form.errors.address))).toEqual({})
    // Drilling reaches the leaf.
    expect(form.errors.address.city?.[0]?.message).toBe('bad')
  })
})

describe('form.meta.errors — flat aggregate', () => {
  const schema = z.object({
    email: z.string(),
    password: z.string(),
  })

  it('aggregates all per-path errors into a single ValidationError[]', () => {
    const form = mount(schema, { email: '', password: '' })
    form.setFieldErrors([
      { path: ['email'], message: 'bad email', formKey: form.key, code: 'api:validation' },
      { path: ['password'], message: 'bad pass', formKey: form.key, code: 'api:validation' },
    ])
    expect(form.meta.errors).toHaveLength(2)
    expect(form.meta.errors.map((e) => e.path[0])).toEqual(['email', 'password'])
  })

  it('reactivity: aggregate updates when underlying error stores change', async () => {
    const form = mount(schema, { email: '', password: '' })
    expect(form.meta.errors).toEqual([])

    form.setFieldErrors([
      { path: ['email'], message: 'bad email', formKey: form.key, code: 'api:validation' },
    ])
    expect(form.meta.errors).toHaveLength(1)

    form.clearFieldErrors('email')
    expect(form.meta.errors).toEqual([])
  })

  it('includes form-level errors (path: [])', () => {
    const form = mount(schema, { email: '', password: '' })
    form.setFieldErrors([
      { path: [], message: 'whole-form invalid', formKey: form.key, code: 'api:validation' },
    ])
    expect(form.meta.errors).toHaveLength(1)
    expect(form.meta.errors[0]?.path).toEqual([])
  })
})

describe('form.fields — JSON.stringify behaviour', () => {
  const schema = z.object({
    email: z.string().email(),
    address: z.object({ city: z.string() }),
  })

  it('JSON.stringify on a leaf returns the FieldStateView snapshot', () => {
    const form = mount(schema, { email: 'a@b.com', address: { city: 'NYC' } })
    const snapshot = JSON.parse(JSON.stringify(form.fields.email))
    expect(snapshot).toMatchObject({
      value: 'a@b.com',
      dirty: false,
      pristine: true,
      blank: false,
      errors: [],
    })
  })

  it('JSON.stringify on a container returns {} (no leaf-key injection)', () => {
    const form = mount(schema, { email: 'a@b.com', address: { city: 'NYC' } })
    expect(JSON.parse(JSON.stringify(form.fields.address))).toEqual({})
  })
})

describe('surface proxies — primitive coercion (Symbol.toPrimitive)', () => {
  // Regression: pre-fix, `String(form.errors)` and `{{ form.errors }}` in
  // a Vue template threw "Cannot convert object to primitive value." The
  // function-target Proxy is `typeof === 'function'`, so Vue's
  // `toDisplayString` falls to `String(val)`; OrdinaryToPrimitive then
  // looked up `toString` / `valueOf` through the schema-aware get trap,
  // which returned sub-proxies (still callable, still non-primitive),
  // and the coercion ran out of options. The fix intercepts
  // `Symbol.toPrimitive` and returns a sensible primitive.
  const schema = z.object({
    email: z.string(),
    address: z.object({ city: z.string() }),
  })

  it('String(form.errors) returns "{}" at the root (container)', () => {
    const form = mount(schema, { email: 'a@b.com', address: { city: 'NYC' } })
    expect(() => String(form.errors)).not.toThrow()
    expect(String(form.errors)).toBe('{}')
  })

  it('String(form.errors.address) returns "{}" at a nested container', () => {
    const form = mount(schema, { email: 'a@b.com', address: { city: 'NYC' } })
    expect(() => String(form.errors.address)).not.toThrow()
    expect(String(form.errors.address)).toBe('{}')
  })

  it('String(form.fields) returns "{}" at the root (container)', () => {
    const form = mount(schema, { email: 'a@b.com', address: { city: 'NYC' } })
    expect(() => String(form.fields)).not.toThrow()
    expect(String(form.fields)).toBe('{}')
  })

  it('String(form.fields.email) returns the FieldStateView snapshot JSON (leaf-view)', () => {
    const form = mount(schema, { email: 'a@b.com', address: { city: 'NYC' } })
    expect(() => String(form.fields.email)).not.toThrow()
    const str = String(form.fields.email)
    const parsed = JSON.parse(str)
    expect(parsed).toMatchObject({ value: 'a@b.com', dirty: false, errors: [] })
  })

  it('Number(form.errors) returns NaN (container)', () => {
    const form = mount(schema, { email: 'a@b.com', address: { city: 'NYC' } })
    expect(Number(form.errors)).toBeNaN()
  })

  it('template-style coercion (`${proxy}`) does not throw', () => {
    const form = mount(schema, { email: 'a@b.com', address: { city: 'NYC' } })
    expect(() => `${form.errors}`).not.toThrow()
    expect(() => `${form.fields}`).not.toThrow()
    expect(() => `${form.fields.email}`).not.toThrow()
  })

  it('default-hint coercion (string concat) produces the same primitive', () => {
    // `form.errors + 'x'` invokes ToPrimitive with the 'default' hint.
    // Without `Symbol.toPrimitive` covering the 'default' branch, the
    // OrdinaryToPrimitive('default') walk runs `valueOf` → `toString`,
    // and we'd be back to the schema-descent throw.
    const form = mount(schema, { email: 'a@b.com', address: { city: 'NYC' } })
    expect(`${form.errors}x`).toBe('{}x')
    expect(`${form.fields.email}`.startsWith('{')).toBe(true)
  })

  it('direct proxy.toString() returns a primitive (container)', () => {
    // Pre-fix this routed through schema descent and returned a callable
    // sub-proxy. Now it returns a primitive string consistent with the
    // `Symbol.toPrimitive` output.
    const form = mount(schema, { email: 'a@b.com', address: { city: 'NYC' } })
    const out = (form.errors as unknown as { toString(): string }).toString()
    expect(typeof out).toBe('string')
    expect(out).toBe('{}')
  })

  it('direct proxy.toString() returns the JSON snapshot (leaf-view)', () => {
    const form = mount(schema, { email: 'a@b.com', address: { city: 'NYC' } })
    const out = (form.fields.email as unknown as { toString(): string }).toString()
    expect(typeof out).toBe('string')
    expect(JSON.parse(out)).toMatchObject({ value: 'a@b.com', dirty: false })
  })

  it('direct proxy.valueOf() returns the proxy itself (object semantics)', () => {
    // Object.prototype.valueOf semantics: returns the receiver. Keeps
    // OrdinaryToPrimitive's `valueOf` → `toString` walk well-formed for
    // any code path that bypasses `Symbol.toPrimitive`.
    const form = mount(schema, { email: 'a@b.com', address: { city: 'NYC' } })
    const proxy = form.errors as unknown as { valueOf(): unknown }
    expect(proxy.valueOf()).toBe(form.errors)
    const leaf = form.fields.email as unknown as { valueOf(): unknown }
    expect(leaf.valueOf()).toBe(form.fields.email)
  })
})

describe('surface proxies — schema-named toString/valueOf collisions', () => {
  // When a schema literally has a field named `toString` or `valueOf`,
  // schema authority wins: dot-access resolves to the field, not the
  // primitive-coercion handler. This is the symmetric companion to the
  // FIELD_STATE_KEYS shadowing fix that was the headline of 0.14.
  // Primitive coercion at the parent (`String(parent)`) still produces
  // a primitive via `Symbol.toPrimitive`, so the field collision and
  // the coercion shortcut coexist without conflict.

  it('schema field literally named "toString" (string leaf) is reachable via dot-access', () => {
    const schema = z.object({
      address: z.object({
        toString: z.string(), // collision case
        city: z.string(),
      }),
    })
    const form = mount(schema, { address: { toString: 'render-as', city: 'NYC' } })

    // Dot-access on `form.fields.address.toString` resolves to the
    // FieldStateView for the schema's `toString` field, NOT the
    // primitive-coercion handler.
    expect(form.fields.address.toString.value).toBe('render-as')
    expect(form.fields.address.toString.path).toEqual(['address', 'toString'])

    // Per-leaf error reads through the same dot-path.
    expect(form.errors.address.toString).toBeUndefined()

    // String coercion at the PARENT still produces a primitive, because
    // `Symbol.toPrimitive` is the hot path for `String(...)` and isn't
    // affected by the schema-authority check (Symbol keys can't be
    // schema keys).
    expect(String(form.fields.address)).toBe('{}')
    expect(String(form.errors.address)).toBe('{}')
  })

  it('schema field literally named "valueOf" (number leaf) is reachable via dot-access', () => {
    const schema = z.object({
      account: z.object({
        valueOf: z.number(), // collision case
        owner: z.string(),
      }),
    })
    const form = mount(schema, { account: { valueOf: 42, owner: 'alice' } })

    expect(form.fields.account.valueOf.value).toBe(42)
    expect(form.values.account.valueOf).toBe(42)

    // Parent coercion unaffected.
    expect(String(form.fields.account)).toBe('{}')
  })

  it('schema field "toString" as a CONTAINER (object) is also reachable', () => {
    // Tests the second branch of the existence check: schema has a
    // child at this path, but it's a container — descent must still
    // proceed (not the primitive-coercion handler).
    const schema = z.object({
      page: z.object({
        toString: z.object({ format: z.string(), locale: z.string() }),
      }),
    })
    const form = mount(schema, {
      page: { toString: { format: 'iso', locale: 'en-US' } },
    })

    expect(form.fields.page.toString.format.value).toBe('iso')
    expect(form.values.page.toString.locale).toBe('en-US')
  })

  it('parent-level String(...) when schema has no child collision (control)', () => {
    // No collision: bare schema. Confirms primitive-coercion handler
    // still wins when there's nothing to defer to.
    const schema = z.object({ email: z.string() })
    const form = mount(schema, { email: 'a@b.com' })
    expect(String(form.fields)).toBe('{}')
    expect((form.errors as unknown as { toString(): string }).toString()).toBe('{}')
  })
})

describe('form.fields — discriminated unions (DU)', () => {
  const schema = z.object({
    name: z.string(),
    notify: z.discriminatedUnion('channel', [
      z.object({ channel: z.literal('email'), address: z.string() }),
      z.object({ channel: z.literal('sms'), number: z.string() }),
    ]),
  })

  it('drills the discriminator key as a leaf', () => {
    const form = mount(schema, {
      name: '',
      notify: { channel: 'email', address: '' },
    })
    expect(form.fields.notify.channel.value).toBe('email')
  })

  it('drills variant-only keys as leaves regardless of active variant', () => {
    const form = mount(schema, {
      name: '',
      notify: { channel: 'email', address: 'a@b.com' },
    })
    // address is a leaf (string) — leaf-view exposed.
    const view = (form.fields as unknown as (p: string) => unknown)('notify.address') as {
      value: string
    }
    expect(view.value).toBe('a@b.com')
  })
})
