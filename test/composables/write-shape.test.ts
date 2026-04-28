import { describe, expectTypeOf, it } from 'vitest'
import { z } from 'zod'
import type { useForm } from '../../src/zod'
import type { WriteShape } from '../../src/runtime/types/types-core'

/**
 * `expectTypeOf` evaluates its argument at runtime even though it only
 * cares about the type. We can't call the real `useForm` here (no Vue
 * app context), so we fake a recursive Proxy that returns itself for
 * every get/apply — enough to keep vitest's runtime happy while the
 * checker sees the real types.
 */
function makeFormProxy<T>(): T {
  const handler: ProxyHandler<() => unknown> = {
    get: () => proxy,
    apply: () => proxy,
  }
  const proxy: unknown = new Proxy(() => undefined, handler)
  return proxy as T
}

/**
 * Compile-time tests for `WriteShape<T>` and its application to the
 * public API surface. These assertions run at typecheck time: the
 * file only compiles if every inferred type matches the expectation.
 *
 * `WriteShape` widens primitive-literal leaves to their primitive
 * supertype to match the runtime "slim-primitive write contract."
 * The TS layer becomes honest about what's storable — refinement-
 * invalid values that satisfy the slim primitive type pass through
 * everywhere (defaults, setValue, getValue) without TS errors.
 *
 * Read-side post-validation types (handleSubmit's `data` argument,
 * validate*() result payloads) intentionally stay STRICT.
 */

describe('WriteShape — primitive-literal widening', () => {
  it('widens string-literal unions to string', () => {
    expectTypeOf<WriteShape<'red' | 'green' | 'blue'>>().toEqualTypeOf<string>()
  })

  it('widens single string-literal to string', () => {
    expectTypeOf<WriteShape<'on'>>().toEqualTypeOf<string>()
  })

  it('widens number-literal to number', () => {
    expectTypeOf<WriteShape<42>>().toEqualTypeOf<number>()
  })

  it('widens number-literal unions to number', () => {
    expectTypeOf<WriteShape<1 | 2 | 3>>().toEqualTypeOf<number>()
  })

  it('widens boolean true/false to boolean', () => {
    expectTypeOf<WriteShape<true>>().toEqualTypeOf<boolean>()
    expectTypeOf<WriteShape<false>>().toEqualTypeOf<boolean>()
  })

  it('mixed primitive-literal union widens to primitive supertypes', () => {
    expectTypeOf<WriteShape<'a' | 1>>().toEqualTypeOf<string | number>()
  })

  it('null/undefined pass through', () => {
    expectTypeOf<WriteShape<null>>().toEqualTypeOf<null>()
    expectTypeOf<WriteShape<undefined>>().toEqualTypeOf<undefined>()
  })

  it('Date pass through', () => {
    expectTypeOf<WriteShape<Date>>().toEqualTypeOf<Date>()
  })
})

describe('WriteShape — composites', () => {
  it('widens object property leaves', () => {
    type R = WriteShape<{ color: 'red' | 'green'; name: string }>
    expectTypeOf<R>().toEqualTypeOf<{ color: string; name: string }>()
  })

  it('recurses into nested objects', () => {
    type R = WriteShape<{ user: { kind: 'admin' | 'guest'; age: 42 } }>
    expectTypeOf<R>().toEqualTypeOf<{ user: { kind: string; age: number } }>()
  })

  it('preserves tuple positions, widens elements', () => {
    type R = WriteShape<['red' | 'green', 42]>
    expectTypeOf<R>().toEqualTypeOf<[string, number]>()
  })

  it('widens unbounded array element types', () => {
    type R = WriteShape<Array<'a' | 'b'>>
    expectTypeOf<R>().toEqualTypeOf<Array<string>>()
  })

  it('preserves Date / RegExp at object leaves', () => {
    type R = WriteShape<{ at: Date }>
    expectTypeOf<R>().toEqualTypeOf<{ at: Date }>()
  })
})

const _setValueSchema = z.object({
  color: z.enum(['red', 'green', 'blue']),
  age: z.number().int(),
  email: z.string().email(),
})
const setValueForm = makeFormProxy<ReturnType<typeof useForm<typeof _setValueSchema>>>()

describe('WriteShape — applied to setValue', () => {
  const form = setValueForm

  it('setValue accepts any string at an enum-typed path', () => {
    // Pre-WriteShape: this would be a TS error because 'magenta' isn't
    // in the enum. Post-WriteShape: the slim type is `string`, so any
    // string is accepted at the type level. Runtime validates at the
    // refinement level via field validation.
    expectTypeOf(form.setValue<'color', string>)
      .parameter(1)
      .toEqualTypeOf<string>()
  })

  it('setValue accepts any number at an int-typed path', () => {
    expectTypeOf(form.setValue<'age', number>)
      .parameter(1)
      .toEqualTypeOf<number>()
  })

  it('setValue rejects a number at a string-typed path (compile error)', () => {
    // @ts-expect-error: number is not assignable to string at this path
    form.setValue('color', 1)
  })

  it('setValue rejects an object at a primitive path', () => {
    // @ts-expect-error: object is not assignable to string at this path
    form.setValue('color', {})
  })
})

