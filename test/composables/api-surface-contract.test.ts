// @vitest-environment jsdom
import { describe, expect, expectTypeOf, it } from 'vitest'
import { createApp, defineComponent, h, type App } from 'vue'
import { z } from 'zod'
import { useForm } from '../../src/zod'
import { createAttaform } from '../../src/runtime/core/plugin'
import type { UseFormReturnType } from '../../src/runtime/types/types-api'

/**
 * Pins the public surface of `useForm()`'s return value against
 * accidental drift. Two failure modes this guards against:
 *
 *   1. A property silently moves between `api` and `api.meta` (or
 *      disappears entirely) — types vs. runtime drift, the bug class
 *      that surfaced during the persistence-history probe round when
 *      `api.canUndo` returned `undefined` because the property lives
 *      at `api.meta.canUndo`.
 *   2. A method is introduced/removed/renamed without the surface
 *      contract being updated.
 *
 * The asymmetry this file documents is intentional but unintuitive:
 *
 *   ┌─ Lives directly on `api` ───────────────────────────────┐
 *   │  setValue, handleSubmit, validateAsync, reset,          │
 *   │  resetField, undo, redo, register, fields, errors,      │
 *   │  values, key, meta, …                                   │
 *   └─────────────────────────────────────────────────────────┘
 *
 *   ┌─ Lives on `api.meta` ───────────────────────────────────┐
 *   │  canUndo, canRedo, historySize, dirty, valid,           │
 *   │  submitting, submitCount, submitError, showErrors,      │
 *   │  firstError, …                                          │
 *   └─────────────────────────────────────────────────────────┘
 *
 * Actions sit at the top level; status flags sit on `meta`. If a
 * future refactor consolidates the surface (e.g. `form.history.{undo,
 * redo, canUndo, canRedo, size}` as a cohesive namespace), this test
 * breaks loudly and intentionally — update it as part of the refactor.
 *
 * Absence checks use type-level assertions (`@ts-expect-error`) rather
 * than runtime `=== undefined`, because the FieldState proxy returns a
 * stub callable for unknown property reads (a separate bug — see
 * round-2 chaos probe). The compile-time check is the canonical surface
 * contract; the runtime check is subordinate.
 */

const schema = z.object({
  name: z.string(),
  email: z.string().email(),
})

type Api = UseFormReturnType<z.output<typeof schema>>

function mountForm(): { app: App; api: Api } {
  const handle: { api?: Api } = {}
  const App = defineComponent({
    setup() {
      handle.api = useForm({
        schema,
        key: `surface-contract-${Math.random().toString(36).slice(2)}`,
        history: true,
        defaultValues: { name: '', email: '' },
      })
      return () => h('div')
    },
  })
  const app = createApp(App).use(createAttaform({ override: true }))
  app.mount(document.createElement('div'))
  return { app, api: handle.api as Api }
}

