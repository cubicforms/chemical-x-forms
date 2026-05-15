// @vitest-environment jsdom
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, defineComponent, h, withDirectives, type App } from 'vue'
import { z } from 'zod'
import { useForm } from '../../src/zod'
import type { UseFormReturn } from '../../src/zod'
import { vRegister } from '../../src/runtime/core/directive'
import { createAttaform } from '../../src/runtime/core/plugin'
import { waitUntil } from '../utils/form-harness'

/**
 * `<input type="file" v-register>` end-to-end coverage.
 *
 * The variant reads `el.files` on change and writes the canonical
 * storage shape: `File | null` (single) or `File[]` (multiple). Blank
 * paths are marked through `setValueWithInternalPath`'s `{ blank:
 * true }` meta so required-file fields surface "No value supplied"
 * via `derivedBlankErrors`. Persistence is carved out at
 * `syncPersistOptIn` — file paths never enter `optedInPaths`.
 *
 * Tests use `z.file().nullable()` (v4 native). The directive itself is
 * DOM-driven, not schema-driven — v3's `z.instanceof(File)` flows
 * through the same code paths.
 */

function dispatchChange(el: HTMLInputElement): void {
  el.dispatchEvent(new Event('change', { bubbles: true }))
}

// jsdom marks `el.files` read-only. Override with a `defineProperty`
// stand-in so tests can simulate user picks without driving the
// native file-picker (which doesn't exist in jsdom).
function setFiles(el: HTMLInputElement, files: File[]): void {
  // FileList isn't constructible; use a typed array-like that mimics
  // the `length` + indexed access + `item(i)` surface.
  const list = {
    ...files,
    length: files.length,
    item(index: number) {
      return files[index] ?? null
    },
    [Symbol.iterator]() {
      let i = 0
      return {
        next: () =>
          i < files.length
            ? { value: files[i++] as File, done: false as const }
            : { value: undefined as unknown as File, done: true as const },
      }
    },
  } as unknown as FileList
  Object.defineProperty(el, 'files', { value: list, configurable: true })
}

function makeFile(name = 'photo.png', size = 1024, type = 'image/png'): File {
  const buf = new Uint8Array(size)
  return new File([buf], name, { type })
}

describe('<input type="file" v-register> — single file', () => {
  let app: App | undefined

  afterEach(() => {
    app?.unmount()
    app = undefined
    document.body.innerHTML = ''
  })

  it('picking a file writes the File to storage and drops the path from blankPaths', async () => {
    const schema = z.object({ avatar: z.file().nullable() })
    const captured: { api?: UseFormReturn<typeof schema> } = {}

    const Parent = defineComponent({
      setup() {
        const form = useForm({ schema, key: 'file-single', strict: false })
        captured.api = form
        return () =>
          withDirectives(h('input', { type: 'file', class: 'avatar' }), [
            [vRegister, form.register('avatar')],
          ])
      },
    })

    app = createApp(Parent).use(createAttaform())
    const root = document.createElement('div')
    document.body.appendChild(root)
    app.mount(root)
    await waitUntil(() => (captured.api?.fields.avatar.blank === true ? true : null))

    if (captured.api === undefined) throw new Error('unreachable')
    const input = root.querySelector('input.avatar') as HTMLInputElement
    expect(input.type).toBe('file')
    expect(captured.api.values.avatar).toBeNull()
    expect(captured.api.fields.avatar.blank).toBe(true)

    const picked = makeFile()
    setFiles(input, [picked])
    dispatchChange(input)

    await waitUntil(() => (captured.api?.values.avatar instanceof File ? true : null))
    expect(captured.api.values.avatar).toBe(picked)
    expect(captured.api.fields.avatar.blank).toBe(false)
  })

  it('clearing (empty FileList) writes null and re-marks blank', async () => {
    const schema = z.object({ avatar: z.file().nullable() })
    const captured: { api?: UseFormReturn<typeof schema> } = {}

    const Parent = defineComponent({
      setup() {
        const form = useForm({ schema, key: 'file-clear', strict: false })
        captured.api = form
        return () =>
          withDirectives(h('input', { type: 'file', class: 'avatar' }), [
            [vRegister, form.register('avatar')],
          ])
      },
    })

    app = createApp(Parent).use(createAttaform())
    const root = document.createElement('div')
    document.body.appendChild(root)
    app.mount(root)
    await waitUntil(() => (captured.api?.fields.avatar.blank === true ? true : null))

    if (captured.api === undefined) throw new Error('unreachable')
    const input = root.querySelector('input.avatar') as HTMLInputElement

    setFiles(input, [makeFile()])
    dispatchChange(input)
    await waitUntil(() => (captured.api?.values.avatar instanceof File ? true : null))
    expect(captured.api.fields.avatar.blank).toBe(false)

    setFiles(input, [])
    dispatchChange(input)
    await waitUntil(() => (captured.api?.values.avatar === null ? true : null))
    expect(captured.api.values.avatar).toBeNull()
    expect(captured.api.fields.avatar.blank).toBe(true)
  })
})

