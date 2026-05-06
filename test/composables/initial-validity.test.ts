// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { createApp, defineComponent, h, nextTick, type App } from 'vue'
import { useForm } from '../../src/zod'
import { z } from 'zod'
import { createAttaform } from '../../src/runtime/core/plugin'

/**
 * Regression: on first render, `form.meta.valid` and
 * `form.isValid([...])` should return `false` until the first
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
 * Fix: gate `meta.valid` / `isValid` on a `firstValidationDone` flag
 * that starts `false` in strict mode and flips `true` once the first
 * validation completes (via the construction-time microtask queue).
 * Non-strict forms start `true` — they opt out of validation by
 * design.
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
    expect(api.isValid([''])).toBe(false)
  })

  it('isValid on a clean prefix is also false until the first validation completes', () => {
    const { app, api } = mountAsync()
    apps.push(app)
    expect(api.isValid(['reference'])).toBe(false)
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
    expect(handle.api?.isValid([''])).toBe(true)
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
    expect(api.isValid([''])).toBe(true)
  })
})
