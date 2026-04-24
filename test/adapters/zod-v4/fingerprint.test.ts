import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { fingerprintZodSchema } from '../../../src/runtime/adapters/zod-v4/fingerprint'

/**
 * Fingerprint guarantees:
 *   - Equivalent schemas at different memory addresses → same string.
 *   - Differing shapes → different strings.
 *   - Key-order-insensitive for objects.
 *   - Membership-order-insensitive for unions.
 *   - Function-valued metadata (refine / transform / lazy defaults)
 *     collapses to opaque sentinels — a documented false negative,
 *     covered by the last test block.
 */

describe('fingerprintZodSchema — structural equivalence', () => {
  it('two identical object schemas built in separate statements match', () => {
    const a = z.object({ email: z.string(), password: z.string().min(8) })
    const b = z.object({ email: z.string(), password: z.string().min(8) })
    expect(fingerprintZodSchema(a)).toBe(fingerprintZodSchema(b))
  })

  it('object key order does not change the fingerprint', () => {
    const a = z.object({ email: z.string(), password: z.string() })
    const b = z.object({ password: z.string(), email: z.string() })
    expect(fingerprintZodSchema(a)).toBe(fingerprintZodSchema(b))
  })

  it('nested object shapes match across reference identity', () => {
    const a = z.object({ user: z.object({ name: z.string(), age: z.number() }) })
    const b = z.object({ user: z.object({ age: z.number(), name: z.string() }) })
    expect(fingerprintZodSchema(a)).toBe(fingerprintZodSchema(b))
  })

  it('array of object — element shape matters but reference does not', () => {
    const a = z.object({ posts: z.array(z.object({ title: z.string() })) })
    const b = z.object({ posts: z.array(z.object({ title: z.string() })) })
    expect(fingerprintZodSchema(a)).toBe(fingerprintZodSchema(b))
  })

  it('tuple position is preserved (different tuples → different fp)', () => {
    const a = z.tuple([z.string(), z.number()])
    const b = z.tuple([z.number(), z.string()])
    expect(fingerprintZodSchema(a)).not.toBe(fingerprintZodSchema(b))
  })

  it('union membership order does not change the fingerprint', () => {
    const a = z.union([z.string(), z.number()])
    const b = z.union([z.number(), z.string()])
    expect(fingerprintZodSchema(a)).toBe(fingerprintZodSchema(b))
  })

  it('discriminated-union option order does not change the fingerprint', () => {
    const a = z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('a'), x: z.number() }),
      z.object({ kind: z.literal('b'), y: z.string() }),
    ])
    const b = z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('b'), y: z.string() }),
      z.object({ kind: z.literal('a'), x: z.number() }),
    ])
    expect(fingerprintZodSchema(a)).toBe(fingerprintZodSchema(b))
  })

  it('check order on a primitive does not change the fingerprint', () => {
    const a = z.string().min(3).max(10)
    const b = z.string().max(10).min(3)
    expect(fingerprintZodSchema(a)).toBe(fingerprintZodSchema(b))
  })
})

describe('fingerprintZodSchema — structural distinctness', () => {
  it('differing leaf types produce different fingerprints', () => {
    const a = z.object({ email: z.string() })
    const b = z.object({ email: z.number() })
    expect(fingerprintZodSchema(a)).not.toBe(fingerprintZodSchema(b))
  })

  it('missing a field produces a different fingerprint', () => {
    const a = z.object({ email: z.string(), password: z.string() })
    const b = z.object({ email: z.string() })
    expect(fingerprintZodSchema(a)).not.toBe(fingerprintZodSchema(b))
  })

  it('different refinement constraints produce different fingerprints', () => {
    const a = z.object({ password: z.string().min(8) })
    const b = z.object({ password: z.string().min(4) })
    expect(fingerprintZodSchema(a)).not.toBe(fingerprintZodSchema(b))
  })

  it('optional vs required is distinguishable', () => {
    const a = z.object({ bio: z.string() })
    const b = z.object({ bio: z.string().optional() })
    expect(fingerprintZodSchema(a)).not.toBe(fingerprintZodSchema(b))
  })

  it('nullable vs non-nullable is distinguishable', () => {
    const a = z.object({ bio: z.string() })
    const b = z.object({ bio: z.string().nullable() })
    expect(fingerprintZodSchema(a)).not.toBe(fingerprintZodSchema(b))
  })

  it('array vs tuple of the same element set is distinguishable', () => {
    const a = z.array(z.string())
    const b = z.tuple([z.string()])
    expect(fingerprintZodSchema(a)).not.toBe(fingerprintZodSchema(b))
  })
})

