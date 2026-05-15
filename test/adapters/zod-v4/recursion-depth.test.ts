// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp, defineComponent, h, type App } from 'vue'
import { z } from 'zod'
import { useForm } from '../../../src/zod'
import type { UseFormReturn } from '../../../src/zod'
import { createAttaform } from '../../../src/runtime/core/plugin'
import {
  deriveDefault,
  getDefaultValuesFromZodSchema,
} from '../../../src/runtime/adapters/zod-v4/default-values'
import { getNestedZodSchemasAtPath } from '../../../src/runtime/adapters/zod-v4/path-walker'
import { slimPrimitivesOf } from '../../../src/runtime/adapters/zod-v4/slim-primitives'
import { getSlimSchema } from '../../../src/runtime/adapters/zod-v4/strip'

/**
 * `maxRecursionDepth` caps descent through `z.lazy()` only — the
 * counter bumps when the walker crosses a lazy boundary and is
 * NOT incremented for plain structural recursion (object → object,
 * array element, wrapper stacks like `.optional().nullable()`,
 * union branches, intersection legs). These tests pin that
 * invariant against future drift: a setting as low as
 * `maxRecursionDepth: 0` must still produce correct results for
 * any schema that doesn't include a `z.lazy()`.
 *
 * Why this matters: if a walker accidentally bumps the counter on
 * non-lazy recursion (the original slim-primitives code did), a
 * consumer who sets `maxRecursionDepth: 1` to constrain a
 * recursive form would see unrelated non-recursive forms in the
 * same app break silently — the cap would gate writes/defaults
 * for any moderately-wrapped schema.
 */
