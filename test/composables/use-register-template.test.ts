// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { baseCompile } from '@vue/compiler-core'
import { createApp, defineComponent, nextTick, type App } from 'vue'
import * as VueRuntime from 'vue'
import { z } from 'zod'
import { useForm } from '../../src/zod'
import { useRegister } from '../../src/runtime/composables/use-register'
import { vRegister } from '../../src/runtime/core/directive'
import { createChemicalXForms } from '../../src/runtime/core/plugin'
import { inputTextAreaNodeTransform } from '../../src/runtime/lib/core/transforms/input-text-area-transform'
import { selectNodeTransform } from '../../src/runtime/lib/core/transforms/select-transform'
import { vRegisterHintTransform } from '../../src/runtime/lib/core/transforms/v-register-hint-transform'
import { vRegisterPreambleTransform } from '../../src/runtime/lib/core/transforms/v-register-preamble-transform'

/**
 * End-to-end template-compiled tests for the useRegister + inner
 * `<input v-register>` pattern. Existing runtime tests use
 * `withDirectives(h(...))` synthetically; transform tests assert
 * compile output strings. This file closes the gap: it COMPILES
 * actual template strings through the production transform stack,
 * evaluates the result into a render function, and mounts the
 * components — proving the full pipeline (compile-time bridge prop
 * injection → runtime attrs strip → child useRegister → inner
 * v-register on a DOM input) works as one piece.
 *
 * The compiler stack mirrors `src/vite.ts`'s production order:
 *   1. selectNodeTransform — injects :value + :registerValue on
 *      <Component v-register> nodes; parent-side bridge
 *   2. inputTextAreaNodeTransform — text-input compile-time hooks
 *   3. vRegisterPreambleTransform — preamble for v-register
 *   4. vRegisterHintTransform — hints / dev-warns
 *
 * The directive itself is registered globally by
 * `createChemicalXForms()` (the app plugin), matching what consumer
 * apps do.
 */

const schema = z.object({ email: z.string(), name: z.string() })

async function flush(): Promise<void> {
  for (let i = 0; i < 4; i++) {
    await Promise.resolve()
    await nextTick()
  }
}

/**
 * Compile a template string through the production transform stack
 * and evaluate it to a render function. `mode: 'function'` produces
 * `const _Vue = Vue\n return function render(_ctx, _cache) { ... }`,
 * which we wrap in `new Function('Vue', code)(VueRuntime)` to bind
 * Vue helpers in scope.
 */
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
  // `Function` is intentional here — the compiler is trusted (vendored
  // Vue) and the only inputs are static template strings inside this
  // test file.

  return new Function('Vue', code)(VueRuntime) as (...args: unknown[]) => unknown
}

describe('useRegister — template-compiled v-register reaches inner input', () => {
  let app: App | undefined

  afterEach(() => {
    app?.unmount()
    app = undefined
    document.body.innerHTML = ''
  })

  it('parent + child compiled templates: typing in the inner <input v-register> writes to the form', async () => {
    // Child SFC equivalent: <label><input v-register="register" /></label>.
    // After compilation, the `v-register` directive on the inner input
    // is resolved against the globally-registered `register` directive
    // (see createChemicalXForms()). The render function reads
    // `register` from setup return.
    const Child = defineComponent({
      name: 'Child',
      setup() {
        const register = useRegister()
        return { register }
      },
      render: compileTemplateToRender(
        `<label class="wrapper"><input v-register="register" class="inner" /></label>`
      ),
    })

    // Parent SFC equivalent: <Child v-register="form.register('email')" />.
    // The select-transform's component branch fires on `<Child>`,
    // injects `:value` and `:registerValue` props. At runtime,
    // useRegister captures registerValue and strips both bridge keys
    // from instance.attrs (no DOM leak on the wrapper).
    const captured: { api?: ReturnType<typeof useForm<typeof schema>> } = {}
    const Parent = defineComponent({
      components: { Child },
      setup() {
        const form = useForm({ schema, key: 'use-register-template-test' })
        captured.api = form
        return { form }
      },
      render: compileTemplateToRender(`<Child v-register="form.register('email')" />`),
    })

    app = createApp(Parent).use(createChemicalXForms())
    const root = document.createElement('div')
    document.body.appendChild(root)
    app.mount(root)
    await flush()

    if (captured.api === undefined) throw new Error('unreachable')

    // The wrapper <label> is the rendered root of Child. Bridge attrs
    // were stripped — verify the DOM is clean (the user's primary
    // architectural concern).
    const wrapper = root.querySelector('label.wrapper')
    expect(wrapper).not.toBeNull()
    expect(wrapper?.hasAttribute('registerValue')).toBe(false)
    expect(wrapper?.hasAttribute('value')).toBe(false)

    // The inner input is the directive-bound element. Typing fires
    // the input listener installed by vRegister's text-input variant,
    // which calls the assigner → form.setValue. Form state updates.
    const innerInput = root.querySelector('input.inner') as HTMLInputElement | null
    expect(innerInput).not.toBeNull()
    if (innerInput === null) throw new Error('unreachable')

    innerInput.value = 'typed-via-template'
    innerInput.dispatchEvent(new Event('input', { bubbles: true }))
    await flush()

    expect(captured.api.values.email).toBe('typed-via-template')
  })

  it('focus on the inner input flips the form-state focused flag (template-compiled)', async () => {
    const Child = defineComponent({
      name: 'Child',
      setup() {
        const register = useRegister()
        return { register }
      },
      render: compileTemplateToRender(
        `<label><input v-register="register" class="inner" /></label>`
      ),
    })

    const captured: { api?: ReturnType<typeof useForm<typeof schema>> } = {}
    const Parent = defineComponent({
      components: { Child },
      setup() {
        const form = useForm({ schema, key: 'use-register-template-focus-test' })
        captured.api = form
        return { form }
      },
      render: compileTemplateToRender(`<Child v-register="form.register('email')" />`),
    })

    app = createApp(Parent).use(createChemicalXForms())
    const root = document.createElement('div')
    document.body.appendChild(root)
    app.mount(root)
    await flush()

    if (captured.api === undefined) throw new Error('unreachable')

    const innerInput = root.querySelector('input.inner') as HTMLInputElement | null
    expect(innerInput).not.toBeNull()
    if (innerInput === null) throw new Error('unreachable')

    innerInput.focus()
    innerInput.dispatchEvent(new Event('focus', { bubbles: true }))
    await flush()

    // The inner input is what FormStore registered (via the directive
    // that landed on it from the inner `<input v-register>`). Focus
    // listeners are installed at registerElement time on that element.
    expect(captured.api.fields.email.focused).toBe(true)
  })

  // Direct assertion that the directive used in the template path is
  // the one we exported. If global registration in the plugin ever
  // drifted, this would catch it before the consumer-facing template
  // started silently no-op'ing.
  it('the globally-registered v-register directive is the same vRegister this lib exports', () => {
    const probe = createApp({ render: () => null })
    probe.use(createChemicalXForms())
    expect(probe._context.directives['register']).toBe(vRegister)
  })
})