describe('fingerprintZodSchema — documented false negatives', () => {
  // Two refinements with different function bodies SHOULD ideally
  // differ, but function identity isn't stably hashable across
  // module / closure boundaries. The floor here is what we test —
  // a future change that quietly starts distinguishing them should
  // break this test and prompt an adapter-contract update.
  it('refinements with different predicates collapse to the same fingerprint', () => {
    const a = z.object({ email: z.string().refine((v) => v.includes('@')) })
    const b = z.object({ email: z.string().refine((v) => v.endsWith('.com')) })
    expect(fingerprintZodSchema(a)).toBe(fingerprintZodSchema(b))
  })

  // Non-deterministic default factories (`.default(() => new
  // Date())`) collapse to the opaque `fn:*` sentinel — distinguishing
  // their output would break idempotence (v4's getter invokes the
  // factory on every read; two back-to-back reads would return
  // different Dates, so the fingerprint would change across calls).
  // Two factories that produce structurally-different but
  // non-deterministic outputs therefore look the same here.
  it('non-deterministic default factories collapse to the same fingerprint', () => {
    const a = z.object({ created: z.date().default(() => new Date()) })
    const b = z.object({ created: z.date().default(() => new Date()) })
    expect(fingerprintZodSchema(a)).toBe(fingerprintZodSchema(b))
  })

  it('two factory defaults that produce different Dates still match (idempotence wins)', () => {
    // Previous behaviour DID distinguish these (each factory's
    // Date differs) — but the comparison relied on whichever Date
    // happened to materialise. Under the new idempotent contract
    // both collapse to `fn:*` so the fingerprint is stable across
    // calls.
    let counter = 0
    const a = z.object({ created: z.number().default(() => counter++) })
    const b = z.object({ created: z.number().default(() => counter++) })
    expect(fingerprintZodSchema(a)).toBe(fingerprintZodSchema(b))
  })

  // Literal defaults still distinguish — no factory, no idempotence
  // risk.
  it('literal defaults with different values distinguish', () => {
    const a = z.object({ count: z.number().default(0) })
    const b = z.object({ count: z.number().default(10) })
    expect(fingerprintZodSchema(a)).not.toBe(fingerprintZodSchema(b))
  })
})

describe('fingerprintZodSchema — deep nesting + adversarial similarity', () => {
  // 4-level-deep wrappers differing only at the innermost leaf kind.
  // Tests the structural walker actually reaches the leaf rather than
  // short-circuiting at some intermediate hash.
  it('distinguishes 4-level-nested objects that differ only at the innermost leaf', () => {
    const a = z.object({
      a: z.object({ b: z.object({ c: z.object({ d: z.string() }) }) }),
    })
    const b = z.object({
      a: z.object({ b: z.object({ c: z.object({ d: z.number() }) }) }),
    })
    expect(fingerprintZodSchema(a)).not.toBe(fingerprintZodSchema(b))
  })

  it('distinguishes 4-level-nested objects that differ only in an inner check argument', () => {
    const a = z.object({
      a: z.object({ b: z.object({ c: z.object({ d: z.string().min(3) }) }) }),
    })
    const b = z.object({
      a: z.object({ b: z.object({ c: z.object({ d: z.string().min(5) }) }) }),
    })
    expect(fingerprintZodSchema(a)).not.toBe(fingerprintZodSchema(b))
  })

  it('distinguishes 3-level-deep array nesting with different leaf types', () => {
    const a = z.array(z.array(z.array(z.string())))
    const b = z.array(z.array(z.array(z.number())))
    expect(fingerprintZodSchema(a)).not.toBe(fingerprintZodSchema(b))
  })

  it('matches 3-level-deep array nesting when leaves are structurally equal', () => {
    const a = z.array(z.array(z.array(z.object({ v: z.string() }))))
    const b = z.array(z.array(z.array(z.object({ v: z.string() }))))
    expect(fingerprintZodSchema(a)).toBe(fingerprintZodSchema(b))
  })

  // Adversarial "one-thing-different" pairs at meaningful depth.
  it('distinguishes unions that differ by one extra option', () => {
    const base = [z.string(), z.number()] as const
    const a = z.union([...base] as unknown as [z.ZodType, z.ZodType])
    const b = z.union([...base, z.boolean()] as unknown as [z.ZodType, z.ZodType, z.ZodType])
    expect(fingerprintZodSchema(a)).not.toBe(fingerprintZodSchema(b))
  })

  it('distinguishes tuples that differ at a single position', () => {
    const a = z.tuple([z.string(), z.number(), z.object({ flag: z.boolean() })])
    const b = z.tuple([z.string(), z.number(), z.object({ flag: z.string() })])
    expect(fingerprintZodSchema(a)).not.toBe(fingerprintZodSchema(b))
  })

  it('distinguishes array-of-discriminated-union with one option leaf changed', () => {
    const a = z.array(
      z.discriminatedUnion('kind', [
        z.object({ kind: z.literal('a'), x: z.number() }),
        z.object({ kind: z.literal('b'), y: z.string() }),
      ])
    )
    const b = z.array(
      z.discriminatedUnion('kind', [
        z.object({ kind: z.literal('a'), x: z.number() }),
        z.object({ kind: z.literal('b'), y: z.boolean() }), // only y changed
      ])
    )
    expect(fingerprintZodSchema(a)).not.toBe(fingerprintZodSchema(b))
  })

  it('distinguishes deeply-nested mixed structure that differs at one terminal', () => {
    // object → array → dunion-option → nested object → leaf
    const build = (leaf: z.ZodType) =>
      z.object({
        events: z.array(
          z.discriminatedUnion('type', [
            z.object({ type: z.literal('click'), pos: z.object({ x: z.number(), y: z.number() }) }),
            z.object({
              type: z.literal('key'),
              key: z.object({ code: z.string(), payload: leaf }),
            }),
          ])
        ),
      })
    const a = build(z.string())
    const b = build(z.number())
    expect(fingerprintZodSchema(a)).not.toBe(fingerprintZodSchema(b))
  })
})

