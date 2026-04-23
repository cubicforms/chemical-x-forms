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
