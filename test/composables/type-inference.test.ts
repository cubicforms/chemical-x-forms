import { describe, expectTypeOf, it } from 'vitest'
import { z } from 'zod'
import type { FormState } from '../../src'
import type { useForm } from '../../src/zod'
import type { WithIndexedUndefined } from '../../src/runtime/types/types-core'

/**
 * Type-inference tests for `useForm` via the Zod v4 adapter.
 *
 * These assertions run at typecheck time: the file only compiles if
 * every inferred type matches the expectation. Catches silent inference
 * regressions — e.g. a refactor to FlatPath/NestedType that widens a
 * leaf to `any`, or a wrapper-layer generic that drops z.output<Schema>
 * along the way — long before a consumer reports "my IDE stopped
 * suggesting field names".
 *
 * Structure: one describe block per public API method. Uses vitest's
 * `expectTypeOf` (stable in v3+) plus `@ts-expect-error` for the
 * negative cases where a compile error IS the success signal.
 *
 * The useForm composable depends on a Vue app context at runtime, so we
 * only reference its TYPE here via `declare const form: ReturnType<...>`
 * — the file never calls useForm, so vitest can load it without a
 * mounted Vue app.
 */

const schema = z.object({
  email: z.string(),
  age: z.number(),
  active: z.boolean(),
  profile: z.object({
    name: z.string(),
    bio: z.string().optional(),
  }),
  tags: z.array(z.string()),
  posts: z.array(
    z.object({
      title: z.string(),
      views: z.number(),
    })
  ),
})

type Schema = typeof schema

type ExpectedForm = {
  email: string
  age: number
  active: boolean
  profile: { name: string; bio?: string | undefined }
  tags: string[]
  posts: { title: string; views: number }[]
}

// The public factory's return type — what a consumer sees when they call
// `useForm({ schema, key })`. We bind the generic to our Schema to
// exercise the full inference pipeline (Schema → z.output<Schema> →
// Form → FlatPath/NestedType).
type Form = ReturnType<typeof useForm<Schema>>

// The public factory's *parameter* type — used to test the type-level
// requirement on `key` without actually invoking useForm at runtime.
type UseFormOptions = Parameters<typeof useForm<Schema>>[0]

// `expectTypeOf` evaluates its argument at runtime even though it only
// cares about the type. We can't call the real `useForm` here (no Vue
// app context), so we fake a `form` whose property/method access never
// crashes. A recursive Proxy returns itself for every get/apply, which
// is enough to keep vitest's runtime happy — only the static types the
// checker sees matter.
const form: Form = (() => {
  const handler: ProxyHandler<() => unknown> = {
    get: () => proxy,
    apply: () => proxy,
  }
  const proxy: unknown = new Proxy(() => undefined, handler)
  return proxy as Form
})()

describe('useForm type inference — factory signature', () => {
  it('accepts `key` as optional for anonymous forms', () => {
    // Post-0.8.3: `key` is optional. Omitted keys resolve to a
    // collision-free synthetic id via Vue's `useId()` at runtime, so
    // a config without `key` must typecheck cleanly.
    const anonymousConfig: UseFormOptions = { schema }
    void anonymousConfig

    // Explicit keys still typecheck — the string form is required
    // when supplied (not `FormKey | undefined`).
    const namedConfig: UseFormOptions = { schema, key: 'test' }
    void namedConfig

    // `schema` remains required — omitting it should still fail.
    // @ts-expect-error - missing required `schema`
    const missingSchemaConfig: UseFormOptions = { key: 'test' }
    void missingSchemaConfig
  })

  it('returns the inferred Form shape on form.values (with array taint)', () => {
    // `form.values` is a Pinia-style readonly proxy over the form
    // wrapped in `WithIndexedUndefined` — `values.tags[N]` etc. is
    // `string | undefined` since arrays can be out-of-bounds at runtime.
    expectTypeOf(form.values).toEqualTypeOf<Readonly<WithIndexedUndefined<ExpectedForm>>>()
  })
})