describe('fingerprintZodSchema — scale', () => {
  // 30 fields is well above what the property-test generator covers
  // (which caps at 4) but below the practical ceiling for real forms.
  // Exercises the sort stability + serialisation path at a size where
  // any O(n^2) accident would show up in runtime.
  it('matches across 100 random key orderings of a 30-field object', () => {
    const fields: Array<[string, z.ZodType]> = []
    for (let i = 0; i < 30; i++) {
      fields.push([`f${i}`, i % 3 === 0 ? z.string() : i % 3 === 1 ? z.number() : z.boolean()])
    }
    const canonicalShape: Record<string, z.ZodType> = Object.fromEntries(fields)
    const canonicalFp = fingerprintZodSchema(z.object(canonicalShape))

    // Deterministic PRNG so the test is reproducible.
    let seed = 0xc0ffee
    const rand = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff
      return seed / 0x80000000
    }

    for (let trial = 0; trial < 100; trial++) {
      const shuffled = [...fields]
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(rand() * (i + 1))
        ;[shuffled[i], shuffled[j]] = [
          shuffled[j] as [string, z.ZodType],
          shuffled[i] as [string, z.ZodType],
        ]
      }
      const permuted: Record<string, z.ZodType> = Object.fromEntries(shuffled)
      expect(fingerprintZodSchema(z.object(permuted))).toBe(canonicalFp)
    }
  })

  it('distinguishes 30-field objects that differ in exactly one field type', () => {
    const baseFields: Array<[string, z.ZodType]> = []
    for (let i = 0; i < 30; i++) baseFields.push([`f${i}`, z.string()])

    const a = z.object(Object.fromEntries(baseFields))
    const mutated = [...baseFields]
    mutated[15] = ['f15', z.number()] // swap middle field type
    const b = z.object(Object.fromEntries(mutated))

    expect(fingerprintZodSchema(a)).not.toBe(fingerprintZodSchema(b))
  })
})

describe('fingerprintZodSchema — idempotence under non-determinism', () => {
  // The fingerprint must be stable across calls, including when the
  // schema contains non-deterministic factories. These tests were
  // added after a bug where `.default(() => new Date())` fingerprinted
  // differently on every call (each read resolved the factory to a
  // fresh Date, and canonicalStringify emitted `date:${time}`).
  it('new Date() default — two calls produce the same fingerprint', () => {
    const schema = z.object({ created: z.date().default(() => new Date()) })
    const fp1 = fingerprintZodSchema(schema)
    const fp2 = fingerprintZodSchema(schema)
    expect(fp1).toBe(fp2)
  })

  it('stateful counter default — stable across many calls', () => {
    let counter = 0
    const schema = z.object({ n: z.number().default(() => counter++) })
    const first = fingerprintZodSchema(schema)
    for (let i = 0; i < 50; i++) {
      expect(fingerprintZodSchema(schema)).toBe(first)
    }
  })

  it('factory returning a fresh object literal — stable', () => {
    const schema = z.object({ meta: z.any().default(() => ({ when: Date.now() })) })
    expect(fingerprintZodSchema(schema)).toBe(fingerprintZodSchema(schema))
  })

  it('catch with a factory — stable', () => {
    const schema = z.object({ n: z.number().catch(() => Math.random()) })
    expect(fingerprintZodSchema(schema)).toBe(fingerprintZodSchema(schema))
  })
})

