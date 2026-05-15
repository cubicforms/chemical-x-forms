// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createApp, h, nextTick, type App } from 'vue'
import AttaformDevtoolsPanel from '../../src/runtime/components/AttaformDevtoolsPanel.vue'
import { createFormStore } from '../../src/runtime/core/create-form-store'
import type { AttaformDevtoolsBridge } from '../../src/runtime/core/devtools-shared'
import { createRegistry } from '../../src/runtime/core/registry'
import { fakeSchema } from '../utils/fake-schema'

/**
 * Component tests for the Nuxt DevTools overlay panel. Mounts the panel
 * with a synthetic registry / form pair, exercises the four sections +
 * the timeline + the edit path, and asserts the panel surfaces the same
 * data the Vue DevTools inspector does — same redaction, same sensitive-
 * path edit refusal, same setValueAtPath contract.
 */

function mountPanel(bridge: AttaformDevtoolsBridge): {
  root: HTMLElement
  app: App
} {
  const root = document.createElement('div')
  document.body.appendChild(root)
  const app = createApp({
    render: () => h(AttaformDevtoolsPanel, { bridge }),
  })
  app.mount(root)
  return { root, app }
}

describe('AttaformDevtoolsPanel — empty state', () => {
  const apps: App[] = []
  beforeEach(() => {
    document.body.innerHTML = ''
  })
  afterEach(() => {
    while (apps.length > 0) apps.pop()?.unmount()
  })

  it('renders the empty-state hint when no forms are registered', () => {
    const registry = createRegistry({})
    const { root, app } = mountPanel({ registry, version: '0.0.0-test' })
    apps.push(app)

    expect(root.textContent).toContain('No registered forms yet')
    expect(root.textContent).toContain('0.0.0-test')
  })
})

describe('AttaformDevtoolsPanel — form display', () => {
  const apps: App[] = []
  beforeEach(() => {
    document.body.innerHTML = ''
  })
  afterEach(() => {
    while (apps.length > 0) apps.pop()?.unmount()
  })

  it('lists registered forms in the sidebar', () => {
    const registry = createRegistry({})
    const a = createFormStore<{ name: string }>({
      formKey: 'form-a',
      schema: fakeSchema<{ name: string }>({ name: '' }),
    })
    const b = createFormStore<{ name: string }>({
      formKey: 'form-b',
      schema: fakeSchema<{ name: string }>({ name: '' }),
    })
    registry.forms.set('form-a', a)
    registry.forms.set('form-b', b)

    const { root, app } = mountPanel({ registry, version: '0' })
    apps.push(app)

    const sidebar = root.querySelector('.atf-sidebar')!
    expect(sidebar.textContent).toContain('form-a')
    expect(sidebar.textContent).toContain('form-b')
  })

  it('redacts sensitive leaves in the Form value section', () => {
    const registry = createRegistry({})
    const state = createFormStore<{ username: string; password: string }>({
      formKey: 'creds',
      schema: fakeSchema<{ username: string; password: string }>({
        username: '',
        password: '',
      }),
    })
    state.applyFormReplacement({ username: 'alice', password: 'hunter2' })
    registry.forms.set('creds', state)

    const { root, app } = mountPanel({ registry, version: '0' })
    apps.push(app)

    expect(root.textContent).toContain('alice')
    expect(root.textContent).toContain('[redacted]')
    expect(root.textContent).not.toContain('hunter2')
  })

  it('renders schema and user errors when present', () => {
    const registry = createRegistry({})
    const state = createFormStore<{ email: string }>({
      formKey: 'errs',
      schema: fakeSchema<{ email: string }>({ email: '' }),
    })
    state.addUserErrors([
      { message: 'looks bad', path: ['email'], formKey: 'errs', code: 'api:bad-email' },
    ])
    registry.forms.set('errs', state)

    const { root, app } = mountPanel({ registry, version: '0' })
    apps.push(app)

    expect(root.textContent).toContain('looks bad')
  })
})