describe('useForm type inference — form.values', () => {
  it('scalar leaf is the leaf type directly (no Ref)', () => {
    expectTypeOf(form.values.email).toEqualTypeOf<string>()
    expectTypeOf(form.values.age).toEqualTypeOf<number>()
    expectTypeOf(form.values.active).toEqualTypeOf<boolean>()
  })

  it('nested object descent', () => {
    expectTypeOf(form.values.profile.name).toEqualTypeOf<string>()
  })

  it('optional nested field preserves `| undefined`', () => {
    expectTypeOf(form.values.profile.bio).toEqualTypeOf<string | undefined>()
  })

  it('array index is undefined-tainted (out-of-bounds is honest)', () => {
    // Numeric index access through a Vue readonly array proxy returns
    // `T | undefined` — same honesty pass.
    expectTypeOf(form.values.tags[0]).toEqualTypeOf<string | undefined>()
  })

  it('array-of-object nested path (posts[N].field) is tainted past the array boundary', () => {
    expectTypeOf(form.values.posts[0]?.title).toEqualTypeOf<string | undefined>()
    expectTypeOf(form.values.posts[0]?.views).toEqualTypeOf<number | undefined>()
  })
})

describe('useForm type inference — setValue', () => {
  it('accepts values that match the path leaf type', () => {
    form.setValue('email', 'alice@example.com')
    form.setValue('age', 30)
    form.setValue('active', true)
    form.setValue('profile.name', 'alice')
    form.setValue('tags.0', 'first-tag')
    form.setValue('posts.0.views', 42)
  })

  it('rejects values whose type does not match the path leaf', () => {
    // @ts-expect-error - email is string, not number
    form.setValue('email', 123)
    // @ts-expect-error - age is number, not string
    form.setValue('age', '30')
    // @ts-expect-error - posts.0.views is number
    form.setValue('posts.0.views', 'not a number')
    // @ts-expect-error - profile.name is string
    form.setValue('profile.name', { nested: 'object' })
  })

  it('rejects invalid paths', () => {
    // @ts-expect-error - path not in schema
    form.setValue('missing', 'x')
  })

  it('accepts callbacks whose signature matches the path leaf', () => {
    form.setValue('email', (prev) => prev + '!')
    form.setValue('age', (prev) => prev + 1)
    form.setValue('active', (prev) => !prev)
    form.setValue('profile.name', (prev) => prev.trim())
    form.setValue('tags.0', (prev) => prev.toUpperCase())
    form.setValue('posts.0.views', (prev) => prev + 1)
    // Whole-form callback: receives DeepPartial<Form>, returns same.
    form.setValue((prev) => ({ ...prev, email: 'z@z.z' }))
  })

  it('rejects callbacks whose return type does not match the path leaf', () => {
    // @ts-expect-error - email is string, callback returns number
    form.setValue('email', () => 123)
    // @ts-expect-error - age is number, callback returns string
    form.setValue('age', () => '30')
    // @ts-expect-error - whole-form callback must return an object, not a string
    form.setValue(() => 'not an object')
  })
})

describe('useForm type inference — register', () => {
  it('non-array paths are STRICT — register returns the leaf type without taint', () => {
    // Phase 4: register read shape is now `NestedReadType<Form, Path>`.
    // Paths that don't cross a numeric segment stay strict — runtime
    // structural-completeness guarantees the slot is populated.
    const r = form.register('email')
    expectTypeOf(r.innerRef.value).toEqualTypeOf<string>()
  })

  it('nested object path stays strict (no array crossing)', () => {
    const r = form.register('profile.name')
    expectTypeOf(r.innerRef.value).toEqualTypeOf<string>()
  })

  it('array-index nested path is undefined-tainted (out-of-bounds at runtime)', () => {
    const r = form.register('posts.0.title')
    expectTypeOf(r.innerRef.value).toEqualTypeOf<string | undefined>()
  })
})

