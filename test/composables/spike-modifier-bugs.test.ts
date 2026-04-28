// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { baseCompile } from '@vue/compiler-core'
import { createApp, defineComponent, nextTick, type App } from 'vue'
import * as VueRuntime from 'vue'
import { z } from 'zod'
import { useForm } from '../../src/zod'
import { createChemicalXForms } from '../../src/runtime/core/plugin'
import { inputTextAreaNodeTransform } from '../../src/runtime/lib/core/transforms/input-text-area-transform'
import { selectNodeTransform } from '../../src/runtime/lib/core/transforms/select-transform'
import { vRegisterHintTransform } from '../../src/runtime/lib/core/transforms/v-register-hint-transform'
import { vRegisterPreambleTransform } from '../../src/runtime/lib/core/transforms/v-register-preamble-transform'

/**
 * Regression coverage for the two spike-reported bugs in section 16
 * (v-register modifiers):
 *
 *   16b. `<input v-register.trim>` — typing a leading or trailing
 *        space made the spacebar appear unusable. The transient
 *        whitespace was clobbered by Vue's `:value` patch on the
 *        next render. Trace: input listener trims → setValue('')
 *        → form.value identity replaced (even with no semantic
 *        change) → Vue re-renders the input → :value binding's
 *        patchDOMProp compares against the live DOM `el.value`
 *        (which has the user's space) and writes the trimmed
 *        value back, wiping the space.
 *
 *   16e. `<input type="number">` — backspacing from "1" to empty
 *        triggered a noisy slim-primitive-gate dev warning. The
 *        directive's auto-cast for `type="number"` ran
 *        `looseToNumber('')` which returned the input string
 *        unchanged, then setValue('') was rejected by the gate
 *        (string heading to a numeric slot).
 *
 * Both tests mount real components through the production
 * transform stack (mirroring `src/vite.ts` order) and simulate the
 * exact keystroke sequence the user reported. Pre-fix, both tests
 * fail; post-fix, both pass.
 */

async function flush(): Promise<void> {
  for (let i = 0; i < 4; i++) {
    await Promise.resolve()
    await nextTick()
  }
}

function compileTemplateToRender(template: string): (...args: unknown[]) => unknown {
  const { code } = baseCompile(template, {
    mode: 'function',
    prefixIdentifiers: false,
    nodeTransforms: [
      selectNodeTransform,
      inputTextAreaNodeTransform,
      vRegisterPreambleTransform,
      vRegisterHintTransform,
    ],
  })
  return new Function('Vue', code)(VueRuntime) as (...args: unknown[]) => unknown
}

describe('regression: 16b — `<input v-register.trim>` spacebar after content', () => {
  let app: App | undefined
  let warnSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    document.body.innerHTML = ''
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  })

  afterEach(() => {
    app?.unmount()
    app = undefined
    document.body.innerHTML = ''
    warnSpy.mockRestore()
  })

  it('typing a trailing space after content preserves the space in the DOM', async () => {
    const root = document.createElement('div')
    document.body.appendChild(root)

    const App = defineComponent({
      setup() {
        const form = useForm({
          schema: z.object({ field: z.string() }),
          key: 'spike-16b-trailing-space',
          defaultValues: { field: '' },
        })
        return { form }
      },
      render: compileTemplateToRender(
        `<input v-register.trim="form.register('field')" class="probe" />`
      ),
    })

    app = createApp(App)
    app.use(createChemicalXForms({ override: false }))
    app.mount(root)
    await flush()

    const input = root.querySelector<HTMLInputElement>('input.probe')
    if (input === null) throw new Error('input not rendered')

    // Type "hello".
    input.focus()
    input.value = 'hello'
    input.dispatchEvent(new Event('input'))
    await flush()
    expect(input.value).toBe('hello')

    // Type a trailing space. The trim modifier strips it before
    // setValue, so the form value stays "hello". The user's space
    // must remain visible in the DOM so they can keep typing.
    input.value = 'hello '
    input.dispatchEvent(new Event('input'))
    await flush()
    expect(input.value).toBe('hello ')

    // Type the next character. The internal space survives —
    // String.prototype.trim() only strips leading/trailing.
    input.value = 'hello w'
    input.dispatchEvent(new Event('input'))
    await flush()
    expect(input.value).toBe('hello w')
  })

  it('typing a single leading space into an empty `.trim` input keeps the space visible', async () => {
    const root = document.createElement('div')
    document.body.appendChild(root)

    const App = defineComponent({
      setup() {
        const form = useForm({
          schema: z.object({ field: z.string() }),
          key: 'spike-16b-leading-space',
          defaultValues: { field: '' },
        })
        return { form }
      },
      render: compileTemplateToRender(
        `<input v-register.trim="form.register('field')" class="probe" />`
      ),
    })

    app = createApp(App)
    app.use(createChemicalXForms({ override: false }))
    app.mount(root)
    await flush()

    const input = root.querySelector<HTMLInputElement>('input.probe')
    if (input === null) throw new Error('input not rendered')

    input.focus()
    input.value = ' '
    input.dispatchEvent(new Event('input'))
    await flush()

    // The user typed a space. With deferred trim the input listener
    // writes the raw " " to the model — DOM and model agree, Vue's
    // :value patch leaves el.value alone, the user's space stays
    // visible. The trim is committed later on blur (`change`).
    expect(input.value).toBe(' ')
  })
})

describe('regression: 16e — `<input type="number">` backspace-to-empty', () => {
  let app: App | undefined
  let warnSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    document.body.innerHTML = ''
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  })

  afterEach(() => {
    app?.unmount()
    app = undefined
    document.body.innerHTML = ''
    warnSpy.mockRestore()
  })

  it('typing "1" then backspace does not emit the slim-primitive-gate dev warning', async () => {
    const root = document.createElement('div')
    document.body.appendChild(root)

    const App = defineComponent({
      setup() {
        const form = useForm({
          schema: z.object({ count: z.number() }),
          key: 'spike-16e-backspace',
          defaultValues: { count: 0 },
        })
        return { form }
      },
      render: compileTemplateToRender(
        `<input v-register="form.register('count')" type="number" class="probe" />`
      ),
    })

    app = createApp(App)
    app.use(createChemicalXForms({ override: false }))
    app.mount(root)
    await flush()

    const input = root.querySelector<HTMLInputElement>('input.probe')
    if (input === null) throw new Error('input not rendered')

    input.focus()

    // Type "1".
    input.value = '1'
    input.dispatchEvent(new Event('input'))
    await flush()

    // Backspace to empty. Pre-fix the directive called setValue('')
    // which the slim-primitive gate rejected with a dev warning.
    // Post-fix the directive treats empty + castToNumber as a
    // transient mid-edit state and skips the assigner entirely.
    input.value = ''
    input.dispatchEvent(new Event('input'))
    await flush()

    const matched = warnSpy.mock.calls.filter((c: unknown[]) =>
      String(c[0]).includes('write rejected')
    )
    expect(matched.length).toBe(0)
  })
})
