import { describe, expect, it, vi } from 'vitest'
import { nextTick, type Ref } from 'vue'
import { createFormStore } from '../../src/runtime/core/create-form-store'
import { SubmitErrorHandlerError } from '../../src/runtime/core/errors'
import type { Path } from '../../src/runtime/core/paths'
import { buildProcessForm } from '../../src/runtime/core/process-form'
import type {
  ReactiveValidationStatus,
  ValidationResponse,
} from '../../src/runtime/types/types-api'
import { fakeSchema } from '../utils/fake-schema'

/**
 * Drain the microtask queue + a Vue tick until the reactive validate()
 * ref has settled (pending === false). The async parse is one microtask
 * away; a generous loop cap guards against contract regressions that
 * would otherwise hang the test.
 */
async function waitUntilSettled<F>(r: Ref<ReactiveValidationStatus<F>>): Promise<void> {
  for (let i = 0; i < 16; i++) {
    if (!r.value.pending) return
    await Promise.resolve()
    await nextTick()
  }
  throw new Error('validate() ref did not settle within 16 microtasks')
}

type Signup = { email: string; password: string }

describe('buildProcessForm', () => {
  function alwaysValid() {
    return createFormStore<Signup>({
      formKey: 'pf',
      schema: fakeSchema<Signup>({ email: 'a@b', password: 'secret1!' }),
    })
  }

  function alwaysInvalid() {
    const validator = (_data: unknown, _path: Path | undefined): ValidationResponse<Signup> => ({
      data: undefined,
      errors: [
        { message: 'Enter a valid email', path: ['email'], formKey: 'pf', code: 'cx:test-fixture' },
      ],
      success: false,
      formKey: 'pf',
    })
    return createFormStore<Signup>({
      formKey: 'pf',
      schema: fakeSchema<Signup>({ email: '', password: '' }, validator),
    })
  }

  describe('validate (as a reactive Ref)', () => {
    it('starts pending and settles to success when schema passes', async () => {
      const state = alwaysValid()
      const { validate } = buildProcessForm(state, 'test:inst')
      const r = validate()
      // Initial synchronous read — the async parse hasn't settled yet.
      expect(r.value.pending).toBe(true)
      // Await the microtask pump so the Promise returned by the fake
      // schema resolves and the watchEffect writes the settled status.
      await waitUntilSettled(r)
      expect(r.value.pending).toBe(false)
      if (r.value.pending) throw new Error('unreachable — narrowed above')
      expect(r.value.success).toBe(true)
      expect(r.value.errors).toBeUndefined()
    })

    it('settles to failure with errors when schema rejects', async () => {
      const state = alwaysInvalid()
      const { validate } = buildProcessForm(state, 'test:inst')
      const r = validate()
      await waitUntilSettled(r)
      expect(r.value.pending).toBe(false)
      if (r.value.pending) throw new Error('unreachable')
      expect(r.value.success).toBe(false)
      expect(r.value.errors).toEqual([
        { message: 'Enter a valid email', path: ['email'], formKey: 'pf', code: 'cx:test-fixture' },
      ])
    })

    it('isValidating flips true during a run and back to false on settle', async () => {
      const state = alwaysValid()
      const { validate } = buildProcessForm(state, 'test:inst')
      expect(state.activeValidations.value).toBe(0)
      const r = validate()
      // The watchEffect defers the counter bump to a microtask (so the
      // write doesn't re-trigger the effect). Drain one microtask,
      // then the counter must be exactly 1 while the parse is in flight —
      // this test fires a single validate(), so any other value would
      // mean a leak or an extra concurrent validation.
      await Promise.resolve()
      expect(state.activeValidations.value).toBe(1)
      await waitUntilSettled(r)
      expect(state.activeValidations.value).toBe(0)
    })
  })

  describe('validateAsync', () => {
    it('resolves to a settled response for the full form', async () => {
      const state = alwaysValid()
      const { validateAsync } = buildProcessForm(state, 'test:inst')
      const response = await validateAsync()
      expect(response.success).toBe(true)
      expect(response.errors).toBeUndefined()
    })

    it('resolves to a failure response when the schema rejects', async () => {
      const state = alwaysInvalid()
      const { validateAsync } = buildProcessForm(state, 'test:inst')
      const response = await validateAsync()
      expect(response.success).toBe(false)
      expect(response.errors).toEqual([
        { message: 'Enter a valid email', path: ['email'], formKey: 'pf', code: 'cx:test-fixture' },
      ])
    })

    it('decrements activeValidations back to 0 on completion', async () => {
      const state = alwaysValid()
      const { validateAsync } = buildProcessForm(state, 'test:inst')
      // validateAsync runs synchronously to the first await — its
      // counter bump happens before the returned promise resolves.
      const pending = validateAsync()
      expect(state.activeValidations.value).toBe(1)
      await pending
      expect(state.activeValidations.value).toBe(0)
    })
  })

  describe('handleSubmit', () => {
    it('returns a function (not a Promise) — consumers bind it to @submit', () => {
      const state = alwaysValid()
      const { handleSubmit } = buildProcessForm(state, 'test:inst')
      const fn = handleSubmit(async () => {})
      expect(typeof fn).toBe('function')
    })

    it('calls onSubmit with data when validation succeeds', async () => {
      const state = alwaysValid()
      const { handleSubmit } = buildProcessForm(state, 'test:inst')
      const onSubmit = vi.fn()
      await handleSubmit(onSubmit)()
      expect(onSubmit).toHaveBeenCalledOnce()
      expect(onSubmit).toHaveBeenCalledWith({ email: 'a@b', password: 'secret1!' })
    })

    it('clears errors on successful submit', async () => {
      const state = alwaysValid()
      const { handleSubmit } = buildProcessForm(state, 'test:inst')
      state.setSchemaErrorsForPath(
        ['email'],
        [{ message: 'stale', path: ['email'], formKey: 'pf', code: 'cx:test-fixture' }]
      )

      await handleSubmit(async () => {})()
      expect(state.getErrorsForPath(['email'])).toEqual([])
    })

    it('populates state errors and calls onError when validation fails', async () => {
      const state = alwaysInvalid()
      const { handleSubmit } = buildProcessForm(state, 'test:inst')
      const onSubmit = vi.fn()
      const onError = vi.fn()
      await handleSubmit(onSubmit, onError)()
      expect(onSubmit).not.toHaveBeenCalled()
      expect(onError).toHaveBeenCalledOnce()
      expect(state.getErrorsForPath(['email'])).toHaveLength(1)
    })

    it('propagates a thrown onError as SubmitErrorHandlerError', async () => {
      // Pre-rewrite swallowed this into console.error. Fixed.
      const state = alwaysInvalid()
      const { handleSubmit } = buildProcessForm(state, 'test:inst')
      const handler = handleSubmit(
        async () => {},
        // eslint-disable-next-line @typescript-eslint/require-await
        async () => {
          throw new Error('user handler crash')
        }
      )
      await expect(handler()).rejects.toBeInstanceOf(SubmitErrorHandlerError)
    })

    it('calls preventDefault on a submitted Event', async () => {
      const state = alwaysValid()
      const { handleSubmit } = buildProcessForm(state, 'test:inst')
      const preventDefault = vi.fn()
      const event = { preventDefault } as unknown as Event

      await handleSubmit(async () => {})(event)
      expect(preventDefault).toHaveBeenCalledOnce()
    })
  })

  describe('handleSubmit — submission lifecycle refs', () => {
    it('flips isSubmitting true for the duration of the handler, false after', async () => {
      const state = alwaysValid()
      const { handleSubmit } = buildProcessForm(state, 'test:inst')
      expect(state.isSubmitting.value).toBe(false)

      let observedMidFlight: boolean | undefined
      const onSubmit = async () => {
        observedMidFlight = state.isSubmitting.value
        await Promise.resolve()
      }
      await handleSubmit(onSubmit)()
      expect(observedMidFlight).toBe(true)
      expect(state.isSubmitting.value).toBe(false)
    })

    it('increments submitCount on success', async () => {
      const state = alwaysValid()
      const { handleSubmit } = buildProcessForm(state, 'test:inst')
      expect(state.submitCount.value).toBe(0)
      await handleSubmit(async () => {})()
      expect(state.submitCount.value).toBe(1)
      await handleSubmit(async () => {})()
      expect(state.submitCount.value).toBe(2)
    })

    it('increments submitCount on validation failure', async () => {
      const state = alwaysInvalid()
      const { handleSubmit } = buildProcessForm(state, 'test:inst')
      await handleSubmit(async () => {})()
      expect(state.submitCount.value).toBe(1)
    })

    it('increments submitCount on user-callback throw', async () => {
      const state = alwaysValid()
      const { handleSubmit } = buildProcessForm(state, 'test:inst')
      const handler = handleSubmit(
        // eslint-disable-next-line @typescript-eslint/require-await
        async () => {
          throw new Error('boom')
        }
      )
      await expect(handler()).rejects.toThrow('boom')
      expect(state.submitCount.value).toBe(1)
    })

    it('captures a thrown onSubmit into submitError (and still re-throws)', async () => {
      const state = alwaysValid()
      const { handleSubmit } = buildProcessForm(state, 'test:inst')
      const err = new Error('callback crash')
      const handler = handleSubmit(
        // eslint-disable-next-line @typescript-eslint/require-await
        async () => {
          throw err
        }
      )
      await expect(handler()).rejects.toBe(err)
      expect(state.submitError.value).toBe(err)
      expect(state.isSubmitting.value).toBe(false)
    })

    it('clears submitError at the start of a fresh submission', async () => {
      const state = alwaysValid()
      const { handleSubmit } = buildProcessForm(state, 'test:inst')
      // First run: user callback throws.
      const failing = handleSubmit(
        // eslint-disable-next-line @typescript-eslint/require-await
        async () => {
          throw new Error('first')
        }
      )
      await expect(failing()).rejects.toThrow('first')
      expect(state.submitError.value).toBeInstanceOf(Error)

      // Second run: callback succeeds — prior error must be cleared.
      await handleSubmit(async () => {})()
      expect(state.submitError.value).toBeNull()
    })

    it('captures SubmitErrorHandlerError when the user onError throws', async () => {
      const state = alwaysInvalid()
      const { handleSubmit } = buildProcessForm(state, 'test:inst')
      const handler = handleSubmit(
        async () => {},
        // eslint-disable-next-line @typescript-eslint/require-await
        async () => {
          throw new Error('onError crash')
        }
      )
      await expect(handler()).rejects.toBeInstanceOf(SubmitErrorHandlerError)
      expect(state.submitError.value).toBeInstanceOf(SubmitErrorHandlerError)
    })

    it('leaves submitError null on successful submit', async () => {
      const state = alwaysValid()
      const { handleSubmit } = buildProcessForm(state, 'test:inst')
      await handleSubmit(async () => {})()
      expect(state.submitError.value).toBeNull()
    })

    it('keeps isSubmitting true across overlapping submissions until all complete', async () => {
      // Regression: previously each handler invocation set isSubmitting
      // = false on its own completion, so the FIRST resolution prematurely
      // flipped the flag while a later submission was still in flight.
      // The fix maintains an in-flight counter on FormStore; isSubmitting
      // is true iff the counter is > 0.
      const state = alwaysValid()
      const { handleSubmit } = buildProcessForm(state, 'test:inst')

      let resolveFirst!: () => void
      let resolveSecond!: () => void
      const firstStarted = new Promise<void>((resolve) => {
        const blocker = new Promise<void>((r) => (resolveFirst = r))
        void handleSubmit(async () => {
          resolve()
          await blocker
        })()
      })
      const secondStarted = new Promise<void>((resolve) => {
        const blocker = new Promise<void>((r) => (resolveSecond = r))
        void handleSubmit(async () => {
          resolve()
          await blocker
        })()
      })

      await Promise.all([firstStarted, secondStarted])
      expect(state.isSubmitting.value).toBe(true)
      expect(state.activeSubmissions.value).toBe(2)

      // Resolve the first submission — counter drops to 1, flag stays true.
      resolveFirst()
      await Promise.resolve() // microtask drain so the finally block runs
      await Promise.resolve()
      expect(state.isSubmitting.value).toBe(true)
      expect(state.activeSubmissions.value).toBe(1)

      // Resolve the second — counter drops to 0, flag flips false.
      resolveSecond()
      await Promise.resolve()
      await Promise.resolve()
      expect(state.isSubmitting.value).toBe(false)
      expect(state.activeSubmissions.value).toBe(0)
      expect(state.submitCount.value).toBe(2)
    })
  })

  describe('handleSubmit — reset() during in-flight submission', () => {
    it('reset() keeps isSubmitting false through the in-flight completion', async () => {
      // Regression: previously `reset()` zeroed `activeSubmissions` and
      // the in-flight submission's finally-block then decremented into
      // a negative value (clamped to 0 by Math.max but still a messy
      // state). With the clamp in place, isSubmitting stays false —
      // this test pins that guarantee.
      const state = alwaysValid()
      const { handleSubmit } = buildProcessForm(state, 'test:inst')

      let resolveSubmit!: () => void
      const started = new Promise<void>((resolve) => {
        const blocker = new Promise<void>((r) => (resolveSubmit = r))
        void handleSubmit(async () => {
          resolve()
          await blocker
        })()
      })
      await started
      expect(state.isSubmitting.value).toBe(true)

      state.reset()
      expect(state.isSubmitting.value).toBe(false)
      expect(state.activeSubmissions.value).toBe(0)
      expect(state.submitCount.value).toBe(0)

      resolveSubmit()
      await Promise.resolve()
      await Promise.resolve()

      // In-flight finally ran, but all visible lifecycle counters stay
      // at their post-reset values — the completion belongs to the
      // prior generation, so isSubmitting, submitCount, and submitError
      // remain the "fresh form" state the consumer asked for.
      expect(state.isSubmitting.value).toBe(false)
      expect(state.activeSubmissions.value).toBe(0)
      expect(state.submitCount.value).toBe(0)
      expect(state.submitError.value).toBeNull()
    })

    it('reset() keeps submitError null even if the in-flight submission later throws', async () => {
      // Without the generation guard, the catch block re-populates
      // submitError with the thrown value after reset cleared it —
      // visually "unfocusing" the reset the consumer just triggered.
      const state = alwaysValid()
      const { handleSubmit } = buildProcessForm(state, 'test:inst')
      const err = new Error('post-reset crash')

      let rejectSubmit!: (e: unknown) => void
      const started = new Promise<void>((resolve) => {
        const blocker = new Promise<void>((_res, rej) => (rejectSubmit = rej))
        void handleSubmit(async () => {
          resolve()
          await blocker
        })().catch(() => {
          /* ignore — the test inspects state, not the rejected promise */
        })
      })
      await started
      expect(state.submitError.value).toBeNull()

      state.reset()
      rejectSubmit(err)
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()

      // Post-reset state is stable: no stale error, not submitting.
      expect(state.submitError.value).toBeNull()
      expect(state.isSubmitting.value).toBe(false)
      expect(state.submissionGeneration.value).toBe(1)
    })

    it('submissions started AFTER reset still capture their own errors normally', async () => {
      // Regression guard for the generation check: post-reset, new
      // submissions should behave exactly as before.
      const state = alwaysValid()
      const { handleSubmit } = buildProcessForm(state, 'test:inst')
      state.reset()

      const err = new Error('fresh')
      const handler = handleSubmit(
        // eslint-disable-next-line @typescript-eslint/require-await
        async () => {
          throw err
        }
      )
      await expect(handler()).rejects.toBe(err)
      expect(state.submitError.value).toBe(err)
      expect(state.submitCount.value).toBe(1)
    })

    // C2 — generation guard on schema-error writes during validation.
    // Pre-fix, the validation completion AFTER reset wrote the stale
    // schema errors back, undoing the consumer's "fresh start" intent.
    it('reset() during async validation drops the late schemaErrors write', async () => {
      // Build a schema whose validate is controllable from outside.
      let releaseValidate!: (resp: ValidationResponse<Signup>) => void
      const validatePromise = new Promise<ValidationResponse<Signup>>((resolve) => {
        releaseValidate = resolve
      })
      const schema = fakeSchema<Signup>({ email: '', password: '' }, async () => validatePromise)
      const state = createFormStore<Signup>({ formKey: 'pf', schema })
      const { handleSubmit } = buildProcessForm(state, 'test:inst')

      // Start a submit; awaits validation.
      const submitPromise = handleSubmit(async () => {})()
      await Promise.resolve()
      // Reset while validation is in-flight — bumps generation.
      state.reset()
      expect(state.submissionGeneration.value).toBe(1)

      // Validation finishes with a failure that — pre-fix — would
      // overwrite reset's empty schemaErrors.
      releaseValidate({
        data: undefined,
        errors: [{ message: 'Invalid', path: ['email'], formKey: 'pf', code: 'cx:test-fixture' }],
        success: false,
        formKey: 'pf',
      })
      await submitPromise.catch(() => undefined)

      // Reset's empty error store wins — no stale write.
      expect(state.schemaErrors.size).toBe(0)
    })

    it('submit-success after reset() does NOT clear schemaErrors set by post-reset writers', async () => {
      // Symmetry case: a successful submit's `clearSchemaErrors()` would
      // wipe entries that a post-reset code path (e.g. user
      // `setFieldErrors` between reset and submit-resolution) had
      // legitimately written. Same generation guard prevents that.
      let releaseValidate!: (resp: ValidationResponse<Signup>) => void
      const validatePromise = new Promise<ValidationResponse<Signup>>((resolve) => {
        releaseValidate = resolve
      })
      const schema = fakeSchema<Signup>({ email: '', password: '' }, async () => validatePromise)
      const state = createFormStore<Signup>({ formKey: 'pf', schema })
      const { handleSubmit } = buildProcessForm(state, 'test:inst')

      const submitPromise = handleSubmit(async () => {})()
      await Promise.resolve()
      state.reset()
      // Consumer writes a fresh schema error after reset.
      state.setAllSchemaErrors([
        { message: 'Server-rejected', path: ['email'], formKey: 'pf', code: 'api:validation' },
      ])
      // Validation now resolves SUCCESS; pre-fix the success path would
      // call clearSchemaErrors and erase the entry above.
      const successData: Signup = { email: '', password: '' }
      releaseValidate({
        data: successData,
        errors: undefined,
        success: true,
        formKey: 'pf',
      })
      await submitPromise.catch(() => undefined)

      expect(state.schemaErrors.size).toBe(1)
    })
  })

  // The `setFieldErrorsFromApi` factory was retired in 0.12 in favour of
  // the pure `parseApiErrors` helper. Pure-parser behaviour is covered by
  // `test/core/parse-api-errors.test.ts`; the consumer-side write
  // (`form.setFieldErrors(parseApiErrors(payload).errors)`) is integration
  // territory tested in `test/composables/use-abstract-form.test.ts` and
  // the field-errors-view tests.

  // C3 — sharpened dev-warn when validate() is called outside an
  // effect scope. The watcher leaks (intentional behaviour), but the
  // first warn per FormStore tells the consumer about the leak so
  // they can wrap in effectScope().
  describe('validate() — outside-scope dev warning', () => {
    it('warns once per FormStore, not on every call', () => {
      const state = alwaysValid()
      const { validate } = buildProcessForm(state, 'test:inst')
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      try {
        validate()
        validate()
        validate()
        const matched = warnSpy.mock.calls.filter((c: unknown[]) =>
          String(c[0]).includes('outside a Vue effect scope')
        )
        expect(matched.length).toBe(1)
      } finally {
        warnSpy.mockRestore()
      }
    })

    it('does NOT warn when called inside an effect scope', async () => {
      const { effectScope } = await import('vue')
      const state = alwaysValid()
      const { validate } = buildProcessForm(state, 'test:inst')
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      try {
        const scope = effectScope()
        scope.run(() => validate())
        const matched = warnSpy.mock.calls.filter((c: unknown[]) =>
          String(c[0]).includes('outside a Vue effect scope')
        )
        expect(matched.length).toBe(0)
        scope.stop()
      } finally {
        warnSpy.mockRestore()
      }
    })
  })
})
