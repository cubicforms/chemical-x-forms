// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, defineComponent, h, nextTick, ref } from 'vue'
import { useForm } from '../../src'
import { injectForm } from '../../src/runtime/composables/use-form-context'
import type { Path } from '../../src/runtime/core/paths'
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
 * schemaErrors → userErrors → state.elements to pick the first visible,
 * connected target. Schema errors take focus priority over user errors
 * at the same path (matches the merged-read iteration order).
 */

function mountWith(options: {
  errorsFor: (keyof Form)[]
  onInvalidSubmit?: 'focus-first-error' | 'scroll-to-first-error' | 'both' | 'none'
  hideField?: keyof Form | null
  detachField?: keyof Form | null
  /**
   * Optional render order. When provided, fields are rendered in this
   * order instead of schema-declaration order — used by the DOM-order
   * regression test (template renders fields in a non-schema order).
   * Defaults to `Object.keys(defaults)` (schema order).
   */
  renderOrder?: (keyof Form)[]
}) {
  type Returned = ReturnType<typeof useForm<Form>>
  const handle: { api?: Returned } = {}

  const App = defineComponent({
    setup() {
      const validator = (_data: unknown, _path: Path | undefined) => {
        const errors = options.errorsFor.map((k) => ({
          message: `${k} is bad`,
          path: [k as string],
          formKey: 'focus-scroll-form',
          code: 'cx:test-fixture',
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
        const order = options.renderOrder ?? (Object.keys(defaults) as (keyof Form)[])
        for (const name of order) {
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

describe('focusFirstError — DOM-order semantics', () => {
  let focusSpy: ReturnType<typeof vi.spyOn>
  let scrollSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
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

  it('focuses the visually-first errored field, not schema-declaration first', async () => {
    // Schema declares email/password/nickname; template renders them
    // in REVERSE order. Errors on email + nickname. Pre-fix the focus
    // landed on `email` (schema-declaration first). Post-fix it lands
    // on `nickname` (rendered first in DOM order).
    const { api, app } = mountWith({
      errorsFor: ['email', 'nickname'],
      renderOrder: ['nickname', 'password', 'email'],
    })
    const submit = api.handleSubmit(async () => {})
    await submit()
    expect(api.focusFirstError()).toBe(true)
    const focusedEl = focusSpy.mock.instances.at(-1) as HTMLInputElement | undefined
    expect(focusedEl?.getAttribute('data-field')).toBe('nickname')
    app.unmount()
  })
})

describe('focusFirstError — shared-key form isolation', () => {
  let focusSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    if (typeof HTMLElement.prototype.scrollIntoView !== 'function') {
      HTMLElement.prototype.scrollIntoView = function scrollIntoView() {
        return undefined
      }
    }
    focusSpy = vi.spyOn(HTMLElement.prototype, 'focus')
    Object.defineProperty(HTMLElement.prototype, 'offsetParent', {
      configurable: true,
      get(this: HTMLElement) {
        return this.style.display === 'none' ? null : this.parentNode
      },
    })
  })

  afterEach(() => {
    focusSpy.mockRestore()
  })

  it("two useForm({ key }) callsites do not focus each other's elements", async () => {
    type ApiT = ReturnType<typeof useForm<Form>>
    const handles: { sidebar?: ApiT; main?: ApiT } = {}

    const validator = (_data: unknown, _path: Path | undefined) => ({
      data: undefined,
      errors: [
        {
          message: 'email is bad',
          path: ['email'],
          formKey: 'shared-form',
          code: 'cx:test-fixture' as string,
        },
      ],
      success: false as const,
      formKey: 'shared-form',
    })

    const SidebarForm = defineComponent({
      setup() {
        handles.sidebar = useForm<Form>({
          schema: fakeSchema<Form>(defaults, validator),
          key: 'shared-form',
        })
        return () => {
          const reg = handles.sidebar?.register('email')
          return h('input', {
            'data-mount': 'sidebar',
            ref: (el: unknown) => {
              if (el instanceof HTMLInputElement && reg) reg.registerElement(el)
            },
          })
        }
      },
    })

    const MainForm = defineComponent({
      setup() {
        handles.main = useForm<Form>({
          schema: fakeSchema<Form>(defaults, validator),
          key: 'shared-form',
        })
        return () => {
          const reg = handles.main?.register('email')
          return h('input', {
            'data-mount': 'main',
            ref: (el: unknown) => {
              if (el instanceof HTMLInputElement && reg) reg.registerElement(el)
            },
          })
        }
      },
    })

    const App = defineComponent({
      setup: () => () => h('div', [h(SidebarForm), h(MainForm)]),
    })

    const app = createApp(App).use(createChemicalXForms({ override: true }))
    const root = document.createElement('div')
    document.body.appendChild(root)
    app.mount(root)

    // Trigger validation on both APIs so the shared-store error map is
    // populated. Both submit calls write the same errors to the same
    // FormStore (by design — they share `key`).
    await handles.sidebar!.handleSubmit(async () => {})()
    await handles.main!.handleSubmit(async () => {})()

    // Sidebar focuses sidebar's input only.
    focusSpy.mockClear()
    expect(handles.sidebar!.focusFirstError()).toBe(true)
    let focused = focusSpy.mock.instances.at(-1) as HTMLInputElement | undefined
    expect(focused?.getAttribute('data-mount')).toBe('sidebar')

    // Main focuses main's input only.
    focusSpy.mockClear()
    expect(handles.main!.focusFirstError()).toBe(true)
    focused = focusSpy.mock.instances.at(-1) as HTMLInputElement | undefined
    expect(focused?.getAttribute('data-mount')).toBe('main')

    app.unmount()
  })

  it('form.meta.instanceId is distinct per useForm call (same key)', () => {
    type ApiT = ReturnType<typeof useForm<Form>>
    const handles: { a?: ApiT; b?: ApiT } = {}

    const FormA = defineComponent({
      setup() {
        handles.a = useForm<Form>({
          schema: fakeSchema<Form>(defaults),
          key: 'instance-id-shared',
        })
        return () => h('span')
      },
    })
    const FormB = defineComponent({
      setup() {
        handles.b = useForm<Form>({
          schema: fakeSchema<Form>(defaults),
          key: 'instance-id-shared',
        })
        return () => h('span')
      },
    })
    const App = defineComponent({
      setup: () => () => h('div', [h(FormA), h(FormB)]),
    })
    const app = createApp(App).use(createChemicalXForms({ override: true }))
    const root = document.createElement('div')
    document.body.appendChild(root)
    app.mount(root)

    expect(typeof handles.a!.meta.instanceId).toBe('string')
    expect(typeof handles.b!.meta.instanceId).toBe('string')
    expect(handles.a!.meta.instanceId.length).toBeGreaterThan(0)
    expect(handles.a!.meta.instanceId).not.toBe(handles.b!.meta.instanceId)
    // Stable across reads on the same instance.
    expect(handles.a!.meta.instanceId).toBe(handles.a!.meta.instanceId)

    app.unmount()
  })
})

describe('focusFirstError — sort cache invalidation', () => {
  let focusSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    if (typeof HTMLElement.prototype.scrollIntoView !== 'function') {
      HTMLElement.prototype.scrollIntoView = function scrollIntoView() {
        return undefined
      }
    }
    focusSpy = vi.spyOn(HTMLElement.prototype, 'focus')
    Object.defineProperty(HTMLElement.prototype, 'offsetParent', {
      configurable: true,
      get(this: HTMLElement) {
        return this.style.display === 'none' ? null : this.parentNode
      },
    })
  })

  afterEach(() => {
    focusSpy.mockRestore()
  })

  it('newly-mounted input above an existing one becomes the new visually-first focus target', async () => {
    // Initial DOM: just <input password>. After submit, password gets
    // focus (only registered errored input). Then toggle a v-if to
    // mount <input email> ABOVE password in the DOM. After resubmit,
    // email is the visually-first errored input — proves the sort
    // cache invalidated on the new register call.
    type ApiT = ReturnType<typeof useForm<Form>>
    const handle: { api?: ApiT } = {}
    const showEmail = ref(false)

    const validator = (_data: unknown, _path: Path | undefined) => ({
      data: undefined,
      errors: [
        { message: 'email is bad', path: ['email'], formKey: 'cache-form', code: 'cx:t' },
        { message: 'password is bad', path: ['password'], formKey: 'cache-form', code: 'cx:t' },
      ],
      success: false as const,
      formKey: 'cache-form',
    })

    const App = defineComponent({
      setup() {
        handle.api = useForm<Form>({
          schema: fakeSchema<Form>(defaults, validator),
          key: 'cache-form',
        })
        return () => {
          const children: ReturnType<typeof h>[] = []
          if (showEmail.value) {
            const regEmail = handle.api?.register('email')
            children.push(
              h('input', {
                'data-field': 'email',
                ref: (el: unknown) => {
                  if (el instanceof HTMLInputElement && regEmail) regEmail.registerElement(el)
                },
              })
            )
          }
          const regPwd = handle.api?.register('password')
          children.push(
            h('input', {
              'data-field': 'password',
              ref: (el: unknown) => {
                if (el instanceof HTMLInputElement && regPwd) regPwd.registerElement(el)
              },
            })
          )
          return h('form', children)
        }
      },
    })

    const app = createApp(App).use(createChemicalXForms({ override: true }))
    const root = document.createElement('div')
    document.body.appendChild(root)
    app.mount(root)

    // Phase 1: only password is in the DOM. Submit, focus password.
    await handle.api!.handleSubmit(async () => {})()
    focusSpy.mockClear()
    expect(handle.api!.focusFirstError()).toBe(true)
    let focused = focusSpy.mock.instances.at(-1) as HTMLInputElement | undefined
    expect(focused?.getAttribute('data-field')).toBe('password')

    // Phase 2: mount email ABOVE password. Cache should invalidate on
    // the new registerElement call; the next focus call rebuilds the
    // sort and email wins (DOM-tree-first).
    showEmail.value = true
    await nextTick()
    focusSpy.mockClear()
    expect(handle.api!.focusFirstError()).toBe(true)
    focused = focusSpy.mock.instances.at(-1) as HTMLInputElement | undefined
    expect(focused?.getAttribute('data-field')).toBe('email')

    app.unmount()
  })
})

describe('focusFirstError — instanceId inheritance through injectForm', () => {
  let focusSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    if (typeof HTMLElement.prototype.scrollIntoView !== 'function') {
      HTMLElement.prototype.scrollIntoView = function scrollIntoView() {
        return undefined
      }
    }
    focusSpy = vi.spyOn(HTMLElement.prototype, 'focus')
    Object.defineProperty(HTMLElement.prototype, 'offsetParent', {
      configurable: true,
      get(this: HTMLElement) {
        return this.style.display === 'none' ? null : this.parentNode
      },
    })
  })

  afterEach(() => {
    focusSpy.mockRestore()
  })

  // The contract: a child reaching the form via injectForm() inherits
  // the closest ancestor useForm()'s `formInstanceId` (provided through
  // `kFormInstanceId`), so inputs the child registers locally are
  // tagged with the ancestor's instance — keeping parent-submit-focus
  // working for inputs registered by deep descendants. If injectForm
  // ever allocates its own fresh ID instead of inheriting, the
  // ancestor's focusFirstError would skip the descendant's inputs and
  // this test would fail.
  it('parent.focusFirstError() targets an input registered by a child that reached the form via injectForm', async () => {
    type ApiT = ReturnType<typeof useForm<Form>>
    const handles: { parent?: ApiT; child?: ReturnType<typeof injectForm<Form>> } = {}

    const validator = (_data: unknown, _path: Path | undefined) => ({
      data: undefined,
      errors: [
        { message: 'email is bad', path: ['email'], formKey: 'inject-inherit', code: 'cx:t' },
      ],
      success: false as const,
      formKey: 'inject-inherit',
    })

    const ChildLeaf = defineComponent({
      setup() {
        handles.child = injectForm<Form>('inject-inherit')
        return () => {
          const reg = handles.child?.register('email')
          return h('input', {
            'data-mount': 'child',
            ref: (el: unknown) => {
              if (el instanceof HTMLInputElement && reg) reg.registerElement(el)
            },
          })
        }
      },
    })

    const Parent = defineComponent({
      setup() {
        handles.parent = useForm<Form>({
          schema: fakeSchema<Form>(defaults, validator),
          key: 'inject-inherit',
        })
        return () => h(ChildLeaf)
      },
    })

    const app = createApp(Parent).use(createChemicalXForms({ override: true }))
    const root = document.createElement('div')
    document.body.appendChild(root)
    app.mount(root)

    // Submit through parent → schemaErrors populates → parent's
    // focusFirstError walks the sort cache, filtered by parent's
    // instanceId. Without inject inheritance, the child's input would
    // be tagged under a fresh instanceId and parent's filter would
    // skip it → focusFirstError returns false. With inheritance, the
    // child's input matches and gets focused.
    await handles.parent!.handleSubmit(async () => {})()
    focusSpy.mockClear()
    expect(handles.parent!.focusFirstError()).toBe(true)
    const focused = focusSpy.mock.instances.at(-1) as HTMLInputElement | undefined
    expect(focused?.getAttribute('data-mount')).toBe('child')

    // form.meta.instanceId equality is the proof: the API the child
    // got back from injectForm carries the same instanceId as the
    // parent's useForm callsite.
    expect(handles.child?.meta.instanceId).toBe(handles.parent!.meta.instanceId)

    app.unmount()
  })

  // Three-level closest-wins for instanceId: Grandparent and Parent
  // both useForm() anonymously; Grandchild uses injectForm() and
  // registers an input. The grandchild's input must be tagged with
  // PARENT's instanceId (closest ancestor wins via Vue's inject
  // semantics), not Grandparent's. Parent's focusFirstError finds it;
  // Grandparent's doesn't.
  it("nested ancestors: grandchild's input is scoped to the closest ancestor's instance, not the further one", async () => {
    type ApiT = ReturnType<typeof useForm<Form>>
    const handles: {
      grandparent?: ApiT
      parent?: ApiT
      child?: ReturnType<typeof injectForm<Form>>
    } = {}

    // Both ancestors fail validation on the same path so each has an
    // errored field at submit time. The closest-wins rule decides
    // which form the grandchild's input belongs to.
    const validatorFor = (kind: 'gp' | 'p') => (_data: unknown, _path: Path | undefined) => ({
      data: undefined,
      errors: [{ message: 'bad', path: ['email'], formKey: kind, code: 'cx:t' }],
      success: false as const,
      formKey: kind,
    })

    const Grandchild = defineComponent({
      setup() {
        handles.child = injectForm<Form>()
        return () => {
          const reg = handles.child?.register('email')
          return h('input', {
            'data-mount': 'grandchild',
            ref: (el: unknown) => {
              if (el instanceof HTMLInputElement && reg) reg.registerElement(el)
            },
          })
        }
      },
    })
    const Parent = defineComponent({
      setup() {
        handles.parent = useForm<Form>({ schema: fakeSchema<Form>(defaults, validatorFor('p')) })
        return () => h(Grandchild)
      },
    })
    const Grandparent = defineComponent({
      setup() {
        handles.grandparent = useForm<Form>({
          schema: fakeSchema<Form>(defaults, validatorFor('gp')),
        })
        return () => h(Parent)
      },
    })

    const app = createApp(Grandparent).use(createChemicalXForms({ override: true }))
    const root = document.createElement('div')
    document.body.appendChild(root)
    app.mount(root)

    // Trigger errors on both forms so each has a candidate to focus.
    await handles.grandparent!.handleSubmit(async () => {})()
    await handles.parent!.handleSubmit(async () => {})()

    // Grandchild's API.meta.instanceId matches PARENT's, not grandparent's.
    expect(handles.child?.meta.instanceId).toBe(handles.parent!.meta.instanceId)
    expect(handles.child?.meta.instanceId).not.toBe(handles.grandparent!.meta.instanceId)

    // Parent's focusFirstError targets grandchild's input.
    focusSpy.mockClear()
    expect(handles.parent!.focusFirstError()).toBe(true)
    const focused = focusSpy.mock.instances.at(-1) as HTMLInputElement | undefined
    expect(focused?.getAttribute('data-mount')).toBe('grandchild')

    // Grandparent's focusFirstError finds NOTHING — its FormStore has
    // an error at `email`, but no element registered with its
    // instanceId is in the DOM (the only `<input email>` in the tree
    // was registered through the injectForm chain that resolved to
    // parent, not grandparent).
    focusSpy.mockClear()
    expect(handles.grandparent!.focusFirstError()).toBe(false)
    expect(focusSpy).not.toHaveBeenCalled()

    app.unmount()
  })
})
