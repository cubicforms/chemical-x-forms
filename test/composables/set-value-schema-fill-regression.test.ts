// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { createApp, defineComponent, h, type App } from 'vue'
import { z } from 'zod'
import { useForm } from '../../src/zod'
import { createChemicalXForms } from '../../src/runtime/core/plugin'

/**
 * Regression spec: every write through setValue must leave the form
 * **structurally complete** — every slot, intermediate and leaf, is the
 * shape the slim schema (objects/arrays/primitives without refines)
 * requires. Refine-level violations remain a validation concern and
 * surface through fieldErrors; structural correctness is a runtime
 * invariant that the lib owns.
 *
 * Today's gaps surfaced by these tests:
 *
 * 1. Sparse array writes leave intermediate slots `undefined` (lib
 *    fills, but with the wrong content — `null` / `undefined` rather
 *    than the schema element default).
 * 2. Path-form callback `prev` is `undefined` when the slot doesn't
 *    exist yet — should be the schema element default.
 * 3. Object writes through a missing intermediate object create that
 *    object as the minimum needed to land the write (`{ name: 'X' }`
 *    only) instead of populating the full default and overriding.
 *
 * The lib already owns initial-state generation via
 * `schema.getDefaultValues({...})`. The same machinery should be
 * exposed at path level (`schema.getDefaultAtPath(path)`) and consumed
 * everywhere a write would otherwise leave a schema-incompatible gap.
 *
 * Mindset (per design discussion): consumers using the API correctly
 * write to existing slots or use `append` for ordered insert. The
 * "write to people.21 against an empty array" path is a misuse, but the
 * lib still produces schema-complete data when it happens — that's the
 * structural-correctness invariant.
 */

const personSchema = z.object({
  name: z.string().default(''),
  age: z.number().default(0),
})

const formSchema = z.object({
  people: z.array(personSchema),
})

type Form = z.output<typeof formSchema>

function harness(initialPeople: Form['people']) {
  let captured!: ReturnType<typeof useForm<typeof formSchema>>
  const Probe = defineComponent({
    setup() {
      captured = useForm({
        schema: formSchema,
        key: `schema-fill-${Math.random().toString(36).slice(2)}`,
        defaultValues: { people: initialPeople },
      })
      return () => h('div')
    },
  })
  const app = createApp(Probe)
  app.use(createChemicalXForms())
  app.mount(document.createElement('div'))
  return { app, form: captured }
}

describe('setValue — intermediate array slots fill with schema element defaults', () => {
  const apps: App[] = []
  afterEach(() => {
    while (apps.length > 0) apps.pop()?.unmount()
  })

  it('value-form: writing to people.5 against empty people fills 0..4 with element defaults', () => {
    const { app, form } = harness([])
    apps.push(app)

    form.setValue('people.5', { name: 'Carol', age: 30 })

    // Indices 0..4 should be schema element defaults — { name: '', age: 0 } —
    // NOT null. Index 5 is the consumer's write.
    expect(form.getValue('people').value).toEqual([
      { name: '', age: 0 },
      { name: '', age: 0 },
      { name: '', age: 0 },
      { name: '', age: 0 },
      { name: '', age: 0 },
      { name: 'Carol', age: 30 },
    ])
  })

  it('value-form: writing to people.5 against length-2 fills 2..4 with element defaults', () => {
    const { app, form } = harness([
      { name: 'Alice', age: 25 },
      { name: 'Bob', age: 28 },
    ])
    apps.push(app)

    form.setValue('people.5', { name: 'Eve', age: 22 })

    // Existing 0,1 preserved. 2..4 are schema element defaults. 5 is the new value.
    expect(form.getValue('people').value).toEqual([
      { name: 'Alice', age: 25 },
      { name: 'Bob', age: 28 },
      { name: '', age: 0 },
      { name: '', age: 0 },
      { name: '', age: 0 },
      { name: 'Eve', age: 22 },
    ])
  })

  it('callback-form: writing to people.5 also fills 0..4 with schema element defaults', () => {
    const { app, form } = harness([])
    apps.push(app)

    form.setValue('people.5', () => ({ name: 'Dave', age: 40 }))

    expect(form.getValue('people').value).toEqual([
      { name: '', age: 0 },
      { name: '', age: 0 },
      { name: '', age: 0 },
      { name: '', age: 0 },
      { name: '', age: 0 },
      { name: 'Dave', age: 40 },
    ])
  })
})

