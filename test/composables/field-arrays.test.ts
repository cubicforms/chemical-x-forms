// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { createApp, defineComponent, h, type App } from 'vue'
import { useForm } from '../../src'
import { attachRegistryToApp, createRegistry } from '../../src/runtime/core/registry'
import type { UseAbstractFormReturnType } from '../../src/runtime/types/types-api'
import { fakeSchema } from '../utils/fake-schema'

/**
 * Runtime coverage for Phase 8.5 — typed array helpers.
 *
 * Each helper is a thin wrapper over read-array + slice + splice +
 * setValueAtPath. The tests pin runtime semantics that consumers depend
 * on (append goes to end, swap preserves siblings, replace never grows,
 * etc.) — if a future refactor moves the logic, these guarantee the
 * observable behaviour stays the same.
 *
 * Type-level rejections (non-array path, mismatched element shape) live
 * alongside the rest of the type-inference suite.
 */

type Post = { title: string; views: number }
type BlogForm = {
  title: string
  tags: string[]
  posts: Post[]
}

const defaults: BlogForm = {
  title: 'untitled',
  tags: [],
  posts: [],
}

function harness(initial?: Partial<BlogForm>) {
  let captured!: UseAbstractFormReturnType<BlogForm>
  const Probe = defineComponent({
    setup() {
      captured = useForm<BlogForm>({
        schema: fakeSchema<BlogForm>({ ...defaults, ...initial }),
        key: `fa-${Math.random().toString(36).slice(2)}`,
      })
      return () => h('div')
    },
  })
  const app = createApp(Probe)
  attachRegistryToApp(app, createRegistry())
  app.mount(document.createElement('div'))
  return { app, form: captured }
}

describe('useForm — field array helpers', () => {
  const apps: App[] = []
  afterEach(() => {
    while (apps.length > 0) apps.pop()?.unmount()
  })

  describe('append', () => {
    it('adds an item at the end of a scalar array', () => {
      const { app, form } = harness({ tags: ['a', 'b'] })
      apps.push(app)
      form.append('tags', 'c')
      expect(form.getValue('tags').value).toEqual(['a', 'b', 'c'])
    })

    it('adds an object item at the end of an array-of-object path', () => {
      const { app, form } = harness({ posts: [{ title: 'first', views: 1 }] })
      apps.push(app)
      form.append('posts', { title: 'second', views: 0 })
      expect(form.getValue('posts').value).toEqual([
        { title: 'first', views: 1 },
        { title: 'second', views: 0 },
      ])
    })

    it('treats an unset (undefined) path as an empty array', () => {
      const { app, form } = harness()
      apps.push(app)
      form.append('tags', 'first')
      expect(form.getValue('tags').value).toEqual(['first'])
    })
  })

  describe('prepend', () => {
    it('adds an item at the start', () => {
      const { app, form } = harness({ tags: ['b', 'c'] })
      apps.push(app)
      form.prepend('tags', 'a')
      expect(form.getValue('tags').value).toEqual(['a', 'b', 'c'])
    })
  })

  describe('insert', () => {
    it('inserts at the given index, shifting subsequent items', () => {
      const { app, form } = harness({ tags: ['a', 'c'] })
      apps.push(app)
      form.insert('tags', 1, 'b')
      expect(form.getValue('tags').value).toEqual(['a', 'b', 'c'])
    })

    it('inserting past `length` appends (Array.splice clamping)', () => {
      const { app, form } = harness({ tags: ['a'] })
      apps.push(app)
      form.insert('tags', 99, 'b')
      expect(form.getValue('tags').value).toEqual(['a', 'b'])
    })
  })

  describe('remove', () => {
    it('removes the element at the given index and shifts the tail', () => {
      const { app, form } = harness({ tags: ['a', 'b', 'c'] })
      apps.push(app)
      form.remove('tags', 1)
      expect(form.getValue('tags').value).toEqual(['a', 'c'])
    })

    it('no-ops on an out-of-range index (never grows or shrinks incorrectly)', () => {
      const { app, form } = harness({ tags: ['a', 'b'] })
      apps.push(app)
      form.remove('tags', 5)
      expect(form.getValue('tags').value).toEqual(['a', 'b'])
      form.remove('tags', -1)
      expect(form.getValue('tags').value).toEqual(['a', 'b'])
    })
  })

  describe('swap', () => {
    it('exchanges two elements without disturbing siblings', () => {
      const { app, form } = harness({ tags: ['a', 'b', 'c', 'd'] })
      apps.push(app)
      form.swap('tags', 1, 2)
      expect(form.getValue('tags').value).toEqual(['a', 'c', 'b', 'd'])
    })

    it('no-ops on out-of-range indices', () => {
      const { app, form } = harness({ tags: ['a', 'b'] })
      apps.push(app)
      form.swap('tags', 0, 10)
      expect(form.getValue('tags').value).toEqual(['a', 'b'])
    })

    it('no-ops when a === b', () => {
      const { app, form } = harness({ tags: ['a', 'b'] })
      apps.push(app)
      const before = form.getValue('tags').value
      form.swap('tags', 1, 1)
      expect(form.getValue('tags').value).toEqual(before)
    })
  })

  describe('move', () => {
    it('moves an item from one index to another, preserving order elsewhere', () => {
      const { app, form } = harness({ tags: ['a', 'b', 'c', 'd'] })
      apps.push(app)
      form.move('tags', 0, 2)
      expect(form.getValue('tags').value).toEqual(['b', 'c', 'a', 'd'])
    })

    it('moves to 0 puts the item at the start', () => {
      const { app, form } = harness({ tags: ['a', 'b', 'c'] })
      apps.push(app)
      form.move('tags', 2, 0)
      expect(form.getValue('tags').value).toEqual(['c', 'a', 'b'])
    })

    it('clamps `to` to length (moving to past-end appends)', () => {
      const { app, form } = harness({ tags: ['a', 'b', 'c'] })
      apps.push(app)
      form.move('tags', 0, 99)
      expect(form.getValue('tags').value).toEqual(['b', 'c', 'a'])
    })
  })

  describe('replace', () => {
    it('replaces an element at the given index', () => {
      const { app, form } = harness({ tags: ['a', 'b', 'c'] })
      apps.push(app)
      form.replace('tags', 1, 'B')
      expect(form.getValue('tags').value).toEqual(['a', 'B', 'c'])
    })

    it('does NOT grow the array on out-of-range index', () => {
      const { app, form } = harness({ tags: ['a'] })
      apps.push(app)
      form.replace('tags', 3, 'BAD')
      expect(form.getValue('tags').value).toEqual(['a'])
    })

    it('replaces an object item', () => {
      const { app, form } = harness({ posts: [{ title: 'first', views: 1 }] })
      apps.push(app)
      form.replace('posts', 0, { title: 'second', views: 2 })
      expect(form.getValue('posts').value).toEqual([{ title: 'second', views: 2 }])
    })
  })

  it('mutations trigger reactivity (form-level getValue sees the update)', () => {
    const { app, form } = harness({ tags: ['a'] })
    apps.push(app)
    const tags = form.getValue('tags')
    expect(tags.value).toEqual(['a'])
    form.append('tags', 'b')
    // Computed ref should now reflect the new array — reactivity round-trip.
    expect(tags.value).toEqual(['a', 'b'])
  })
})
