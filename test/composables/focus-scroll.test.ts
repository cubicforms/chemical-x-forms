// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, defineComponent, h } from 'vue'
import { useForm } from '../../src'
import { createChemicalXForms } from '../../src/runtime/core/plugin'
import { fakeSchema } from '../utils/fake-schema'

type Form = {
  email: string
  password: string
  nickname: string
}
const defaults: Form = { email: '', password: '', nickname: '' }

/**
 * The focus/scroll helpers operate on the DOM elements registered via
 * v-register. This suite mounts a real tree against jsdom so
 * registerElement sees actual HTMLElements; the helpers walk
 * state.errors → state.elements to pick the first visible, connected
 * target.
 */

function mountWith(options: {
  errorsFor: (keyof Form)[]
  onInvalidSubmit?: 'focus-first-error' | 'scroll-to-first-error' | 'both' | 'none'
  hideField?: keyof Form | null
  detachField?: keyof Form | null
}) {
  type Returned = ReturnType<typeof useForm<Form>>
  const handle: { api?: Returned } = {}

  const App = defineComponent({
    setup() {
      const validator = (_data: unknown, _path: string | undefined) => {
        const errors = options.errorsFor.map((k) => ({
          message: `${k} is bad`,
          path: [k as string],
          formKey: 'focus-scroll-form',
        }))
        return {
          data: undefined,
          errors,
          success: false as const,
          formKey: 'focus-scroll-form',
        }
      }
      const useOpts: Parameters<typeof useForm<Form>>[0] = {
        schema: fakeSchema<Form>(defaults, validator),
        key: 'focus-scroll-form',
      }
      if (options.onInvalidSubmit !== undefined) useOpts.onInvalidSubmit = options.onInvalidSubmit
      handle.api = useForm<Form>(useOpts)

      return () => {
        const childNodes: ReturnType<typeof h>[] = []
        for (const name of Object.keys(defaults) as (keyof Form)[]) {
          if (options.detachField === name) continue
          // register's type is branded to RegisterFlatPath<Form>; cast
          // through `unknown` so TS accepts the dynamically-chosen key.
          // (Fine in a test — the field names we loop over are exactly
          // the ones the form's shape declares.)
          const reg = handle.api?.register(
            name as unknown as Parameters<NonNullable<typeof handle.api>['register']>[0]
          )
          const style = options.hideField === name ? 'display:none' : ''
          childNodes.push(
            h('input', {
              ref: (el: unknown) => {
                if (el instanceof HTMLInputElement && reg) {
                  reg.registerElement(el)
                }
              },
              name,
              style,
              'data-field': name,
            })
          )
        }
        return h('form', childNodes)
      }
    },
  })

  const app = createApp(App).use(createChemicalXForms({ override: true }))
  const root = document.createElement('div')
  document.body.appendChild(root)
  app.mount(root)
  return { app, api: handle.api as Returned, root }
}

