// @vitest-environment jsdom
import { createApp, defineComponent, h } from 'vue'
import { describe, expect, expectTypeOf, it } from 'vitest'
import { z } from 'zod'
import { useForm } from '../../src/zod'
import { createAttaform } from '../../src/runtime/core/plugin'

/**
 * `form.clear(path?)` — wipe a path (or the whole form) to the
 * "appropriate nullish value" for the schema-declared type at that
 * path, regardless of any `.default(...)` wrapper. Orthogonal to
 * `reset()` (which restores declared defaults) by design: a user
 * with `z.boolean().default(true)` who calls `clear` ends up at
 * `false`, never `true`. From feedback doc §2.1.
 *
 * Implementation note: `clear` is sugar for `setValue(path,
 * appropriateNullishValue)`, where the nullish value comes from the
 * adapter's underlying "schema empty for type" walk (in zod-v4, the
 * `deriveDefault(schema, useDefault=false, ...)` branch — the same
 * machinery that produces blank-path synthesis falsy values).
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
  return `clear-${prefix}-${Math.random().toString(36).slice(2)}`
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

describe('form.clear(path) — primitive leaves wipe to falsy, not default', () => {
  it('clear("urls") → []', () => {
    const { api, unmount } = mountForm(() => useForm({ schema, key: uniqueKey('arr') }))
    try {
      expect(api.values.urls).toEqual(['https://a.test']) // schema default
      api.clear('urls')
      expect(api.values.urls).toEqual([])
    } finally {
      unmount()
    }
  })

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
})

describe('form.clear(path) — nested objects recurse to per-leaf falsy', () => {
  it('clear("config") → { enabled: false, label: "" }', () => {
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
      expect(api.values.config.enabled).toBe(true)
      api.clear('config.enabled')
      expect(api.values.config.enabled).toBe(false)
      // Sibling untouched.
      expect(api.values.config.label).toBe('default-label')
    } finally {
      unmount()
    }
  })
})

describe('form.clear(path) — optional / nullable respect their wrapper semantic', () => {
  it('clear("optionalBio") → undefined (the wrapper\'s "absent" marker)', () => {
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

  it('clear("nullableRef") → null (the wrapper\'s "explicit empty")', () => {
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

describe('form.clear() — whole-form variant clears every leaf to its falsy', () => {
  it('clear() with no path wipes every leaf to falsy-for-type', () => {
    const { api, unmount } = mountForm(() => useForm({ schema, key: uniqueKey('whole') }))
    try {
      api.clear()
      expect(api.values.urls).toEqual([])
      expect(api.values.name).toBe('')
      expect(api.values.notify).toBe(false)
      expect(api.values.count).toBe(0)
      expect(api.values.config).toEqual({ enabled: false, label: '' })
    } finally {
      unmount()
    }
  })

  // `''` is a real, distinct path (the form-level slot post-#184), NOT
  // equivalent to "no arg / whole-form". The implementation must NOT
  // collapse them via special-casing — otherwise it has to maintain a
  // nuanced exception every time the empty-string path matters. This
  // probe locks the disambiguation so a refactor that conflates `''`
  // with "no path" trips immediately.
  it("clear('') is path-targeted and does NOT wipe non-empty-path values", () => {
    const { api, unmount } = mountForm(() => useForm({ schema, key: uniqueKey('empty-path') }))
    try {
      // Sanity — every named field carries its declared default.
      expect(api.values.notify).toBe(true)
      expect(api.values.name).toBe('ozzy')
      expect(api.values.count).toBe(5)

      api.clear('')

      // The named fields stay at their declared defaults; clear('')
      // touches only the '' slot (if any), never collapses to
      // whole-form clear.
      expect(api.values.notify).toBe(true)
      expect(api.values.name).toBe('ozzy')
      expect(api.values.count).toBe(5)
    } finally {
      unmount()
    }
  })
})

describe('form.clear vs form.reset — orthogonality', () => {
  it('reset restores schema defaults; clear wipes to falsy', () => {
    const { api, unmount } = mountForm(() => useForm({ schema, key: uniqueKey('vs') }))
    try {
      // After mount: defaults apply.
      expect(api.values.notify).toBe(true)

      // setValue → false; reset → back to default true.
      api.setValue('notify', false)
      api.reset()
      expect(api.values.notify).toBe(true)

      // setValue → true; clear → false (NOT the default).
      api.setValue('notify', true)
      api.clear('notify')
      expect(api.values.notify).toBe(false)
    } finally {
      unmount()
    }
  })

  it('whole-form reset() vs clear() produce different end states', () => {
    const { api, unmount } = mountForm(() => useForm({ schema, key: uniqueKey('whole-vs') }))
    try {
      api.reset()
      expect(api.values.notify).toBe(true)
      expect(api.values.count).toBe(5)
      expect(api.values.name).toBe('ozzy')

      api.clear()
      expect(api.values.notify).toBe(false)
      expect(api.values.count).toBe(0)
      expect(api.values.name).toBe('')
    } finally {
      unmount()
    }
  })
})

describe('form.clear — type-level signature', () => {
  it('accepts FlatPath strings (same as setValue / resetField)', () => {
    const { api, unmount } = mountForm(() => useForm({ schema, key: uniqueKey('types') }))
    try {
      // These compile, asserting the path types are recognised.
      api.clear('urls')
      api.clear('name')
      api.clear('config.enabled')
      api.clear() // whole-form
      expectTypeOf(api.clear).toBeFunction()
      // Bad paths rejected.
      // @ts-expect-error - path not in schema
      api.clear('definitely.not.a.path')
    } finally {
      unmount()
    }
  })
})

describe('form.clear — tuple-segment path form', () => {
  it('accepts [segment, ...] tuples (parallels setValue / toRef)', () => {
    const { api, unmount } = mountForm(() => useForm({ schema, key: uniqueKey('tuple') }))
    try {
      api.clear(['config', 'enabled'])
      expect(api.values.config.enabled).toBe(false)
      expect(api.values.config.label).toBe('default-label')
    } finally {
      unmount()
    }
  })
})
