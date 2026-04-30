// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { createApp, defineComponent, h, type App } from 'vue'
import { z } from 'zod'
import { useForm } from '../../src/zod'
import { createChemicalXForms } from '../../src/runtime/core/plugin'

/**
 * End-to-end coverage for explicit `.default(customValue)` flowing
 * through the consumer-facing surface. The adapter unit tests prove
 * `getDefaultValues` / `getDefaultAtPath` / `deriveDefault` each honor
 * `.default()` in isolation; these tests pin the consumer-visible
 * behavior:
 *
 *   1. Form construction: `useForm({ schema })` with `.default('user')`
 *      on a field produces `'user'` at `form.values.role`.
 *   2. Path-form callback prev auto-default: when the slot is missing,
 *      `setValue('field', cb)` hands the consumer the `.default(x)`
 *      value (not the natural falsy primitive default).
 *   3. Sparse-array fill: writing past length pads each slot with the
 *      schema element default — including any `.default(x)` values
 *      nested inside the element shape.
 *
 * Catches regressions where Phase-2 / Phase-3 plumbing accidentally
 * stops calling deriveDefault with useDefault=true, or where the
 * structural-completeness fill walker drops `.default()` wrappers
 * during peeling.
 */

function harness<S extends z.ZodObject>(
  schema: S
): {
  app: App
  form: ReturnType<typeof useForm<S>>
} {
  let captured!: ReturnType<typeof useForm<S>>
  const Probe = defineComponent({
    setup() {
      captured = useForm({
        schema,
        key: `custom-defaults-${Math.random().toString(36).slice(2)}`,
      })
      return () => h('div')
    },
  })
  const app = createApp(Probe)
  app.use(createChemicalXForms())
  app.mount(document.createElement('div'))
  return { app, form: captured }
}

describe('custom .default() values flow through the consumer surface', () => {
  const apps: App[] = []
  afterEach(() => {
    while (apps.length > 0) apps.pop()?.unmount()
  })

  describe('form construction picks .default() over natural falsy', () => {
    it('string with .default("user") produces "user" — not ""', () => {
      const schema = z.object({ role: z.string().default('user') })
      const { app, form } = harness(schema)
      apps.push(app)
      expect(form.values.role).toBe('user')
    })

    it('number with .default(5) produces 5 — not 0', () => {
      const schema = z.object({ count: z.number().default(5) })
      const { app, form } = harness(schema)
      apps.push(app)
      expect(form.values.count).toBe(5)
    })

    it('boolean with .default(true) produces true — not false', () => {
      const schema = z.object({ active: z.boolean().default(true) })
      const { app, form } = harness(schema)
      apps.push(app)
      expect(form.values.active).toBe(true)
    })

    it('object .default({...}) produces the literal default', () => {
      const schema = z.object({
        prefs: z.object({ theme: z.string(), density: z.string() }).default({
          theme: 'dark',
          density: 'comfortable',
        }),
      })
      const { app, form } = harness(schema)
      apps.push(app)
      expect(form.values.prefs).toEqual({
        theme: 'dark',
        density: 'comfortable',
      })
    })

    it('nested .default() inside an object field produces the nested default', () => {
      const schema = z.object({
        prefs: z.object({
          theme: z.string().default('dark'),
          // No .default — natural ''.
          locale: z.string(),
        }),
      })
      const { app, form } = harness(schema)
      apps.push(app)
      expect(form.values.prefs).toEqual({
        theme: 'dark',
        locale: '',
      })
    })

    it('array element with nested .default() honours the nested default on construction', () => {
      const schema = z.object({
        // Array starts empty (no .default on the array itself); the
        // element default is `{ title: 'untitled', views: 0 }` and is
        // exposed via getDefaultAtPath when the array is grown.
        posts: z.array(
          z.object({
            title: z.string().default('untitled'),
            views: z.number(),
          })
        ),
      })
      const { app, form } = harness(schema)
      apps.push(app)
      // The array is empty at construction, but a synthetic write past
      // length should pad with the element default — `.default('untitled')`
      // for title.
      form.setValue('posts.2', { title: 'real', views: 100 })
      expect(form.values.posts).toEqual([
        { title: 'untitled', views: 0 },
        { title: 'untitled', views: 0 },
        { title: 'real', views: 100 },
      ])
    })
  })

  describe('path-form callback prev auto-default uses .default(x)', () => {
    it('callback prev for an unpopulated optional field is the .default value', () => {
      const schema = z.object({
        // Optional so the slot is genuinely missing at construction.
        prefs: z
          .object({
            theme: z.string().default('dark'),
            density: z.string().default('comfortable'),
          })
          .optional(),
      })
      const { app, form } = harness(schema)
      apps.push(app)

      let receivedPrev: unknown
      form.setValue('prefs', (prev) => {
        receivedPrev = prev
        return { ...prev, theme: 'light' }
      })

      // prev was auto-defaulted from getDefaultAtPath(['prefs']),
      // which peels the .optional() and returns the inner shape's
      // structural default — including the `.default('dark')` /
      // `.default('comfortable')` values rather than `''`.
      expect(receivedPrev).toEqual({ theme: 'dark', density: 'comfortable' })
      // Final value carries the consumer's override, defaults survive.
      expect(form.values.prefs).toEqual({
        theme: 'light',
        density: 'comfortable',
      })
    })

    it('callback prev for a missing array element honours nested .default()', () => {
      const schema = z.object({
        posts: z.array(
          z.object({
            title: z.string().default('untitled'),
            views: z.number().default(0),
          })
        ),
      })
      const { app, form } = harness(schema)
      apps.push(app)

      let receivedPrev: unknown
      form.setValue('posts.0', (prev) => {
        receivedPrev = prev
        return { ...prev, title: 'first' }
      })

      // The element default is `{ title: 'untitled', views: 0 }` —
      // verifies the .default('untitled') survives the path-form
      // auto-default path (vs. natural empty string '').
      expect(receivedPrev).toEqual({ title: 'untitled', views: 0 })
    })
  })

  describe('sparse-array fill picks nested .default(x)', () => {
    it('writing posts.3 against empty posts populates 0..2 with .default-aware elements', () => {
      const schema = z.object({
        posts: z.array(
          z.object({
            title: z.string().default('untitled'),
            views: z.number().default(10),
          })
        ),
      })
      const { app, form } = harness(schema)
      apps.push(app)

      form.setValue('posts.3', { title: 'real', views: 100 })

      // Indices 0..2: element default with both .default() values
      // present. Index 3: the consumer's value.
      expect(form.values.posts).toEqual([
        { title: 'untitled', views: 10 },
        { title: 'untitled', views: 10 },
        { title: 'untitled', views: 10 },
        { title: 'real', views: 100 },
      ])
    })

    it('tuple positions pick their own .default(x) when fill kicks in', () => {
      const schema = z.object({
        coords: z.tuple([z.number().default(7), z.number().default(13), z.number().default(99)]),
      })
      const { app, form } = harness(schema)
      apps.push(app)

      // Form construction already produces [7, 13, 99] from positional
      // defaults. Verify it directly first.
      expect(form.values.coords).toEqual([7, 13, 99])

      // Now mutate: setValue at position 2 should leave 0,1 as their
      // existing defaults (no fill needed — they're already populated).
      form.setValue('coords.2', 42)
      expect(form.values.coords).toEqual([7, 13, 42])
    })
  })
})
