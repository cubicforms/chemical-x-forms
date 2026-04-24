import { describe, expectTypeOf, it } from 'vitest'
import { z } from 'zod'
import type { ComputedRef, Ref } from 'vue'
import type { useForm } from '../../src/zod'

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

  it('returns the inferred Form shape at the top-level getValue()', () => {
    const whole = form.getValue()
    expectTypeOf(whole.value).toEqualTypeOf<ExpectedForm>()
  })
})

describe('useForm type inference — getValue', () => {
  it('scalar leaf path → Readonly<Ref<leaf type>>', () => {
    expectTypeOf(form.getValue('email')).toEqualTypeOf<Readonly<Ref<string>>>()
    expectTypeOf(form.getValue('age')).toEqualTypeOf<Readonly<Ref<number>>>()
    expectTypeOf(form.getValue('active')).toEqualTypeOf<Readonly<Ref<boolean>>>()
  })

  it('nested object path', () => {
    expectTypeOf(form.getValue('profile.name')).toEqualTypeOf<Readonly<Ref<string>>>()
  })

  it('optional nested field preserves `| undefined`', () => {
    expectTypeOf(form.getValue('profile.bio')).toEqualTypeOf<Readonly<Ref<string | undefined>>>()
  })

  it('array index path', () => {
    expectTypeOf(form.getValue('tags.0')).toEqualTypeOf<Readonly<Ref<string>>>()
  })

  it('array-of-object nested path (posts.N.field)', () => {
    expectTypeOf(form.getValue('posts.0.title')).toEqualTypeOf<Readonly<Ref<string>>>()
    expectTypeOf(form.getValue('posts.0.views')).toEqualTypeOf<Readonly<Ref<number>>>()
  })

  it('rejects paths not present in the schema', () => {
    // @ts-expect-error - 'nope' is not a top-level key
    form.getValue('nope')
    // @ts-expect-error - 'profile.nonexistent' not in profile shape
    form.getValue('profile.nonexistent')
    // @ts-expect-error - 'posts.0.bad' not on the post shape
    form.getValue('posts.0.bad')
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
})

describe('useForm type inference — register', () => {
  it('innerRef is typed as `| undefined` of the path leaf', () => {
    const r = form.register('email')
    expectTypeOf(r.innerRef.value).toEqualTypeOf<string | undefined>()
  })

  it('nested object path', () => {
    const r = form.register('profile.name')
    expectTypeOf(r.innerRef.value).toEqualTypeOf<string | undefined>()
  })

  it('array-index nested path', () => {
    const r = form.register('posts.0.title')
    expectTypeOf(r.innerRef.value).toEqualTypeOf<string | undefined>()
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

describe('useForm type inference — getFieldState + fieldErrors', () => {
  it('getFieldState returns a Ref<FieldState> with a typed errors array', () => {
    const fs = form.getFieldState('email')
    expectTypeOf(fs.value.errors).toMatchTypeOf<ReadonlyArray<{ message: string }>>()
  })

  it('fieldErrors is a ComputedRef<FormErrorRecord>', () => {
    expectTypeOf(form.fieldErrors.value).toMatchTypeOf<Record<string, unknown>>()
  })
})

describe('useForm type inference — form-level aggregates', () => {
  it('isDirty is a Readonly<ComputedRef<boolean>>', () => {
    expectTypeOf(form.isDirty).toEqualTypeOf<Readonly<ComputedRef<boolean>>>()
    expectTypeOf(form.isDirty.value).toEqualTypeOf<boolean>()
  })

  it('isValid is a Readonly<ComputedRef<boolean>>', () => {
    expectTypeOf(form.isValid).toEqualTypeOf<Readonly<ComputedRef<boolean>>>()
    expectTypeOf(form.isValid.value).toEqualTypeOf<boolean>()
  })
})

describe('useForm type inference — submission lifecycle', () => {
  it('isSubmitting is a Readonly<ComputedRef<boolean>>', () => {
    expectTypeOf(form.isSubmitting).toEqualTypeOf<Readonly<ComputedRef<boolean>>>()
    expectTypeOf(form.isSubmitting.value).toEqualTypeOf<boolean>()
  })

  it('submitCount is a Readonly<ComputedRef<number>>', () => {
    expectTypeOf(form.submitCount).toEqualTypeOf<Readonly<ComputedRef<number>>>()
    expectTypeOf(form.submitCount.value).toEqualTypeOf<number>()
  })

  it('submitError is a Readonly<ComputedRef<unknown>>', () => {
    expectTypeOf(form.submitError).toEqualTypeOf<Readonly<ComputedRef<unknown>>>()
    expectTypeOf(form.submitError.value).toEqualTypeOf<unknown>()
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
