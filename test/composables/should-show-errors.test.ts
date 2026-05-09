// @vitest-environment jsdom
import { afterEach, describe, expect, expectTypeOf, it } from 'vitest'
import { computed, createApp, defineComponent, h, nextTick, type App } from 'vue'
import { z as zV4 } from 'zod'
import { z as zV3 } from 'zod-v3'
import { useForm as useFormV4 } from '../../src/zod-v4'
import { useForm as useFormV3 } from '../../src/zod-v3'
import { createAttaform } from '../../src/runtime/core/plugin'
import { defaultShouldShowErrors } from '../../src'
import type { FieldState, FormMeta, ShouldShowErrors, ValidationError } from '../../src'

/**
 * `field.showErrors` + `shouldShowErrors` predicate.
 *
 * `field.showErrors` is a derived boolean on `FieldState` that gates
 * error rendering through a centralised, configurable heuristic. The
 * heuristic — `shouldShowErrors(field, formMeta)` — resolves through
 * three tiers:
 *   1. Library default: `submitCount > 0 || (touched && dirty)`.
 *   2. `createAttaform({ defaults: { shouldShowErrors } })`.
 *   3. `useForm({ shouldShowErrors })` — wins over both above.
 *
 * Boolean shorthand: `true` → always show when errors exist; `false` →
 * never show. The predicate is invoked only when `errors.length > 0`,
 * so authors don't re-check inside the predicate body.
 *
 * The predicate's args (`field`, `formMeta`) are `Omit`'d of
 * `showErrors` / `firstError` at BOTH the type and runtime level —
 * recursion is impossible regardless of language (TS or JS).
 */

const apps: App[] = []
afterEach(() => {
  while (apps.length > 0) apps.pop()?.unmount()
  document.body.innerHTML = ''
})

function mountWithApp<T>(
  setup: () => T,
  pluginOptions: Parameters<typeof createAttaform>[0] = { override: true }
): T {
  const handle: { captured?: T } = {}
  const App = defineComponent({
    setup() {
      handle.captured = setup()
      return () => h('div')
    },
  })
  const app = createApp(App).use(createAttaform({ override: true, ...pluginOptions }))
  const root = document.createElement('div')
  document.body.appendChild(root)
  app.mount(root)
  apps.push(app)
  if (handle.captured === undefined) throw new Error('mountWithApp: setup never returned')
  return handle.captured
}

type FieldStateLike = {
  readonly errors: readonly ValidationError[]
  readonly showErrors: boolean
  readonly firstError: ValidationError | undefined
  readonly touched: boolean | null
  readonly dirty: boolean
}

type FormLike = {
  fields: (path?: string | readonly (string | number)[]) => FieldStateLike
  setFieldErrors: (errors: readonly ValidationError[]) => void
  setValue: (path: string, value: unknown) => boolean
  touch: (path?: string | readonly (string | number)[]) => void
  handleSubmit: (
    onSubmit: (data: unknown) => void | Promise<void>,
    onError?: (errors: readonly ValidationError[]) => void
  ) => () => Promise<void>
  meta: { submitCount: number; submitting: boolean; showErrors: boolean }
  key: string
}

function asForm<F>(form: F): F & FormLike {
  return form as unknown as F & FormLike
}

// -----------------------------------------------------------------------------
// Shared schema-shaped tests, parameterised by adapter
// -----------------------------------------------------------------------------

type AdapterFactory = (pluginOptions?: Parameters<typeof createAttaform>[0]) => FormLike

