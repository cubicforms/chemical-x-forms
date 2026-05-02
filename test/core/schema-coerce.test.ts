import { describe, expect, it, vi, afterEach } from 'vitest'
import { z } from 'zod'
import { zodV4Adapter } from '../../src/runtime/adapters/zod-v4/adapter'
import {
  IDENTITY,
  buildCoerceFn,
  defaultCoercionRules,
  defineCoercion,
  resolveCoercionIndex,
} from '../../src/runtime/core/schema-coerce'
import type { CoercionRegistry, AbstractSchema } from '../../src/runtime/types/types-api'

/**
 * Unit tests for the schema-coerce module — the registry, the index
 * projection, the per-path closure, and the dispatch + post-validate
 * defenses. These cases run without DOM; the matching DOM-flow
 * integration coverage is in `test/composables/coerce.test.ts`.
 */

function adapter(schema: z.ZodObject): AbstractSchema<unknown, unknown> {
  return zodV4Adapter(schema)('f') as unknown as AbstractSchema<unknown, unknown>
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('resolveCoercionIndex', () => {
  it('boolean true → indexed defaults', () => {
    const idx = resolveCoercionIndex(true)
    expect(idx.has('string->number')).toBe(true)
    expect(idx.has('string->boolean')).toBe(true)
    expect(idx.size).toBe(2)
  })

  it('undefined → indexed defaults', () => {
    const idx = resolveCoercionIndex(undefined)
    expect(idx.size).toBe(2)
  })

  it('boolean false → empty index (reference-equal singleton)', () => {
    const a = resolveCoercionIndex(false)
    const b = resolveCoercionIndex(false)
    expect(a).toBe(b)
    expect(a.size).toBe(0)
  })

  it('custom registry → indexed', () => {
    const custom: CoercionRegistry = [
      defineCoercion({
        input: 'string',
        output: 'number',
        transform: (s) => ({ coerced: true, value: parseInt(s, 10) }),
      }),
    ]
    const idx = resolveCoercionIndex(custom)
    expect(idx.size).toBe(1)
    expect(idx.has('string->number')).toBe(true)
    expect(idx.has('string->boolean')).toBe(false)
  })
})

describe('buildCoerceFn', () => {
  it('with empty index → IDENTITY singleton', () => {
    const schema = adapter(z.object({ x: z.number() }))
    const fn = buildCoerceFn(schema, ['x'], resolveCoercionIndex(false))
    expect(fn).toBe(IDENTITY)
  })

  it('returns identity for an unresolvable path (empty accept set)', () => {
    const schema = adapter(z.object({ x: z.number() }))
    const fn = buildCoerceFn(schema, ['unknown'], resolveCoercionIndex(true))
    expect(fn('25')).toBe('25')
  })
})

describe('defaultCoercionRules — registry shape', () => {
  it('contains exactly the two built-in entries', () => {
    expect(defaultCoercionRules).toHaveLength(2)
    const keys = defaultCoercionRules.map((e) => `${e.input}->${e.output}`).sort()
    expect(keys).toEqual(['string->boolean', 'string->number'])
  })
})

describe('defineCoercion — runtime identity', () => {
  it('returns the entry it was given', () => {
    const entry = defineCoercion({
      input: 'string',
      output: 'number',
      transform: () => ({ coerced: false }),
    })
    expect(defineCoercion(entry)).toBe(entry)
  })
})

describe('numeric scalar coercion', () => {
  const idx = resolveCoercionIndex(true)
  const schema = adapter(z.object({ age: z.number() }))
  const fn = buildCoerceFn(schema, ['age'], idx)

  it("'25' → 25", () => {
    expect(fn('25')).toBe(25)
  })

  it("'25.5' → 25.5", () => {
    expect(fn('25.5')).toBe(25.5)
  })

  it("'' → '' (NOT 0 — empty string passthrough)", () => {
    expect(fn('')).toBe('')
  })

  it("'   ' (whitespace-only) → passthrough (NOT 0)", () => {
    // Without the trim-then-empty guard, `Number('  ')` is 0 and
    // would slip past the empty-string check. Trim normalises to
    // '' which the rule rejects.
    expect(fn('   ')).toBe('   ')
  })

  it("'  25  ' (padded) → 25 (whitespace tolerated)", () => {
    expect(fn('  25  ')).toBe(25)
  })

  it("'abc' → 'abc' (passthrough; gate decides)", () => {
    expect(fn('abc')).toBe('abc')
  })

  it("'1e309' (overflow) → passthrough", () => {
    expect(fn('1e309')).toBe('1e309')
  })

  it('already-number → no-op (returns same value)', () => {
    expect(fn(42)).toBe(42)
  })

  it('null → passthrough on z.number().nullable()', () => {
    const nullSchema = adapter(z.object({ age: z.number().nullable() }))
    const nullFn = buildCoerceFn(nullSchema, ['age'], idx)
    expect(nullFn(null)).toBe(null)
  })
})

describe('boolean scalar coercion', () => {
  const idx = resolveCoercionIndex(true)
  const schema = adapter(z.object({ active: z.boolean() }))
  const fn = buildCoerceFn(schema, ['active'], idx)

  it("'true' → true", () => {
    expect(fn('true')).toBe(true)
  })

  it("'false' → false", () => {
    expect(fn('false')).toBe(false)
  })

  it("'True' / 'TRUE' / 'False' (case-insensitive)", () => {
    expect(fn('True')).toBe(true)
    expect(fn('TRUE')).toBe(true)
    expect(fn('False')).toBe(false)
    expect(fn('FALSE')).toBe(false)
  })

  it("'  true  ' (padded) → true (whitespace tolerated)", () => {
    expect(fn('  true  ')).toBe(true)
    expect(fn('  False  ')).toBe(false)
  })

  it("'yes' → 'yes' (passthrough)", () => {
    expect(fn('yes')).toBe('yes')
  })

  it('already-boolean → no-op', () => {
    expect(fn(true)).toBe(true)
    expect(fn(false)).toBe(false)
  })
})

describe('union ambiguity', () => {
  it('z.union([z.string(), z.number()]) → all inputs passthrough', () => {
    const schema = adapter(z.object({ flex: z.union([z.string(), z.number()]) }))
    const fn = buildCoerceFn(schema, ['flex'], resolveCoercionIndex(true))
    expect(fn('25')).toBe('25')
    expect(fn(25)).toBe(25)
    expect(fn('hi')).toBe('hi')
  })
})

describe('array element coercion', () => {
  const idx = resolveCoercionIndex(true)

  it('z.array(z.number()): string members coerced', () => {
    const schema = adapter(z.object({ ids: z.array(z.number()) }))
    const fn = buildCoerceFn(schema, ['ids'], idx)
    const result = fn(['1', '2', '3'])
    expect(result).toEqual([1, 2, 3])
  })

  it('mixed-coercible: bad members preserve as-is', () => {
    const schema = adapter(z.object({ ids: z.array(z.number()) }))
    const fn = buildCoerceFn(schema, ['ids'], idx)
    expect(fn(['1', 'abc', '3'])).toEqual([1, 'abc', 3])
  })

  it('reference-equal pass-through when nothing changed', () => {
    const schema = adapter(z.object({ ids: z.array(z.number()) }))
    const fn = buildCoerceFn(schema, ['ids'], idx)
    const arr = [1, 2, 3]
    expect(fn(arr)).toBe(arr)
  })

  it('z.array(z.boolean()): string members coerced', () => {
    const schema = adapter(z.object({ flags: z.array(z.boolean()) }))
    const fn = buildCoerceFn(schema, ['flags'], idx)
    expect(fn(['true', 'false', 'true'])).toEqual([true, false, true])
  })
})

describe('Set element coercion', () => {
  const idx = resolveCoercionIndex(true)

  it('z.set(z.number()): string members coerced', () => {
    const schema = adapter(z.object({ tags: z.set(z.number()) }))
    const fn = buildCoerceFn(schema, ['tags'], idx)
    const result = fn(new Set(['1', '2'])) as Set<unknown>
    expect([...result]).toEqual([1, 2])
  })

  it('z.set(z.boolean()): string members coerced', () => {
    const schema = adapter(z.object({ flags: z.set(z.boolean()) }))
    const fn = buildCoerceFn(schema, ['flags'], idx)
    const result = fn(new Set(['true', 'false'])) as Set<unknown>
    expect([...result]).toEqual([true, false])
  })

  it('reference-equal pass-through when nothing changed', () => {
    const schema = adapter(z.object({ tags: z.set(z.number()) }))
    const fn = buildCoerceFn(schema, ['tags'], idx)
    const s = new Set([1, 2, 3])
    expect(fn(s)).toBe(s)
  })
})

describe('array of permissive elements', () => {
  it('z.array(z.union([z.string(), z.number()])) → passthrough', () => {
    const schema = adapter(z.object({ flex: z.array(z.union([z.string(), z.number()])) }))
    const fn = buildCoerceFn(schema, ['flex'], resolveCoercionIndex(true))
    const arr = ['1', 2, 'three']
    expect(fn(arr)).toBe(arr)
  })
})

describe('consumer extension', () => {
  it('extending defaults adds new cells without dropping built-ins', () => {
    const customRegistry: CoercionRegistry = [
      ...defaultCoercionRules,
      defineCoercion({
        input: 'string',
        output: 'bigint',
        transform: (s) => {
          try {
            return { coerced: true, value: BigInt(s) }
          } catch {
            return { coerced: false }
          }
        },
      }),
    ]
    const idx = resolveCoercionIndex(customRegistry)
    expect(idx.size).toBe(3)

    const schema = adapter(
      z.object({
        amount: z.bigint(),
        n: z.number(),
        b: z.boolean(),
      })
    )
    const bigintFn = buildCoerceFn(schema, ['amount'], idx)
    expect(bigintFn('42')).toBe(42n)

    const numFn = buildCoerceFn(schema, ['n'], idx)
    expect(numFn('25')).toBe(25)

    const boolFn = buildCoerceFn(schema, ['b'], idx)
    expect(boolFn('true')).toBe(true)
  })
})

describe('consumer replacement (REPLACE-not-merge)', () => {
  it('a custom string->number entry alone replaces the built-in', () => {
    const replaceRegistry: CoercionRegistry = [
      defineCoercion({
        input: 'string',
        output: 'number',
        transform: (s) => {
          // User opts in to "treat empty string as zero" — opposite
          // of the built-in's choice.
          if (s === '') return { coerced: true, value: 0 }
          const n = Number(s)
          return Number.isFinite(n) ? { coerced: true, value: n } : { coerced: false }
        },
      }),
    ]
    const idx = resolveCoercionIndex(replaceRegistry)
    expect(idx.size).toBe(1)
    expect(idx.has('string->boolean')).toBe(false)

    const schema = adapter(z.object({ age: z.number() }))
    const fn = buildCoerceFn(schema, ['age'], idx)
    expect(fn('')).toBe(0)
    expect(fn('25')).toBe(25)
  })
})

describe('duplicate-pair detection', () => {
  it('two string->number entries: dev-warn and the LATER one wins', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const registry: CoercionRegistry = [
      defineCoercion({
        input: 'string',
        output: 'number',
        transform: () => ({ coerced: true, value: 1 }),
      }),
      defineCoercion({
        input: 'string',
        output: 'number',
        transform: () => ({ coerced: true, value: 2 }),
      }),
    ]
    const idx = resolveCoercionIndex(registry)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("'string->number'"))

    const schema = adapter(z.object({ n: z.number() }))
    const fn = buildCoerceFn(schema, ['n'], idx)
    // Later entry wins.
    expect(fn('anything')).toBe(2)
  })
})

