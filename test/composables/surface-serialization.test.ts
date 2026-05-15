// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { createApp, defineComponent, h, nextTick, toDisplayString, type App } from 'vue'
import { useForm } from '../../src/zod'
import type { UseFormReturn } from '../../src/zod'
import { z } from 'zod'
import { createAttaform } from '../../src/runtime/core/plugin'

/**
 * Surface-serialization parity. `form.values`, `form.errors`, and
 * `form.fields` are all callable Proxies with function targets. Each
 * must serialize sensibly when consumed by:
 *
 *   - Vue templates (`{{ form.values }}`) — routes through
 *     `toDisplayString` → `String(proxy)` for callables, which trips
 *     `Symbol.toPrimitive` if intercepted else falls to
 *     `Function.prototype.toString` (i.e. `"() => {}"`, useless).
 *   - `JSON.stringify(proxy)` — routes through the `toJSON` trap.
 *
 * For `form.errors` specifically, two additional contracts:
 *
 *   - Form-level errors (set via `setFormErrors([{message}])`, stored
 *     at the empty-string path bucket) MUST appear in the serialized
 *     output, keyed at the empty string. Otherwise consumers debug-
 *     printing the proxy can't see them.
 *   - User errors at paths the schema doesn't know about (server
 *     replies referencing an unknown field — drift, typo, soft-renamed
 *     field) MUST appear too. They're the consumer's data; the
 *     library doesn't get to silently drop them.
 *   - Inactive DU variant errors (schema errors at a path whose
 *     discriminator just switched away) STAY hidden. They're library-
 *     produced; the active variant is the source of truth.
 */