describe('<input type="file" multiple v-register>', () => {
  let app: App | undefined

  afterEach(() => {
    app?.unmount()
    app = undefined
    document.body.innerHTML = ''
  })

  it('picking multiple writes File[] of correct length and order', async () => {
    const schema = z.object({ docs: z.array(z.file()) })
    const captured: { api?: UseFormReturn<typeof schema> } = {}

    const Parent = defineComponent({
      setup() {
        const form = useForm({ schema, key: 'file-multi', strict: false })
        captured.api = form
        return () =>
          withDirectives(h('input', { type: 'file', multiple: true, class: 'docs' }), [
            [vRegister, form.register('docs')],
          ])
      },
    })

    app = createApp(Parent).use(createAttaform())
    const root = document.createElement('div')
    document.body.appendChild(root)
    app.mount(root)
    await waitUntil(() =>
      Array.isArray(captured.api?.values.docs) && captured.api.values.docs.length === 0
        ? true
        : null
    )

    if (captured.api === undefined) throw new Error('unreachable')
    const input = root.querySelector('input.docs') as HTMLInputElement
    expect(captured.api.values.docs).toEqual([])
    expect(captured.api.fields('docs').blank).toBe(true)

    const a = makeFile('a.pdf', 10, 'application/pdf')
    const b = makeFile('b.pdf', 20, 'application/pdf')
    setFiles(input, [a, b])
    dispatchChange(input)

    await waitUntil(() => (captured.api?.values.docs.length === 2 ? true : null))
    expect(captured.api.values.docs).toEqual([a, b])
    expect(captured.api.fields('docs').blank).toBe(false)
  })

  it('clearing all selections writes [] and re-marks blank', async () => {
    const schema = z.object({ docs: z.array(z.file()) })
    const captured: { api?: UseFormReturn<typeof schema> } = {}

    const Parent = defineComponent({
      setup() {
        const form = useForm({ schema, key: 'file-multi-clear', strict: false })
        captured.api = form
        return () =>
          withDirectives(h('input', { type: 'file', multiple: true, class: 'docs' }), [
            [vRegister, form.register('docs')],
          ])
      },
    })

    app = createApp(Parent).use(createAttaform())
    const root = document.createElement('div')
    document.body.appendChild(root)
    app.mount(root)
    await waitUntil(() => (captured.api?.fields('docs').blank === true ? true : null))

    if (captured.api === undefined) throw new Error('unreachable')
    const input = root.querySelector('input.docs') as HTMLInputElement

    setFiles(input, [makeFile()])
    dispatchChange(input)
    await waitUntil(() => (captured.api?.values.docs.length === 1 ? true : null))

    setFiles(input, [])
    dispatchChange(input)
    await waitUntil(() =>
      captured.api?.fields('docs').blank === true && captured.api.values.docs.length === 0
        ? true
        : null
    )
    expect(captured.api.values.docs).toEqual([])
    expect(captured.api.fields('docs').blank).toBe(true)
  })
})

