// @vitest-environment jsdom
import { createApp, defineComponent, h } from 'vue'
import { describe, expect, it } from 'vitest'
import { z } from 'zod-v3'
import { useForm } from '../../src/zod-v3'
import { createAttaform } from '../../src/runtime/core/plugin'

/**
 * `form.clear(path?)` — Zod v3 mirror of `clear.test.ts`. Pins the
 * same orthogonality with `reset`: clear wipes to falsy-for-type,
 * reset restores declared defaults.
 */

function mountForm<R>(setup: () => R): { api: R; unmount: () => void } {
  let captured: R | undefined
  const App = defineComponent({
    setup() {
      captured = setup()
      return () => h('div')
    },
  })
  const app = createApp(App).use(createAttaform())
  const root = document.createElement('div')
  document.body.appendChild(root)
  app.mount(root)
  if (captured === undefined) throw new Error('mountForm: setup never returned')
  return {
    api: captured,
    unmount: () => {
      app.unmount()
      document.body.removeChild(root)
    },
  }
}

function uniqueKey(prefix: string): string {
  return `v3-clear-${prefix}-${Math.random().toString(36).slice(2)}`
}

const schema = z.object({
  urls: z.array(z.string()).default(['https://a.test']),
  name: z.string().default('ozzy'),
  notify: z.boolean().default(true),
  count: z.number().default(5),
  config: z
    .object({
      enabled: z.boolean().default(true),
      label: z.string().default('default-label'),
    })
    .default({ enabled: true, label: 'default-label' }),
  optionalBio: z.string().optional(),
  nullableRef: z.string().nullable(),
})

describe('v3 — form.clear(path) wipes primitives to falsy', () => {
  it('clear("name") → "" (NOT the default "ozzy")', () => {
    const { api, unmount } = mountForm(() => useForm({ schema, key: uniqueKey('str') }))
    try {
      expect(api.values.name).toBe('ozzy')
      api.clear('name')
      expect(api.values.name).toBe('')
    } finally {
      unmount()
    }
  })

  it('clear("notify") → false (NOT the default true)', () => {
    const { api, unmount } = mountForm(() => useForm({ schema, key: uniqueKey('bool') }))
    try {
      expect(api.values.notify).toBe(true)
      api.clear('notify')
      expect(api.values.notify).toBe(false)
    } finally {
      unmount()
    }
  })

  it('clear("count") → 0 (NOT the default 5)', () => {
    const { api, unmount } = mountForm(() => useForm({ schema, key: uniqueKey('num') }))
    try {
      expect(api.values.count).toBe(5)
      api.clear('count')
      expect(api.values.count).toBe(0)
    } finally {
      unmount()
    }
  })

  it('clear("urls") → []', () => {
    const { api, unmount } = mountForm(() => useForm({ schema, key: uniqueKey('arr') }))
    try {
      expect(api.values.urls).toEqual(['https://a.test'])
      api.clear('urls')
      expect(api.values.urls).toEqual([])
    } finally {
      unmount()
    }
  })
})

describe('v3 — nested object descent', () => {
  it('clear("config") → recursively-empty inner shape', () => {
    const { api, unmount } = mountForm(() => useForm({ schema, key: uniqueKey('obj') }))
    try {
      expect(api.values.config).toEqual({ enabled: true, label: 'default-label' })
      api.clear('config')
      expect(api.values.config).toEqual({ enabled: false, label: '' })
    } finally {
      unmount()
    }
  })

  it('clear("config.enabled") → false (sub-path)', () => {
    const { api, unmount } = mountForm(() => useForm({ schema, key: uniqueKey('obj-sub') }))
    try {
      api.clear('config.enabled')
      expect(api.values.config.enabled).toBe(false)
      expect(api.values.config.label).toBe('default-label')
    } finally {
      unmount()
    }
  })
})

describe('v3 — wrapper semantics', () => {
  it('clear("optionalBio") → undefined', () => {
    const { api, unmount } = mountForm(() => useForm({ schema, key: uniqueKey('opt') }))
    try {
      api.setValue('optionalBio', 'hello')
      expect(api.values.optionalBio).toBe('hello')
      api.clear('optionalBio')
      expect(api.values.optionalBio).toBeUndefined()
    } finally {
      unmount()
    }
  })

  it('clear("nullableRef") → null', () => {
    const { api, unmount } = mountForm(() => useForm({ schema, key: uniqueKey('nul') }))
    try {
      api.setValue('nullableRef', 'something')
      expect(api.values.nullableRef).toBe('something')
      api.clear('nullableRef')
      expect(api.values.nullableRef).toBeNull()
    } finally {
      unmount()
    }
  })
})

describe("v3 — whole-form and `''` distinction", () => {
  it('clear() (no arg) wipes every leaf to falsy', () => {
    const { api, unmount } = mountForm(() => useForm({ schema, key: uniqueKey('whole') }))
    try {
      api.clear()
      expect(api.values.notify).toBe(false)
      expect(api.values.count).toBe(0)
      expect(api.values.name).toBe('')
    } finally {
      unmount()
    }
  })

  it("clear('') targets the empty-string path slot, does NOT wipe whole form", () => {
    const { api, unmount } = mountForm(() => useForm({ schema, key: uniqueKey('empty-path') }))
    try {
      expect(api.values.notify).toBe(true)
      expect(api.values.name).toBe('ozzy')

      api.clear('')

      expect(api.values.notify).toBe(true)
      expect(api.values.name).toBe('ozzy')
    } finally {
      unmount()
    }
  })
})

describe('v3 — orthogonality with reset', () => {
  it('reset restores defaults; clear wipes to falsy', () => {
    const { api, unmount } = mountForm(() => useForm({ schema, key: uniqueKey('vs') }))
    try {
      api.setValue('notify', false)
      api.reset()
      expect(api.values.notify).toBe(true)

      api.setValue('notify', true)
      api.clear('notify')
      expect(api.values.notify).toBe(false)
    } finally {
      unmount()
    }
  })
})