describe('form.values / form.errors / form.fields — template + JSON.stringify parity', () => {
  const apps: App[] = []
  afterEach(() => {
    while (apps.length > 0) apps.pop()?.unmount()
  })

  function mountSimple() {
    const schema = z.object({
      email: z.email(),
      password: z.string().min(1, 'pw required'),
    })
    type Api = UseFormReturn<typeof schema>
    const handle: { api?: Api } = {}
    const App = defineComponent({
      setup() {
        handle.api = useForm({
          schema,
          key: `surface-${Math.random().toString(36).slice(2)}`,
          strict: false,
        })
        return () => h('div')
      },
    })
    const app = createApp(App).use(createAttaform())
    app.mount(document.createElement('div'))
    apps.push(app)
    return handle.api as Api
  }

  describe('form.values', () => {
    it('Vue template binding ({{ form.values }}) renders the form data, not "() => {}"', async () => {
      const form = mountSimple()
      form.setValue('email', 'a@b.co')
      form.setValue('password', 'hunter2')
      await nextTick()

      // toDisplayString is what Vue calls for `{{ expr }}` interpolation.
      const rendered = toDisplayString(form.values)

      // Must be parseable JSON of the form data.
      const parsed = JSON.parse(rendered)
      expect(parsed).toEqual({ email: 'a@b.co', password: 'hunter2' })

      // Negative: must NOT be the arrow-function source.
      expect(rendered).not.toMatch(/=>/)
    })

    it('String(form.values) coerces to JSON via Symbol.toPrimitive', () => {
      const form = mountSimple()
      form.setValue('email', 'a@b.co')

      const stringified = String(form.values)
      const parsed = JSON.parse(stringified)
      expect(parsed).toEqual({ email: 'a@b.co', password: '' })
    })

    it('JSON.stringify(form.values) returns the form data via toJSON', () => {
      const form = mountSimple()
      form.setValue('email', 'a@b.co')

      const parsed = JSON.parse(JSON.stringify(form.values))
      expect(parsed).toEqual({ email: 'a@b.co', password: '' })
    })
  })

  describe('form.errors', () => {
    it('Vue template binding renders form-level + field errors as JSON', async () => {
      const form = mountSimple()
      // Order matters: `setFieldErrors` calls `setAllUserErrors`
      // which CLEARS the user-error map before writing, including
      // the form-level bucket. Field-first, form-after preserves
      // both. Reversing the order today wipes the form-level entry
      // — tracked separately as a setFieldErrors-vs-setFormErrors
      // isolation bug.
      form.setFieldErrors([
        { path: ['email'], message: 'taken', formKey: form.key, code: 'api:dup' },
      ])
      form.setFormErrors([{ message: 'oh snap!' }])
      await nextTick()

      const rendered = toDisplayString(form.errors)
      const parsed = JSON.parse(rendered)

      // Field error visible (already worked).
      expect(parsed.email).toBeDefined()
      expect((parsed.email as Array<{ message: string }>)[0]?.message).toBe('taken')

      // Form-level visible at the empty-string key (the canonical
      // form-level path).
      expect(parsed['']).toBeDefined()
      expect((parsed[''] as Array<{ message: string }>)[0]?.message).toBe('oh snap!')
    })

    it('JSON.stringify(form.errors) includes form-level user errors', async () => {
      const form = mountSimple()
      form.setFormErrors([{ message: 'capacity exceeded' }])
      await nextTick()

      const tree = JSON.parse(JSON.stringify(form.errors)) as Record<string, unknown>
      expect(tree['']).toBeDefined()
      expect((tree[''] as Array<{ message: string }>)[0]?.message).toBe('capacity exceeded')
    })

    it('JSON.stringify(form.errors) includes user errors at paths NOT in the schema', async () => {
      const form = mountSimple()
      // The schema only has `email` and `password`. A server reply
      // referencing an unknown key (`nonExistent.field`) is the
      // consumer's data — the proxy must surface it for debugging
      // even though `hasAtPath` would normally filter the path out.
      form.setFieldErrors([
        {
          path: ['nonExistent', 'field'],
          message: 'server says no',
          formKey: form.key,
          code: 'api:unknown',
        },
      ])
      await nextTick()

      const tree = JSON.parse(JSON.stringify(form.errors)) as Record<string, unknown>
      const nonExistent = tree['nonExistent'] as Record<string, unknown> | undefined
      expect(nonExistent).toBeDefined()
      const field = nonExistent?.['field'] as Array<{ message: string }> | undefined
      expect(field?.[0]?.message).toBe('server says no')
    })

    it('JSON.stringify(form.errors) still HIDES schema errors at inactive DU variants', async () => {
      // Variant-switch: schema error is written against the email
      // variant, then the discriminator switches to sms. The schema
      // error remains in the store (form.meta.errors sees it) but
      // form.errors filters it out because the path is unreachable
      // through the current value.
      const schema = z.object({
        notify: z.discriminatedUnion('channel', [
          z.object({ channel: z.literal('email'), address: z.email() }),
          z.object({ channel: z.literal('sms'), number: z.string().min(10) }),
        ]),
      })
      type Api = UseFormReturn<typeof schema>
      const handle: { api?: Api } = {}
      const App = defineComponent({
        setup() {
          handle.api = useForm({
            schema,
            key: `surface-du-${Math.random().toString(36).slice(2)}`,
            strict: false,
            defaultValues: { notify: { channel: 'email', address: 'bad@' } } as never,
          })
          return () => h('div')
        },
      })
      const app = createApp(App).use(createAttaform())
      app.mount(document.createElement('div'))
      apps.push(app)
      const form = handle.api as Api

      // Trigger schema error on the email variant.
      await form.validateAsync()
      await nextTick()

      // Switch to the sms variant. The schema error at notify.address
      // becomes inactive (the active value tree doesn't have an
      // `address` branch anymore).
      form.setValue('notify', { channel: 'sms', number: '5551234567' })
      await nextTick()

      const tree = JSON.parse(JSON.stringify(form.errors)) as Record<string, unknown>
      const notify = tree['notify'] as Record<string, unknown> | undefined
      // Either notify is undefined, or it doesn't have an `address`
      // entry — both encode "the inactive variant's error is hidden."
      if (notify !== undefined) {
        expect(notify['address']).toBeUndefined()
      }
    })
  })

  describe('setFieldErrors / setFormErrors isolation', () => {
    it('clearFieldErrors() with no path preserves form-level errors', async () => {
      const form = mountSimple()
      form.setFormErrors([{ message: 'capacity exceeded' }])
      form.setFieldErrors([
        { path: ['email'], message: 'taken', formKey: form.key, code: 'api:dup' },
      ])
      await nextTick()

      form.clearFieldErrors()
      await nextTick()

      // Field error gone.
      expect(form.errors.email).toBeUndefined()
      // Form-level survives — `clearFieldErrors` is field-scope only.
      // Use `clearFormErrors` to drop form-level.
      expect(form.errors('')?.[0]?.message).toBe('capacity exceeded')
    })

    it('setFieldErrors does NOT wipe a previously-set form-level error', async () => {
      // setFormErrors stores at the empty-string bucket; setFieldErrors
      // writes field errors. The two manage logically distinct slots
      // and must not clobber each other in either order.
      const form = mountSimple()
      form.setFormErrors([{ message: 'capacity exceeded' }])
      form.setFieldErrors([
        { path: ['email'], message: 'taken', formKey: form.key, code: 'api:dup' },
      ])
      await nextTick()

      // Field error landed.
      expect(form.errors.email?.[0]?.message).toBe('taken')
      // Form-level survives — it was set first and the field-error
      // write must NOT have cleared the empty-string bucket.
      expect(form.errors('')?.[0]?.message).toBe('capacity exceeded')
      // Aggregate sees both.
      const flat = form.meta.errors
      expect(flat.find((e) => e.message === 'taken')).toBeDefined()
      expect(flat.find((e) => e.message === 'capacity exceeded')).toBeDefined()
    })
  })

  describe('form.fields', () => {
    it('Vue template binding renders something useful (not "() => {}")', async () => {
      const form = mountSimple()
      form.setValue('email', 'a@b.co')
      await nextTick()

      const rendered = toDisplayString(form.fields)
      // Whatever the materialized shape, it must NOT be the arrow-
      // function source. Existing contract: returns `{}` at the
      // container level because field-state descendants serialise via
      // per-field reads. The regression-only assertion here pins that
      // the Symbol.toPrimitive trap doesn't fall through to
      // Function.prototype.toString.
      expect(rendered).not.toMatch(/=>/)
      expect(() => JSON.parse(rendered)).not.toThrow()
    })

    it('JSON.stringify(form.fields.email) returns the FieldState snapshot', async () => {
      const form = mountSimple()
      form.setValue('email', 'a@b.co')
      await nextTick()

      const snapshot = JSON.parse(JSON.stringify(form.fields.email)) as Record<string, unknown>
      // FieldState terminal includes the usual keys.
      expect(snapshot['value']).toBe('a@b.co')
      expect(typeof snapshot['dirty']).toBe('boolean')
      expect(typeof snapshot['touched']).toBe('boolean')
    })
  })
})