describe('WriteShape — applied to defaultValues', () => {
  it('refinement-invalid string defaults are accepted', () => {
    const _schema = z.object({ color: z.enum(['red', 'green', 'blue']) })
    type Defaults = Parameters<typeof useForm<typeof _schema>>[0]['defaultValues']

    // 'teal' is not in the enum, but it's a string — slim-correct.
    expectTypeOf<{ color: 'teal' }>().toMatchTypeOf<NonNullable<Defaults>>()
  })

  it('wrong-primitive defaults are TS errors (compile error)', () => {
    const _schema = z.object({ color: z.enum(['red', 'green', 'blue']) })
    type Defaults = Parameters<typeof useForm<typeof _schema>>[0]['defaultValues']

    // @ts-expect-error: number is not a string — slim-mismatch
    const _bad: Defaults = { color: 1 }
    void _bad
  })
})

const _submitSchema = z.object({ color: z.enum(['red', 'green', 'blue']) })
const _submitForm = makeFormProxy<ReturnType<typeof useForm<typeof _submitSchema>>>()

describe('WriteShape — handleSubmit stays strict', () => {
  it('handleSubmit data is the strict zod-output type, not WriteShape', () => {
    type SubmitArg = Parameters<Parameters<typeof _submitForm.handleSubmit>[0]>[0]

    // Post-validation type: STRICT. The submit callback only fires
    // when validation succeeded, so 'magenta' is impossible there.
    expectTypeOf<SubmitArg>().toEqualTypeOf<{ color: 'red' | 'green' | 'blue' }>()
  })
})

const _readSchema = z.object({
  color: z.enum(['red', 'green', 'blue']),
  age: z.number().int(),
  email: z.string().email(),
})
const _readForm = makeFormProxy<ReturnType<typeof useForm<typeof _readSchema>>>()

/**
 * Read-side widening: storage holds slim-primitive-correct values
 * under the write contract, so reads must reflect that. `getValue`,
 * `getFieldState(...).value.currentValue`, and `register(path).innerRef`
 * all widen leaves to the slim primitive type. Strict post-validation
 * shapes only appear on `handleSubmit` / `validate*()`.
 */
describe('WriteShape — applied to getValue', () => {
  it('getValue at an enum-typed path returns Ref<string>', () => {
    // The store can hold `'teal'` (refinement-invalid but slim-correct);
    // the read type must admit it. Pre-widen this was Ref<'red'|'green'|'blue'>.
    const ref = _readForm.getValue('color')
    expectTypeOf(ref.value).toEqualTypeOf<string>()
  })

  it('getValue at an int-typed path returns Ref<number>', () => {
    const ref = _readForm.getValue('age')
    expectTypeOf(ref.value).toEqualTypeOf<number>()
  })

  it('getValue at the email path returns Ref<string>', () => {
    const ref = _readForm.getValue('email')
    expectTypeOf(ref.value).toEqualTypeOf<string>()
  })

  it('getValue() (whole-form) widens every leaf', () => {
    const ref = _readForm.getValue()
    expectTypeOf(ref.value).toEqualTypeOf<{
      color: string
      age: number
      email: string
    }>()
  })
})

describe('WriteShape — applied to getFieldState', () => {
  it('getFieldState at an enum-typed path narrows currentValue/originalValue/previousValue to string', () => {
    const fieldStateRef = _readForm.getFieldState('color')
    expectTypeOf(fieldStateRef.value.currentValue).toEqualTypeOf<string>()
    expectTypeOf(fieldStateRef.value.originalValue).toEqualTypeOf<string>()
    expectTypeOf(fieldStateRef.value.previousValue).toEqualTypeOf<string>()
  })

  it('getFieldState metadata stays untouched (errors / dirty / pristine / focused)', () => {
    const fieldStateRef = _readForm.getFieldState('color')
    expectTypeOf(fieldStateRef.value.dirty).toEqualTypeOf<boolean>()
    expectTypeOf(fieldStateRef.value.pristine).toEqualTypeOf<boolean>()
    expectTypeOf(fieldStateRef.value.focused).toEqualTypeOf<boolean | null>()
  })
})

describe('WriteShape — applied to register', () => {
  it("register(path).innerRef widens the path's leaf type", () => {
    const reg = _readForm.register('color')
    expectTypeOf(reg.innerRef.value).toEqualTypeOf<string>()
  })
})