describe('fingerprintZodSchema — shared sub-schema references', () => {
  // A regression test for the `canonicalStringify` sibling bug. Two
  // sibling properties pointing at the same object / array must not
  // produce a `<cyclic>` sentinel — the reference isn't an ancestor,
  // just a shared child. The walker uses reference identity for
  // actual cycle detection, not repeat visits.
  it('shared leaf sub-schema at two positions does not trip cycle detection', () => {
    const leaf = z.string()
    const a = z.object({ first: leaf, second: leaf })
    const fp = fingerprintZodSchema(a)
    // Neither property should be marked `<cyclic>` — `leaf` isn't
    // on either property's ancestor chain, just referenced twice.
    expect(fp).not.toContain('<cyclic>')
    // And both properties should have the same leaf fingerprint in
    // their serialised form.
    expect(fp).toBe(fingerprintZodSchema(z.object({ first: z.string(), second: z.string() })))
  })

  it('shared default object reference between two properties produces identical structure', () => {
    const shared = { answer: 42 }
    const a = z.object({
      a: z.any().default(shared),
      b: z.any().default(shared),
    })
    const b = z.object({
      a: z.any().default({ answer: 42 }),
      b: z.any().default({ answer: 42 }),
    })
    // `a` and `b` differ only in whether the default object is the
    // same reference or two separate ones. Both must fingerprint
    // identically — reference identity is not part of the schema
    // meaning.
    expect(fingerprintZodSchema(a)).toBe(fingerprintZodSchema(b))
    // And neither side should contain `<cyclic>`.
    expect(fingerprintZodSchema(a)).not.toContain('<cyclic>')
  })
})

describe('fingerprintZodSchema — mutually-recursive schemas', () => {
  // Mutually-recursive lazy schemas expose a cache-poisoning bug
  // if the walker shares a module-level cache across calls: the
  // `<cyclic>` sentinel's meaning is relative to the starting node,
  // so caching an intermediate result from one call poisons later
  // fingerprint calls rooted at a different node. The walker uses a
  // per-call cache to avoid this.
  it('fingerprint is the same across multiple calls on the same schema', () => {
    type A = { nextA: A }
    type B = { nextB: B }
    // The lazy getters close over `nodeA`/`nodeB` before they're
    // assigned; using a holder object keeps the references
    // late-bound without tripping prefer-const.
    const nodes: { a?: z.ZodType<A>; b?: z.ZodType<B> } = {}
    nodes.a = z.lazy(() => z.object({ nextA: nodes.b as z.ZodType<B> })) as unknown as z.ZodType<A>
    nodes.b = z.lazy(() => z.object({ nextB: nodes.a as z.ZodType<A> })) as unknown as z.ZodType<B>
    const nodeA = nodes.a
    const nodeB = nodes.b

    const fpA1 = fingerprintZodSchema(nodeA)
    const fpB1 = fingerprintZodSchema(nodeB)
    // Fingerprint each a few more times; results must be stable
    // regardless of order, even with two distinct recursion entries.
    expect(fingerprintZodSchema(nodeA)).toBe(fpA1)
    expect(fingerprintZodSchema(nodeB)).toBe(fpB1)
    expect(fingerprintZodSchema(nodeA)).toBe(fpA1)
  })

  it('self-referential schema produces the same fingerprint no matter when it is called first', () => {
    // Build tree A first, get its fingerprint. Then build structurally
    // identical tree B and fingerprint. They must match.
    type Node = { name: string; children: Node[] }
    const buildTree = (): z.ZodType<Node> => {
      const tree: z.ZodType<Node> = z.lazy(() =>
        z.object({ name: z.string(), children: z.array(tree) })
      )
      return tree
    }
    const fp1 = fingerprintZodSchema(buildTree())
    const fp2 = fingerprintZodSchema(buildTree())
    expect(fp1).toBe(fp2)
  })
})

describe('fingerprintZodSchema — multi-value literal ordering', () => {
  it('z.literal([a, b]) matches z.literal([b, a])', () => {
    // `z.literal` can accept an array of accepted values. Those have
    // no semantic order, so canonical-sort before hashing.
    const a = z.literal(['a', 'b'])
    const b = z.literal(['b', 'a'])
    expect(fingerprintZodSchema(a)).toBe(fingerprintZodSchema(b))
  })

  it('z.literal([a, b]) ≠ z.literal([a, c])', () => {
    const a = z.literal(['a', 'b'])
    const b = z.literal(['a', 'c'])
    expect(fingerprintZodSchema(a)).not.toBe(fingerprintZodSchema(b))
  })
})

describe('fingerprintZodSchema — caching + cycles', () => {
  it('repeat calls on the same schema are cached', () => {
    const schema = z.object({ a: z.string(), b: z.number() })
    const fp1 = fingerprintZodSchema(schema)
    const fp2 = fingerprintZodSchema(schema)
    expect(fp1).toBe(fp2)
  })

  it('does not hang on self-referential lazy schemas', () => {
    type Node = { name: string; children: Node[] }
    const tree: z.ZodType<Node> = z.lazy(() =>
      z.object({ name: z.string(), children: z.array(tree) })
    )
    const fp = fingerprintZodSchema(tree)
    expect(fp).toContain('<cyclic>')
  })
})