describe('setValue — path-form callback `prev` is the schema element default when the slot is missing', () => {
  const apps: App[] = []
  afterEach(() => {
    while (apps.length > 0) apps.pop()?.unmount()
  })

  it('callback prev is the element default for an empty array', () => {
    const { app, form } = harness([])
    apps.push(app)

    let receivedPrev: unknown
    form.setValue('people.0', (prev) => {
      receivedPrev = prev
      return { ...prev, name: 'Alice' }
    })

    // prev arrived populated by the schema, not as undefined.
    expect(receivedPrev).toEqual({ name: '', age: 0 })

    // The consumer's spread + override produces a complete Person.
    expect(form.getValue('people').value[0]).toEqual({ name: 'Alice', age: 0 })
  })

  it('callback prev for an existing slot is the existing value, not a fresh default', () => {
    const { app, form } = harness([{ name: 'Existing', age: 99 }])
    apps.push(app)

    let receivedPrev: unknown
    form.setValue('people.0', (prev) => {
      receivedPrev = prev
      return { ...prev, age: prev.age + 1 }
    })

    expect(receivedPrev).toEqual({ name: 'Existing', age: 99 })
    expect(form.getValue('people').value[0]).toEqual({ name: 'Existing', age: 100 })
  })

  it('callback prev for a missing high index also gets the element default', () => {
    const { app, form } = harness([])
    apps.push(app)

    let receivedPrev: unknown
    form.setValue('people.5', (prev) => {
      receivedPrev = prev
      return { ...prev, name: 'Carol' }
    })

    // Same default-prev guarantee at index 5 as at index 0.
    expect(receivedPrev).toEqual({ name: '', age: 0 })
    // Intermediates 0..4 also defaulted (the structural fill from the
    // first describe block); index 5 is the consumer's spread + override.
    expect(form.getValue('people').value).toEqual([
      { name: '', age: 0 },
      { name: '', age: 0 },
      { name: '', age: 0 },
      { name: '', age: 0 },
      { name: '', age: 0 },
      { name: 'Carol', age: 0 },
    ])
  })
})

/**
 * Object-intermediate gaps. Same theme: when a deep write traverses
 * through a missing object, the lib must populate that object with the
 * schema default — not just create the minimum sub-tree needed to land
 * the leaf.
 */

const profileSchema = z.object({
  user: z.object({
    // `.optional()` prevents construction-time `getDefaultValues` from
    // pre-populating profile — the gap genuinely exists at runtime, so
    // setValue's intermediate-fill behaviour is what's under test here.
    profile: z
      .object({
        name: z.string().default(''),
        age: z.number().default(0),
        bio: z.string().default(''),
      })
      .optional(),
  }),
})

type ProfileForm = z.output<typeof profileSchema>

function profileHarness(initial: Partial<ProfileForm['user']>) {
  let captured!: ReturnType<typeof useForm<typeof profileSchema>>
  const Probe = defineComponent({
    setup() {
      captured = useForm({
        schema: profileSchema,
        key: `profile-fill-${Math.random().toString(36).slice(2)}`,
        defaultValues: { user: initial as ProfileForm['user'] },
      })
      return () => h('div')
    },
  })
  const app = createApp(Probe)
  app.use(createChemicalXForms())
  app.mount(document.createElement('div'))
  return { app, form: captured }
}