describe('Phase 4: WithIndexedUndefined + strict SetValuePayload', () => {
  it('whole-form callback prev sees array elements as `T | undefined`', () => {
    form.setValue((prev) => {
      // Array index reads are honestly tainted. `prev.posts[5]` could
      // be out-of-bounds at runtime, so the type must include undefined.
      expectTypeOf(prev.posts[5]).toEqualTypeOf<{ title: string; views: number } | undefined>()
      expectTypeOf(prev.tags[0]).toEqualTypeOf<string | undefined>()
      // Non-array properties remain strict.
      expectTypeOf(prev.email).toEqualTypeOf<string>()
      // Spread is fine — the return type matches the read shape and
      // mergeStructural fills any structural gaps at the runtime layer.
      return { ...prev, email: 'updated@example.com' }
    })
  })

  it('path-form callback prev is STRICT (runtime auto-defaults)', () => {
    // The runtime hands the consumer the schema default at the path
    // when the slot is unpopulated, so prev is genuinely populated —
    // strict NestedType (not undefined-tainted) is honest.
    form.setValue('posts.0', (prev) => {
      expectTypeOf(prev).toEqualTypeOf<{ title: string; views: number }>()
      // No `?.` or fallback needed — `prev.title` is `string`, not
      // `string | undefined`.
      return { ...prev, title: prev.title.toUpperCase() }
    })
  })

  it('value form is STRICT — drops DeepPartial', () => {
    // Phase 4 dropped `DeepPartial<Payload>` from `SetValuePayload`. A
    // partial object at a strict path is now a TYPE ERROR; consumers
    // either provide the complete shape or use the callback form. The
    // runtime mergeStructural still fills any gaps that slip through
    // via casts.
    form.setValue('profile.name', 'alice')
    // @ts-expect-error - profile requires { name, bio? }; partial wrong-shape rejected.
    form.setValue('profile', { unknown: 'field' })
  })

  it('register read shape uses NestedReadType — taint after numeric segment', () => {
    // Path doesn't cross a numeric segment.
    expectTypeOf(form.register('email').innerRef.value).toEqualTypeOf<string>()
    // Path crosses a numeric segment ('0').
    expectTypeOf(form.register('posts.0.title').innerRef.value).toEqualTypeOf<string | undefined>()
    // Bare array element path.
    expectTypeOf(form.register('tags.0').innerRef.value).toEqualTypeOf<string | undefined>()
  })
})

describe('useForm type inference — primitive-array register paths', () => {
  // Multi-select / multi-checkbox bindings register at the array root.
  // The directive accepts arrays of any slim primitive (string, number,
  // boolean, bigint), so the type must allow root registration on each.
  const _multiSchema = z.object({
    multiStrings: z.array(z.string()),
    multiNumbers: z.array(z.number()),
    multiBooleans: z.array(z.boolean()),
    multiBigints: z.array(z.bigint()),
  })
  type MultiForm = ReturnType<typeof useForm<typeof _multiSchema>>
  const multiForm = (() => {
    const handler: ProxyHandler<() => unknown> = { get: () => proxy, apply: () => proxy }
    const proxy: unknown = new Proxy(() => undefined, handler)
    return proxy as MultiForm
  })()

  it('register accepts the array root for every primitive item type', () => {
    expectTypeOf(multiForm.register('multiStrings').innerRef.value).toEqualTypeOf<string[]>()
    expectTypeOf(multiForm.register('multiNumbers').innerRef.value).toEqualTypeOf<number[]>()
    expectTypeOf(multiForm.register('multiBooleans').innerRef.value).toEqualTypeOf<boolean[]>()
    expectTypeOf(multiForm.register('multiBigints').innerRef.value).toEqualTypeOf<bigint[]>()
  })

  it('register accepts indexed positions on every primitive array', () => {
    expectTypeOf(multiForm.register('multiStrings.0').innerRef.value).toEqualTypeOf<
      string | undefined
    >()
    expectTypeOf(multiForm.register('multiNumbers.0').innerRef.value).toEqualTypeOf<
      number | undefined
    >()
    expectTypeOf(multiForm.register('multiBooleans.0').innerRef.value).toEqualTypeOf<
      boolean | undefined
    >()
    expectTypeOf(multiForm.register('multiBigints.0').innerRef.value).toEqualTypeOf<
      bigint | undefined
    >()
  })
})

describe('useForm type inference — handleSubmit', () => {
  it('callback `values` parameter is the fully inferred Form', () => {
    form.handleSubmit((values) => {
      expectTypeOf(values).toEqualTypeOf<ExpectedForm>()
    })
  })

  it('callback return type may be void or Promise<void>', () => {
    form.handleSubmit(() => {})
    form.handleSubmit(async () => {
      await Promise.resolve()
    })
  })

  it('returns a SubmitHandler (function) rather than a Promise', () => {
    const handler = form.handleSubmit(() => {})
    expectTypeOf(handler).toMatchTypeOf<(event?: Event) => Promise<void>>()
  })
})

describe('useForm type inference — fields + errors', () => {
  it('form.fields exposes a typed errors array on each path', () => {
    expectTypeOf(form.fields.email.errors).toMatchTypeOf<ReadonlyArray<{ message: string }>>()
  })

  it('form.errors is a Readonly<FormFieldErrors<Form>> (Proxy view, no .value)', () => {
    // Internally backed by a ComputedRef + Proxy; the public type is
    // the unwrapped record so templates can dot-access without `.value`.
    expectTypeOf(form.errors).toMatchTypeOf<Record<string, unknown>>()
    // @ts-expect-error — errors is not a Ref, so `.value` is gone.
    void form.errors.value
  })
})