describe('maxRecursionDepth — counter bumps on lazy only', () => {
  describe('slimPrimitivesOf', () => {
    it('a 6-deep wrapper stack resolves correctly at maxRecursionDepth=0', () => {
      // `.optional().nullable().default('x').readonly().catch('y').optional()`
      // — six nested wrappers, no lazy. Cap=0 must not bail.
      const schema = z
        .string()
        .optional()
        .nullable()
        .default('x' as never)
        .readonly()
        .catch('y' as never)
        .optional()
      const kinds = slimPrimitivesOf(schema, 0)
      // The leaf type (string) must be in the set — bailing to PERMISSIVE
      // would also include 'string' but would also include 'object',
      // 'array', etc. Test by asserting the optional-wrapper marker too:
      // a correctly-walked wrapper stack accumulates 'undefined' and
      // 'null' alongside the leaf.
      expect(kinds.has('string')).toBe(true)
      expect(kinds.has('undefined')).toBe(true)
      expect(kinds.has('null')).toBe(true)
      // The permissive fallback set is broader (12+ kinds). The
      // wrapper-walk produces a tighter set. Use the size as a
      // proof the cap didn't trip.
      expect(kinds.size).toBeLessThan(8)
    })

    it('deep union branches resolve at maxRecursionDepth=0', () => {
      const schema = z.union([z.string(), z.number(), z.boolean(), z.null(), z.undefined()])
      const kinds = slimPrimitivesOf(schema, 0)
      expect(kinds.has('string')).toBe(true)
      expect(kinds.has('number')).toBe(true)
      expect(kinds.has('boolean')).toBe(true)
      expect(kinds.has('null')).toBe(true)
      expect(kinds.has('undefined')).toBe(true)
    })

    it('a single lazy crossing bails at maxRecursionDepth=0', () => {
      // Trivial non-recursive lazy. Cap=0 means "no lazy crossings
      // allowed" — the walker bails immediately to PERMISSIVE.
      const inner = z.object({ name: z.string() })
      const lazy = z.lazy(() => inner)
      const kinds = slimPrimitivesOf(lazy, 0)
      // Permissive fallback — includes the entire kind set.
      expect(kinds.size).toBeGreaterThan(8)
    })

    it('a single lazy crossing succeeds at maxRecursionDepth=1', () => {
      const inner = z.object({ name: z.string() })
      const lazy = z.lazy(() => inner)
      const kinds = slimPrimitivesOf(lazy, 1)
      // Resolved to the inner kind: 'object'.
      expect(kinds.has('object')).toBe(true)
      expect(kinds.size).toBeLessThan(8)
    })
  })

  describe('deriveDefault', () => {
    it('a 5-deep nested object derives the full default at maxRecursionDepth=0', () => {
      const schema = z.object({
        a: z.object({
          b: z.object({
            c: z.object({
              d: z.object({
                e: z.string(),
              }),
            }),
          }),
        }),
      })
      const result = deriveDefault(schema, false, 0)
      // Full structural recursion succeeds at cap=0 because no lazy
      // is crossed. The default for every leaf is the empty string.
      expect(result).toEqual({ a: { b: { c: { d: { e: '' } } } } })
    })

    it('an array of objects derives correctly at maxRecursionDepth=0', () => {
      const schema = z.object({
        rows: z.array(z.object({ x: z.number(), y: z.string() })),
      })
      const result = deriveDefault(schema, false, 0)
      // Arrays default to []; the recursion into the element type
      // happens only on demand, not during deriveDefault.
      expect(result).toEqual({ rows: [] })
    })

    it('a non-recursive lazy resolves at maxRecursionDepth=1', () => {
      const inner = z.object({ name: z.string() })
      const schema = z.object({ wrap: z.lazy(() => inner) })
      const result = deriveDefault(schema, false, 1)
      expect(result).toEqual({ wrap: { name: '' } })
    })

    it('a non-recursive lazy returns undefined at the lazy boundary when maxRecursionDepth=0', () => {
      const inner = z.object({ name: z.string() })
      const schema = z.object({ wrap: z.lazy(() => inner) })
      const result = deriveDefault(schema, false, 0)
      // The lazy crossing trips the cap; structural recursion at the
      // outer object level still resolves. The lazy node becomes
      // `undefined`.
      expect(result).toEqual({ wrap: undefined })
    })

    it('a self-referencing lazy bails after maxRecursionDepth crossings', () => {
      // Recursion through `child: self` (not wrapped in `.optional()`,
      // which would short-circuit to undefined at every level via the
      // optional branch). With cap=2 the walker crosses the lazy at
      // entry (depth 0 → 1), then again at the inner `child` (depth
      // 1 → 2), and bails to undefined on the third encounter.
      type Node = { value: string; child: Node }
      const Node: z.ZodType<Node> = z.lazy(() => z.object({ value: z.string(), child: Node }))
      const schema = z.object({ root: Node })
      const result = deriveDefault(schema, false, 2) as {
        root: { value: string; child: unknown }
      }
      expect(result.root.value).toBe('')
      // First level: cap-aware lazy entered (lazyDepth 0 → 1).
      const childLevel1 = result.root.child as { value: string; child: unknown }
      expect(childLevel1).toBeDefined()
      expect(childLevel1.value).toBe('')
      // Second level: cap is met (lazyDepth 1 → 2; 2 >= 2 triggers
      // the bail on the next descent).
      expect(childLevel1.child).toBeUndefined()
    })
  })

  describe('getNestedZodSchemasAtPath', () => {
    it('resolves a 4-deep object path at maxRecursionDepth=0', () => {
      const schema = z.object({
        a: z.object({ b: z.object({ c: z.object({ d: z.number() }) }) }),
      })
      const result = getNestedZodSchemasAtPath(schema, 'a.b.c.d', 0)
      expect(result).toHaveLength(1)
      // The resolved schema parses a number.
      expect(result[0]?.safeParse(42).success).toBe(true)
      expect(result[0]?.safeParse('not-a-number').success).toBe(false)
    })

    it('resolves through a tuple at maxRecursionDepth=0', () => {
      const schema = z.object({
        point: z.tuple([z.string(), z.number()]),
      })
      const result = getNestedZodSchemasAtPath(schema, 'point.1', 0)
      expect(result).toHaveLength(1)
      expect(result[0]?.safeParse(99).success).toBe(true)
    })

    it('resolves a path through one lazy at maxRecursionDepth=1', () => {
      const inner = z.object({ value: z.string() })
      const schema = z.object({ wrap: z.lazy(() => inner) })
      const result = getNestedZodSchemasAtPath(schema, 'wrap.value', 1)
      expect(result).toHaveLength(1)
      expect(result[0]?.safeParse('hi').success).toBe(true)
    })

    it('bails on a path through lazy at maxRecursionDepth=0', () => {
      const inner = z.object({ value: z.string() })
      const schema = z.object({ wrap: z.lazy(() => inner) })
      const result = getNestedZodSchemasAtPath(schema, 'wrap.value', 0)
      expect(result).toEqual([])
    })
  })

  describe('getSlimSchema', () => {
    it('rebuilds a 4-deep object tree intact at maxRecursionDepth=0', () => {
      const schema = z.object({
        a: z.object({ b: z.object({ c: z.object({ d: z.string() }) }) }),
      })
      const slim = getSlimSchema(schema, { stripRefinements: true }, 0)
      // Slim schema accepts the structural default.
      const parsed = slim.safeParse({ a: { b: { c: { d: '' } } } })
      expect(parsed.success).toBe(true)
    })

    it('leaves the lazy in place when maxRecursionDepth=0', () => {
      const inner = z.object({ value: z.string() })
      const schema = z.object({ wrap: z.lazy(() => inner) })
      const slim = getSlimSchema(schema, { stripRefinements: true }, 0)
      // The lazy still resolves through Zod's own parser, so a valid
      // input still parses. The walker just didn't strip inside it.
      const parsed = slim.safeParse({ wrap: { value: 'x' } })
      expect(parsed.success).toBe(true)
    })
  })

  describe('getDefaultValuesFromZodSchema', () => {
    it('produces full defaults for a deeply-nested non-recursive schema at maxRecursionDepth=0', () => {
      const schema = z.object({
        profile: z.object({
          name: z.string(),
          address: z.object({
            city: z.string(),
            country: z.string(),
          }),
        }),
        tags: z.array(z.string()),
      })
      const { data } = getDefaultValuesFromZodSchema({
        schema,
        useDefaultSchemaValues: true,
        constraints: undefined,
        maxRecursionDepth: 0,
      })
      expect(data).toEqual({
        profile: { name: '', address: { city: '', country: '' } },
        tags: [],
      })
    })
  })

  describe('integration — useForm with a non-recursive schema and a tight cap', () => {
    const apps: App[] = []
    afterEach(() => {
      while (apps.length > 0) apps.pop()?.unmount()
    })

    it('a 3-deep object schema mounts and seeds defaults at maxRecursionDepth=0', () => {
      const schema = z.object({
        address: z.object({
          city: z.string(),
          country: z.string(),
        }),
      })
      type Api = UseFormReturn<typeof schema>
      const handle: { api?: Api } = {}
      const App = defineComponent({
        setup() {
          handle.api = useForm({
            schema,
            key: `recursion-depth-0-${Math.random().toString(36).slice(2)}`,
            maxRecursionDepth: 0,
          })
          return () => h('div')
        },
      })
      const app = createApp(App).use(createAttaform())
      app.mount(document.createElement('div'))
      apps.push(app)
      const api = handle.api as Api
      expect(api.values.address.city).toBe('')
      expect(api.values.address.country).toBe('')
    })

    it('Infinity allows arbitrarily deep nesting', () => {
      const schema = z.object({
        a: z.object({ b: z.object({ c: z.object({ d: z.string() }) }) }),
      })
      type Api = UseFormReturn<typeof schema>
      const handle: { api?: Api } = {}
      const App = defineComponent({
        setup() {
          handle.api = useForm({
            schema,
            key: `recursion-depth-infinity-${Math.random().toString(36).slice(2)}`,
            maxRecursionDepth: Infinity,
          })
          return () => h('div')
        },
      })
      const app = createApp(App).use(createAttaform())
      app.mount(document.createElement('div'))
      apps.push(app)
      const api = handle.api as Api
      expect(api.values.a.b.c.d).toBe('')
    })
  })
})

