// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { createApp, defineComponent, h, nextTick, type App } from 'vue'
import { useForm } from '../../src/zod'
import { z } from 'zod'
import { createAttaform } from '../../src/runtime/core/plugin'

/**
 * Regression: on first render, `form.meta.valid` and
 * `form.fields(path).valid` should return `false` until the first
 * validation pass has completed. Without the gate, a form whose
 * defaults pass STRUCTURAL validation but fail REFINEMENT validation
 * (e.g. `z.string().min(1)` against `''`) renders as "valid" for the
 * one frame between mount and the queued microtask that runs the full
 * schema. UI bound to `valid` (submit-button enable, stepper "done"
 * pills) flashes briefly green before settling into the correct
 * invalid state.
 *
 * Reproduction steps in the demo: refresh the REPL preview — the
 * step pills paint green, then turn gray a tick later when validation
 * lands. The gray state is the truth.
 *
 * Fix: gate `meta.valid` / per-path `valid` on a `firstValidationDone`
 * flag that starts `false` in strict mode and flips `true` once the
 * first validation completes (via the construction-time microtask
 * queue). Non-strict forms start `true` — they opt out of
 * validation by design.
 */

// Reproduction: the SLIM schema (used at construction to derive defaults)
// strips `.refine` predicates, so a `.refine` failure on the supplied
// defaults goes unnoticed at construction. The FULL schema with the
// refinement only runs as a queued microtask post-mount (when the
// schema declares async work) or on the next user mutation (sync-only
// schemas). Either way, frame 1 sees an empty error map and the form
// looks "valid" until the real validation lands.
const asyncSchema = z
  .object({
    reference: z.string(),
  })
  .refine(async (data) => data.reference === 'OK', {
    message: 'reference must be OK',
  })

const syncSchema = z.object({ reference: z.string() }).refine((data) => data.reference === 'OK', {
  message: 'reference must be OK',
})

type AsyncApi = ReturnType<typeof useForm<typeof asyncSchema>>
type SyncApi = ReturnType<typeof useForm<typeof syncSchema>>

// Convenience wrapper for the multi-path "all subtrees valid" read.
// Each path goes through `form.fields(p).valid` — same per-path
// async-validation gate, same conjunction over descendant leaves.
function isValid(
  api: { fields: unknown } | undefined,
  paths: ReadonlyArray<string | readonly (string | number)[]>
): boolean {
  if (api === undefined) return false
  const f = api.fields as unknown as (p: string | readonly (string | number)[]) => {
    valid: boolean
  }
  return paths.every((p) => f(p).valid)
}

function mountAsync(): { app: App; api: AsyncApi } {
  const handle: { api?: AsyncApi } = {}
  const App = defineComponent({
    setup() {
      handle.api = useForm({
        schema: asyncSchema,
        key: `initial-validity-async-${Math.random().toString(36).slice(2)}`,
        defaultValues: { reference: '' },
      })
      return () => h('div')
    },
  })
  const app = createApp(App).use(createAttaform({ override: true }))
  app.mount(document.createElement('div'))
  return { app, api: handle.api as AsyncApi }
}

function mountSync(opts: { strict?: boolean } = {}): { app: App; api: SyncApi } {
  const handle: { api?: SyncApi } = {}
  const App = defineComponent({
    setup() {
      // exactOptionalPropertyTypes: only pass `strict` when the caller
      // opted in; an explicit `undefined` is a different shape from an
      // omitted property under that flag.
      handle.api = useForm({
        schema: syncSchema,
        key: `initial-validity-sync-${Math.random().toString(36).slice(2)}`,
        defaultValues: { reference: '' },
        ...(opts.strict !== undefined ? { strict: opts.strict } : {}),
      })
      return () => h('div')
    },
  })
  const app = createApp(App).use(createAttaform({ override: true }))
  app.mount(document.createElement('div'))
  return { app, api: handle.api as SyncApi }
}

