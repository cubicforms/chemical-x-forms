// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { createApp, defineComponent, h, type App } from 'vue'
import { z } from 'zod'
import { useForm } from '../../src/zod'
import { createChemicalXForms } from '../../src/runtime/core/plugin'

/**
 * Phase 5.9 — undo/redo.
 *
 * `history: true` enables the default bounded stack (max 50);
 * `history: { max: N }` tunes it. `undo()` / `redo()` restore the
 * prior form value (and the error map). `canUndo` / `canRedo` gate
 * consumer UI. `reset()` clears both stacks.
 */

const schema = z.object({
  email: z.string(),
  password: z.string(),
})

type ApiReturn = ReturnType<typeof useForm<typeof schema>>

function mountForm(history: Parameters<typeof useForm<typeof schema>>[0]['history']): {
  app: App
  api: ApiReturn
} {
  const handle: { api?: ApiReturn } = {}
  const App = defineComponent({
    setup() {
      handle.api = useForm({
        schema,
        key: `history-${Math.random().toString(36).slice(2)}`,
        ...(history !== undefined ? { history } : {}),
      })
      return () => h('div')
    },
  })
  const app = createApp(App).use(createChemicalXForms())
  const root = document.createElement('div')
  document.body.appendChild(root)
  app.mount(root)
  return { app, api: handle.api as ApiReturn }
}

describe('history — default (history: true)', () => {
  const apps: App[] = []
  afterEach(() => {
    while (apps.length > 0) apps.pop()?.unmount()
  })

  it('canUndo starts false and flips true after first mutation', () => {
    const { app, api } = mountForm(true)
    apps.push(app)
    expect(api.state.canUndo).toBe(false)
    api.setValue('email', 'a@example.com')
    expect(api.state.canUndo).toBe(true)
  })

  it('undo restores the prior form value', () => {
    const { app, api } = mountForm(true)
    apps.push(app)
    api.setValue('email', 'first@example.com')
    api.setValue('email', 'second@example.com')
    expect(api.values.email).toBe('second@example.com')
    expect(api.undo()).toBe(true)
    expect(api.values.email).toBe('first@example.com')
    expect(api.undo()).toBe(true)
    expect(api.values.email).toBe('')
    // One more undo bottoms out at the initial snapshot.
    expect(api.undo()).toBe(false)
    expect(api.values.email).toBe('')
  })

  it('redo replays an undone mutation', () => {
    const { app, api } = mountForm(true)
    apps.push(app)
    api.setValue('email', 'one@example.com')
    api.setValue('email', 'two@example.com')
    api.undo()
    expect(api.state.canRedo).toBe(true)
    expect(api.redo()).toBe(true)
    expect(api.values.email).toBe('two@example.com')
  })

  it('new mutation after undo clears the redo stack', () => {
    const { app, api } = mountForm(true)
    apps.push(app)
    api.setValue('email', 'one@example.com')
    api.undo()
    expect(api.state.canRedo).toBe(true)
    api.setValue('email', 'two@example.com')
    expect(api.state.canRedo).toBe(false)
    expect(api.redo()).toBe(false)
  })

  it('reset() clears both stacks', () => {
    const { app, api } = mountForm(true)
    apps.push(app)
    api.setValue('email', 'a@example.com')
    api.setValue('email', 'b@example.com')
    expect(api.state.canUndo).toBe(true)
    api.reset()
    expect(api.state.canUndo).toBe(false)
    expect(api.state.canRedo).toBe(false)
  })

  it('restores errors alongside the form on undo', () => {
    const { app, api } = mountForm(true)
    apps.push(app)
    // setFieldErrors does NOT trigger onFormChange — the snapshot
    // captured at a later form mutation is what carries the errors
    // forward. Sequence below captures: form='a' (no errors),
    // setFieldErrors lands, form='b' snapshot now has the errors.
    api.setValue('email', 'a')
    api.setFieldErrors([
      { path: ['email'], message: 'bad', formKey: api.key, code: 'api:validation' },
    ])
    api.setValue('email', 'b')
    // clear errors live, then mutate form once more so the NEXT
    // snapshot captures the cleared state.
    api.clearFieldErrors('email')
    api.setValue('email', 'c')
    expect(api.errors.email).toBeUndefined()
    // Undo once — snapshot taken at the 'b' mutation carried the
    // errors that were set just before it.
    api.undo()
    expect(api.values.email).toBe('b')
    expect(api.errors.email?.[0]?.message).toBe('bad')
  })
})

describe('history — bounded stack', () => {
  const apps: App[] = []
  afterEach(() => {
    while (apps.length > 0) apps.pop()?.unmount()
  })

  it('trims FIFO when mutations exceed max', () => {
    const { app, api } = mountForm({ max: 3 })
    apps.push(app)
    // Mutate 5 times; only the 3 most recent snapshots should be
    // retained (plus the initial entry is FIFO-evicted too once the
    // stack grows past max).
    for (let i = 0; i < 5; i++) api.setValue('email', `value-${i}`)
    // Undo until we can't anymore. The oldest retained snapshot is
    // `value-2` (value-0 and initial were trimmed).
    let depth = 0
    while (api.undo()) depth++
    // Stack had 3 entries; undo from the current settles us on the
    // oldest-retained — we can undo (max - 1) times.
    expect(depth).toBe(2)
    expect(['value-2', 'value-3'].includes(api.values.email as string)).toBe(true)
  })

  it('historySize tracks both stacks', () => {
    const { app, api } = mountForm(true)
    apps.push(app)
    api.setValue('email', 'a')
    api.setValue('email', 'b')
    expect(api.state.historySize).toBe(3) // initial + 2 mutations
    api.undo()
    // One moved from undo stack to redo stack — total is still 3.
    expect(api.state.historySize).toBe(3)
  })
})

describe('history — disabled (no config)', () => {
  const apps: App[] = []
  afterEach(() => {
    while (apps.length > 0) apps.pop()?.unmount()
  })

  it('undo/redo are inert no-ops when history is not configured', () => {
    const { app, api } = mountForm(undefined)
    apps.push(app)
    api.setValue('email', 'mutated')
    expect(api.undo()).toBe(false)
    expect(api.redo()).toBe(false)
    expect(api.state.canUndo).toBe(false)
    expect(api.state.canRedo).toBe(false)
    expect(api.state.historySize).toBe(0)
    expect(api.values.email).toBe('mutated')
  })
})
