// @vitest-environment jsdom
import { createApp, defineComponent, h } from 'vue'
import { describe, expect, expectTypeOf, it } from 'vitest'
import { z } from 'zod-v3'
import { useForm } from '../../src/zod-v3'
import { createAttaform } from '../../src/runtime/core/plugin'

/**
 * Storage-shape invariant probes — Zod v3 mirror of
 * `values-storage-shape.test.ts`. Same invariant ("`form.values.<path>`
 * always returns the resolved concrete type storage holds"), pinned
 * against the v3 adapter via `ReadShape<Schema>` from
 * `src/runtime/adapters/zod-v3/types-read-shape.ts`.
 *
 * v3 ReadShape peels wrappers (`ZodDefault` / `ZodOptional` /
 * `ZodNullable` / `ZodEffects` / `ZodReadonly` / `ZodCatch`) at the
 * top level of an object's shape and descends one further level into
 * nested `ZodObject` / `ZodArray`. Deeper-nested wrapper peeling
 * intentionally stays at `z.input<Inner>` to keep TS instantiation
 * depth bounded — see the doc on `ReadShape` for the rationale.
 *
 * v3's `useForm` has multiple overloads, so the proxy-based
 * `ReturnType<typeof useForm<...>>` pattern used by the v4 matrix
 * doesn't resolve consistently. We mount each scenario and run both
 * type-level (`expectTypeOf(api.values.X)`) and runtime
 * (`expect(api.values.X)`) assertions against the live API instance.
 */

function mountWith<R>(setup: () => R): { api: R; unmount: () => void } {
  let captured: R | undefined
  const App = defineComponent({
    setup() {
      captured = setup()
      return () => h('div')
    },
  })
  const app = createApp(App).use(createAttaform())
  const root = document.createElement('div')
  document.body.appendChild(root)
  app.mount(root)
  if (captured === undefined) throw new Error('mountWith: setup never returned')
  return {
    api: captured,
    unmount: () => {
      app.unmount()
      document.body.removeChild(root)
    },
  }
}

function uniqueKey(prefix: string): string {
  return `v3-${prefix}-${Math.random().toString(36).slice(2)}`
}

// ──────────────────────────────────────────────────────────────────────
// ZodDefault — type peels `| undefined`; runtime resolves the default.
// ──────────────────────────────────────────────────────────────────────

const defaultsSchema = z.object({
  flag: z.boolean().default(true),
  count: z.number().default(0),
  name: z.string().default('attaform'),
  tags: z.array(z.string()).default([]),
})

describe('v3 — ZodDefault peels `| undefined`, runtime resolves the default', () => {
  it('z.boolean().default(true) → boolean / runtime true', () => {
    const { api, unmount } = mountWith(() =>
      useForm({ schema: defaultsSchema, key: uniqueKey('zd-bool') })
    )
    try {
      expectTypeOf(api.values.flag).toEqualTypeOf<boolean>()
      expect(api.values.flag).toBe(true)
    } finally {
      unmount()
    }
  })

  it('z.number().default(0) → number / runtime 0', () => {
    const { api, unmount } = mountWith(() =>
      useForm({ schema: defaultsSchema, key: uniqueKey('zd-num') })
    )
    try {
      expectTypeOf(api.values.count).toEqualTypeOf<number>()
      expect(api.values.count).toBe(0)
    } finally {
      unmount()
    }
  })

  it('z.string().default("attaform") → string / runtime "attaform"', () => {
    const { api, unmount } = mountWith(() =>
      useForm({ schema: defaultsSchema, key: uniqueKey('zd-str') })
    )
    try {
      expectTypeOf(api.values.name).toEqualTypeOf<string>()
      expect(api.values.name).toBe('attaform')
    } finally {
      unmount()
    }
  })

  it('z.array(z.string()).default([]) → string[] / runtime []', () => {
    const { api, unmount } = mountWith(() =>
      useForm({ schema: defaultsSchema, key: uniqueKey('zd-arr') })
    )
    try {
      expectTypeOf(api.values.tags).toEqualTypeOf<string[]>()
      expect(api.values.tags).toEqual([])
    } finally {
      unmount()
    }
  })

  it('reset restores defaults', () => {
    const { api, unmount } = mountWith(() =>
      useForm({ schema: defaultsSchema, key: uniqueKey('zd-reset') })
    )
    try {
      api.setValue('flag', false)
      api.setValue('count', 42)
      api.reset()
      expect(api.values.flag).toBe(true)
      expect(api.values.count).toBe(0)
    } finally {
      unmount()
    }
  })
})

// ──────────────────────────────────────────────────────────────────────
// Bare-required fields — synthesis resolves to falsy concrete.
// ──────────────────────────────────────────────────────────────────────

const bareRequiredSchema = z.object({
  s: z.string(),
  n: z.number(),
  b: z.boolean(),
  arr: z.array(z.string()),
})

describe('v3 — Bare-required fields resolve to a falsy concrete value', () => {
  it('plain primitives — type + runtime', () => {
    const { api, unmount } = mountWith(() =>
      useForm({ schema: bareRequiredSchema, key: uniqueKey('bare') })
    )
    try {
      expectTypeOf(api.values.s).toEqualTypeOf<string>()
      expectTypeOf(api.values.n).toEqualTypeOf<number>()
      expectTypeOf(api.values.b).toEqualTypeOf<boolean>()
      expectTypeOf(api.values.arr).toEqualTypeOf<string[]>()
      expect(api.values.s).toBe('')
      expect(api.values.n).toBe(0)
      expect(api.values.b).toBe(false)
      expect(api.values.arr).toEqual([])
    } finally {
      unmount()
    }
  })
})

// ──────────────────────────────────────────────────────────────────────
// Nested object descent — one level deep is peeled at the type level.
// ──────────────────────────────────────────────────────────────────────

const nestedSchema = z.object({
  user: z.object({
    name: z.string(),
    age: z.number().default(0),
  }),
})

describe('v3 — Nested object descent (one level)', () => {
  it('nested leaves keep their peeled types and resolve at runtime', () => {
    const { api, unmount } = mountWith(() =>
      useForm({ schema: nestedSchema, key: uniqueKey('nested') })
    )
    try {
      expectTypeOf(api.values.user.name).toEqualTypeOf<string>()
      expectTypeOf(api.values.user.age).toEqualTypeOf<number>()
      expect(api.values.user.name).toBe('')
      expect(api.values.user.age).toBe(0)
    } finally {
      unmount()
    }
  })
})

// ──────────────────────────────────────────────────────────────────────
// Genuinely uncertain — invariant does NOT promise to peel.
// ──────────────────────────────────────────────────────────────────────

describe('v3 — Genuinely uncertain edges', () => {
  it('z.string().optional() keeps `| undefined`', () => {
    const schema = z.object({ bio: z.string().optional() })
    const { api, unmount } = mountWith(() => useForm({ schema, key: uniqueKey('opt') }))
    try {
      expectTypeOf(api.values.bio).toEqualTypeOf<string | undefined>()
    } finally {
      unmount()
    }
  })

  it('z.string().nullable() keeps `| null`', () => {
    const schema = z.object({ ref: z.string().nullable() })
    const { api, unmount } = mountWith(() => useForm({ schema, key: uniqueKey('nul') }))
    try {
      expectTypeOf(api.values.ref).toEqualTypeOf<string | null>()
    } finally {
      unmount()
    }
  })
})
