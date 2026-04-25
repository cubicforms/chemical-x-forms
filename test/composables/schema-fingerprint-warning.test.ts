// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, defineComponent, h } from 'vue'
import { z } from 'zod'
import { useForm as useZodForm } from '../../src/zod'
import { useForm } from '../../src'
import { createChemicalXForms } from '../../src/runtime/core/plugin'
import { fakeSchema } from '../utils/fake-schema'

/**
 * Shared-key collision detection.
 *
 * Two `useForm({ key: 'x', schema })` calls resolve to the same
 * `FormStore` by design — the shared-store semantic. When the second
 * call's schema has a different structural fingerprint from the
 * first's, the library emits a dev-mode `console.warn` naming both
 * fingerprints. The second call's schema is silently ignored in
 * favour of the first's (matching the existing "only first caller
 * wires the state" behaviour).
 *
 * NOTE: `useAbstractForm` also emits a separate `console.warn` from
 * `warnOnDuplicateAmbientProvide` when two `useForm()` calls run in
 * the same component (covers the anonymous-forms footgun — see PR
 * #117). The fixtures here deliberately use that pattern to drive
 * the shared-store resolution, so every test filters `warnSpy.mock.calls`
 * by the fingerprint-warning marker rather than asserting the spy's
 * raw call count. The fingerprint-warning marker is `"use different
 * schemas"` — unique to this subsystem.
 */

const FINGERPRINT_WARN_MARKER = 'use different schemas'

type Form = { name: string }
const defaults: Form = { name: '' }

describe('schema-fingerprint shared-key warning', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>
  let errorSpy: ReturnType<typeof vi.spyOn>
  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
  })
  afterEach(() => {
    warnSpy.mockRestore()
    errorSpy.mockRestore()
  })

  const fingerprintWarnCalls = (): readonly unknown[][] =>
    warnSpy.mock.calls.filter((args: readonly unknown[]) =>
      String(args[0] ?? '').includes(FINGERPRINT_WARN_MARKER)
    )

  function mountTwo(
    schemaA: ReturnType<typeof fakeSchema<Form>>,
    schemaB: ReturnType<typeof fakeSchema<Form>>
  ): () => void {
    const App = defineComponent({
      setup() {
        useForm<Form>({ schema: schemaA, key: 'shared-form' })
        useForm<Form>({ schema: schemaB, key: 'shared-form' })
        return () => h('div')
      },
    })
    const app = createApp(App).use(createChemicalXForms())
    const root = document.createElement('div')
    document.body.appendChild(root)
    app.mount(root)
    return () => app.unmount()
  }

  it('stays silent when two useForm calls use the same fingerprint', () => {
    const schemaA = fakeSchema<Form>(defaults, undefined, 'fp:same')
    const schemaB = fakeSchema<Form>(defaults, undefined, 'fp:same')
    const unmount = mountTwo(schemaA, schemaB)
    expect(fingerprintWarnCalls()).toHaveLength(0)
    unmount()
  })

  it('warns when the second call uses a different fingerprint', () => {
    const schemaA = fakeSchema<Form>(defaults, undefined, 'fp:first')
    const schemaB = fakeSchema<Form>(defaults, undefined, 'fp:second')
    const unmount = mountTwo(schemaA, schemaB)
    const calls = fingerprintWarnCalls()
    expect(calls).toHaveLength(1)
    const message = String(calls[0]?.[0] ?? '')
    expect(message).toContain('shared-form')
    expect(message).toContain('fp:first')
    expect(message).toContain('fp:second')
    unmount()
  })

  it('catches adapter-thrown fingerprint exceptions and surfaces them in dev', () => {
    // A misbehaving adapter that throws from .fingerprint() must
    // NOT crash the form lifecycle — we allow the inconsistency
    // and skip the mismatch check. In dev the exception is logged
    // via console.error so the adapter bug is visible; no mismatch
    // warning fires because the comparison never ran.
    const throwing = fakeSchema<Form>(defaults, undefined, 'fp:base')
    const thrown = new Error('adapter bug')
    throwing.fingerprint = () => {
      throw thrown
    }
    const second = fakeSchema<Form>(defaults, undefined, 'fp:other')
    const unmount = mountTwo(throwing, second)
    expect(fingerprintWarnCalls()).toHaveLength(0)
    expect(errorSpy).toHaveBeenCalledTimes(1)
    const [message, errArg] = errorSpy.mock.calls[0] ?? []
    expect(String(message)).toContain('shared-form')
    expect(String(message)).toContain('fingerprint()')
    expect(errArg).toBe(thrown)
    unmount()
  })

  it('no false positive on shared key with zod factory default', () => {
    // Regression: before the idempotence fix in the v4 walker,
    // `.default(() => new Date())` made `.fingerprint()` return a
    // different string on every call (the getter re-invoked the
    // factory). At warning-check time we compare the stored
    // schema's fingerprint vs the incoming schema's fingerprint —
    // even when they're the SAME reference, the two calls could
    // produce different strings and falsely fire the warning. With
    // the fix, factory defaults collapse to `fn:*` and the
    // fingerprint is stable across calls.
    const schema = z.object({ created: z.date().default(() => new Date()) })
    const App = defineComponent({
      setup() {
        useZodForm({ schema, key: 'factory-default-form' })
        useZodForm({ schema, key: 'factory-default-form' })
        return () => h('div')
      },
    })
    const app = createApp(App).use(createChemicalXForms())
    const root = document.createElement('div')
    document.body.appendChild(root)
    app.mount(root)
    expect(fingerprintWarnCalls()).toHaveLength(0)
    app.unmount()
  })
})
