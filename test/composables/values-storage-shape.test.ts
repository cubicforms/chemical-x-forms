// @vitest-environment jsdom
import { createApp, defineComponent, h } from 'vue'
import { describe, expect, expectTypeOf, it } from 'vitest'
import { z } from 'zod'
import { useForm } from '../../src/zod'
import { createAttaform } from '../../src/runtime/core/plugin'

/**
 * Storage-shape invariant probes (feedback §1.2).
 *
 * The invariant: `form.values.<path>` always returns the resolved
 * concrete type that storage holds. `.default()` has fired,
 * preprocess has normalised, blank-path synthesis has filled the
 * skeleton. Reads NEVER produce `undefined` for a slot the schema
 * resolved to a concrete type — and the static type SHOULD agree.
 *
 * Today, `form.values` is typed as `z.input<Schema>`, which leaves a
 * gap: `ZodDefault<T>`'s input is `T | undefined`, even though the
 * runtime resolves it to `T` at storage-init. That gap is the §1.1
 * "type lies" friction.
 *
 * Type-level assertions pin the surface so a future regression to
 * `z.input<Schema>`-only typing (or any drift in `ReadShape<>`) trips
 * `expectTypeOf` at compile time. Runtime assertions confirm the
 * storage invariant holds end-to-end; together the matrix is the
 * cross-check that the static type and the runtime agree.
 *
 * Out-of-scope edges (kept here as guardrails, not bugs):
 *  - `ZodOptional<T>` without a default — genuinely optional; type
 *    correctly carries `| undefined`.
 *  - `ZodNullable<T>` — type carries `| null`.
 *  - Array index access past `length` — tainted by
 *    `noUncheckedIndexedAccess`, not by the storage invariant.
 *  - `.transform()` — storage holds pre-transform input; post-transform
 *    output is exposed via `handleSubmit` / `form.process()`.
 */

function makeFormProxy<T>(): T {
  const handler: ProxyHandler<() => unknown> = {
    get: () => proxy,
    apply: () => proxy,
  }
  const proxy: unknown = new Proxy(() => undefined, handler)
  return proxy as T
}

function mountForm<R>(setup: () => R): { api: R; unmount: () => void } {
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
  if (captured === undefined) throw new Error('mountForm: setup never returned')
  return {
    api: captured,
    unmount: () => {
      app.unmount()
      document.body.removeChild(root)
    },
  }
}