describe('API surface contract — actions on `api`, status on `api.meta`', () => {
  it('history actions live directly on `api`', () => {
    const { api } = mountForm()

    expect(typeof api.undo).toBe('function')
    expect(typeof api.redo).toBe('function')

    // Type-level pins: undo / redo are `() => boolean`. If a refactor
    // moves them under a namespace (e.g. `api.history.undo`), these
    // expectTypeOf calls fail and force a deliberate update of this
    // contract test.
    expectTypeOf(api.undo).toEqualTypeOf<() => boolean>()
    expectTypeOf(api.redo).toEqualTypeOf<() => boolean>()
  })

  it('history STATUS lives on `api.meta`, NOT directly on `api`', () => {
    const { api } = mountForm()

    // Where the props actually live — runtime check.
    expect(typeof api.meta.canUndo).toBe('boolean')
    expect(typeof api.meta.canRedo).toBe('boolean')
    expect(typeof api.meta.historySize).toBe('number')

    // Type-level pin.
    expectTypeOf(api.meta.canUndo).toEqualTypeOf<boolean>()
    expectTypeOf(api.meta.canRedo).toEqualTypeOf<boolean>()
    expectTypeOf(api.meta.historySize).toEqualTypeOf<number>()

    // Type-level absence. If a future refactor promotes these to
    // top-level, the @ts-expect-error stops being needed and the
    // `Unused @ts-expect-error directive` lint trips. Either way,
    // the maintainer is forced to consciously update this contract.
    // The `void` prefix appeases the no-unused-expressions lint
    // without changing the type-check semantics.
    // @ts-expect-error api.canUndo must NOT exist; use api.meta.canUndo
    void api.canUndo
    // @ts-expect-error api.canRedo must NOT exist; use api.meta.canRedo
    void api.canRedo
    // @ts-expect-error api.historySize must NOT exist; use api.meta.historySize
    void api.historySize
  })

  it('mutating actions live directly on `api`', () => {
    const { api } = mountForm()

    expect(typeof api.setValue).toBe('function')
    expect(typeof api.reset).toBe('function')
    expect(typeof api.resetField).toBe('function')
    expect(typeof api.handleSubmit).toBe('function')
    expect(typeof api.validateAsync).toBe('function')
  })

  it('form-level reactive flags live on `api.meta` (not `api`)', () => {
    const { api } = mountForm()

    // Status flags. Same architectural pattern as canUndo/canRedo.
    expect(typeof api.meta.dirty).toBe('boolean')
    expect(typeof api.meta.valid).toBe('boolean')
    expect(typeof api.meta.submitting).toBe('boolean')
    expect(typeof api.meta.submitCount).toBe('number')

    // showErrors / firstError landed in PR #186.
    expect(typeof api.meta.showErrors).toBe('boolean')
    expect(['undefined', 'object']).toContain(typeof api.meta.firstError)

    // Type-level absence at the top level.
    // @ts-expect-error api.dirty must NOT exist; use api.meta.dirty
    void api.dirty
    // @ts-expect-error api.valid must NOT exist; use api.meta.valid
    void api.valid
    // @ts-expect-error api.submitting must NOT exist; use api.meta.submitting
    void api.submitting
    // @ts-expect-error api.submitCount must NOT exist; use api.meta.submitCount
    void api.submitCount
  })

  it('field accessors live directly on `api`', () => {
    const { api } = mountForm()

    // `api.fields` is a callable proxy — supports both
    // `api.fields.email` (property access) and a function-form
    // signature. typeof returns 'function' for callable proxies.
    expect(typeof api.fields === 'function' || typeof api.fields === 'object').toBe(true)
    expect(typeof api.errors).toBe('function')
    expect(typeof api.values === 'function' || typeof api.values === 'object').toBe(true)
    expect(typeof api.register).toBe('function')
    expect(typeof api.key).toBe('string')

    // Property access works as advertised. FieldState entries are
    // also callable proxies (lift signature), so typeof returns
    // 'function' rather than 'object' even for leaf fields.
    expect(typeof api.fields.email === 'function' || typeof api.fields.email === 'object').toBe(
      true
    )
    expect(typeof api.values.email).toBe('string')
  })

  it('per-field state surfaces status directly on the FieldState', () => {
    const { api } = mountForm()
    const emailField = api.fields.email

    expect(typeof emailField.dirty).toBe('boolean')
    expect(typeof emailField.valid).toBe('boolean')
    expect(typeof emailField.touched === 'boolean' || emailField.touched === null).toBe(true)
    expect(typeof emailField.showErrors).toBe('boolean')

    expectTypeOf(emailField.dirty).toEqualTypeOf<boolean>()
    expectTypeOf(emailField.valid).toEqualTypeOf<boolean>()
    expectTypeOf(emailField.showErrors).toEqualTypeOf<boolean>()
  })

  it('per-field history does NOT exist today (pinned for the consolidation question)', () => {
    const { api } = mountForm()
    const emailField = api.fields.email

    // Type-level absence — future per-field history (e.g.
    // `api.fields.email.history.{undo, redo, canUndo}`) breaks these
    // @ts-expect-error directives intentionally.
    // @ts-expect-error per-field history is not part of the contract today
    void emailField.history
    // @ts-expect-error per-field undo is not part of the contract today
    void emailField.undo
    // @ts-expect-error per-field redo is not part of the contract today
    void emailField.redo

    // Note: runtime `emailField.undo` returns `[Function undefined]`
    // because the FieldState proxy stubs unknown property reads as
    // callables (separate bug — see round-2 chaos probe). The
    // type-level absence above is the canonical contract; runtime
    // probing here would fail-positive.
  })

  it('there is no `api.history` namespace today (pinned for the consolidation question)', () => {
    const { api } = mountForm()

    // Type-level absence. If we consolidate to `form.history.{undo,
    // redo, canUndo, canRedo, size, clear}`, this @ts-expect-error
    // becomes unused and trips the lint, forcing the contract update.
    // @ts-expect-error consolidated `api.history` namespace does not exist today
    void api.history
  })
})

/**
 * FUTURE-COMMITMENT MARKERS — fail LOUDLY in CI until implemented.
 *
 * Plain `it()` (NOT `it.fails()`): a silently-green `it.fails()` lets
 * the signal dissipate; a CI red is a constant nag every time the
 * suite runs. Each marker stays red until the feature lands, at which
 * point the assertions pass and CI goes green by virtue of the work
 * being done.
 *
 * Asserts SHAPE / minimal-behavior only, not full semantics. The full
 * semantics live in the implementing PR's tests; this file's job is
 * to keep the commitment visible.
 */