describe('setValue — intermediate object gaps fill with schema defaults', () => {
  const apps: App[] = []
  afterEach(() => {
    while (apps.length > 0) apps.pop()?.unmount()
  })

  it('writing to user.profile.name through a missing user.profile populates the whole profile default', () => {
    // Setup: user exists but profile is undefined.
    const { app, form } = profileHarness({})
    apps.push(app)

    form.setValue('user.profile.name', 'Alice')

    // Consumer wrote `name`. The lib must fill the rest of `profile`
    // with the schema default, not leave `age`/`bio` as undefined.
    expect(form.getValue('user.profile').value).toEqual({
      name: 'Alice',
      age: 0,
      bio: '',
    })
  })

  it('callback prev for a missing intermediate object slot is the full default', () => {
    const { app, form } = profileHarness({})
    apps.push(app)

    let receivedPrev: unknown
    form.setValue('user.profile', (prev) => {
      receivedPrev = prev
      return { ...prev, name: 'Bob' }
    })

    // prev is the whole profile default — every required field present.
    expect(receivedPrev).toEqual({ name: '', age: 0, bio: '' })
    // Result is a structurally-complete profile.
    expect(form.getValue('user.profile').value).toEqual({
      name: 'Bob',
      age: 0,
      bio: '',
    })
  })
})

/**
 * Partial value-form writes. The consumer passes a value at the path
 * that's structurally incomplete (e.g. `[{ name: 'A' }]` against
 * `Person[]` requiring `age` too). Per the theme, the lib should fill
 * missing required fields with schema defaults rather than write the
 * partial as-is.
 *
 * This is the most opinionated of the three areas — the consumer
 * explicitly typed a value with a missing field, and we're saying the
 * lib auto-completes it. Worth landing if structural-completeness is a
 * non-negotiable invariant; revisit if the surprise factor outweighs
 * the consistency win.
 */
/**
 * Combined: deep nested path that crosses an object boundary AND an
 * array boundary, with a callback that spreads `prev` and overrides one
 * field. Probably the cleanest single-shot expression of the
 * structural-completeness invariant.
 */

const addressSchema = z.object({
  address: z.object({
    street: z.string().default(''),
    people: z.array(
      z.object({
        name: z.string().default(''),
        age: z.number().default(0),
      })
    ),
  }),
})

type AddressForm = z.output<typeof addressSchema>

function addressHarness(initialPeople: AddressForm['address']['people']) {
  let captured!: ReturnType<typeof useForm<typeof addressSchema>>
  const Probe = defineComponent({
    setup() {
      captured = useForm({
        schema: addressSchema,
        key: `address-fill-${Math.random().toString(36).slice(2)}`,
        defaultValues: { address: { street: '123 Main St', people: initialPeople } },
      })
      return () => h('div')
    },
  })
  const app = createApp(Probe)
  app.use(createChemicalXForms())
  app.mount(document.createElement('div'))
  return { app, form: captured }
}

describe('setValue — combined: object + array intermediate fill via callback', () => {
  const apps: App[] = []
  afterEach(() => {
    while (apps.length > 0) apps.pop()?.unmount()
  })

  it('setValue("address.people.4", (person) => ({ ...person, name: "ed" })) against empty people produces structurally correct output', () => {
    const { app, form } = addressHarness([])
    apps.push(app)

    let receivedPrev: unknown
    form.setValue('address.people.4', (person) => {
      receivedPrev = person
      return { ...person, name: 'ed' }
    })

    // The callback received the schema element default — populated, not undefined.
    expect(receivedPrev).toEqual({ name: '', age: 0 })

    // The whole address subtree is structurally correct: street preserved
    // from defaultValues, people populated through index 4, intermediates
    // 0..3 are schema element defaults, index 4 is the callback's result.
    expect(form.getValue('address').value).toEqual({
      street: '123 Main St',
      people: [
        { name: '', age: 0 },
        { name: '', age: 0 },
        { name: '', age: 0 },
        { name: '', age: 0 },
        { name: 'ed', age: 0 },
      ],
    })
  })
})

/**
 * Deep cascade — three levels of intermediate fill in one write:
 * `object → array → object → array → object → leaf`. The original
 * implementation got the OUTERMOST array fill right (people[0..1])
 * but lost sibling fields on the slot at the cascading boundary —
 * people[2] was emitted as `{ addresses: [...] }` (no name / age)
 * because the array branch failed to fill arr[head] before recursing
 * past the existing length, and the next level built a fresh `{}`
 * populated only by the keys the path actually touched.
 *
 * Same bug at the inner array boundary: addresses[3] landed as
 * `{ street: 'X' }` only — `city` dropped.
 *
 * Regression: every slot the path traverses is structurally complete,
 * end-to-end, regardless of cascade depth.
 */

