// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { createApp, defineComponent, h, type App } from 'vue'
import { useForm } from '../../src/zod'
import { z } from 'zod'
import { createAttaform } from '../../src/runtime/core/plugin'

/**
 * Runtime smoke for the tuple-segment overload on `form.register` (and
 * future Phase 3b/3c siblings). The runtime path-handling
 * (`canonicalizePath` in `src/runtime/core/paths.ts`) already accepts
 * both dotted-string and segment-array forms; these tests confirm the
 * tuple form produces an equivalent `RegisterValue` to the dotted
 * form — same resolved path key, same value reads, same write
 * propagation.
 */

const schema = z.object({
  email: z.string(),
  profile: z.object({
    name: z.string(),
  }),
  posts: z.array(
    z.object({
      title: z.string(),
    })
  ),
})

type Api = ReturnType<typeof useForm<typeof schema>>

function mount(): { app: App; api: Api } {
  const handle: { api?: Api } = {}
  const App = defineComponent({
    setup() {
      handle.api = useForm({
        schema,
        key: 'path-tuples',
        strict: false,
        defaultValues: {
          email: 'a@b.c',
          profile: { name: 'Ada' },
          posts: [{ title: 'first' }, { title: 'second' }],
        },
      })
      return () => h('div')
    },
  })
  const app = createApp(App).use(createAttaform({ override: true }))
  const root = document.createElement('div')
  document.body.appendChild(root)
  app.mount(root)
  return { app, api: handle.api as Api }
}

describe('register — tuple-segment runtime equivalence', () => {
  const apps: App[] = []
  afterEach(() => {
    while (apps.length > 0) apps.pop()?.unmount()
  })

  it('produces the same canonical PathKey for tuple and dotted forms', () => {
    const { app, api } = mount()
    apps.push(app)

    const dotted = api.register('email')
    const tuple = api.register(['email'])
    expect(tuple.path).toBe(dotted.path)
    expect(tuple.segments).toEqual(dotted.segments)
  })

  it('reads the same live value through both forms', () => {
    const { app, api } = mount()
    apps.push(app)

    const dotted = api.register('profile.name')
    const tuple = api.register(['profile', 'name'])
    expect(tuple.innerRef.value).toBe(dotted.innerRef.value)

    api.setValue('profile.name', 'Grace')
    expect(tuple.innerRef.value).toBe('Grace')
    expect(dotted.innerRef.value).toBe('Grace')
  })

  it('handles mixed string/number tuple segments through array indices', () => {
    const { app, api } = mount()
    apps.push(app)

    const dotted = api.register('posts.0.title')
    const tuple = api.register(['posts', 0, 'title'])
    expect(tuple.path).toBe(dotted.path)
    expect(tuple.innerRef.value).toBe('first')

    api.setValue('posts.0.title', 'updated')
    expect(tuple.innerRef.value).toBe('updated')
  })

  it('passes options through identically', () => {
    const { app, api } = mount()
    apps.push(app)

    const dotted = api.register('email', { persist: false })
    const tuple = api.register(['email'], { persist: false })
    expect(tuple.persist).toBe(dotted.persist)
  })
})