function describeAdapter(label: string, makeForm: AdapterFactory): void {
  describe(label, () => {
    function injectError(form: FormLike, path: readonly (string | number)[], message: string) {
      form.setFieldErrors([{ path: [...path], message, formKey: form.key, code: 'test' }])
    }

    describe('default heuristic — leaf', () => {
      it('errors present, untouched, submitCount=0 → showErrors === false', () => {
        const form = makeForm()
        injectError(form, ['email'], 'email required')
        expect(form.fields('email').errors.length).toBe(1)
        expect(form.fields('email').showErrors).toBe(false)
      })

      it('errors present, touched but not dirty → showErrors === false', async () => {
        const form = makeForm()
        injectError(form, ['email'], 'email required')
        form.touch('email')
        await nextTick()
        expect(form.fields('email').touched).toBe(true)
        expect(form.fields('email').dirty).toBe(false)
        expect(form.fields('email').showErrors).toBe(false)
      })

      it('errors present, touched and dirty → showErrors === true', async () => {
        const form = makeForm()
        injectError(form, ['email'], 'email required')
        form.touch('email')
        form.setValue('email', 'x')
        await nextTick()
        expect(form.fields('email').dirty).toBe(true)
        expect(form.fields('email').showErrors).toBe(true)
      })

      it('errors present, untouched, submitCount=1 → showErrors === true', async () => {
        const form = makeForm()
        injectError(form, ['email'], 'email required')
        await form.handleSubmit(() => {})()
        await nextTick()
        expect(form.meta.submitCount).toBeGreaterThan(0)
        expect(form.fields('email').showErrors).toBe(true)
      })

      it('no errors, submitCount=10, touched and dirty → showErrors === false (errors-empty gate)', async () => {
        const form = makeForm()
        form.touch('email')
        form.setValue('email', 'x')
        for (let i = 0; i < 10; i++) {
          await form.handleSubmit(() => {})()
        }
        await nextTick()
        expect(form.fields('email').errors.length).toBe(0)
        expect(form.meta.submitCount).toBe(10)
        expect(form.fields('email').showErrors).toBe(false)
      })
    })

    describe('default heuristic — container', () => {
      it('row-level container picks up descendant touched + dirty + errors', async () => {
        const form = makeForm()
        injectError(form, ['users', 0, 'label'], 'label required')
        form.touch(['users', 0, 'label'])
        form.setValue('users.0.label', 'x')
        await nextTick()
        const row = form.fields('users.0')
        expect(row.errors.length).toBeGreaterThan(0)
        expect(row.showErrors).toBe(true)
      })

      it('container shows nothing when descendants have errors but heuristic conditions unmet', async () => {
        const form = makeForm()
        injectError(form, ['users', 0, 'label'], 'label required')
        await nextTick()
        const row = form.fields('users.0')
        expect(row.errors.length).toBeGreaterThan(0)
        expect(row.showErrors).toBe(false)
      })
    })

    describe('reactivity', () => {
      it('a computed wrapping field.showErrors updates after submit', async () => {
        const form = makeForm()
        injectError(form, ['email'], 'email required')
        const probe = computed(() => form.fields('email').showErrors)
        expect(probe.value).toBe(false)
        await form.handleSubmit(() => {})()
        await nextTick()
        expect(probe.value).toBe(true)
      })

      it('clearing errors flips showErrors back to false', async () => {
        const form = makeForm()
        injectError(form, ['email'], 'email required')
        // touched + dirty + valid value (so no schema error replaces the
        // injected one when validateOn:'change' fires on setValue).
        form.touch('email')
        form.setValue('email', 'x')
        await nextTick()
        expect(form.fields('email').showErrors).toBe(true)
        form.setFieldErrors([])
        await nextTick()
        expect(form.fields('email').errors.length).toBe(0)
        expect(form.fields('email').showErrors).toBe(false)
      })
    })

    describe('form.meta.showErrors', () => {
      it('aggregates over the whole form via the same heuristic', async () => {
        const form = makeForm()
        injectError(form, ['email'], 'email required')
        expect(form.meta.showErrors).toBe(false)
        await form.handleSubmit(() => {})()
        await nextTick()
        expect(form.meta.showErrors).toBe(true)
      })
    })
  })
}

function describeOverrideTier(
  label: string,
  makeForm: (
    pluginDefault: ShouldShowErrors | boolean | undefined,
    perFormConfig: ShouldShowErrors | boolean | undefined
  ) => FormLike
): void {
  describe(label, () => {
    function inject(form: FormLike) {
      form.setFieldErrors([
        { path: ['email'], message: 'required', formKey: form.key, code: 'test' },
      ])
    }

    it('plugin-level override: custom predicate ignores submitCount', async () => {
      const form = makeForm((field) => field.touched === true, undefined)
      inject(form)
      await form.handleSubmit(() => {})()
      await nextTick()
      expect(form.meta.submitCount).toBeGreaterThan(0)
      // touched is still null (no DOM blur, no programmatic touch)
      expect(form.fields('email').showErrors).toBe(false)
      form.touch('email')
      await nextTick()
      expect(form.fields('email').showErrors).toBe(true)
    })

    it('plugin-level override: boolean true → always show when errors exist', async () => {
      const form = makeForm(true, undefined)
      inject(form)
      await nextTick()
      expect(form.fields('email').showErrors).toBe(true)
    })

    it('plugin-level override: boolean false → never show even after submit', async () => {
      const form = makeForm(false, undefined)
      inject(form)
      await form.handleSubmit(() => {})()
      await nextTick()
      expect(form.fields('email').showErrors).toBe(false)
    })

    it('per-form useForm override beats plugin-level', async () => {
      // Plugin says ALWAYS show; per-form overrides to NEVER show.
      const form = makeForm(true, false)
      inject(form)
      await form.handleSubmit(() => {})()
      await nextTick()
      expect(form.fields('email').showErrors).toBe(false)
    })

    it('per-form useForm override beats plugin-level (function)', async () => {
      // Plugin says always; per-form gates on touched only.
      const form = makeForm(true, (field) => field.touched === true)
      inject(form)
      await form.handleSubmit(() => {})()
      await nextTick()
      expect(form.fields('email').showErrors).toBe(false)
      form.touch('email')
      await nextTick()
      expect(form.fields('email').showErrors).toBe(true)
    })
  })
}