describe('useForm type inference — form-level state bundle', () => {
  it('`state` matches the exported `FormState` shape exactly', () => {
    // Pins the whole-bundle contract: any future refactor that drops a
    // field, re-widens a type, or loses the auto-unwrap (re-exposing a
    // Ref/ComputedRef at a leaf) fails this assertion at compile time.
    expectTypeOf(form.state).toEqualTypeOf<FormState>()
  })

  it('scalar leaves are primitives, not Refs', () => {
    // These are the 9 fields that used to live at the top level as
    // `Readonly<ComputedRef<X>>`. Inside reactive() they auto-unwrap
    // on access — so the template footgun (binding to the wrapper
    // object instead of its .value) is gone at the type level too.
    expectTypeOf(form.state.isDirty).toEqualTypeOf<boolean>()
    expectTypeOf(form.state.isValid).toEqualTypeOf<boolean>()
    expectTypeOf(form.state.isSubmitting).toEqualTypeOf<boolean>()
    expectTypeOf(form.state.isValidating).toEqualTypeOf<boolean>()
    expectTypeOf(form.state.submitCount).toEqualTypeOf<number>()
    expectTypeOf(form.state.submitError).toEqualTypeOf<unknown>()
    expectTypeOf(form.state.canUndo).toEqualTypeOf<boolean>()
    expectTypeOf(form.state.canRedo).toEqualTypeOf<boolean>()
    expectTypeOf(form.state.historySize).toEqualTypeOf<number>()
  })

  it('rejects writes (state is readonly at the type level)', () => {
    // @ts-expect-error — state is readonly; prefer setValue / handleSubmit
    form.state.isSubmitting = true
    // @ts-expect-error — same for counters
    form.state.submitCount = 5
  })

  it('rejects unknown keys', () => {
    // @ts-expect-error — `foo` is not a FormState key
    void form.state.foo
  })
})

describe('useForm type inference — field array helpers', () => {
  it('append accepts only array paths with a matching item shape', () => {
    form.append('tags', 'a-tag')
    form.append('posts', { title: 't', views: 1 })
  })

  it('append rejects non-array paths', () => {
    // @ts-expect-error - email is a string, not an array
    form.append('email', 'x')
    // @ts-expect-error - profile is an object, not an array
    form.append('profile', { name: 'n', bio: 'b' })
  })

  it('append rejects mismatched item shapes', () => {
    // @ts-expect-error - tags expects string, not number
    form.append('tags', 42)
    // @ts-expect-error - posts expects { title; views }, not a bare string
    form.append('posts', 'not an object')
    // @ts-expect-error - post shape is missing `views`
    form.append('posts', { title: 't' })
  })

  it('insert / replace enforce the same item shape + accept number index', () => {
    form.insert('tags', 0, 'new')
    form.replace('posts', 1, { title: 't', views: 3 })
    // @ts-expect-error - string index not allowed
    form.insert('tags', 'first', 'new')
  })

  it('remove / swap / move operate purely on numeric indices', () => {
    form.remove('tags', 0)
    form.swap('posts', 0, 1)
    form.move('tags', 0, 2)
    // @ts-expect-error - remove doesn't accept a value argument
    form.remove('tags', 0, 'extra')
  })
})

describe('useForm type inference — reset / resetField', () => {
  it('reset accepts no args or a DeepPartial<Form>', () => {
    form.reset()
    form.reset({})
    form.reset({ email: 'x@y' })
    form.reset({ profile: { name: 'alice' } })
  })

  it('reset rejects values whose shape does not match the form', () => {
    // @ts-expect-error - 'email' must be a string
    form.reset({ email: 123 })
    // @ts-expect-error - 'nope' is not a known key
    form.reset({ nope: 'x' })
  })

  it('resetField accepts a known leaf path', () => {
    form.resetField('email')
    form.resetField('profile.name')
    form.resetField('profile.bio')
    form.resetField('tags.0')
    form.resetField('posts.0.title')
  })

  it('resetField accepts a nested-container path', () => {
    form.resetField('profile')
  })

  it('resetField rejects unknown paths', () => {
    // @ts-expect-error - 'nope' is not a known path
    form.resetField('nope')
    // @ts-expect-error - 'profile.bogus' is not known
    form.resetField('profile.bogus')
  })
})
