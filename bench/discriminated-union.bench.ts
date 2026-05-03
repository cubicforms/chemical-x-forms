/**
 * Phase 9.10 bench: discriminated-union value assignment.
 *
 * The DU-aware walker (`zod-v4/path-walker.ts` + `discriminator.ts`)
 * kicks in whenever a form value lands on a DU-shaped path. A form
 * that flips `event.kind` back and forth exercises the walker's
 * option-filtering on every assignment. We measure the round-trip
 * cost of setValue + getValue under that load.
 *
 * Reported absolute throughput; no regression floor gating yet.
 */
import { bench, describe } from 'vitest'
import { createSSRApp, defineComponent, h } from 'vue'
import { renderToString } from '@vue/server-renderer'
import { z } from 'zod'
import { useForm } from '../src/runtime/adapters/zod-v4'
import { createDecant } from '../src/runtime/core/plugin'

const schema = z.object({
  event: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('click'), x: z.number(), y: z.number() }),
    z.object({ kind: z.literal('scroll'), delta: z.number() }),
    z.object({ kind: z.literal('keypress'), code: z.string(), meta: z.boolean() }),
  ]),
})

function mount() {
  let captured: ReturnType<typeof useForm<typeof schema>> | undefined
  const App = defineComponent({
    setup() {
      captured = useForm({ schema, key: `bench-du-${Math.random()}` })
      return () => h('div')
    },
  })
  const app = createSSRApp(App)
  app.use(createDecant({ override: true }))
  void renderToString(app)
  if (captured === undefined) throw new Error('useForm setup did not run')
  return captured
}

describe('discriminated-union: single-field assignment inside active branch', () => {
  const form = mount()
  // Seed the discriminant so every iteration measures the DU-walker path
  // into the `click` branch — otherwise the first bench calls can land on
  // a path the walker can't resolve and skew the ops/sec.
  const seed: { kind: 'click'; x: number; y: number } = { kind: 'click', x: 0, y: 0 }
  form.setValue('event' as never, seed as never)
  let i = 0
  bench('setValue(event.x, N)', () => {
    form.setValue('event.x' as never, (i++ % 100) as never)
  })
})

describe('discriminated-union: cross-branch flip x1000', () => {
  const form = mount()
  let toggle = 0
  bench('setValue(event, { kind: ... }) — full-branch replacement', () => {
    toggle = (toggle + 1) % 3
    const next =
      toggle === 0
        ? { kind: 'click' as const, x: 1, y: 2 }
        : toggle === 1
          ? { kind: 'scroll' as const, delta: 5 }
          : { kind: 'keypress' as const, code: 'a', meta: false }
    form.setValue('event' as never, next as never)
  })
})