// -----------------------------------------------------------------------------
// v3 adapter
// -----------------------------------------------------------------------------

const v3Schema = zV3.object({
  email: zV3.string().min(1),
  profile: zV3.object({ name: zV3.string().min(1) }),
  users: zV3.array(zV3.object({ label: zV3.string().min(1) })),
})
const v3Defaults = {
  email: '',
  profile: { name: '' },
  users: [{ label: '' }],
}

describeAdapter('shouldShowErrors — zod-v3 adapter', () =>
  asForm(
    mountWithApp(() =>
      useFormV3({
        schema: v3Schema,
        key: `should-show-errors-v3-${Math.random()}`,
        strict: false,
        defaultValues: v3Defaults,
      })
    )
  )
)

describeOverrideTier('shouldShowErrors override resolution — zod-v3', (pluginDefault, perForm) =>
  asForm(
    mountWithApp(
      () =>
        useFormV3({
          schema: v3Schema,
          key: `should-show-errors-override-v3-${Math.random()}`,
          strict: false,
          defaultValues: v3Defaults,
          ...(perForm === undefined
            ? {}
            : ({ shouldShowErrors: perForm } as { shouldShowErrors: typeof perForm })),
        }),
      pluginDefault === undefined
        ? { override: true }
        : { override: true, defaults: { shouldShowErrors: pluginDefault } as never }
    )
  )
)

// -----------------------------------------------------------------------------
// v4 adapter
// -----------------------------------------------------------------------------

const v4Schema = zV4.object({
  email: zV4.string().min(1),
  profile: zV4.object({ name: zV4.string().min(1) }),
  users: zV4.array(zV4.object({ label: zV4.string().min(1) })),
})
const v4Defaults = {
  email: '',
  profile: { name: '' },
  users: [{ label: '' }],
}

describeAdapter('shouldShowErrors — zod-v4 adapter', () =>
  asForm(
    mountWithApp(() =>
      useFormV4({
        schema: v4Schema,
        key: `should-show-errors-v4-${Math.random()}`,
        strict: false,
        defaultValues: v4Defaults,
      })
    )
  )
)

describeOverrideTier('shouldShowErrors override resolution — zod-v4', (pluginDefault, perForm) =>
  asForm(
    mountWithApp(
      () =>
        useFormV4({
          schema: v4Schema,
          key: `should-show-errors-override-v4-${Math.random()}`,
          strict: false,
          defaultValues: v4Defaults,
          ...(perForm === undefined
            ? {}
            : ({ shouldShowErrors: perForm } as { shouldShowErrors: typeof perForm })),
        }),
      pluginDefault === undefined
        ? { override: true }
        : { override: true, defaults: { shouldShowErrors: pluginDefault } as never }
    )
  )
)

// -----------------------------------------------------------------------------
// Cross-cutting: omit'd args, public default heuristic, runtime safety
// -----------------------------------------------------------------------------