describe('<input type="file" v-register> — required-file error', () => {
  let app: App | undefined

  afterEach(() => {
    app?.unmount()
    app = undefined
    document.body.innerHTML = ''
  })

  it('surfaces "No value supplied" through derivedBlankErrors when required', async () => {
    const schema = z.object({ id: z.file() })
    const captured: { api?: UseFormReturn<typeof schema> } = {}

    const Parent = defineComponent({
      setup() {
        const form = useForm({ schema, key: 'file-required', strict: false })
        captured.api = form
        return () =>
          withDirectives(h('input', { type: 'file', class: 'id' }), [
            [vRegister, form.register('id')],
          ])
      },
    })

    app = createApp(Parent).use(createAttaform())
    const root = document.createElement('div')
    document.body.appendChild(root)
    app.mount(root)
    await waitUntil(() => (captured.api?.fields.id.blank === true ? true : null))

    if (captured.api === undefined) throw new Error('unreachable')
    const errs = captured.api.errors.id
    expect(Array.isArray(errs) && errs.length > 0).toBe(true)
  })
})

describe('<input type="file" v-register> — persistence carve-out', () => {
  const apps: App[] = []

  beforeEach(() => {
    localStorage.clear()
  })

  afterEach(() => {
    while (apps.length > 0) apps.pop()?.unmount()
    document.body.innerHTML = ''
    localStorage.clear()
  })

  it('never persists file values regardless of register({ persist: true })', async () => {
    const schema = z.object({
      avatar: z.file().nullable(),
      title: z.string(),
    })
    const captured: { api?: UseFormReturn<typeof schema> } = {}

    const Parent = defineComponent({
      setup() {
        const form = useForm({
          schema,
          key: 'file-persist-carveout',
          persist: { storage: 'local', key: 'file-persist-test', debounceMs: 5 },
          strict: false,
        })
        captured.api = form
        return () =>
          h('div', [
            withDirectives(h('input', { type: 'file', class: 'avatar' }), [
              [vRegister, form.register('avatar', { persist: true })],
            ]),
            withDirectives(h('input', { type: 'text', class: 'title' }), [
              [vRegister, form.register('title', { persist: true })],
            ]),
          ])
      },
    })

    const app = createApp(Parent).use(createAttaform())
    apps.push(app)
    const root = document.createElement('div')
    document.body.appendChild(root)
    app.mount(root)
    await waitUntil(() => (captured.api?.fields.avatar.blank === true ? true : null))

    if (captured.api === undefined) throw new Error('unreachable')
    const fileInput = root.querySelector('input.avatar') as HTMLInputElement
    const textInput = root.querySelector('input.title') as HTMLInputElement

    setFiles(fileInput, [makeFile()])
    dispatchChange(fileInput)
    textInput.value = 'release notes'
    textInput.dispatchEvent(new Event('input', { bubbles: true }))

    await waitUntil(() => (localStorage.getItem('file-persist-test') !== null ? true : null), 200)

    const raw = Object.keys(localStorage).find((k) => k.startsWith('file-persist-test:'))
    expect(raw).toBeDefined()
    if (raw === undefined) throw new Error('unreachable')
    const payload = JSON.parse(localStorage.getItem(raw) ?? '{}') as {
      data?: { form?: Record<string, unknown> }
    }
    expect(payload.data?.form).toBeDefined()
    expect('avatar' in (payload.data?.form ?? {})).toBe(false)
    expect(payload.data?.form?.['title']).toBe('release notes')
  })

  it('emits a one-time dev warn when persist is set on a file input', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    const schema = z.object({
      avatar: z.file().nullable(),
      banner: z.file().nullable(),
    })

    const Parent = defineComponent({
      setup() {
        const form = useForm({
          schema,
          key: 'file-warn-dedup',
          persist: { storage: 'local', key: 'file-warn-test', debounceMs: 5 },
          strict: false,
        })
        return () =>
          h('div', [
            withDirectives(h('input', { type: 'file', class: 'avatar' }), [
              [vRegister, form.register('avatar', { persist: true })],
            ]),
            withDirectives(h('input', { type: 'file', class: 'avatar-dup' }), [
              [vRegister, form.register('avatar', { persist: true })],
            ]),
            withDirectives(h('input', { type: 'file', class: 'banner' }), [
              [vRegister, form.register('banner', { persist: true })],
            ]),
          ])
      },
    })

    const app = createApp(Parent).use(createAttaform())
    apps.push(app)
    const root = document.createElement('div')
    document.body.appendChild(root)
    app.mount(root)

    await waitUntil(
      () =>
        warnSpy.mock.calls.filter((c: unknown[]) =>
          String(c[0] ?? '').includes('on <input type="file">')
        ).length > 0
          ? true
          : null,
      200
    )

    const fileWarns = warnSpy.mock.calls.filter((c: unknown[]) =>
      String(c[0] ?? '').includes('on <input type="file">')
    )
    const avatarWarns = fileWarns.filter((c: unknown[]) => String(c[0] ?? '').includes('avatar'))
    const bannerWarns = fileWarns.filter((c: unknown[]) => String(c[0] ?? '').includes('banner'))
    expect(avatarWarns.length).toBe(1)
    expect(bannerWarns.length).toBe(1)

    warnSpy.mockRestore()
  })
})