describe('focusFirstError / scrollToFirstError', () => {
  let focusSpy: ReturnType<typeof vi.spyOn>
  let scrollSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    // jsdom doesn't implement scrollIntoView; stub it so vi.spyOn can
    // wrap the prototype method.
    if (typeof HTMLElement.prototype.scrollIntoView !== 'function') {
      HTMLElement.prototype.scrollIntoView = function scrollIntoView() {
        return undefined
      }
    }
    focusSpy = vi.spyOn(HTMLElement.prototype, 'focus')
    scrollSpy = vi.spyOn(HTMLElement.prototype, 'scrollIntoView')
    // jsdom doesn't implement offsetParent per layout; force a truthy
    // value so elements look "visible" to the helper's visibility check.
    // Hidden-element coverage overrides this per-test via the style.
    Object.defineProperty(HTMLElement.prototype, 'offsetParent', {
      configurable: true,
      get(this: HTMLElement) {
        return this.style.display === 'none' ? null : this.parentNode
      },
    })
  })

  afterEach(() => {
    // Detach the prototype-level spies so the next test (in file or
    // workspace) doesn't see call counts from ours. Without this,
    // vi.spyOn stacks on the same prototype method and counts leak.
    focusSpy.mockRestore()
    scrollSpy.mockRestore()
  })

  it('focusFirstError returns false and no-ops when there are no errors', () => {
    const { api, app } = mountWith({ errorsFor: [] })
    expect(api.focusFirstError()).toBe(false)
    expect(focusSpy).not.toHaveBeenCalled()
    app.unmount()
  })

  it('focusFirstError focuses the first errored field', () => {
    const { api, app } = mountWith({ errorsFor: ['email', 'password'] })
    // Populate errors by running handleSubmit (the validator above
    // returns failure with the listed fields).
    const submit = api.handleSubmit(async () => {})
    return submit().then(() => {
      expect(api.focusFirstError()).toBe(true)
      expect(focusSpy).toHaveBeenCalled()
      // Instance on which focus was called should be the 'email' input.
      const focusedEl = focusSpy.mock.instances[0] as HTMLInputElement | undefined
      expect(focusedEl?.getAttribute('data-field')).toBe('email')
      app.unmount()
    })
  })

  it('scrollToFirstError scrolls the first errored field', () => {
    const { api, app } = mountWith({ errorsFor: ['password'] })
    const submit = api.handleSubmit(async () => {})
    return submit().then(() => {
      expect(api.scrollToFirstError({ block: 'start' })).toBe(true)
      expect(scrollSpy).toHaveBeenCalledWith({ block: 'start' })
      app.unmount()
    })
  })

  it('skips hidden (display:none) fields and targets the next errored field', () => {
    const { api, app } = mountWith({ errorsFor: ['email', 'password'], hideField: 'email' })
    const submit = api.handleSubmit(async () => {})
    return submit().then(() => {
      expect(api.focusFirstError()).toBe(true)
      const focusedEl = focusSpy.mock.instances[0] as HTMLInputElement | undefined
      expect(focusedEl?.getAttribute('data-field')).toBe('password')
      app.unmount()
    })
  })

  it('returns false when every errored field is detached from the DOM', () => {
    const { api, app } = mountWith({ errorsFor: ['email'], detachField: 'email' })
    const submit = api.handleSubmit(async () => {})
    return submit().then(() => {
      expect(api.focusFirstError()).toBe(false)
      expect(focusSpy).not.toHaveBeenCalled()
      app.unmount()
    })
  })
})

describe('onInvalidSubmit policy wiring', () => {
  let focusSpy: ReturnType<typeof vi.spyOn>
  let scrollSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    // vi.spyOn on the first describe restores scrollIntoView back to
    // jsdom's (missing) state at teardown — re-stub before re-spying.
    if (typeof HTMLElement.prototype.scrollIntoView !== 'function') {
      HTMLElement.prototype.scrollIntoView = function scrollIntoView() {
        return undefined
      }
    }
    focusSpy = vi.spyOn(HTMLElement.prototype, 'focus')
    scrollSpy = vi.spyOn(HTMLElement.prototype, 'scrollIntoView')
    Object.defineProperty(HTMLElement.prototype, 'offsetParent', {
      configurable: true,
      get(this: HTMLElement) {
        return this.style.display === 'none' ? null : this.parentNode
      },
    })
  })

  afterEach(() => {
    focusSpy.mockRestore()
    scrollSpy.mockRestore()
  })

  it('focus-first-error: submit failure focuses the first errored field', async () => {
    const { api, app } = mountWith({
      errorsFor: ['email'],
      onInvalidSubmit: 'focus-first-error',
    })
    await api.handleSubmit(async () => {})()
    expect(focusSpy).toHaveBeenCalled()
    expect(scrollSpy).not.toHaveBeenCalled()
    app.unmount()
  })

  it('scroll-to-first-error: submit failure scrolls, does not focus', async () => {
    const { api, app } = mountWith({
      errorsFor: ['email'],
      onInvalidSubmit: 'scroll-to-first-error',
    })
    await api.handleSubmit(async () => {})()
    expect(scrollSpy).toHaveBeenCalled()
    expect(focusSpy).not.toHaveBeenCalled()
    app.unmount()
  })

  it('both: scrolls first then focuses with preventScroll', async () => {
    const { api, app } = mountWith({
      errorsFor: ['email'],
      onInvalidSubmit: 'both',
    })
    await api.handleSubmit(async () => {})()
    expect(scrollSpy).toHaveBeenCalled()
    expect(focusSpy).toHaveBeenCalledWith({ preventScroll: true })
    app.unmount()
  })

  it('none (default): submit failure does not touch focus or scroll', async () => {
    const { api, app } = mountWith({ errorsFor: ['email'] })
    await api.handleSubmit(async () => {})()
    expect(focusSpy).not.toHaveBeenCalled()
    expect(scrollSpy).not.toHaveBeenCalled()
    app.unmount()
  })
})