describe('shouldShowErrors — cross-cutting', () => {
  it('predicate runtime args literally omit showErrors / firstError', async () => {
    const probe = {
      fieldHasShowErrors: undefined as boolean | undefined,
      fieldHasFirstError: undefined as boolean | undefined,
      formMetaHasShowErrors: undefined as boolean | undefined,
      formMetaHasFirstError: undefined as boolean | undefined,
    }
    const form = asForm(
      mountWithApp(() =>
        useFormV4({
          schema: v4Schema,
          key: `omit-runtime-${Math.random()}`,
          strict: false,
          defaultValues: v4Defaults,
          // Cast: until Phase 2 adds the option type, the test asserts runtime
          // shape directly via the configured predicate.
          shouldShowErrors: ((field, formMeta) => {
            probe.fieldHasShowErrors = 'showErrors' in (field as object)
            probe.fieldHasFirstError = 'firstError' in (field as object)
            probe.formMetaHasShowErrors = 'showErrors' in (formMeta as object)
            probe.formMetaHasFirstError = 'firstError' in (formMeta as object)
            return true
          }) satisfies ShouldShowErrors,
        } as never)
      )
    )
    form.setFieldErrors([{ path: ['email'], message: 'required', formKey: form.key, code: 'test' }])
    // Trigger evaluation
    void form.fields('email').showErrors
    await nextTick()

    expect(probe.fieldHasShowErrors).toBe(false)
    expect(probe.fieldHasFirstError).toBe(false)
    expect(probe.formMetaHasShowErrors).toBe(false)
    expect(probe.formMetaHasFirstError).toBe(false)
  })

  it('defaultShouldShowErrors is publicly exported and arity-2', () => {
    expect(typeof defaultShouldShowErrors).toBe('function')
    expect(defaultShouldShowErrors.length).toBe(2)
  })

  it('defaultShouldShowErrors composes inside a layered predicate', async () => {
    const layered: ShouldShowErrors = (field, formMeta) =>
      field.path[0] === 'urgent' || defaultShouldShowErrors(field, formMeta)

    const form = asForm(
      mountWithApp(() =>
        useFormV4({
          schema: v4Schema,
          key: `composed-${Math.random()}`,
          strict: false,
          defaultValues: v4Defaults,
          shouldShowErrors: layered,
        } as never)
      )
    )
    form.setFieldErrors([{ path: ['email'], message: 'required', formKey: form.key, code: 'test' }])
    // Special case path[0] === 'urgent' is false for 'email' — falls through
    // to the default heuristic, which is false at this state (untouched, submitCount=0).
    await nextTick()
    expect(form.fields('email').showErrors).toBe(false)
    // Trigger the default branch's true case.
    await form.handleSubmit(() => {})()
    await nextTick()
    expect(form.fields('email').showErrors).toBe(true)
  })

  it('defaultShouldShowErrors result tracks the documented heuristic on synthetic inputs', () => {
    const baseField = {
      errors: [{ path: ['x'], message: 'm', formKey: 'k', code: 'c' }],
      touched: false,
      dirty: false,
      path: ['x'],
    } as unknown as Omit<FieldState, 'showErrors' | 'firstError'>
    const baseMeta = {
      submitCount: 0,
    } as unknown as Omit<FormMeta, 'showErrors' | 'firstError'>

    expect(defaultShouldShowErrors(baseField, baseMeta)).toBe(false)
    expect(defaultShouldShowErrors({ ...baseField, touched: true, dirty: true }, baseMeta)).toBe(
      true
    )
    expect(
      defaultShouldShowErrors(baseField, { ...baseMeta, submitCount: 1 } as typeof baseMeta)
    ).toBe(true)
    expect(defaultShouldShowErrors({ ...baseField, touched: true, dirty: false }, baseMeta)).toBe(
      false
    )
  })
})

describe('shouldShowErrors — type-level guards', () => {
  it('predicate signature omits showErrors / firstError on field and formMeta args', () => {
    type Field = Parameters<ShouldShowErrors>[0]
    type Meta = Parameters<ShouldShowErrors>[1]

    expectTypeOf<keyof Field>().not.toEqualTypeOf<'showErrors' | 'firstError'>()
    // @ts-expect-error — `showErrors` is omitted from the predicate's field arg
    expectTypeOf<Field['showErrors']>()
    // @ts-expect-error — `firstError` is omitted from the predicate's field arg
    expectTypeOf<Field['firstError']>()
    // @ts-expect-error — `showErrors` is omitted from the predicate's formMeta arg
    expectTypeOf<Meta['showErrors']>()
    // @ts-expect-error — `firstError` is omitted from the predicate's formMeta arg
    expectTypeOf<Meta['firstError']>()

    // Every other FieldState key still reaches through, so authors keep
    // full IDE access to touched / dirty / errors / path / etc.
    expectTypeOf<Field['touched']>().toEqualTypeOf<boolean | null>()
    expectTypeOf<Field['dirty']>().toEqualTypeOf<boolean>()
    expectTypeOf<Meta['submitCount']>().toEqualTypeOf<number>()
  })
})
