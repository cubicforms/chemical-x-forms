import { describe, expect, it, vi } from 'vitest'
import { createFormState } from '../../src/runtime/core/create-form-state'
import { SubmitErrorHandlerError } from '../../src/runtime/core/errors'
import { buildProcessForm } from '../../src/runtime/core/process-form'
import type { ValidationResponse } from '../../src/runtime/types/types-api'
import { fakeSchema } from '../utils/fake-schema'

type Signup = { email: string; password: string }

describe('buildProcessForm', () => {
  function alwaysValid() {
    return createFormState<Signup>({
      formKey: 'pf',
      schema: fakeSchema<Signup>({ email: 'a@b', password: 'secret1!' }),
    })
  }

  function alwaysInvalid() {
    const validator = (_data: unknown, _path: string | undefined): ValidationResponse<Signup> => ({
      data: undefined,
      errors: [{ message: 'Enter a valid email', path: ['email'], formKey: 'pf' }],
      success: false,
      formKey: 'pf',
    })
    return createFormState<Signup>({
      formKey: 'pf',
      schema: fakeSchema<Signup>({ email: '', password: '' }, validator),
    })
  }

  describe('validate (as a Ref)', () => {
    it('reflects success when schema passes', () => {
      const state = alwaysValid()
      const { validate } = buildProcessForm(state)
      const r = validate()
      expect(r.value.success).toBe(true)
      expect(r.value.errors).toBeUndefined()
    })

    it('reflects failure with errors when schema rejects', () => {
      const state = alwaysInvalid()
      const { validate } = buildProcessForm(state)
      const r = validate()
      expect(r.value.success).toBe(false)
      expect(r.value.errors).toEqual([
        { message: 'Enter a valid email', path: ['email'], formKey: 'pf' },
      ])
    })
  })

  describe('handleSubmit', () => {
    it('returns a function (not a Promise) — consumers bind it to @submit', () => {
      const state = alwaysValid()
      const { handleSubmit } = buildProcessForm(state)
      const fn = handleSubmit(async () => {})
      expect(typeof fn).toBe('function')
    })

    it('calls onSubmit with data when validation succeeds', async () => {
      const state = alwaysValid()
      const { handleSubmit } = buildProcessForm(state)
      const onSubmit = vi.fn()
      await handleSubmit(onSubmit)()
      expect(onSubmit).toHaveBeenCalledOnce()
      expect(onSubmit).toHaveBeenCalledWith({ email: 'a@b', password: 'secret1!' })
    })

    it('clears errors on successful submit', async () => {
      const state = alwaysValid()
      const { handleSubmit } = buildProcessForm(state)
      state.setErrorsForPath(['email'], [{ message: 'stale', path: ['email'], formKey: 'pf' }])

      await handleSubmit(async () => {})()
      expect(state.getErrorsForPath(['email'])).toEqual([])
    })

    it('populates state errors and calls onError when validation fails', async () => {
      const state = alwaysInvalid()
      const { handleSubmit } = buildProcessForm(state)
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
      const { handleSubmit } = buildProcessForm(state)
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
      const { handleSubmit } = buildProcessForm(state)
      const preventDefault = vi.fn()
      const event = { preventDefault } as unknown as Event

      await handleSubmit(async () => {})(event)
      expect(preventDefault).toHaveBeenCalledOnce()
    })
  })

  describe('handleSubmit — submission lifecycle refs', () => {
    it('flips isSubmitting true for the duration of the handler, false after', async () => {
      const state = alwaysValid()
      const { handleSubmit } = buildProcessForm(state)
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
      const { handleSubmit } = buildProcessForm(state)
      expect(state.submitCount.value).toBe(0)
      await handleSubmit(async () => {})()
      expect(state.submitCount.value).toBe(1)
      await handleSubmit(async () => {})()
      expect(state.submitCount.value).toBe(2)
    })

    it('increments submitCount on validation failure', async () => {
      const state = alwaysInvalid()
      const { handleSubmit } = buildProcessForm(state)
      await handleSubmit(async () => {})()
      expect(state.submitCount.value).toBe(1)
    })

    it('increments submitCount on user-callback throw', async () => {
      const state = alwaysValid()
      const { handleSubmit } = buildProcessForm(state)
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
      const { handleSubmit } = buildProcessForm(state)
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
      const { handleSubmit } = buildProcessForm(state)
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
      const { handleSubmit } = buildProcessForm(state)
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
      const { handleSubmit } = buildProcessForm(state)
      await handleSubmit(async () => {})()
      expect(state.submitError.value).toBeNull()
    })

    it('keeps isSubmitting true across overlapping submissions until all complete', async () => {
      // Regression: previously each handler invocation set isSubmitting
      // = false on its own completion, so the FIRST resolution prematurely
      // flipped the flag while a later submission was still in flight.
      // The fix maintains an in-flight counter on FormState; isSubmitting
      // is true iff the counter is > 0.
      const state = alwaysValid()
      const { handleSubmit } = buildProcessForm(state)

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

  describe('setFieldErrorsFromApi', () => {
    it('hydrates wrapped envelope and populates state errors', () => {
      const state = alwaysValid()
      const { setFieldErrorsFromApi } = buildProcessForm(state)
      const result = setFieldErrorsFromApi({
        error: { details: { email: ['taken'] } },
      })
      expect(result.ok).toBe(true)
      expect(result.errors).toHaveLength(1)
      expect(state.getErrorsForPath(['email'])).toHaveLength(1)
    })

    it('returns ok:false with reason on malformed payload and does not mutate state', () => {
      const state = alwaysValid()
      const { setFieldErrorsFromApi } = buildProcessForm(state)
      state.setErrorsForPath(
        ['password'],
        [{ message: 'existing', path: ['password'], formKey: 'pf' }]
      )
      const result = setFieldErrorsFromApi(
        'oops' as unknown as Parameters<typeof setFieldErrorsFromApi>[0]
      )
      expect(result.ok).toBe(false)
      expect(result.rejected).toBeDefined()
      // Existing errors untouched
      expect(state.getErrorsForPath(['password'])).toHaveLength(1)
    })
  })
})