function uniqueKey(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2)}`
}

// ──────────────────────────────────────────────────────────────────────
// ZodDefault — type should peel `| undefined`; runtime resolves the default.
// ──────────────────────────────────────────────────────────────────────

const defaultsSchema = z.object({
  flag: z.boolean().default(true),
  count: z.number().default(0),
  name: z.string().default('attaform'),
  tags: z.array(z.string()).default([]),
  config: z
    .object({
      enabled: z.boolean().default(true),
      label: z.string().default('default-label'),
    })
    .default({ enabled: true, label: 'default-label' }),
})

describe('ZodDefault — type peels `| undefined`, runtime resolves the default', () => {
  type Form = ReturnType<typeof useForm<typeof defaultsSchema>>
  const formT = makeFormProxy<Form>()

  it('z.boolean().default(true) → boolean (type)', () => {
    expectTypeOf(formT.values.flag).toEqualTypeOf<boolean>()
  })
  it('z.boolean().default(true) → true (runtime)', () => {
    const { api, unmount } = mountForm(() =>
      useForm({ schema: defaultsSchema, key: uniqueKey('zd-bool') })
    )
    try {
      expect(api.values.flag).toBe(true)
      expect(typeof api.values.flag).toBe('boolean')
    } finally {
      unmount()
    }
  })

  it('z.number().default(0) → number (type)', () => {
    expectTypeOf(formT.values.count).toEqualTypeOf<number>()
  })
  it('z.number().default(0) → 0 (runtime)', () => {
    const { api, unmount } = mountForm(() =>
      useForm({ schema: defaultsSchema, key: uniqueKey('zd-num') })
    )
    try {
      expect(api.values.count).toBe(0)
      expect(typeof api.values.count).toBe('number')
    } finally {
      unmount()
    }
  })

  it('z.string().default("attaform") → string (type)', () => {
    expectTypeOf(formT.values.name).toEqualTypeOf<string>()
  })
  it('z.string().default("attaform") → "attaform" (runtime)', () => {
    const { api, unmount } = mountForm(() =>
      useForm({ schema: defaultsSchema, key: uniqueKey('zd-str') })
    )
    try {
      expect(api.values.name).toBe('attaform')
      expect(typeof api.values.name).toBe('string')
    } finally {
      unmount()
    }
  })

  it('z.array(z.string()).default([]) → string[] (type)', () => {
    expectTypeOf(formT.values.tags).toEqualTypeOf<string[]>()
  })
  it('z.array(z.string()).default([]) → [] (runtime)', () => {
    const { api, unmount } = mountForm(() =>
      useForm({ schema: defaultsSchema, key: uniqueKey('zd-arr') })
    )
    try {
      expect(api.values.tags).toEqual([])
      expect(Array.isArray(api.values.tags)).toBe(true)
    } finally {
      unmount()
    }
  })

  it('nested ZodDefault — type resolves inner shape', () => {
    expectTypeOf(formT.values.config).toEqualTypeOf<{ enabled: boolean; label: string }>()
    expectTypeOf(formT.values.config.enabled).toEqualTypeOf<boolean>()
  })
  it('nested ZodDefault — runtime resolves the inner shape', () => {
    const { api, unmount } = mountForm(() =>
      useForm({ schema: defaultsSchema, key: uniqueKey('zd-obj') })
    )
    try {
      expect(api.values.config).toEqual({ enabled: true, label: 'default-label' })
      expect(api.values.config.enabled).toBe(true)
    } finally {
      unmount()
    }
  })

  it('reset restores defaults (sanity: ZodDefault is the source of truth)', () => {
    const { api, unmount } = mountForm(() =>
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
// Bare-required fields — synthesis resolves to a falsy concrete value.
// ──────────────────────────────────────────────────────────────────────

const bareRequiredSchema = z.object({
  s: z.string(),
  n: z.number(),
  b: z.boolean(),
  arr: z.array(z.string()),
})

describe('Synthesis — bare-required fields resolve to a falsy concrete value', () => {
  type Form = ReturnType<typeof useForm<typeof bareRequiredSchema>>
  const formT = makeFormProxy<Form>()

  it('z.string() (no default) → string (type)', () => {
    expectTypeOf(formT.values.s).toEqualTypeOf<string>()
  })
  it('z.string() (no default) → "" (runtime)', () => {
    const { api, unmount } = mountForm(() =>
      useForm({ schema: bareRequiredSchema, key: uniqueKey('synth-str') })
    )
    try {
      expect(api.values.s).toBe('')
      expect(typeof api.values.s).toBe('string')
    } finally {
      unmount()
    }
  })

  it('z.number() (no default) → number (type)', () => {
    expectTypeOf(formT.values.n).toEqualTypeOf<number>()
  })
  it('z.number() (no default) → 0 (runtime)', () => {
    const { api, unmount } = mountForm(() =>
      useForm({ schema: bareRequiredSchema, key: uniqueKey('synth-num') })
    )
    try {
      expect(api.values.n).toBe(0)
      expect(typeof api.values.n).toBe('number')
    } finally {
      unmount()
    }
  })

  it('z.boolean() (no default) → boolean (type)', () => {
    expectTypeOf(formT.values.b).toEqualTypeOf<boolean>()
  })
  it('z.boolean() (no default) → false (runtime)', () => {
    const { api, unmount } = mountForm(() =>
      useForm({ schema: bareRequiredSchema, key: uniqueKey('synth-bool') })
    )
    try {
      expect(api.values.b).toBe(false)
      expect(typeof api.values.b).toBe('boolean')
    } finally {
      unmount()
    }
  })

  it('z.array(z.string()) (no default) → string[] (type)', () => {
    expectTypeOf(formT.values.arr).toEqualTypeOf<string[]>()
  })
  it('z.array(z.string()) (no default) → [] (runtime)', () => {
    const { api, unmount } = mountForm(() =>
      useForm({ schema: bareRequiredSchema, key: uniqueKey('synth-arr') })
    )
    try {
      expect(api.values.arr).toEqual([])
      expect(Array.isArray(api.values.arr)).toBe(true)
    } finally {
      unmount()
    }
  })
})

// ──────────────────────────────────────────────────────────────────────
// Deep nested synthesis — invariant holds all the way down.
// ──────────────────────────────────────────────────────────────────────

const deepSchema = z.object({
  user: z.object({
    name: z.string(),
    profile: z.object({
      bio: z.string(),
    }),
  }),
  a: z.object({
    b: z.object({
      c: z.object({
        d: z.string(),
      }),
    }),
  }),
})

describe('Synthesis — deep nested objects resolve recursively', () => {
  type Form = ReturnType<typeof useForm<typeof deepSchema>>
  const formT = makeFormProxy<Form>()

  it('two-level descent — type stays strict', () => {
    expectTypeOf(formT.values.user.name).toEqualTypeOf<string>()
    expectTypeOf(formT.values.user.profile.bio).toEqualTypeOf<string>()
  })
  it('two-level descent — every leaf falsy-concrete at runtime', () => {
    const { api, unmount } = mountForm(() =>
      useForm({ schema: deepSchema, key: uniqueKey('deep-2') })
    )
    try {
      expect(api.values.user.name).toBe('')
      expect(api.values.user.profile.bio).toBe('')
      expect(typeof api.values.user.name).toBe('string')
      expect(typeof api.values.user.profile.bio).toBe('string')
    } finally {
      unmount()
    }
  })

  it('four-level descent — type stays strict', () => {
    expectTypeOf(formT.values.a.b.c.d).toEqualTypeOf<string>()
  })
  it('four-level descent does not short-circuit to undefined', () => {
    const { api, unmount } = mountForm(() =>
      useForm({ schema: deepSchema, key: uniqueKey('deep-4') })
    )
    try {
      expect(api.values.a.b.c.d).toBe('')
      expect(typeof api.values.a.b.c.d).toBe('string')
    } finally {
      unmount()
    }
  })
})

// ──────────────────────────────────────────────────────────────────────
// Discriminated union — stub state before the discriminator is chosen.
// ──────────────────────────────────────────────────────────────────────

const duSchema = z.object({
  tagged: z.discriminatedUnion('type', [
    z.object({ type: z.literal('a'), a: z.string() }),
    z.object({ type: z.literal('b'), b: z.number() }),
  ]),
})

describe('Discriminated union — stub state before discriminator chosen', () => {
  it('discriminator path is readable and falls in the literal union at runtime', () => {
    const { api, unmount } = mountForm(() =>
      useForm({ schema: duSchema, key: uniqueKey('du-stub') })
    )
    try {
      expect(['a', 'b']).toContain(api.values.tagged.type)
    } finally {
      unmount()
    }
  })

  it('active-variant leaf reads as its resolved falsy-concrete', () => {
    const { api, unmount } = mountForm(() =>
      useForm({ schema: duSchema, key: uniqueKey('du-leaf') })
    )
    try {
      const active = api.values.tagged
      if (active.type === 'a') {
        expect(active.a).toBe('')
        expect(typeof active.a).toBe('string')
      } else if (active.type === 'b') {
        expect(active.b).toBe(0)
        expect(typeof active.b).toBe('number')
      } else {
        throw new Error(`unexpected DU stub variant: ${String(active.type)}`)
      }
    } finally {
      unmount()
    }
  })
})

// ──────────────────────────────────────────────────────────────────────
// Genuinely uncertain — invariant does NOT promise to peel these.
// ──────────────────────────────────────────────────────────────────────

const optionalSchema = z.object({ bio: z.string().optional() })
const nullableSchema = z.object({ ref: z.string().nullable() })
const arrSchema = z.object({ tags: z.array(z.string()) })

describe('Genuinely uncertain — invariant does NOT promise to peel', () => {
  it('z.string().optional() keeps `| undefined` at the type level', () => {
    type Form = ReturnType<typeof useForm<typeof optionalSchema>>
    const formT = makeFormProxy<Form>()
    expectTypeOf(formT.values.bio).toEqualTypeOf<string | undefined>()
  })
  it('z.string().optional() — runtime behaviour documented', () => {
    const { api, unmount } = mountForm(() =>
      useForm({ schema: optionalSchema, key: uniqueKey('opt') })
    )
    try {
      // Pin whatever the runtime returns today; the assertion's role is
      // to document the synthesized value for optional-without-default,
      // not to claim a target. Flip the matcher if a future intentional
      // change in synthesis policy lands.
      expect(api.values.bio).toBeUndefined()
    } finally {
      unmount()
    }
  })

  it('z.string().nullable() keeps `| null` at the type level', () => {
    type Form = ReturnType<typeof useForm<typeof nullableSchema>>
    const formT = makeFormProxy<Form>()
    expectTypeOf(formT.values.ref).toEqualTypeOf<string | null>()
  })
  it('z.string().nullable() — runtime behaviour documented', () => {
    const { api, unmount } = mountForm(() =>
      useForm({ schema: nullableSchema, key: uniqueKey('nul') })
    )
    try {
      // Pin whatever the runtime returns today (likely null or
      // undefined); the assertion documents synthesis for nullable-
      // without-default.
      const ref: unknown = api.values.ref
      expect(ref === null || ref === undefined).toBe(true)
    } finally {
      unmount()
    }
  })

  it('array element past length is `T | undefined` — noUncheckedIndexedAccess, not storage', () => {
    type Form = ReturnType<typeof useForm<typeof arrSchema>>
    const formT = makeFormProxy<Form>()
    expectTypeOf(formT.values.tags[0]).toEqualTypeOf<string | undefined>()
  })
  it('array element past length — runtime is undefined (just the indexing edge)', () => {
    const { api, unmount } = mountForm(() =>
      useForm({ schema: arrSchema, key: uniqueKey('arr-edge') })
    )
    try {
      expect(api.values.tags[0]).toBeUndefined()
      expect(api.values.tags.length).toBe(0)
    } finally {
      unmount()
    }
  })
})

// ──────────────────────────────────────────────────────────────────────
// preprocess / transform — write-boundary vs parse-time semantics.
// ──────────────────────────────────────────────────────────────────────

const preprocessSchema = z.object({
  trimmed: z.preprocess((v) => (typeof v === 'string' ? v.trim() : v), z.string()),
})

const transformSchema = z.object({
  letterCount: z.string().transform((s) => s.length),
})

describe('preprocess / transform — write-boundary vs parse-time semantics', () => {
  it('z.preprocess(fn, z.string()) — type peels to inner-schema input', () => {
    type Form = ReturnType<typeof useForm<typeof preprocessSchema>>
    const formT = makeFormProxy<Form>()
    expectTypeOf(formT.values.trimmed).toEqualTypeOf<string>()
  })

  // RED today: synthesis bails on preprocess wrappers and the field
  // reads as `undefined`. POST-FIX, the blank-path skeleton descends
  // through the preprocess wrapper to the inner schema's falsy — the
  // storage invariant holds for preprocess slots too. `.fails` flips
  // to a passing assertion when the synthesis path peels through.
  it.fails(
    'z.preprocess(fn, z.string()) — storage holds the inner-schema falsy, not undefined',
    () => {
      const { api, unmount } = mountForm(() =>
        useForm({ schema: preprocessSchema, key: uniqueKey('pre-synth') })
      )
      try {
        expect(api.values.trimmed).toBe('')
        expect(typeof api.values.trimmed).toBe('string')
      } finally {
        unmount()
      }
    }
  )

  // RED today: preprocess throwing on a write leaves the field at
  // `undefined` (or whatever the throw policy is). POST-FIX, the
  // field falls back to a "reasonable value" — concrete sub-policy
  // (inner-falsy vs prior-value) settled when the implementation
  // lands. The narrow guarantee this probe pins: NEVER undefined.
  it.fails('preprocess failure on write does not strand the field at undefined', () => {
    const throwyPreprocess = z.object({
      v: z.preprocess(() => {
        throw new Error('preprocess refused')
      }, z.string()),
    })
    const { api, unmount } = mountForm(() =>
      useForm({ schema: throwyPreprocess, key: uniqueKey('pre-throw') })
    )
    try {
      // Pre-write: synthesis path holds (inner falsy).
      expect(api.values.v).toBe('')
      // Write attempt that triggers the throw.
      try {
        api.setValue('v', 'anything')
      } catch {
        // Throw policy at the write boundary is open; the probe only
        // pins the resulting storage state.
      }
      expect(api.values.v).not.toBeUndefined()
      expect(typeof api.values.v).toBe('string')
    } finally {
      unmount()
    }
  })

  it('z.string().transform(fn) — storage holds PRE-transform input (existing rationale)', () => {
    type Form = ReturnType<typeof useForm<typeof transformSchema>>
    const formT = makeFormProxy<Form>()
    // Transforms run at parse, not at write. The storage view stays the
    // input shape — string here, not number. This is the case the §1.1
    // tightening DELIBERATELY leaves alone.
    expectTypeOf(formT.values.letterCount).toEqualTypeOf<string>()
  })

  it('z.string().transform(fn) — runtime stores the pre-transform string', () => {
    const { api, unmount } = mountForm(() =>
      useForm({ schema: transformSchema, key: uniqueKey('tx') })
    )
    try {
      expect(typeof api.values.letterCount).toBe('string')
    } finally {
      unmount()
    }
  })
})
