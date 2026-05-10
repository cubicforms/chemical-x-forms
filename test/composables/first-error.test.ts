// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { createApp, defineComponent, h, nextTick, type App } from 'vue'
import { z as zV4 } from 'zod'
import { z as zV3 } from 'zod-v3'
import { useForm as useFormV4 } from '../../src/zod-v4'
import { useForm as useFormV3 } from '../../src/zod-v3'
import { createAttaform } from '../../src/runtime/core/plugin'
import type { ValidationError } from '../../src'

/**
 * `field.firstError` — pure data primitive.
 *
 * `firstError` returns the first error in the deterministic schema-
 * declaration order at the path (`errors[0]`). It is INDEPENDENT of
 * `field.showErrors` / `shouldShowErrors`: the data is the data
 * regardless of whether the heuristic chooses to render it. Adopters
 * who use a different gate read `firstError` directly.
 *
 * For container paths, `firstError` is the first error in the
 * aggregated subtree (descendant errors sorted by `pathOrdinal`).
 *
 * Mirrored across both adapters (v3 + v4).
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

type FieldStateLike = {
  readonly errors: readonly ValidationError[]
  readonly firstError: ValidationError | undefined
  readonly showErrors: boolean
}

type FormLike = {
  fields: (path?: string | readonly (string | number)[]) => FieldStateLike
  setFieldErrors: (errors: readonly ValidationError[]) => void
  clearFieldErrors: (path?: string | readonly (string | number)[]) => void
  key: string
}

function asForm<F>(form: F): F & FormLike {
  return form as unknown as F & FormLike
}

function describeFirstError(label: string, makeForm: () => FormLike): void {
  describe(label, () => {
    it('firstError is undefined when no errors exist at the path', () => {
      const form = makeForm()
      expect(form.fields('email').errors.length).toBe(0)
      expect(form.fields('email').firstError).toBeUndefined()
    })

    it('firstError === errors[0] (referential equality)', () => {
      const form = makeForm()
      form.setFieldErrors([
        { path: ['email'], message: 'required', formKey: form.key, code: 'test' },
      ])
      const errs = form.fields('email').errors
      expect(errs.length).toBe(1)
      expect(form.fields('email').firstError).toBe(errs[0])
    })

    it('firstError is a ValidationError object (has .message, .path, .code)', () => {
      const form = makeForm()
      form.setFieldErrors([
        { path: ['email'], message: 'required', formKey: form.key, code: 'test' },
      ])
      const first = form.fields('email').firstError
      expect(first).toBeDefined()
      expect(typeof first?.message).toBe('string')
      expect(Array.isArray(first?.path)).toBe(true)
      expect(typeof first?.code).toBe('string')
    })

    it('container firstError aggregates over descendants in schema-declaration order', () => {
      const form = makeForm()
      // Inject in REVERSE schema order (users first, then email-equivalent
      // earlier path) — `firstError` should still surface schema-first.
      form.setFieldErrors([
        {
          path: ['users', 1, 'label'],
          message: 'late',
          formKey: form.key,
          code: 'test',
        },
        {
          path: ['users', 0, 'label'],
          message: 'early',
          formKey: form.key,
          code: 'test',
        },
      ])
      const container = form.fields('users')
      expect(container.errors.length).toBe(2)
      // schema-declaration order resolves users[0] before users[1]
      expect(container.firstError?.message).toBe('early')
    })

    it('firstError is reactive: clearing the underlying error flips it back to undefined', async () => {
      const form = makeForm()
      form.setFieldErrors([
        { path: ['email'], message: 'required', formKey: form.key, code: 'test' },
      ])
      await nextTick()
      expect(form.fields('email').firstError).toBeDefined()
      form.clearFieldErrors('email')
      await nextTick()
      expect(form.fields('email').errors.length).toBe(0)
      expect(form.fields('email').firstError).toBeUndefined()
    })

    it('firstError is independent of showErrors (default heuristic gate)', () => {
      const form = makeForm()
      form.setFieldErrors([
        { path: ['email'], message: 'required', formKey: form.key, code: 'test' },
      ])
      // Default heuristic: untouched + submitCount=0 → showErrors === false
      expect(form.fields('email').showErrors).toBe(false)
      // ...but firstError is still the data, regardless.
      expect(form.fields('email').firstError?.message).toBe('required')
    })
  })
}

// -----------------------------------------------------------------------------
// v3 adapter
// -----------------------------------------------------------------------------

const v3Schema = zV3.object({
  email: zV3.string().min(1),
  users: zV3.array(zV3.object({ label: zV3.string().min(1) })),
})
const v3Defaults = {
  email: '',
  users: [{ label: '' }, { label: '' }],
}

describeFirstError('field.firstError — zod-v3 adapter', () =>
  asForm(
    mountWithApp(() =>
      useFormV3({
        schema: v3Schema,
        key: `first-error-v3-${Math.random()}`,
        strict: false,
        defaultValues: v3Defaults,
      })
    )
  )
)

// -----------------------------------------------------------------------------
// v4 adapter
// -----------------------------------------------------------------------------

const v4Schema = zV4.object({
  email: zV4.string().min(1),
  users: zV4.array(zV4.object({ label: zV4.string().min(1) })),
})
const v4Defaults = {
  email: '',
  users: [{ label: '' }, { label: '' }],
}

describeFirstError('field.firstError — zod-v4 adapter', () =>
  asForm(
    mountWithApp(() =>
      useFormV4({
        schema: v4Schema,
        key: `first-error-v4-${Math.random()}`,
        strict: false,
        defaultValues: v4Defaults,
      })
    )
  )
)