describe('throwing rule resilience', () => {
  it('a rule that throws is caught — original passes through', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const registry: CoercionRegistry = [
      defineCoercion({
        input: 'string',
        output: 'number',
        transform: () => {
          throw new Error('boom')
        },
      }),
    ]
    const idx = resolveCoercionIndex(registry)
    const schema = adapter(z.object({ n: z.number() }))
    const fn = buildCoerceFn(schema, ['n'], idx)
    expect(fn('25')).toBe('25')
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("'string->number' threw"),
      expect.any(Error)
    )
  })
})

describe('wrong-type post-validation', () => {
  it('rule returns wrong-typed value → dev-warn and passthrough', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const registry: CoercionRegistry = [
      defineCoercion({
        input: 'string',
        output: 'number',
        // Cast to unknown → number to bypass the type check; we're
        // testing the runtime guard against buggy rules.
        transform: () => ({ coerced: true, value: 'oops' as unknown as number }),
      }),
    ]
    const idx = resolveCoercionIndex(registry)
    const schema = adapter(z.object({ n: z.number() }))
    const fn = buildCoerceFn(schema, ['n'], idx)
    expect(fn('25')).toBe('25')
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('produced a string'))
  })
})

describe('NaN post-validation', () => {
  it('rule returns NaN for output number → dev-warn and passthrough', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const registry: CoercionRegistry = [
      defineCoercion({
        input: 'string',
        output: 'number',
        transform: () => ({ coerced: true, value: NaN }),
      }),
    ]
    const idx = resolveCoercionIndex(registry)
    const schema = adapter(z.object({ n: z.number() }))
    const fn = buildCoerceFn(schema, ['n'], idx)
    expect(fn('25')).toBe('25')
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('non-finite'))
  })
})

describe('malformed entry', () => {
  it('an entry missing transform is dropped at index time', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    // Cast through `unknown` so the registry resolver sees an entry
    // missing its `.transform` property and exercises the malformed-
    // entry skip path. The eslint rule prefers a `const x: T = …`
    // form over a trailing `as` cast, but the value is intentionally
    // ill-typed; widen via `unknown` first to satisfy both checks.
    const partial = { input: 'string', output: 'number' } as unknown as never
    const malformed = [
      partial,
      defineCoercion({
        input: 'string',
        output: 'boolean',
        transform: (s) => (s === 'true' ? { coerced: true, value: true } : { coerced: false }),
      }),
    ]
    const idx = resolveCoercionIndex(malformed)
    expect(idx.size).toBe(1)
    expect(idx.has('string->boolean')).toBe(true)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('missing or invalid `transform`'))
  })
})
