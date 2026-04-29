// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { createApp, defineComponent, h, nextTick, watch, type App } from 'vue'
import { z } from 'zod'
import { useForm } from '../../src/zod'
import { createChemicalXForms } from '../../src/runtime/core/plugin'

/**
 * `form.fieldState` — Pinia-style nested reactive proxy. Each path
 * exposes the FieldStateLeaf at that path AND descent into named
 * children. FieldStateLeaf keys (`dirty`, `touched`, `errors`,
 * `pendingEmpty`, `currentValue`, `focused`, `blurred`, `pristine`,
 * `value`, `original`, `isConnected`, `updatedAt`, `path`) shadow
 * schema fields with conflicting names at depth 2+.
 */

const schema = z.object({
  email: z.string().email(),
  password: z.string().min(4),
  address: z.object({
    city: z.string(),
    zip: z.string(),
  }),
})

async function flush(): Promise<void> {
  for (let i = 0; i < 4; i++) {
    await Promise.resolve()
    await nextTick()
  }
}

function mountForm(): {
  api: ReturnType<typeof useForm<typeof schema>>
  app: App
} {
  let captured: ReturnType<typeof useForm<typeof schema>> | undefined
  const App = defineComponent({
    setup() {
      captured = useForm({
        schema,
        key: `field-state-proxy-${Math.random().toString(36).slice(2)}`,
        defaultValues: {
          email: 'a@b.com',
          password: 'secret',
          address: { city: 'NYC', zip: '10001' },
        },
      })
      return () => h('div')
    },
  })
  const app = createApp(App).use(createChemicalXForms())
  const root = document.createElement('div')
  document.body.appendChild(root)
  app.mount(root)
  if (captured === undefined) throw new Error('mountForm: useForm never returned')
  return { api: captured, app }
}

describe('form.fieldState — top-level leaf reads', () => {
  let app: App | undefined
  afterEach(() => {
    app?.unmount()
    app = undefined
    document.body.innerHTML = ''
  })

  it('exposes leaf props directly without .value', () => {
    const mounted = mountForm()
    app = mounted.app
    const fs = mounted.api.fieldState.email
    expect(fs.value).toBe('a@b.com')
    expect(fs.dirty).toBe(false)
    expect(fs.pristine).toBe(true)
    expect(fs.errors).toEqual([])
    expect(fs.touched).toBe(null)
  })

  it('reflects setValue mutations on subsequent reads', () => {
    const mounted = mountForm()
    app = mounted.app
    expect(mounted.api.fieldState.email.value).toBe('a@b.com')
    mounted.api.setValue('email', 'changed@x.com')
    expect(mounted.api.fieldState.email.value).toBe('changed@x.com')
    expect(mounted.api.fieldState.email.dirty).toBe(true)
  })

  it('triggers a watch effect when an underlying field changes', async () => {
    const mounted = mountForm()
    app = mounted.app
    const seen: boolean[] = []
    const stop = watch(
      () => mounted.api.fieldState.email.dirty,
      (next) => {
        seen.push(next)
      }
    )
    mounted.api.setValue('email', 'first@x.com')
    await flush()
    mounted.api.setValue('email', 'a@b.com')
    await flush()
    stop()
    expect(seen).toEqual([true, false])
  })
})

describe('form.fieldState — nested descent', () => {
  let app: App | undefined
  afterEach(() => {
    app?.unmount()
    app = undefined
    document.body.innerHTML = ''
  })

  it('descends into nested object paths', () => {
    const mounted = mountForm()
    app = mounted.app
    expect(mounted.api.fieldState.address.city.value).toBe('NYC')
    expect(mounted.api.fieldState.address.zip.value).toBe('10001')
    expect(mounted.api.fieldState.address.city.dirty).toBe(false)
  })

  it('reflects nested mutations', () => {
    const mounted = mountForm()
    app = mounted.app
    mounted.api.setValue('address.city', 'Boston')
    expect(mounted.api.fieldState.address.city.value).toBe('Boston')
    expect(mounted.api.fieldState.address.city.dirty).toBe(true)
  })

  it('returns the same proxy reference on repeated path access', () => {
    const mounted = mountForm()
    app = mounted.app
    const a = mounted.api.fieldState.email
    const b = mounted.api.fieldState.email
    expect(a).toBe(b)

    const ac = mounted.api.fieldState.address.city
    const bc = mounted.api.fieldState.address.city
    expect(ac).toBe(bc)
  })
})

describe('form.fieldState — errors propagation', () => {
  let app: App | undefined
  afterEach(() => {
    app?.unmount()
    app = undefined
    document.body.innerHTML = ''
  })

  it('surfaces user-injected errors at the path', () => {
    const mounted = mountForm()
    app = mounted.app
    mounted.api.setFieldErrors([
      {
        path: ['email'],
        message: 'taken',
        code: 'custom',
        formKey: mounted.api.key,
      },
    ])
    expect(mounted.api.fieldState.email.errors).toHaveLength(1)
    expect(mounted.api.fieldState.email.errors[0]?.message).toBe('taken')
  })

  it('errors at one path do not leak to another', () => {
    const mounted = mountForm()
    app = mounted.app
    mounted.api.setFieldErrors([
      {
        path: ['email'],
        message: 'taken',
        code: 'custom',
        formKey: mounted.api.key,
      },
    ])
    expect(mounted.api.fieldState.email.errors).toHaveLength(1)
    expect(mounted.api.fieldState.password.errors).toEqual([])
  })
})
