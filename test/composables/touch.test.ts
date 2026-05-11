// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { computed, createApp, defineComponent, h, nextTick, type App } from 'vue'
import { z as zV4 } from 'zod'
import { z as zV3 } from 'zod-v3'
import { useForm as useFormV4 } from '../../src/zod-v4'
import { useForm as useFormV3 } from '../../src/zod-v3'
import { createAttaform } from '../../src/runtime/core/plugin'

/**
 * `form.touch(path?)` — programmatic mark-as-interacted.
 *
 * The maintainer's gap: when a field is populated programmatically
 * (file import, paste, autofill), there's no ergonomic way to mark
 * it touched. The DOM workaround `el.focus(); el.blur()` reaches
 * around the abstraction; `form.touch(path)` closes the gap.
 *
 * Contract:
 *   - leaf path: marks that one field touched
 *   - container path: walks the subtree, marks each leaf touched
 *   - no arg: walks the whole form, marks every leaf touched
 *   - touched is sticky-true; the call is idempotent
 *   - does NOT clobber focused/blurred (DOM-owned), value, or
 *     trigger validation
 *
 * Mirrored across both adapters (v3 + v4) so the surface is
 * adapter-agnostic.
 */

const apps: App[] = []
afterEach(() => {
  while (apps.length > 0) apps.pop()?.unmount()
  document.body.innerHTML = ''
})

function mountWithApp<T>(setup: () => T): T {
  const handle: { captured?: T } = {}
  const App = defineComponent({
    setup() {
      handle.captured = setup()
      return () => h('div')
    },
  })
  const app = createApp(App).use(createAttaform())
  const root = document.createElement('div')
  document.body.appendChild(root)
  app.mount(root)
  apps.push(app)
  if (handle.captured === undefined) throw new Error('mountWithApp: setup never returned')
  return handle.captured
}

async function flushValidations(form: { meta: { validating: boolean } }): Promise<void> {
  for (let i = 0; i < 20; i++) {
    await nextTick()
    if (!form.meta.validating) break
  }
  await nextTick()
  await nextTick()
}

type FormWithTouch = {
  touch: (path?: string | readonly (string | number)[]) => void
  fields: (path?: string | readonly (string | number)[]) => { touched: boolean | null }
  meta: { validating: boolean }
  setValue: (path: string, value: unknown) => boolean
  values: (path?: string | readonly (string | number)[]) => unknown
}

function asTouchable<F>(form: F): F & FormWithTouch {
  return form as unknown as F & FormWithTouch
}

// -----------------------------------------------------------------------------
// v3 adapter
// -----------------------------------------------------------------------------

describe('form.touch — zod-v3 adapter', () => {
  const schema = zV3.object({
    email: zV3.string().min(1),
    profile: zV3.object({
      name: zV3.string().min(1),
      age: zV3.number().int().min(0),
    }),
  })

  function makeForm() {
    return mountWithApp(() =>
      useFormV3({
        schema,
        key: `touch-v3-${Math.random()}`,
        strict: false,
        defaultValues: { email: '', profile: { name: '', age: 0 } },
      })
    )
  }

  it('marks a leaf path touched', async () => {
    const form = asTouchable(makeForm())
    expect(form.fields('email').touched).toBe(null)
    form.touch('email')
    await nextTick()
    expect(form.fields('email').touched).toBe(true)
  })

  it('idempotent — touching twice keeps touched=true', async () => {
    const form = asTouchable(makeForm())
    form.touch('email')
    await nextTick()
    form.touch('email')
    await nextTick()
    expect(form.fields('email').touched).toBe(true)
  })

  it('container path marks every leaf under it', async () => {
    const form = asTouchable(makeForm())
    form.touch('profile')
    await nextTick()
    expect(form.fields('profile.name').touched).toBe(true)
    expect(form.fields('profile.age').touched).toBe(true)
    // Sibling leaf untouched
    expect(form.fields('email').touched).toBe(null)
  })

  it('no-arg form marks every leaf in the form', async () => {
    const form = asTouchable(makeForm())
    form.touch()
    await nextTick()
    expect(form.fields('email').touched).toBe(true)
    expect(form.fields('profile.name').touched).toBe(true)
    expect(form.fields('profile.age').touched).toBe(true)
  })

  it('segment-array form is equivalent to dotted-string', async () => {
    const form = asTouchable(makeForm())
    form.touch(['profile', 'name'])
    await nextTick()
    expect(form.fields('profile.name').touched).toBe(true)
    expect(form.fields('profile.age').touched).toBe(null)
  })

  it('does not modify value', async () => {
    const form = asTouchable(makeForm())
    const before = JSON.stringify(form.values())
    form.touch()
    await nextTick()
    const after = JSON.stringify(form.values())
    expect(after).toBe(before)
  })

  it('does not trigger validation', async () => {
    const form = asTouchable(makeForm())
    form.touch()
    await flushValidations(form)
    expect(form.meta.validating).toBe(false)
  })

  it('aggregate parent watcher fires once per touch call, not N times', async () => {
    const form = asTouchable(makeForm())
    let runs = 0
    const watcher = computed(() => {
      runs += 1
      return form.fields('profile').touched
    })
    // Prime: read once to register the dep.
    expect(watcher.value).toBe(false)
    const baseline = runs
    form.touch('profile')
    await nextTick()
    // Vue may run the computed once (re-evaluation) — anything more
    // means we're firing per-leaf instead of batching.
    expect(watcher.value).toBe(true)
    expect(runs - baseline).toBeLessThanOrEqual(2)
  })
})

// -----------------------------------------------------------------------------
// v4 adapter
// -----------------------------------------------------------------------------

describe('form.touch — zod-v4 adapter', () => {
  const schema = zV4.object({
    email: zV4.string().min(1),
    profile: zV4.object({
      name: zV4.string().min(1),
      age: zV4.number().int().min(0),
    }),
  })

  function makeForm() {
    return mountWithApp(() =>
      useFormV4({
        schema,
        key: `touch-v4-${Math.random()}`,
        strict: false,
        defaultValues: { email: '', profile: { name: '', age: 0 } },
      })
    )
  }

  it('marks a leaf path touched', async () => {
    const form = asTouchable(makeForm())
    expect(form.fields('email').touched).toBe(null)
    form.touch('email')
    await nextTick()
    expect(form.fields('email').touched).toBe(true)
  })

  it('container path marks every leaf under it', async () => {
    const form = asTouchable(makeForm())
    form.touch('profile')
    await nextTick()
    expect(form.fields('profile.name').touched).toBe(true)
    expect(form.fields('profile.age').touched).toBe(true)
    expect(form.fields('email').touched).toBe(null)
  })

  it('no-arg form marks every leaf in the form', async () => {
    const form = asTouchable(makeForm())
    form.touch()
    await nextTick()
    expect(form.fields('email').touched).toBe(true)
    expect(form.fields('profile.name').touched).toBe(true)
    expect(form.fields('profile.age').touched).toBe(true)
  })

  it('does not trigger validation', async () => {
    const form = asTouchable(makeForm())
    form.touch()
    await flushValidations(form)
    expect(form.meta.validating).toBe(false)
  })
})
