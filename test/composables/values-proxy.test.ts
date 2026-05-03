// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { createApp, defineComponent, h, isReactive, isReadonly, isRef, nextTick, watch } from 'vue'
import { z } from 'zod'
import { useForm } from '../../src/zod'
import { createAttaform } from '../../src/runtime/core/plugin'

/**
 * `form.values` — Pinia-style reactive readonly proxy over the form
 * value. Read identically in script + template (no `.value`), writes
 * blocked at the proxy boundary, deeply reactive, identity-stable
 * across `reset()` swaps.
 */

const schema = z.object({
  email: z.string(),
  age: z.number(),
  address: z.object({
    city: z.string(),
    zip: z.string(),
  }),
  tags: z.array(z.string()),
})

type Form = z.infer<typeof schema>

async function flush(): Promise<void> {
  for (let i = 0; i < 4; i++) {
    await Promise.resolve()
    await nextTick()
  }
}

function mountForm(): {
  api: ReturnType<typeof useForm<typeof schema>>
  unmount: () => void
} {
  let captured: ReturnType<typeof useForm<typeof schema>> | undefined
  const App = defineComponent({
    setup() {
      captured = useForm({
        schema,
        key: `values-proxy-${Math.random().toString(36).slice(2)}`,
        defaultValues: {
          email: 'a@b.com',
          age: 30,
          address: { city: 'NYC', zip: '10001' },
          tags: ['alpha', 'beta'],
        } as Form,
      })
      return () => h('div')
    },
  })
  const app = createApp(App).use(createAttaform())
  const root = document.createElement('div')
  document.body.appendChild(root)
  app.mount(root)
  if (captured === undefined) throw new Error('mountForm: useForm never returned')
  return {
    api: captured,
    unmount: () => {
      app.unmount()
      document.body.removeChild(root)
    },
  }
}

describe('form.values — readonly reactive proxy', () => {
  it('reads primitive leaves directly with no .value', () => {
    const { api, unmount } = mountForm()
    try {
      expect(api.values.email).toBe('a@b.com')
      expect(api.values.age).toBe(30)
    } finally {
      unmount()
    }
  })

  it('reads nested object leaves through dotted access', () => {
    const { api, unmount } = mountForm()
    try {
      expect(api.values.address.city).toBe('NYC')
      expect(api.values.address.zip).toBe('10001')
    } finally {
      unmount()
    }
  })

  it('reads array entries with index access', () => {
    const { api, unmount } = mountForm()
    try {
      expect(api.values.tags[0]).toBe('alpha')
      expect(api.values.tags[1]).toBe('beta')
      expect(api.values.tags.length).toBe(2)
    } finally {
      unmount()
    }
  })

  it('reflects setValue mutations on subsequent reads', () => {
    const { api, unmount } = mountForm()
    try {
      api.setValue('email', 'changed@x.com')
      expect(api.values.email).toBe('changed@x.com')
      api.setValue('address.city', 'Boston')
      expect(api.values.address.city).toBe('Boston')
    } finally {
      unmount()
    }
  })

  it('returns a deeply readonly proxy (writes warn-and-noop, not throw)', () => {
    const { api, unmount } = mountForm()
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    try {
      // Vue's readonly() emits a dev-warn and returns true (write rejected).
      // The mutation does NOT take effect.
      expect(isReadonly(api.values)).toBe(true)
      const before = api.values.email
      ;(api.values as { email: string }).email = 'should-not-stick'
      expect(api.values.email).toBe(before)
    } finally {
      warnSpy.mockRestore()
      unmount()
    }
  })

  it('nested objects are themselves readonly + reactive', () => {
    const { api, unmount } = mountForm()
    try {
      expect(isReactive(api.values.address)).toBe(true)
      expect(isReadonly(api.values.address)).toBe(true)
    } finally {
      unmount()
    }
  })

  it('triggers a watch effect when the underlying form value changes', async () => {
    const { api, unmount } = mountForm()
    const seen: string[] = []
    const stop = watch(
      () => api.values.email,
      (next) => {
        seen.push(next)
      }
    )
    try {
      api.setValue('email', 'first@x.com')
      await flush()
      api.setValue('email', 'second@x.com')
      await flush()
      expect(seen).toEqual(['first@x.com', 'second@x.com'])
    } finally {
      stop()
      unmount()
    }
  })

  it('survives reset() — produces a fresh readonly proxy keyed to the new target', async () => {
    const { api, unmount } = mountForm()
    try {
      api.setValue('email', 'pre-reset@x.com')
      expect(api.values.email).toBe('pre-reset@x.com')

      api.reset()
      await flush()
      expect(api.values.email).toBe('a@b.com')
      expect(api.values.address.city).toBe('NYC')
    } finally {
      unmount()
    }
  })

  it('triggers a watch effect when reset() swaps the whole form value', async () => {
    const { api, unmount } = mountForm()
    const seen: string[] = []
    const stop = watch(
      () => api.values.email,
      (next) => {
        seen.push(next)
      }
    )
    try {
      api.setValue('email', 'before-reset@x.com')
      await flush()
      api.reset()
      await flush()
      // First entry: setValue. Second: reset (back to default).
      expect(seen).toEqual(['before-reset@x.com', 'a@b.com'])
    } finally {
      stop()
      unmount()
    }
  })

  it('reflects field-array mutations via append/prepend/remove', async () => {
    const { api, unmount } = mountForm()
    try {
      api.append('tags', 'gamma')
      await flush()
      expect(api.values.tags).toEqual(['alpha', 'beta', 'gamma'])

      api.prepend('tags', 'pre')
      await flush()
      expect(api.values.tags).toEqual(['pre', 'alpha', 'beta', 'gamma'])

      api.remove('tags', 0)
      await flush()
      expect(api.values.tags).toEqual(['alpha', 'beta', 'gamma'])
    } finally {
      unmount()
    }
  })
})

describe('form.errors — readonly proxy over the form error map', () => {
  it('reflects user-injected errors on dotted-key access', () => {
    const { api, unmount } = mountForm()
    try {
      api.setFieldErrors([
        {
          path: ['email'],
          message: 'taken',
          code: 'custom',
          formKey: api.key,
        },
      ])
      expect(api.errors.email).toHaveLength(1)
      expect(api.errors.email?.[0]?.message).toBe('taken')
      expect(api.errors.age).toBeUndefined()
    } finally {
      unmount()
    }
  })
})

describe('form.toRef — escape hatch for ref-shaped interop', () => {
  it('returns a Readonly<Ref<T>> matching the path value', () => {
    const { api, unmount } = mountForm()
    try {
      const emailRef = api.toRef('email')
      expect(isRef(emailRef)).toBe(true)
      expect(emailRef.value).toBe('a@b.com')
    } finally {
      unmount()
    }
  })

  it('the returned ref reflects subsequent setValue mutations', async () => {
    const { api, unmount } = mountForm()
    try {
      const emailRef = api.toRef('email')
      api.setValue('email', 'changed@x.com')
      await flush()
      expect(emailRef.value).toBe('changed@x.com')
    } finally {
      unmount()
    }
  })
})