describe('AttaformDevtoolsPanel — edit path', () => {
  const apps: App[] = []
  beforeEach(() => {
    document.body.innerHTML = ''
  })
  afterEach(() => {
    while (apps.length > 0) apps.pop()?.unmount()
  })

  it('writes a new value via setValueAtPath when a non-sensitive leaf commits', async () => {
    const registry = createRegistry({})
    const state = createFormStore<{ username: string }>({
      formKey: 'edit-1',
      schema: fakeSchema<{ username: string }>({ username: '' }),
    })
    state.applyFormReplacement({ username: 'old' })
    registry.forms.set('edit-1', state)

    const { root, app } = mountPanel({ registry, version: '0' })
    apps.push(app)

    // Find the editable leaf cell for "username" and click it.
    const leafCells = Array.from(root.querySelectorAll<HTMLElement>('.leaf-editable'))
    const usernameCell = leafCells.find((el) => el.textContent?.includes('"old"'))
    expect(usernameCell, 'editable username leaf cell rendered').toBeTruthy()
    usernameCell!.click()
    await nextTick()

    const input = root.querySelector<HTMLInputElement>('.leaf-input')
    expect(input, 'input cell rendered on click').toBeTruthy()
    input!.value = 'new'
    input!.dispatchEvent(new Event('input'))
    input!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }))
    await nextTick()

    expect(state.form.value.username).toBe('new')
  })

  it('refuses edits on sensitive-named leaves — clicking the cell does not enter edit mode', async () => {
    const registry = createRegistry({})
    const state = createFormStore<{ password: string }>({
      formKey: 'edit-2',
      schema: fakeSchema<{ password: string }>({ password: '' }),
    })
    state.applyFormReplacement({ password: 'original' })
    registry.forms.set('edit-2', state)

    const { root, app } = mountPanel({ registry, version: '0' })
    apps.push(app)

    // The password leaf renders as REDACTED — clicking it shouldn't promote
    // to an input because redacted-typed leaves aren't in the editable set.
    const allLeaves = Array.from(root.querySelectorAll<HTMLElement>('.leaf'))
    const passwordCell = allLeaves.find((el) => el.textContent?.includes('[redacted]'))
    expect(passwordCell, 'redacted password cell rendered').toBeTruthy()
    passwordCell!.click()
    await nextTick()

    // No input element appeared — the cell stays as the redacted display.
    expect(root.querySelector('.leaf-input')).toBeNull()
    // And the underlying value is unchanged.
    expect(state.form.value.password).toBe('original')
  })
})

describe('AttaformDevtoolsPanel — timeline', () => {
  const apps: App[] = []
  beforeEach(() => {
    document.body.innerHTML = ''
  })
  afterEach(() => {
    while (apps.length > 0) apps.pop()?.unmount()
  })

  it('records a form.change entry when the form mutates', async () => {
    const registry = createRegistry({})
    const state = createFormStore<{ name: string }>({
      formKey: 'tl',
      schema: fakeSchema<{ name: string }>({ name: '' }),
    })
    registry.forms.set('tl', state)

    const { root, app } = mountPanel({ registry, version: '0' })
    apps.push(app)

    // Mutate after mount so the subscriber catches it.
    state.setValueAtPath(['name'], 'alice')
    await nextTick()

    const timeline = root.querySelector('.atf-timeline')
    expect(timeline?.textContent).toContain('form.change')
    expect(timeline?.textContent).toContain('tl')
  })

  it('clears the timeline log when the clear button fires', async () => {
    const registry = createRegistry({})
    const state = createFormStore<{ name: string }>({
      formKey: 'tl-clear',
      schema: fakeSchema<{ name: string }>({ name: '' }),
    })
    registry.forms.set('tl-clear', state)

    const { root, app } = mountPanel({ registry, version: '0' })
    apps.push(app)

    state.setValueAtPath(['name'], 'alice')
    await nextTick()
    expect(root.querySelector('.atf-timeline')?.textContent).toContain('form.change')

    const clearBtn = root.querySelector<HTMLButtonElement>('.atf-clear-btn')
    expect(clearBtn, 'clear button rendered when timeline has entries').toBeTruthy()
    clearBtn!.click()
    await nextTick()

    expect(root.querySelector('.atf-timeline')).toBeNull()
    expect(root.textContent).toContain('No events yet')
  })
})
