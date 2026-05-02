/**
 * Phase 5.7 — field-validation overhead on the keystroke path.
 *
 * Sanity check: with `validateOn: 'submit'` (or the options omitted
 * entirely), `setValueAtPath` should have near-zero overhead vs a
 * baseline without the feature in the tree. With `validateOn: 'change'`
 * + a positive `debounceMs`, setValueAtPath does one Map lookup + one
 * setTimeout per keystroke — expect a modest constant-factor penalty
 * but no allocation / schedule storm under rapid typing.
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

function makeState(opts?: { validateOn?: 'change' | 'blur' | 'submit'; debounceMs?: number }) {
  return createFormStore<Form>({
    formKey: 'bench',
    schema: fakeSchema<Form>(defaults),
    ...(opts?.validateOn !== undefined ? { validateOn: opts.validateOn } : {}),
    ...(opts?.debounceMs !== undefined ? { debounceMs: opts.debounceMs } : {}),
  })
}

describe('fieldValidation: setValueAtPath overhead per keystroke', () => {
  bench('validateOn: omitted (baseline — defaults to "change", debounceMs: 0)', () => {
    const state = makeState()
    state.setValueAtPath(['email'], 'a')
  })

  bench('validateOn: "submit" — explicit no-op', () => {
    const state = makeState({ validateOn: 'submit' })
    state.setValueAtPath(['email'], 'a')
  })

  bench('validateOn: "change", debounceMs: 200 — timer scheduled each call', () => {
    // Uses real setTimeout; the timer is scheduled + cancelled on the
    // next call, so steady-state cost is one Map lookup + one
    // clearTimeout + one setTimeout per keystroke.
    const state = makeState({ validateOn: 'change', debounceMs: 200 })
    state.setValueAtPath(['email'], 'a')
    // Tear down the scheduled timer so it doesn't fire after the bench
    // run completes.
    state.cancelFieldValidation()
  })
})
