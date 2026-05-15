// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { createApp, defineComponent, h, type App } from 'vue'
import { z } from 'zod'
import { unset, useForm } from '../../src/zod'
import type { UseFormConfigV4, UseFormReturnV4 } from '../../src/zod'
import { createAttaform } from '../../src/runtime/core/plugin'

/**
 * Coverage for the leaf-aware drillable callable Proxy machinery
 * shared by `form.values`, `form.errors`, and `form.fields`.
 *
 * The pivotal behaviour: `FIELD_STATE_KEYS` (`value`, `dirty`,
 * `errors`, `connected`, …) inject ONLY at leaf paths, not at
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
  defaultValues: UseFormConfigV4<Schema>['defaultValues']
): UseFormReturnV4<Schema> {
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
  const app = createApp(App).use(createAttaform())
  const root = document.createElement('div')
  document.body.appendChild(root)
  app.mount(root)
  apps.push(app)
  if (captured === undefined) throw new Error('useForm did not return')
  return captured as UseFormReturnV4<Schema>
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
    // The leaf-view's own .dirty prop is the FieldState's dirty boolean.
    expect(form.fields.address.dirty.value).toBe(false)
    expect(form.fields.address.dirty.dirty).toBe(false) // the leaf's pristine state

    form.setValue('address.dirty', true)
    expect(form.fields.address.dirty.value).toBe(true)
    expect(form.fields.address.dirty.dirty).toBe(true) // now dirty per the FieldState
  })

  it('schema field named "valid" at depth 2 is reachable; .valid drilling works', () => {
    const schema = z.object({
      address: z.object({
        valid: z.boolean(),
        city: z.string(),
      }),
    })
    const form = mount(schema, { address: { valid: true, city: 'NYC' } })

    // address.valid is a leaf (boolean) — exposed as a FieldState.
    expect(form.fields.address.valid.value).toBe(true)
    expect(form.fields.address.valid.path).toEqual(['address', 'valid'])
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
    // The leaf-view's OWN .errors (the FieldState's errors array) is empty.
    expect(form.fields.submission.errors.errors).toEqual([])
  })
})

describe('form.fields — callable form', () => {
  const schema = z.object({
    email: z.string().email(),
    address: z.object({ city: z.string(), zip: z.string() }),
  })

  type FieldStateLike = {
    value: unknown
    path: readonly (string | number)[]
    errors: readonly unknown[]
    pristine: boolean
    dirty: boolean
    city?: unknown
  }

  // Dot-access and call-form return DIFFERENT proxy shapes by design:
  //   - dot: leaf-view (descend-on-miss; depth-2+ collisions resolve via
  //     descent, e.g. `form.fields.address.dirty.dirty`)
  //   - call: FieldState terminal (FIELD_STATE_KEYS land directly,
  //     non-keys return undefined)
  // Both surface the same FIELD_STATE_KEYS values; equivalence is tested
  // structurally, not via referential equality.
  it('form.fields("path") and form.fields.path expose equivalent FieldState reads at leaves', () => {
    const form = mount(schema, { email: 'a@b.com', address: { city: 'NYC', zip: '10001' } })
    const fromDot = form.fields.email
    const fromCall = (form.fields as unknown as (p: string) => FieldStateLike)('email')
    expect(fromCall.value).toBe(fromDot.value)
    expect(fromCall.errors).toEqual(fromDot.errors)
    expect(fromCall.path).toEqual(fromDot.path)
  })

  it('form.fields("a.b.c") and form.fields.a.b.c expose equivalent FieldState reads', () => {
    const form = mount(schema, { email: 'a@b.com', address: { city: 'NYC', zip: '10001' } })
    const fromDot = form.fields.address.city
    const fromCall = (form.fields as unknown as (p: string) => FieldStateLike)('address.city')
    expect(fromCall.value).toBe(fromDot.value)
    expect(fromCall.path).toEqual(fromDot.path)
  })

  it('form.fields([...path]) accepts array paths and exposes equivalent FieldState reads', () => {
    const form = mount(schema, { email: 'a@b.com', address: { city: 'NYC', zip: '10001' } })
    const fromDot = form.fields.address.city
    const fromCall = (form.fields as unknown as (p: readonly string[]) => FieldStateLike)([
      'address',
      'city',
    ])
    expect(fromCall.value).toBe(fromDot.value)
    expect(fromCall.path).toEqual(fromDot.path)
  })

  // No-arg call returns the root FieldState terminal — equivalent to
  // `form.fields([])`. Same shape `form.meta` exposes (FormMeta is
  // FieldState<F> at the root with lifecycle scalars layered on).
  it('form.fields() returns the root FieldState terminal (aggregation over the whole form)', () => {
    const form = mount(schema, { email: 'a@b.com', address: { city: 'NYC', zip: '10001' } })
    const root = (form.fields as unknown as () => FieldStateLike)()
    expect(root.path).toEqual([])
    expect(root.pristine).toBe(true)
    expect(root.dirty).toBe(false)
  })

  it('container call-form returns FieldState — not navigable', () => {
    const form = mount(schema, { email: 'a@b.com', address: { city: 'NYC', zip: '10001' } })
    const addr = (form.fields as unknown as (p: string) => FieldStateLike)('address')
    expect(addr.path).toEqual(['address'])
    expect(addr.pristine).toBe(true)
    // FIELD_STATE_KEYS land directly; non-keys return undefined (no
    // descent through schema children).
    expect(addr.city).toBeUndefined()
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

  it('form.errors() with no arg returns the form-level error aggregate', () => {
    // `form.errors()` is shorthand for `form.errors([])` — the same
    // aggregated array `form.meta.errors` exposes. `undefined` when
    // no errors exist.
    const form = mount(schema, { email: 'a@b.com', address: { city: 'NYC' } })
    const root = (form.errors as unknown as () => unknown)()
    expect(root).toBeUndefined()
  })

  it('form.errors at a container materialises descendants as a nested tree', () => {
    const form = mount(schema, { email: 'a@b.com', address: { city: 'NYC' } })
    form.setFieldErrors([
      { path: ['address', 'city'], message: 'bad', formKey: form.key, code: 'api:validation' },
    ])
    // Container materialisation: the underlying nested error tree, not `{}`.
    expect(JSON.parse(JSON.stringify(form.errors.address))).toEqual({
      city: [
        { path: ['address', 'city'], message: 'bad', formKey: form.key, code: 'api:validation' },
      ],
    })
    // Drilling still reaches the leaf.
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

  it("includes form-level errors (path: [''])", () => {
    // setFieldErrors entries that arrive with `path: []` are rerouted
    // at storage to the form-level bucket (`['']`), so the aggregate
    // surfaces them with the new contract path.
    const form = mount(schema, { email: '', password: '' })
    form.setFieldErrors([
      { path: [], message: 'whole-form invalid', formKey: form.key, code: 'api:validation' },
    ])
    expect(form.meta.errors).toHaveLength(1)
    expect(form.meta.errors[0]?.path).toEqual([''])
  })
})

describe('form.fields — JSON.stringify behaviour', () => {
  const schema = z.object({
    email: z.string().email(),
    address: z.object({ city: z.string() }),
  })

  it('JSON.stringify on a leaf returns the FieldState snapshot', () => {
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

  it('JSON.stringify on a container materialises FieldState snapshots for every leaf descendant', () => {
    const form = mount(schema, { email: 'a@b.com', address: { city: 'NYC' } })
    const snapshot = JSON.parse(JSON.stringify(form.fields.address))
    expect(snapshot).toMatchObject({
      city: { value: 'NYC', dirty: false, errors: [] },
    })
    // The same shape JSON.stringify(form.fields.address.city) would
    // produce — leaf snapshots are nested under their relative key.
    expect(snapshot.city).toMatchObject(JSON.parse(JSON.stringify(form.fields.address.city)))
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

  it('String(form.errors) reflects the empty error model when no errors are set', () => {
    const form = mount(schema, { email: 'a@b.com', address: { city: 'NYC' } })
    expect(() => String(form.errors)).not.toThrow()
    // Underlying model: zero errors → empty materialised tree.
    expect(form.meta.errors).toEqual([])
    expect(JSON.parse(String(form.errors))).toEqual({})
  })

  it('String(form.errors) reflects the populated error model when errors exist', () => {
    const form = mount(schema, { email: '', address: { city: '' } })
    form.setFieldErrors([
      { path: ['email'], message: 'Required', formKey: form.key, code: 'api:validation' },
      { path: ['address', 'city'], message: 'Required', formKey: form.key, code: 'api:validation' },
    ])
    // Surface (String/{{ }}) and model (form.meta.errors) agree on the data.
    expect(form.meta.errors).toHaveLength(2)
    const parsed = JSON.parse(String(form.errors))
    expect(parsed).toMatchObject({
      email: [{ message: 'Required', path: ['email'] }],
      address: { city: [{ message: 'Required', path: ['address', 'city'] }] },
    })
  })

  it('String(form.errors.address) reflects an empty subtree when no descendants have errors', () => {
    const form = mount(schema, { email: 'a@b.com', address: { city: 'NYC' } })
    expect(() => String(form.errors.address)).not.toThrow()
    expect(form.meta.errors).toEqual([])
    expect(JSON.parse(String(form.errors.address))).toEqual({})
  })

  it('String(form.fields) materialises the full FieldState tree (root container)', () => {
    const form = mount(schema, { email: 'a@b.com', address: { city: 'NYC' } })
    expect(() => String(form.fields)).not.toThrow()
    const parsed = JSON.parse(String(form.fields))
    expect(parsed).toMatchObject({
      email: { value: 'a@b.com', dirty: false, errors: [] },
      address: { city: { value: 'NYC', dirty: false, errors: [] } },
    })
  })

  it('String(form.fields.email) returns the FieldState snapshot JSON (leaf-view)', () => {
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

  it('default-hint coercion (string concat) reflects the live error model', () => {
    // `form.errors + 'x'` invokes ToPrimitive with the 'default' hint.
    // Without `Symbol.toPrimitive` covering the 'default' branch, the
    // OrdinaryToPrimitive('default') walk runs `valueOf` → `toString`,
    // and we'd be back to the schema-descent throw.
    const form = mount(schema, { email: '', address: { city: '' } })
    // Empty error model → empty materialised tree under default-hint.
    expect(form.meta.errors).toEqual([])
    const concatEmpty = `${form.errors}x`
    expect(concatEmpty.endsWith('x')).toBe(true)
    expect(JSON.parse(concatEmpty.slice(0, -1))).toEqual({})

    // Populated error model → materialised tree mirrors the underlying data.
    form.setFieldErrors([
      { path: ['email'], message: 'Required', formKey: form.key, code: 'api:validation' },
    ])
    const concatPopulated = `${form.errors}!`
    expect(concatPopulated.endsWith('!')).toBe(true)
    expect(JSON.parse(concatPopulated.slice(0, -1))).toMatchObject({
      email: [{ message: 'Required' }],
    })

    // Leaf-view coercion: starts with `{` and round-trips to a
    // FieldState snapshot.
    expect(JSON.parse(`${form.fields.email}`)).toMatchObject({
      value: '',
      errors: expect.any(Array),
    })
  })

  it('direct proxy.toString() returns the materialised error tree (container)', () => {
    // Pre-fix this routed through schema descent and returned a callable
    // sub-proxy. Now it returns a primitive string consistent with the
    // `Symbol.toPrimitive` output AND consistent with the underlying model.
    const form = mount(schema, { email: '', address: { city: '' } })
    form.setFieldErrors([
      { path: ['email'], message: 'Required', formKey: form.key, code: 'api:validation' },
    ])
    const out = (form.errors as unknown as { toString(): string }).toString()
    expect(typeof out).toBe('string')
    expect(JSON.parse(out)).toMatchObject({
      email: [{ message: 'Required', path: ['email'] }],
    })
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
    // FieldState for the schema's `toString` field, NOT the
    // primitive-coercion handler.
    expect(form.fields.address.toString.value).toBe('render-as')
    expect(form.fields.address.toString.path).toEqual(['address', 'toString'])

    // Per-leaf error reads through the same dot-path.
    expect(form.errors.address.toString).toBeUndefined()

    // String coercion at the PARENT still produces a primitive, because
    // `Symbol.toPrimitive` is the hot path for `String(...)` and isn't
    // affected by the schema-authority check (Symbol keys can't be
    // schema keys). The materialised fields tree exposes both leaves;
    // the materialised errors tree mirrors the empty store.
    const fieldsString = String(form.fields.address)
    expect(typeof fieldsString).toBe('string')
    expect(JSON.parse(fieldsString)).toMatchObject({
      toString: { value: 'render-as' },
      city: { value: 'NYC' },
    })
    expect(form.meta.errors).toEqual([])
    expect(JSON.parse(String(form.errors.address))).toEqual({})
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

    // Parent coercion: the materialised tree exposes both leaves, with
    // a FieldState snapshot under the `valueOf` key (the schema
    // field, NOT the Object.prototype method).
    const parsed = JSON.parse(String(form.fields.account))
    expect(parsed).toMatchObject({
      valueOf: { value: 42 },
      owner: { value: 'alice' },
    })
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
    const fieldsParsed = JSON.parse(String(form.fields))
    expect(fieldsParsed).toMatchObject({ email: { value: 'a@b.com' } })
    // No errors set → underlying model is empty AND materialisation reflects it.
    expect(form.meta.errors).toEqual([])
    const errorsString = (form.errors as unknown as { toString(): string }).toString()
    expect(JSON.parse(errorsString)).toEqual({})
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

describe('form.errors — container materialisation (toJSON / String / `{{ }}`)', () => {
  // Pre-fix, JSON.stringify(form.errors) returned {} unconditionally —
  // hiding every error under the proxy's container shell. The
  // materialiser walks the live error stores and produces a sparse
  // nested tree at every container depth, including the root.

  it('errors should not be {} when a required field has a leaf error (the headline case)', () => {
    const schema = z.object({ name: z.string(), age: z.number() })
    const form = mount(schema, { name: '', age: 0 })
    form.setFieldErrors([
      { path: ['name'], message: 'Required', formKey: form.key, code: 'api:validation' },
    ])
    const serialised = JSON.parse(JSON.stringify(form.errors))
    expect(serialised).not.toEqual({})
    expect(serialised).toMatchObject({
      name: [{ message: 'Required', path: ['name'] }],
    })
  })

  it('produces a deep nested tree mirroring the leaf-error paths', () => {
    const schema = z.object({
      name: z.string(),
      address: z.object({ city: z.string(), zip: z.string() }),
      tags: z.array(z.string()),
    })
    const form = mount(schema, { name: '', address: { city: '', zip: '' }, tags: ['a', 'b'] })
    form.setFieldErrors([
      { path: ['name'], message: 'Required', formKey: form.key, code: 'api:validation' },
      {
        path: ['address', 'city'],
        message: 'Required',
        formKey: form.key,
        code: 'api:validation',
      },
      { path: ['tags', 0], message: 'Bad tag', formKey: form.key, code: 'api:validation' },
    ])
    const root = JSON.parse(JSON.stringify(form.errors))
    expect(root).toMatchObject({
      name: [{ message: 'Required' }],
      address: { city: [{ message: 'Required' }] },
      tags: { 0: [{ message: 'Bad tag' }] },
    })
    // Sparse: paths with no errors don't appear (`address.zip`, `tags.1`).
    expect(root.address.zip).toBeUndefined()
    expect((root.tags as Record<string, unknown>)[1]).toBeUndefined()
  })

  it('container-relative tree at form.errors.address only includes descendants of address', () => {
    const schema = z.object({
      name: z.string(),
      address: z.object({ city: z.string(), zip: z.string() }),
    })
    const form = mount(schema, { name: '', address: { city: '', zip: '' } })
    form.setFieldErrors([
      { path: ['name'], message: 'Required', formKey: form.key, code: 'api:validation' },
      {
        path: ['address', 'city'],
        message: 'Bad',
        formKey: form.key,
        code: 'api:validation',
      },
      {
        path: ['address', 'zip'],
        message: 'Bad zip',
        formKey: form.key,
        code: 'api:validation',
      },
    ])
    const sub = JSON.parse(JSON.stringify(form.errors.address))
    expect(sub).toMatchObject({
      city: [{ message: 'Bad' }],
      zip: [{ message: 'Bad zip' }],
    })
    // Sibling paths outside the container are excluded.
    expect((sub as Record<string, unknown>)['name']).toBeUndefined()
  })

  it('merges schemaErrors + derivedBlankErrors + userErrors at the same path', () => {
    const schema = z.object({ name: z.string() })
    const form = mount(schema, { name: '' })
    // userErrors via setFieldErrors
    form.setFieldErrors([
      { path: ['name'], message: 'A', formKey: form.key, code: 'api:validation' },
    ])
    form.addFieldErrors([
      { path: ['name'], message: 'B', formKey: form.key, code: 'api:validation' },
    ])
    const serialised = JSON.parse(JSON.stringify(form.errors)) as { name: { message: string }[] }
    expect(serialised.name).toHaveLength(2)
    expect(serialised.name.map((e) => e.message)).toEqual(['A', 'B'])
  })

  it('user errors at inactive DU variant paths still surface (consumer data, not filtered)', () => {
    // Updated contract: user-injected errors are consumer data —
    // server replies, manual marks, programmatic warnings — and the
    // library never silently drops them, including at paths the
    // current DU variant doesn't cover. Schema errors (library-
    // produced verdicts) still respect the active-path filter; see
    // the DU-transition probe below for that contract.
    const schema = z.object({
      notify: z.discriminatedUnion('channel', [
        z.object({ channel: z.literal('email'), address: z.string() }),
        z.object({ channel: z.literal('sms'), number: z.string() }),
      ]),
    })
    const form = mount(schema, { notify: { channel: 'email', address: 'a@b.com' } })
    form.setFieldErrors([
      {
        path: ['notify', 'address'],
        message: 'bad addr',
        formKey: form.key,
        code: 'api:validation',
      },
      {
        path: ['notify', 'number'],
        message: 'bad num',
        formKey: form.key,
        code: 'api:validation',
      },
    ])
    const serialised = JSON.parse(JSON.stringify(form.errors))
    expect(serialised.notify.address).toMatchObject([{ message: 'bad addr' }])
    expect(serialised.notify.number).toMatchObject([{ message: 'bad num' }])
  })

  it('serialised tree updates on every JSON.stringify call (no staleness across state changes)', () => {
    const schema = z.object({ name: z.string() })
    const form = mount(schema, { name: '' })

    // Initial: model has no errors → materialised tree empty.
    expect(form.meta.errors).toEqual([])
    expect(JSON.parse(JSON.stringify(form.errors))).toEqual({})

    // Set: model gains one entry → materialised tree mirrors it.
    form.setFieldErrors([
      { path: ['name'], message: 'Required', formKey: form.key, code: 'api:validation' },
    ])
    expect(form.meta.errors).toHaveLength(1)
    expect(JSON.parse(JSON.stringify(form.errors))).toMatchObject({
      name: [{ message: 'Required', path: ['name'] }],
    })

    // Clear: model returns to empty → materialised tree empty again. The
    // cached proxy is the SAME reference, but the closures inside
    // `containerProxyAt` re-read the live stores every call, so
    // JSON.stringify produces fresh output rather than the previous shape.
    form.clearFieldErrors('name')
    expect(form.meta.errors).toEqual([])
    expect(JSON.parse(JSON.stringify(form.errors))).toEqual({})
  })

  it('proxy referential stability across stringify calls (cache is preserved)', () => {
    const schema = z.object({ name: z.string() })
    const form = mount(schema, { name: '' })
    const before = form.errors
    JSON.stringify(form.errors) // force a materialisation
    const after = form.errors
    expect(before).toBe(after) // same proxy reference, just fresh JSON each time
  })
})

describe('form.fields — container materialisation (toJSON / String / `{{ }}`)', () => {
  it('root materialisation produces FieldState snapshots for every leaf', () => {
    const schema = z.object({
      email: z.string(),
      address: z.object({ city: z.string() }),
    })
    const form = mount(schema, { email: 'a@b.com', address: { city: 'NYC' } })
    const root = JSON.parse(JSON.stringify(form.fields))
    expect(root).toMatchObject({
      email: { value: 'a@b.com', dirty: false, errors: [] },
      address: { city: { value: 'NYC', dirty: false, errors: [] } },
    })
  })

  it('arrays materialise as arrays of FieldState snapshots', () => {
    const schema = z.object({ tags: z.array(z.string()) })
    const form = mount(schema, { tags: ['alpha', 'beta'] })
    const root = JSON.parse(JSON.stringify(form.fields)) as {
      tags: Array<{ value: string }>
    }
    expect(Array.isArray(root.tags)).toBe(true)
    expect(root.tags).toHaveLength(2)
    expect(root.tags[0]?.value).toBe('alpha')
    expect(root.tags[1]?.value).toBe('beta')
  })

  it('discriminated unions materialise only the active variant keys', () => {
    const schema = z.object({
      notify: z.discriminatedUnion('channel', [
        z.object({ channel: z.literal('email'), address: z.string() }),
        z.object({ channel: z.literal('sms'), number: z.string() }),
      ]),
    })
    const form = mount(schema, { notify: { channel: 'email', address: 'a@b.com' } })
    const sub = JSON.parse(JSON.stringify(form.fields.notify)) as Record<string, { value: unknown }>
    expect(sub['channel']?.value).toBe('email')
    expect(sub['address']?.value).toBe('a@b.com')
    // Inactive variant key not present in live storage → omitted.
    expect(sub['number']).toBeUndefined()
  })

  it('serialised tree reflects state changes (not stale)', () => {
    const schema = z.object({ name: z.string() })
    const form = mount(schema, { name: '' })

    const before = JSON.parse(JSON.stringify(form.fields)) as {
      name: { value: string; dirty: boolean }
    }
    expect(before.name.value).toBe('')
    expect(before.name.dirty).toBe(false)

    form.setValue('name', 'Alice')

    const after = JSON.parse(JSON.stringify(form.fields)) as {
      name: { value: string; dirty: boolean }
    }
    expect(after.name.value).toBe('Alice')
    expect(after.name.dirty).toBe(true)
  })
})

describe('surface materialisation — predictable representations + complex errors', () => {
  // These tests pin exact stringified output for non-trivial shapes
  // (deep nesting, arrays, discriminated unions). If the materialiser
  // ever drifts — wrong key ordering at the schema level, lost
  // FieldState fields, mis-shaped error nesting — these break first.

  it('form.values prints an exact deep-equal copy of the form data (root + nested)', () => {
    const schema = z.object({
      title: z.string(),
      author: z.object({ name: z.string(), age: z.number() }),
      tags: z.array(z.string()),
      notify: z.discriminatedUnion('channel', [
        z.object({ channel: z.literal('email'), address: z.string() }),
        z.object({ channel: z.literal('sms'), number: z.string() }),
      ]),
    })
    const form = mount(schema, {
      title: 'Hello',
      author: { name: 'Alice', age: 30 },
      tags: ['a', 'b', 'c'],
      notify: { channel: 'email', address: 'a@b.com' },
    })

    expect(JSON.parse(JSON.stringify(form.values))).toEqual({
      title: 'Hello',
      author: { name: 'Alice', age: 30 },
      tags: ['a', 'b', 'c'],
      notify: { channel: 'email', address: 'a@b.com' },
    })
    expect(JSON.parse(JSON.stringify(form.values.author))).toEqual({
      name: 'Alice',
      age: 30,
    })
    expect(JSON.parse(JSON.stringify(form.values.tags))).toEqual(['a', 'b', 'c'])
  })

  it('form.fields prints a FieldState at every schema-leaf descendant', () => {
    const schema = z.object({
      title: z.string(),
      tags: z.array(z.string()),
      notify: z.discriminatedUnion('channel', [
        z.object({ channel: z.literal('email'), address: z.string() }),
        z.object({ channel: z.literal('sms'), number: z.string() }),
      ]),
    })
    const form = mount(schema, {
      title: 'Hello',
      tags: ['x', 'y'],
      notify: { channel: 'sms', number: '+15555' },
    })

    const tree = JSON.parse(JSON.stringify(form.fields)) as Record<string, unknown>

    // Every schema-leaf carries the full FieldState surface — `value`
    // matches storage, `path` is the absolute path, `pristine` reflects
    // the un-mutated initial state. `focused` / `blurred` start as
    // `null` (no DOM connected, so the DOM-state concepts don't apply
    // yet); `touched` starts as `false` (interaction history is a
    // boolean — no event yet means `false`, not "unknown");
    // `updatedAt` is the construction timestamp until the first write.
    const expectedLeafShape = {
      value: expect.anything(),
      original: expect.anything(),
      pristine: true,
      dirty: false,
      focused: null,
      blurred: null,
      touched: false,
      connected: false,
      updatedAt: expect.anything(),
      errors: [],
      path: expect.any(Array),
      blank: expect.any(Boolean),
    }
    expect(tree['title']).toMatchObject({ ...expectedLeafShape, value: 'Hello', path: ['title'] })

    const tags = tree['tags'] as Array<Record<string, unknown>>
    expect(Array.isArray(tags)).toBe(true)
    expect(tags).toHaveLength(2)
    expect(tags[0]).toMatchObject({ ...expectedLeafShape, value: 'x', path: ['tags', 0] })
    expect(tags[1]).toMatchObject({ ...expectedLeafShape, value: 'y', path: ['tags', 1] })

    const notify = tree['notify'] as Record<string, unknown>
    expect(notify['channel']).toMatchObject({
      ...expectedLeafShape,
      value: 'sms',
      path: ['notify', 'channel'],
    })
    expect(notify['number']).toMatchObject({
      ...expectedLeafShape,
      value: '+15555',
      path: ['notify', 'number'],
    })
    // Inactive variant key is absent from live storage, so the dense
    // walk doesn't surface a FieldState for it.
    expect(notify['address']).toBeUndefined()
  })

  it('errors at array indices materialise as a sparse object (only erroring indices appear)', () => {
    const schema = z.object({ tags: z.array(z.string()) })
    const form = mount(schema, { tags: ['ok', 'bad', 'also-ok', 'also-bad'] })
    form.setFieldErrors([
      { path: ['tags', 1], message: 'second is bad', formKey: form.key, code: 'api:validation' },
      { path: ['tags', 3], message: 'fourth is bad', formKey: form.key, code: 'api:validation' },
    ])

    // The materialiser allocates an array at `tags` (numeric next-seg)
    // and writes errors only at the touched indices. Untouched indices
    // are holes; `JSON.stringify` serialises holes as `null` so the
    // round-tripped shape mirrors the array layout one-to-one.
    const root = JSON.parse(JSON.stringify(form.errors)) as {
      tags: Array<Array<{ message: string }> | null>
    }
    expect(Array.isArray(root.tags)).toBe(true)
    expect(root.tags).toHaveLength(4)
    expect(root.tags[0]).toBeNull()
    expect(root.tags[1]?.[0]?.message).toBe('second is bad')
    expect(root.tags[2]).toBeNull()
    expect(root.tags[3]?.[0]?.message).toBe('fourth is bad')

    // Drilling reaches each index identically.
    expect(form.errors.tags[1]?.[0]?.message).toBe('second is bad')
    expect(form.errors.tags[3]?.[0]?.message).toBe('fourth is bad')
  })

  it('errors deep in array-of-objects materialise at the right path', () => {
    const schema = z.object({
      contacts: z.array(z.object({ name: z.string(), number: z.string() })),
    })
    const form = mount(schema, {
      contacts: [
        { name: 'Alice', number: '+1' },
        { name: 'Bob', number: '+2' },
        { name: 'Carol', number: '+3' },
      ],
    })
    form.setFieldErrors([
      {
        path: ['contacts', 0, 'number'],
        message: 'Alice number bad',
        formKey: form.key,
        code: 'api:validation',
      },
      {
        path: ['contacts', 2, 'name'],
        message: 'Carol name bad',
        formKey: form.key,
        code: 'api:validation',
      },
    ])

    // contacts is an array path → materialiser allocates an array;
    // untouched indices become null after JSON round-trip.
    const root = JSON.parse(JSON.stringify(form.errors)) as {
      contacts: Array<{ name?: unknown; number?: unknown } | null>
    }
    expect(Array.isArray(root.contacts)).toBe(true)
    expect(root.contacts).toHaveLength(3)
    expect(root.contacts[0]).toMatchObject({
      number: [{ message: 'Alice number bad', path: ['contacts', 0, 'number'] }],
    })
    expect((root.contacts[0] as { name?: unknown }).name).toBeUndefined()
    expect(root.contacts[1]).toBeNull()
    expect(root.contacts[2]).toMatchObject({
      name: [{ message: 'Carol name bad', path: ['contacts', 2, 'name'] }],
    })
    expect((root.contacts[2] as { number?: unknown }).number).toBeUndefined()

    // Container-relative materialisation drops the parent prefix.
    const sub = JSON.parse(JSON.stringify(form.errors.contacts)) as Array<{
      name?: unknown
      number?: unknown
    } | null>
    expect(Array.isArray(sub)).toBe(true)
    expect((sub[0] as { number: unknown }).number).toEqual([
      {
        path: ['contacts', 0, 'number'],
        message: 'Alice number bad',
        formKey: form.key,
        code: 'api:validation',
      },
    ])
    expect(sub[1]).toBeNull()
    expect((sub[2] as { name: unknown }).name).toEqual([
      {
        path: ['contacts', 2, 'name'],
        message: 'Carol name bad',
        formKey: form.key,
        code: 'api:validation',
      },
    ])
  })

  it('numeric blank-required errors merge with userErrors at the same path', () => {
    // Required numeric field, marked blank explicitly via the `unset`
    // sentinel: `derivedBlankErrors` injects "No value supplied" at the
    // path. A second user-supplied error at the same path stacks via
    // `addFieldErrors`. Both must appear in the materialised tree.
    const schema = z.object({ income: z.number() })
    const form = mount(schema, { income: unset })

    form.addFieldErrors([
      {
        path: ['income'],
        message: 'Server says income is suspicious',
        formKey: form.key,
        code: 'api:validation',
      },
    ])

    const root = JSON.parse(JSON.stringify(form.errors)) as {
      income: Array<{ message: string; code?: string }>
    }
    expect(root.income).toBeDefined()
    expect(root.income.length).toBeGreaterThanOrEqual(2)
    const messages = root.income.map((e) => e.message)
    // Derived blank error from the numeric required gate.
    expect(messages).toContain('No value supplied')
    // User-injected error from the addFieldErrors call.
    expect(messages).toContain('Server says income is suspicious')
  })

  it('DU transition: schema errors at the previously-active variant disappear after switch (user errors persist)', () => {
    // Schema errors (library-produced) respect the active-path filter:
    // a schema verdict against the email variant becomes unreachable
    // when the discriminator flips to sms, so it stops appearing in
    // the serialised tree. User-injected errors are consumer data
    // and survive the switch — see the surface-serialization probe
    // for the unknown-key / form-level companions to this rule.
    const schema = z.object({
      notify: z.discriminatedUnion('channel', [
        z.object({ channel: z.literal('email'), address: z.email() }),
        z.object({ channel: z.literal('sms'), number: z.string().min(10) }),
      ]),
    })
    const form = mount(schema, { notify: { channel: 'email', address: 'not-an-email' } })

    // Trigger a schema error on the active variant.
    form.validate('notify.address')

    // After the variant switch, the schema error at notify.address
    // becomes inactive and the serialised tree drops it.
    form.setValue('notify', { channel: 'sms', number: '+1555' })
    const afterSwitch = JSON.parse(JSON.stringify(form.errors)) as {
      notify?: { address?: unknown; number?: unknown }
    }
    expect(afterSwitch.notify?.address).toBeUndefined()
  })

  it("form-level errors (path: ['']) surface in form.errors at the empty-string key, plus form.meta.errors and form.errors('')", () => {
    // Form-level user entries (set via `setFormErrors` or arriving
    // through `setFieldErrors([{ path: [] }])` which reroutes to the
    // empty-string bucket) MUST surface in the serialised
    // `form.errors` tree under the empty-string key. Otherwise
    // debug-prints (`{{ JSON.stringify(form.errors, null, 2) }}`)
    // silently lose them. They also stay reachable via
    // `form.errors('')` and `form.meta.errors`.
    const schema = z.object({ name: z.string() })
    const form = mount(schema, { name: '' })
    form.setFieldErrors([
      { path: [], message: 'whole-form invalid', formKey: form.key, code: 'api:validation' },
      { path: ['name'], message: 'name bad', formKey: form.key, code: 'api:validation' },
    ])

    const errorsTree = JSON.parse(JSON.stringify(form.errors)) as Record<string, unknown>
    expect(errorsTree['name']).toMatchObject([{ message: 'name bad' }])
    expect(errorsTree['']).toMatchObject([{ message: 'whole-form invalid' }])

    // Dedicated form-level read still works.
    expect(form.errors('')).toMatchObject([{ message: 'whole-form invalid' }])

    // Flat aggregate captures both entries.
    expect(form.meta.errors).toHaveLength(2)
  })
})