describe('initial validity gating — async-refinement schema (the demo case)', () => {
  const apps: App[] = []
  afterEach(() => {
    while (apps.length > 0) apps.pop()?.unmount()
  })

  it('meta.valid is false synchronously after mount, before the async pass lands', () => {
    const { app, api } = mountAsync()
    apps.push(app)
    // Slim parse stripped the refinement → no errors seeded at
    // construction. The full-schema microtask is queued but hasn't
    // run yet. Without the gate, this asserts `true` — the bug.
    expect(api.meta.valid).toBe(false)
  })

  it('isValid([root]) is false synchronously after mount', () => {
    const { app, api } = mountAsync()
    apps.push(app)
    expect(isValid(api, [[]])).toBe(false)
  })

  it('isValid on a sync-only prefix is true even before first validation completes (per-path gate)', () => {
    const { app, api } = mountAsync()
    apps.push(app)
    // The async refine in `asyncSchema` is at the root (no `path:`
    // config), so its sub-schema at ['reference'] is just z.string()
    // — no async work, no gate, no playing dumb. Per-path
    // resolution lets us answer the obvious question for sync
    // subtrees without waiting on an unrelated async pass.
    expect(isValid(api, ['reference'])).toBe(true)
  })

  it('flips to true after a manual validateAsync resolves with no errors', async () => {
    const handle: { api?: AsyncApi } = {}
    const App = defineComponent({
      setup() {
        handle.api = useForm({
          schema: asyncSchema,
          key: `initial-validity-clean-${Math.random().toString(36).slice(2)}`,
          // 'OK' satisfies the refinement → no errors after the pass.
          defaultValues: { reference: 'OK' },
        })
        return () => h('div')
      },
    })
    const app = createApp(App).use(createAttaform({ override: true }))
    app.mount(document.createElement('div'))
    apps.push(app)

    expect(handle.api?.meta.valid).toBe(false) // gate, not errors
    await handle.api?.validateAsync()
    await nextTick()
    expect(handle.api?.meta.valid).toBe(true)
    expect(isValid(handle.api, [[]])).toBe(true)
  })

  it('stays false after handleSubmit on an invalid form (gate flipped, errors written)', async () => {
    const { app, api } = mountAsync()
    apps.push(app)
    expect(api.meta.valid).toBe(false) // gate
    let onValidCalled = false
    // handleSubmit's pre-check writes refinement errors to state.
    // The 'OK' refinement fails on '' → onValid is skipped, errors land.
    await api.handleSubmit(() => {
      onValidCalled = true
    })()
    expect(onValidCalled).toBe(false)
    expect(api.meta.errors.length).toBeGreaterThan(0)
    expect(api.meta.valid).toBe(false)
  })
})

describe('initial validity gating — sync-refinement schema', () => {
  const apps: App[] = []
  afterEach(() => {
    while (apps.length > 0) apps.pop()?.unmount()
  })

  it('strict + sync: meta.valid is false synchronously after mount', () => {
    const { app, api } = mountSync()
    apps.push(app)
    // Sync schemas don't queue construction-time async validation in
    // the current code, so frame 1 sees no errors AT ALL. The gate
    // catches this case — the form has never been validated, even
    // though the slim parse "succeeded" trivially.
    expect(api.meta.valid).toBe(false)
  })

  it('non-strict skips the gate (validation is opt-out by design)', () => {
    const { app, api } = mountSync({ strict: false })
    apps.push(app)
    // Non-strict consumers explicitly tell the runtime to treat
    // defaultValues as best-effort — locking the form forever
    // because nothing validated would defeat the opt-out.
    expect(api.meta.valid).toBe(true)
    expect(isValid(api, [''])).toBe(true)
  })
})

