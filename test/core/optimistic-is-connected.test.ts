// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { createFormStore } from '../../src/runtime/core/create-form-store'
import { buildRegister } from '../../src/runtime/core/register-api'
import { fakeSchema } from '../utils/fake-schema'

type F = { email: string; note: string }

function makeForm(opts: { isSSR: boolean }) {
  const state = createFormStore<F>({
    formKey: 'opt',
    schema: fakeSchema<F>({ email: '', note: '' }),
    isSSR: opts.isSSR,
  })
  return { state, register: buildRegister(state) }
}

describe('optimistic isConnected — FormStore.markConnectedOptimistically', () => {
  it('flips isConnected: true for the path when isSSR is true', () => {
    const { state } = makeForm({ isSSR: true })
    expect(state.getFieldRecord(['email'])?.isConnected).toBe(false)
    state.markConnectedOptimistically(['email'])
    expect(state.getFieldRecord(['email'])?.isConnected).toBe(true)
  })

  it('is a no-op when isSSR is false (client lifecycle is authoritative)', () => {
    // On the client, the directive's `created` hook is the source of
    // truth for isConnected. The optimistic-mark would be a stale
    // override risk if it fired here, so it MUST early-return.
    const { state } = makeForm({ isSSR: false })
    state.markConnectedOptimistically(['email'])
    expect(state.getFieldRecord(['email'])?.isConnected).toBe(false)
  })

  it('is idempotent — repeat calls keep isConnected: true without touching unrelated fields', () => {
    const { state } = makeForm({ isSSR: true })
    state.markConnectedOptimistically(['email'])
    state.markConnectedOptimistically(['email'])
    expect(state.getFieldRecord(['email'])?.isConnected).toBe(true)
    // Note: the transform never wraps a binding for `note`, so its record stays as-init.
    expect(state.getFieldRecord(['note'])?.isConnected).toBe(false)
  })

  it('preserves existing focus/touch flags when flipping isConnected', () => {
    // touchFieldRecord merges patches. The optimistic-mark flow must
    // not reset focused/touched/blurred state (in tests that path is
    // unlikely, but in real SSR a future patch could land in either order).
    const { state } = makeForm({ isSSR: true })
    state.markFocused(['email'], true)
    expect(state.getFieldRecord(['email'])?.focused).toBe(true)
    state.markConnectedOptimistically(['email'])
    expect(state.getFieldRecord(['email'])?.focused).toBe(true)
    expect(state.getFieldRecord(['email'])?.isConnected).toBe(true)
  })
})

describe('optimistic isConnected — RegisterValue.markConnectedOptimistically', () => {
  it('flips the path it was built for, not other paths', () => {
    const { state, register } = makeForm({ isSSR: true })
    const rv = register(['email'])
    rv.markConnectedOptimistically()
    expect(state.getFieldRecord(['email'])?.isConnected).toBe(true)
    expect(state.getFieldRecord(['note'])?.isConnected).toBe(false)
  })

  it('does nothing on the client even when called from a RegisterValue', () => {
    // Mirrors the FormStore-level no-op test, exercised via the public
    // surface that the AST-rewritten template actually invokes.
    const { state, register } = makeForm({ isSSR: false })
    const rv = register(['email'])
    rv.markConnectedOptimistically()
    expect(state.getFieldRecord(['email'])?.isConnected).toBe(false)
  })

  it('a register() call without the optimistic mark does NOT flip the flag', () => {
    // Negative case: register() called from setup that's never bound to
    // v-register receives no transform-injected markConnectedOptimistically()
    // invocation. Its field record stays isConnected: false on the
    // server. This keeps the flag honest for paths that aren't
    // actually rendered as DOM elements.
    const { state, register } = makeForm({ isSSR: true })
    register(['email']) // create RegisterValue but don't call the mark
    expect(state.getFieldRecord(['email'])?.isConnected).toBe(false)
  })
})