describe('useForm — passes sanitised maxRecursionDepth into walks', () => {
  const apps: App[] = []
  afterEach(() => {
    while (apps.length > 0) apps.pop()?.unmount()
  })

  it('NaN at the useForm callsite does not infinite-loop on a self-referencing lazy', () => {
    // Without sanitisation, `NaN` would make `lazyDepth >= maxDepth`
    // permanently false, infinite-recursing on a self-referencing
    // lazy. The sanitiser maps it to the library default (64),
    // bounding the walk.
    type Node = { value: string; child: Node }
    const Node: z.ZodType<Node> = z.lazy(() => z.object({ value: z.string(), child: Node }))
    const schema = z.object({ root: Node })
    type Api = UseFormReturn<typeof schema>
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const handle: { api?: Api } = {}
    const App = defineComponent({
      setup() {
        handle.api = useForm({
          schema,
          key: `recursion-nan-${Math.random().toString(36).slice(2)}`,
          // Defy the TS signature via the `as` cast — the runtime
          // must still terminate.
          maxRecursionDepth: NaN as unknown as number,
          defaultValues: {
            root: { value: 'top', child: { value: 'inner', child: undefined as never } },
          },
        })
        return () => h('div')
      },
    })
    try {
      const app = createApp(App).use(createAttaform())
      app.mount(document.createElement('div'))
      apps.push(app)
      const api = handle.api as Api
      // Form mounted without exhausting the stack.
      const values = api.values as { root: { value: string } }
      expect(values.root.value).toBe('top')
      // Dev-warn fired.
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('maxRecursionDepth must be a non-negative integer or Infinity')
      )
    } finally {
      warnSpy.mockRestore()
    }
  })

  it('a negative cap clamps to 0 (rejects any lazy crossing in the slim gate)', () => {
    const schema = z.object({
      name: z.string(),
    })
    type Api = UseFormReturn<typeof schema>
    const handle: { api?: Api } = {}
    const App = defineComponent({
      setup() {
        handle.api = useForm({
          schema,
          key: `recursion-negative-${Math.random().toString(36).slice(2)}`,
          maxRecursionDepth: -100,
        })
        return () => h('div')
      },
    })
    const app = createApp(App).use(createAttaform())
    app.mount(document.createElement('div'))
    apps.push(app)
    const api = handle.api as Api
    // Form mounts with the sanitised cap (0). The non-recursive
    // schema is unaffected — the cap is dormant.
    expect(api.values.name).toBe('')
  })
})