describe('<input type="file" v-register> — programmatic clear', () => {
  let app: App | undefined

  afterEach(() => {
    app?.unmount()
    app = undefined
    document.body.innerHTML = ''
  })

  it('form.clear(path) resets storage to null and clears the DOM input', async () => {
    const schema = z.object({ avatar: z.file().nullable() })
    const captured: { api?: UseFormReturn<typeof schema> } = {}

    const Parent = defineComponent({
      setup() {
        const form = useForm({ schema, key: 'file-prog-clear', strict: false })
        captured.api = form
        return () =>
          withDirectives(h('input', { type: 'file', class: 'avatar' }), [
            [vRegister, form.register('avatar')],
          ])
      },
    })

    app = createApp(Parent).use(createAttaform())
    const root = document.createElement('div')
    document.body.appendChild(root)
    app.mount(root)
    await waitUntil(() => (captured.api?.fields.avatar.blank === true ? true : null))

    if (captured.api === undefined) throw new Error('unreachable')
    const input = root.querySelector('input.avatar') as HTMLInputElement

    setFiles(input, [makeFile()])
    dispatchChange(input)
    await waitUntil(() => (captured.api?.values.avatar instanceof File ? true : null))
    expect(captured.api.values.avatar).toBeInstanceOf(File)

    captured.api.clear('avatar')
    await waitUntil(() => (captured.api?.values.avatar === null ? true : null))
    expect(captured.api.values.avatar).toBeNull()
    expect(captured.api.fields.avatar.blank).toBe(true)
    expect(input.value).toBe('')
  })
})

describe('<input type="file" v-register> — listener cleanup', () => {
  let app: App | undefined

  afterEach(() => {
    app?.unmount()
    app = undefined
    document.body.innerHTML = ''
  })

  it('removes the change listener on unmount', async () => {
    const schema = z.object({ avatar: z.file().nullable() })
    const captured: { api?: UseFormReturn<typeof schema> } = {}

    const Parent = defineComponent({
      setup() {
        const form = useForm({ schema, key: 'file-cleanup', strict: false })
        captured.api = form
        return () =>
          withDirectives(h('input', { type: 'file', class: 'avatar' }), [
            [vRegister, form.register('avatar')],
          ])
      },
    })

    app = createApp(Parent).use(createAttaform())
    const root = document.createElement('div')
    document.body.appendChild(root)
    app.mount(root)
    await waitUntil(() => (captured.api?.fields.avatar.blank === true ? true : null))

    const input = root.querySelector('input.avatar') as HTMLInputElement
    app.unmount()
    app = undefined

    // After unmount, dispatching change must not flow into storage.
    setFiles(input, [makeFile()])
    dispatchChange(input)
    expect(captured.api?.values.avatar).toBeNull()
  })
})

// Restore the platform localStorage for the file-suite block that
// touched it — sibling suites observing jsdom's default get a clean
// slate.
afterAll(() => {
  localStorage.clear()
})