describe('FUTURE — form.history namespace (not yet implemented)', () => {
  it('form.history exposes undo/redo + canUndo/canRedo/size + clear', () => {
    const { api } = mountForm()
    const history = (api as unknown as { history?: unknown }).history as
      | {
          undo: () => boolean
          redo: () => boolean
          canUndo: boolean
          canRedo: boolean
          size: number
          clear: () => void
        }
      | undefined

    expect(history).toBeDefined()
    expect(typeof history?.undo).toBe('function')
    expect(typeof history?.redo).toBe('function')
    expect(typeof history?.canUndo).toBe('boolean')
    expect(typeof history?.canRedo).toBe('boolean')
    expect(typeof history?.size).toBe('number')
    expect(typeof history?.clear).toBe('function')
  })
})

/**
 * FUTURE — multi-tab persistence sync (not yet implemented).
 *
 * The user-impact concern: a user with N open tabs of the same form
 * can submit on one tab while the others quietly hold stale state.
 * The "stale tab" looks live (no error), so subsequent edits there
 * race against / overwrite the just-submitted truth. The data-loss
 * mode is invisible to the user.
 *
 * Minimum viable contract: when another tab writes to the form's
 * persistence key, the storage event fires and the receiving tab's
 * form.values reflect the cross-tab update. Implementation may use
 * `addEventListener('storage', …)` (free, browser-native), a
 * BroadcastChannel (richer signalling), or the same dynamic adapter
 * the `persist:` config already loads. Whatever the mechanism, this
 * test pins the user-visible end state: form values converge across
 * tabs without explicit reload.
 *
 * This test fixture mounts a form WITH per-input opt-in (the
 * documented persistence-enable pattern) so the form's own writer
 * doesn't wipe the seeded payload — that's the silent-wipe footgun
 * documented separately. The test simulates a cross-tab write by
 * directly setting localStorage and dispatching a `storage` event,
 * which is what real browsers do for OTHER-tab writes.
 */
describe('FUTURE — multi-tab persistence sync (not yet implemented)', () => {
  it('a cross-tab write propagates to all open tabs of the same form', async () => {
    const { fingerprintZodSchema } = await import('../../src/runtime/adapters/zod-v4/fingerprint')
    const { hashStableString } = await import('../../src/runtime/core/hash')
    const { vRegister } = await import('../../src/runtime/core/directive')
    const { withDirectives, nextTick } = await import('vue')
    const { waitUntil } = await import('../utils/form-harness')

    const formKey = `future-multitab-${Math.random().toString(36).slice(2)}`
    const storageKey = `${formKey}:${hashStableString(fingerprintZodSchema(schema))}`

    // Clean slate.
    localStorage.removeItem(storageKey)

    // Mount Tab A with per-input opt-in (so the writer doesn't wipe
    // the seeded payload below — that's the documented enable
    // pattern). Type a baseline so the persistence layer materialises
    // an envelope.
    const handle: { api?: ReturnType<typeof useForm<typeof schema>>; el?: HTMLInputElement } = {}
    const App = defineComponent({
      setup() {
        const api = useForm({
          schema,
          key: formKey,
          persist: { storage: 'local', debounceMs: 5 },
          defaultValues: { name: '', email: '' },
        })
        handle.api = api
        return () =>
          h(
            'div',
            withDirectives(
              h('input', {
                ref: (el: unknown): void => {
                  if (el !== null) handle.el = el as HTMLInputElement
                },
              }),
              [[vRegister, api.register('name', { persist: true })]]
            )
          )
      },
    })
    const app = createApp(App).use(createAttaform({ override: true }))
    const root = document.createElement('div')
    document.body.appendChild(root)
    app.mount(root)

    // Type into the input so the writer materialises a payload.
    const el = handle.el as HTMLInputElement
    el.value = 'tab-A-typed'
    el.dispatchEvent(new Event('input', { bubbles: true }))
    await nextTick()
    await waitUntil(() => (localStorage.getItem(storageKey) !== null ? true : null))

    const api = handle.api as ReturnType<typeof useForm<typeof schema>>
    expect(api.values.name).toBe('tab-A-typed')

    // Simulate Tab B writing to the same key. Cross-tab writes fire
    // a `storage` event on every OTHER tab — Tab A here.
    const newPayload = JSON.stringify({
      v: 4,
      data: { form: { name: 'tab-B-typed' } },
    })
    localStorage.setItem(storageKey, newPayload)
    window.dispatchEvent(
      new StorageEvent('storage', {
        key: storageKey,
        newValue: newPayload,
        oldValue: null,
        storageArea: localStorage,
      })
    )

    // Tab A's form value should converge to the cross-tab write
    // within a small window. Today: it doesn't (no storage-event
    // listener wired). When a future PR wires the subscription,
    // this assertion passes and CI goes green.
    await waitUntil(() => (api.values.name === 'tab-B-typed' ? true : null), 500)
    expect(api.values.name).toBe('tab-B-typed')

    app.unmount()
    document.body.removeChild(root)
    localStorage.removeItem(storageKey)
  })
})