// Pin the documented asymmetry between `isValid(paths)` and
// `field.valid`: scoped `isValid` honours the form-wide gate
// (cross-field refines can surface errors at any path, so
// "have we verified?" is a form-wide question), while
// per-leaf `field.valid` does not (it answers a tighter
// "based on what we have at this path, has anything failed?"
// question used by green-checkmark UX patterns).
describe('initial validity gating — asymmetry between isValid and field.valid', () => {
  // Schema with a plain `z.string()` leaf living alongside a leaf
  // that does carry an async refine directly. Slim parse strips
  // the refine → construction sees no errors. The form-wide gate
  // is active because the schema declares async work, but the
  // per-path resolver lets us split the answer: `word` resolves
  // synchronously (its sub-schema has no async), `asyncField`
  // gates (its sub-schema does).
  const mixedSchema = z.object({
    word: z.string(),
    asyncField: z.string().refine(async (v) => v === 'OK', {
      message: 'asyncField must be OK',
    }),
  })

  type MixedApi = ReturnType<typeof useForm<typeof mixedSchema>>
  const apps: App[] = []
  afterEach(() => {
    while (apps.length > 0) apps.pop()?.unmount()
  })

  function mountMixed(): { app: App; api: MixedApi } {
    const handle: { api?: MixedApi } = {}
    const App = defineComponent({
      setup() {
        handle.api = useForm({
          schema: mixedSchema,
          key: `initial-validity-mixed-${Math.random().toString(36).slice(2)}`,
          defaultValues: { word: 'hello', asyncField: '' },
        })
        return () => h('div')
      },
    })
    const app = createApp(App).use(createAttaform({ override: true }))
    app.mount(document.createElement('div'))
    return { app, api: handle.api as MixedApi }
  }

  it('isValid([leafPath]) returns true at frame 1 for a sync leaf, matching field.valid', () => {
    const { app, api } = mountMixed()
    apps.push(app)
    // Per-path gating: the `word` leaf has no async work in its
    // subtree (`pathHasAsyncValidation(['word']) === false`), so
    // the form-wide `firstValidationDone` gate is skipped. Both
    // surfaces converge on the truth: a structurally-valid
    // `z.string()` leaf with no errors and nothing in flight is
    // valid, full stop.
    expect(isValid(api, ['word'])).toBe(true)
    expect(api.fields.word.valid).toBe(true)
  })

  it('isValid([asyncLeafPath]) is gated false at frame 1 — the path has async work pending', () => {
    const { app, api } = mountMixed()
    apps.push(app)
    // `asyncField`'s subtree DOES contain async work, so
    // `pathHasAsyncValidation(['asyncField']) === true`. The gate
    // applies and `isValid` returns false until the construction-
    // time microtask completes.
    expect(isValid(api, ['asyncField'])).toBe(false)
  })

  it('asyncField gates at frame 1, then surfaces a real verdict after handleSubmit', async () => {
    const { app, api } = mountMixed()
    apps.push(app)
    // Gate active for the async-bearing leaf — same answer as
    // `meta.valid`: "we haven't checked yet."
    expect(isValid(api, ['asyncField'])).toBe(false)
    // The sync sibling answers honestly throughout.
    expect(isValid(api, ['word'])).toBe(true)

    // Trigger a real validation pass; the refine fails on the empty
    // default and writes an error at ['asyncField'].
    await api.handleSubmit(() => {})()

    // After validation: gate flipped, errors are real.
    expect(isValid(api, ['asyncField'])).toBe(false) // refinement violated
    expect(isValid(api, ['word'])).toBe(true) // still clean
  })

  it('field.valid mirrors isValid: per-path async gate, no clamping for sync leaves', () => {
    const { app, api } = mountMixed()
    apps.push(app)
    // Sync leaf: no gate, answers honestly at frame 1.
    expect(api.fields.word.valid).toBe(true)
    expect(isValid(api, ['word'])).toBe(true)
    // Async leaf: gated until first validation completes.
    expect(api.fields.asyncField.valid).toBe(false)
    expect(isValid(api, ['asyncField'])).toBe(false)
  })

  it('field.valid for an async leaf flips after the gate completes (handleSubmit on a clean default)', async () => {
    // Mount with a default that satisfies the refine — once
    // validation completes, no errors remain at the async leaf.
    const handle: { api?: MixedApi } = {}
    const App = defineComponent({
      setup() {
        handle.api = useForm({
          schema: mixedSchema,
          key: `initial-validity-mixed-clean-${Math.random().toString(36).slice(2)}`,
          defaultValues: { word: 'hello', asyncField: 'OK' },
        })
        return () => h('div')
      },
    })
    const app = createApp(App).use(createAttaform({ override: true }))
    app.mount(document.createElement('div'))
    apps.push(app)
    const api = handle.api as MixedApi

    // Gate active at frame 1 for asyncField.
    expect(api.fields.asyncField.valid).toBe(false)
    // Trigger validation; refine passes ('OK' === 'OK').
    await api.handleSubmit(() => {})()
    // Gate flipped, no errors → field.valid mirrors the truth.
    expect(api.fields.asyncField.valid).toBe(true)
  })
})
