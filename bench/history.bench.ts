/**
 * Phase 5.9 — history overhead on the mutation path.
 *
 * Measures `applyFormReplacement` cost with history enabled vs
 * disabled, on a 100-leaf form. With history on, each mutation
 * captures a snapshot (shallow-clones the errors Map) and pushes
 * it onto the undo stack — expect a modest constant-factor
 * penalty but no quadratic growth.
 *
 * No regression gate (no `old:` / `new:` pair). Reports numbers
 * for inspection.
 */

import { bench, describe } from 'vitest'
import { createFormStore } from '../src/runtime/core/create-form-store'
import { createHistoryModule } from '../src/runtime/core/history'
import { fakeSchema } from '../test/utils/fake-schema'

type Form = Record<string, unknown>

function buildLeaves(count: number): Form {
  const form: Form = {}
  for (let i = 0; i < count; i++) form[`field${i}`] = `value${i}`
  return form
}

const defaults100 = buildLeaves(100)

describe('history: applyFormReplacement with / without history', () => {
  bench('history disabled — applyFormReplacement baseline', () => {
    const state = createFormStore<Form>({
      formKey: 'bench',
      schema: fakeSchema<Form>(defaults100),
    })
    state.setValueAtPath(['field0'], 'mutated')
    state.setValueAtPath(['field1'], 'mutated')
    state.setValueAtPath(['field2'], 'mutated')
  })

  bench('history enabled — 3 mutations, 3 snapshots pushed', () => {
    const state = createFormStore<Form>({
      formKey: 'bench',
      schema: fakeSchema<Form>(defaults100),
    })
    const history = createHistoryModule(state, true)
    state.setValueAtPath(['field0'], 'mutated')
    state.setValueAtPath(['field1'], 'mutated')
    state.setValueAtPath(['field2'], 'mutated')
    history.dispose()
  })
})