const cascadeSchema = z.object({
  people: z.array(
    z.object({
      name: z.string(),
      age: z.number(),
      addresses: z.array(
        z.object({
          street: z.string(),
          city: z.string(),
          notes: z.string().optional(),
        })
      ),
    })
  ),
})

type CascadeForm = z.output<typeof cascadeSchema>

function cascadeHarness() {
  let captured!: ReturnType<typeof useForm<typeof cascadeSchema>>
  const Probe = defineComponent({
    setup() {
      captured = useForm({
        schema: cascadeSchema,
        key: `cascade-fill-${Math.random().toString(36).slice(2)}`,
        defaultValues: { people: [] as CascadeForm['people'] },
      })
      return () => h('div')
    },
  })
  const app = createApp(Probe)
  app.use(createChemicalXForms())
  app.mount(document.createElement('div'))
  return { app, form: captured }
}

describe('setValue — deep cascade fills every traversed slot completely', () => {
  const apps: App[] = []
  afterEach(() => {
    while (apps.length > 0) apps.pop()?.unmount()
  })

  it('setValue("people.2.addresses.3.street", x) against empty people produces a structurally complete tree', () => {
    const { app, form } = cascadeHarness()
    apps.push(app)

    form.setValue('people.2.addresses.3.street', 'Diagonal Drive')

    // people[0..1] are full Person defaults (each with empty addresses
    // — the inner array's natural default).
    // people[2] is a Person populated through addresses[3]: the array
    // branch pre-fills the slot with the schema element default before
    // recursing, so name/age survive even though the path only writes
    // through addresses.
    // addresses[0..2] are full Address defaults.
    // addresses[3] is a structurally complete Address with the
    // consumer's `street` overlaid — `city` was filled from the schema
    // element default, NOT dropped just because the path didn't name
    // it.
    expect(form.getValue('people').value).toEqual([
      { name: '', age: 0, addresses: [] },
      { name: '', age: 0, addresses: [] },
      {
        name: '',
        age: 0,
        addresses: [
          { street: '', city: '' },
          { street: '', city: '' },
          { street: '', city: '' },
          { street: 'Diagonal Drive', city: '' },
        ],
      },
    ])
  })

  it('callback form: setValue("people.2.addresses.3", (a) => ({...a, street: x})) preserves siblings at every cascade level', () => {
    const { app, form } = cascadeHarness()
    apps.push(app)

    let receivedPrev: unknown
    form.setValue('people.2.addresses.3', (prev) => {
      receivedPrev = prev
      return { ...prev, street: 'Callback Street' }
    })

    // Path-form callback prev is auto-defaulted from
    // schema.getDefaultAtPath(['people', 2, 'addresses', 3]) — the
    // inner Address default. notes is optional → omitted.
    expect(receivedPrev).toEqual({ street: '', city: '' })

    // Same shape guarantee as the value-form variant above.
    expect(form.getValue('people').value).toEqual([
      { name: '', age: 0, addresses: [] },
      { name: '', age: 0, addresses: [] },
      {
        name: '',
        age: 0,
        addresses: [
          { street: '', city: '' },
          { street: '', city: '' },
          { street: '', city: '' },
          { street: 'Callback Street', city: '' },
        ],
      },
    ])
  })

  it('writing the SAME deep path twice is idempotent (no double-fill / no overwrite)', () => {
    const { app, form } = cascadeHarness()
    apps.push(app)

    form.setValue('people.2.addresses.3.street', 'First')
    form.setValue('people.2.addresses.3.street', 'Second')

    // Second write should only touch the leaf — every intermediate
    // already exists, no fill triggers, and the value lands cleanly.
    const people = form.getValue('people').value
    expect(people).toHaveLength(3)
    const target = (people as CascadeForm['people'])[2]?.addresses[3]
    expect(target).toEqual({ street: 'Second', city: '' })
  })
})

