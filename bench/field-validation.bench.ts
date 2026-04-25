/**
 * Phase 5.7 — field-validation overhead on the keystroke path.
 *
 * Sanity check: with `fieldValidation: { on: 'none' }` (or the option
 * omitted entirely), `setValueAtPath` should have near-zero overhead
 * vs a baseline without the feature in the tree. With `on: 'change'`,
 * setValueAtPath does one Map lookup + one setTimeout per keystroke —
 * expect a modest constant-factor penalty but no allocation / schedule
 * storm under rapid typing.
 *
 * No regression gate (no `old:` / `new:` pair). This bench reports
 * numbers for inspection. If any mode drops below a few hundred-thousand
 * ops/sec we've likely introduced a quadratic or per-keystroke
 * allocation.
 */

import { bench, describe } from 'vitest'
import { createFormStore } from '../src/runtime/core/create-form-store'
import { fakeSchema } from '../test/utils/fake-schema'

type Form = { email: string; password: string; nickname: string }
const defaults: Form = { email: '', password: '', nickname: '' }

function makeState(
  fieldValidation?: Parameters<typeof createFormStore<Form>>[0]['fieldValidation']
) {
  return createFormStore<Form>({
    formKey: 'bench',
    schema: fakeSchema<Form>(defaults),
    ...(fieldValidation ? { fieldValidation } : {}),
  })
}

describe('fieldValidation: setValueAtPath overhead per keystroke', () => {
  bench('fieldValidation: omitted (baseline)', () => {
    const state = makeState()
    state.setValueAtPath(['email'], 'a')
  })

  bench('fieldValidation: { on: "none" } — explicit no-op', () => {
    const state = makeState({ on: 'none' })
    state.setValueAtPath(['email'], 'a')
  })

  bench('fieldValidation: { on: "change", debounceMs: 200 } — timer scheduled each call', () => {
    // Uses real setTimeout; the timer is scheduled + cancelled on the
    // next call, so steady-state cost is one Map lookup + one
    // clearTimeout + one setTimeout per keystroke.
    const state = makeState({ on: 'change', debounceMs: 200 })
    state.setValueAtPath(['email'], 'a')
    // Tear down the scheduled timer so it doesn't fire after the bench
    // run completes.
    state.cancelFieldValidation()
  })
})
