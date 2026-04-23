/**
 * Phase 9.10 bench: `reset()` on a mid-sized form.
 *
 * Reset reseeds the form from schema defaults and clears errors +
 * field records. It walks `originals` + `errors` + `fields` maps and
 * replaces each. On a 500-leaf form this is the kind of operation
 * where an O(N²) regression would be invisible until a user hits it
 * at scale. The bench keeps an eye on the cost per reset.
 *
 * Reported absolute throughput; no regression floor gating yet.
 */
import { bench, describe } from 'vitest'
import { createSSRApp, defineComponent, h } from 'vue'
import { renderToString } from '@vue/server-renderer'
import { z } from 'zod'
import { useForm } from '../src/runtime/adapters/zod-v4'
import { createChemicalXForms } from '../src/runtime/core/plugin'

// 100 leaves via 10 groups of 10 fields each. Enough shape for the
// originals / fields maps to have real data without making each bench
// iteration prohibitively slow.
function buildSchema(groups: number, fieldsPerGroup: number) {
  const shape: Record<string, z.ZodObject> = {}
  for (let g = 0; g < groups; g++) {
    const groupShape: Record<string, z.ZodString> = {}
    for (let f = 0; f < fieldsPerGroup; f++) {
      groupShape[`f${f}`] = z.string()
    }
    shape[`g${g}`] = z.object(groupShape)
  }
  return z.object(shape)
}

const schema = buildSchema(10, 10)

function mount() {
  let captured: ReturnType<typeof useForm<typeof schema>> | undefined
  const App = defineComponent({
    setup() {
      captured = useForm({ schema, key: `bench-reset-${Math.random()}` })
      return () => h('div')
    },
  })
  const app = createSSRApp(App)
  app.use(createChemicalXForms({ override: true }))
  void renderToString(app)
  if (captured === undefined) throw new Error('useForm setup did not run')
  return captured
}

describe('reset: 100-leaf object form', () => {
  const form = mount()
  // Dirty every leaf before each run so reset has real work to do —
  // leaving the form pristine would make reset a near-no-op.
  bench(
    'reset() — full baseline rebuild',
    () => {
      form.reset()
    },
    {
      setup: () => {
        for (let g = 0; g < 10; g++) {
          for (let f = 0; f < 10; f++) {
            form.setValue(`g${g}.f${f}` as never, `x-${Math.random()}` as never)
          }
        }
      },
    }
  )
})