/**
 * Tuples (positional arrays). Same structural-completeness invariant
 * as regular arrays: writing past the current length must fill the
 * intermediate positions with the schema-prescribed defaults for those
 * positions — and tuples have *position-specific* defaults (each slot
 * is its own type), so the fill is per-position, not a single element
 * default reused.
 */

const tupleSchema = z.object({
  coords: z.tuple([z.number().default(0), z.number().default(0), z.number().default(0)]),
})

type TupleForm = z.output<typeof tupleSchema>

function tupleHarness(initial: TupleForm['coords']) {
  let captured!: ReturnType<typeof useForm<typeof tupleSchema>>
  const Probe = defineComponent({
    setup() {
      captured = useForm({
        schema: tupleSchema,
        key: `tuple-fill-${Math.random().toString(36).slice(2)}`,
        defaultValues: { coords: initial },
      })
      return () => h('div')
    },
  })
  const app = createApp(Probe)
  app.use(createChemicalXForms())
  app.mount(document.createElement('div'))
  return { app, form: captured }
}

describe('setValue — tuple intermediate positions fill with schema position defaults', () => {
  const apps: App[] = []
  afterEach(() => {
    while (apps.length > 0) apps.pop()?.unmount()
  })

  it('writing to coords.2 with only coords.0 set fills coords.1 with the position default', () => {
    // Force a structural gap: tuple starts with only index 0.
    const { app, form } = tupleHarness([42] as unknown as TupleForm['coords'])
    apps.push(app)

    form.setValue('coords.2', 99)

    // Index 1 should be the schema's position-1 default (0), not undefined.
    expect(form.getValue('coords').value).toEqual([42, 0, 99])
  })
})

/**
 * Reset confirmation. `reset()` should produce a structurally-complete
 * state per the schema — the same invariant. Probably already works
 * today (reset rebuilds via `getDefaultValues`), but worth pinning so
 * any future churn that bypasses the schema-default pipeline regresses
 * a test rather than slipping through.
 */
describe('reset / resetField — structural completeness preserved', () => {
  const apps: App[] = []
  afterEach(() => {
    while (apps.length > 0) apps.pop()?.unmount()
  })

  it('reset() returns the form to a structurally-complete state', () => {
    const { app, form } = harness([
      { name: 'Alice', age: 25 },
      { name: 'Bob', age: 28 },
    ])
    apps.push(app)

    // Mutate into a state that may be schema-incomplete (depending on
    // how the regression fix above lands — currently this leaves
    // intermediate undefineds).
    form.setValue('people.5', { name: 'Carol', age: 30 })

    // Reset should wipe back to the original defaults — no leftover
    // schema-incomplete shape from the prior write.
    form.reset()

    expect(form.getValue('people').value).toEqual([
      { name: 'Alice', age: 25 },
      { name: 'Bob', age: 28 },
    ])
  })

  it('resetField on an array path returns to the schema-default for that path', () => {
    const { app, form } = harness([
      { name: 'Alice', age: 25 },
      { name: 'Bob', age: 28 },
    ])
    apps.push(app)

    form.setValue('people.0.name', 'Mutated')
    form.resetField('people')

    expect(form.getValue('people').value).toEqual([
      { name: 'Alice', age: 25 },
      { name: 'Bob', age: 28 },
    ])
  })
})

describe('setValue — partial value writes are filled with schema defaults', () => {
  const apps: App[] = []
  afterEach(() => {
    while (apps.length > 0) apps.pop()?.unmount()
  })

  it('writing a partial array element via the value form fills missing fields', () => {
    const { app, form } = harness([])
    apps.push(app)

    // The cast forces the type checker to allow the partial; at runtime
    // the lib should fill `age` from the schema default.
    form.setValue('people', [{ name: 'Alice' } as Form['people'][number]])

    expect(form.getValue('people').value).toEqual([{ name: 'Alice', age: 0 }])
  })

  it('writing a partial object via the value form fills missing fields', () => {
    const { app, form } = profileHarness({})
    apps.push(app)

    form.setValue('user.profile', { name: 'Carol' } as ProfileForm['user']['profile'])

    expect(form.getValue('user.profile').value).toEqual({
      name: 'Carol',
      age: 0,
      bio: '',
    })
  })
})
