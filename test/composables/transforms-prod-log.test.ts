// @vitest-environment jsdom
//
// Test #8 from the transforms plan: prod log shape (information-leak guard).
//
// Lives in a SEPARATE file because `__DEV__` (in src/runtime/core/dev.ts) is
// computed at module-load time from `process.env.NODE_ENV`. To exercise the
// prod branch of the directive's transform error logging we need to mock the
// dev module before the directive is imported — vi.mock is hoisted by vitest
// to the top of the file, so the import order works out only if the mock and
// the imports live in a fresh test file. In the main test file `__DEV__` is
// already cached at `true`, so swapping it locally is a no-op.
//
// Critical regression guard: a future contributor accidentally widening the
// prod-branch payload (path, transform name, error message, stack) is an
// information-leak surface. The transform body is consumer code we don't
// control; error messages may construct strings from user-typed values.
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../src/runtime/core/dev', () => ({ __DEV__: false }))

import { createApp, defineComponent, h, nextTick, withDirectives, type App } from 'vue'
import { z } from 'zod'
import { useForm } from '../../src/zod'
import { vRegister } from '../../src/runtime/core/directive'
import { createAttaform } from '../../src/runtime/core/plugin'

async function flush(): Promise<void> {
  for (let i = 0; i < 4; i++) {
    await Promise.resolve()
    await nextTick()
  }
}

describe('register({ transforms }) — prod log shape (information-leak guard)', () => {
  let app: App | undefined

  afterEach(() => {
    app?.unmount()
    app = undefined
    document.body.innerHTML = ''
  })

  it('throws use the fixed prod string with no path / index / message / stack', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const sensitiveError = new Error('SECRET_VALUE_email_was_xyz@private.com')
    sensitiveError.stack =
      'Error: SECRET_VALUE_email_was_xyz@private.com\n    at /home/me/secret/path/file.ts:42'

    const Parent = defineComponent({
      setup() {
        const api = useForm({
          schema: z.object({ email: z.string() }),
          key: `prod-${Math.random().toString(36).slice(2)}`,
        })
        const rv = api.register('email', {
          transforms: [
            (_: unknown) => {
              throw sensitiveError
            },
          ],
        })
        return () => withDirectives(h('input', { type: 'text' }), [[vRegister, rv]])
      },
    })

    app = createApp(Parent).use(createAttaform())
    const root = document.createElement('div')
    document.body.appendChild(root)
    app.mount(root)
    await flush()

    const input = root.firstElementChild as HTMLInputElement
    input.value = 'abc'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await flush()

    expect(errSpy).toHaveBeenCalled()
    // The prod log is a single argument (no second-positional error object).
    const calls = errSpy.mock.calls
    expect(calls.length).toBe(1)
    const call = calls[0]
    if (call === undefined) throw new Error('no call')

    // Single arg, fixed string.
    expect(call.length).toBe(1)
    const msg = String(call[0])
    expect(msg).toContain('transform error')
    expect(msg).toContain('write aborted')
    expect(msg).toContain('NODE_ENV=development')

    // The leak surface — every one of these MUST be absent.
    expect(msg).not.toContain('email') // path
    expect(msg).not.toContain('index 0') // transform index
    expect(msg).not.toContain('SECRET_VALUE') // error message
    expect(msg).not.toContain('xyz@private.com') // user-typed-derived content
    expect(msg).not.toContain('/home/me') // stack-frame file path
    expect(msg).not.toContain(':42') // line number from stack

    errSpy.mockRestore()
  })

  it('Promise returns use the same fixed prod string', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const Parent = defineComponent({
      setup() {
        const api = useForm({
          schema: z.object({ email: z.string() }),
          key: `prod-async-${Math.random().toString(36).slice(2)}`,
        })
        const rv = api.register('email', { transforms: [(v: unknown) => Promise.resolve(v)] })
        return () => withDirectives(h('input', { type: 'text' }), [[vRegister, rv]])
      },
    })

    app = createApp(Parent).use(createAttaform())
    const root = document.createElement('div')
    document.body.appendChild(root)
    app.mount(root)
    await flush()

    const input = root.firstElementChild as HTMLInputElement
    input.value = 'abc'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await flush()

    expect(errSpy).toHaveBeenCalled()
    const call = errSpy.mock.calls[0]
    if (call === undefined) throw new Error('no call')
    const msg = String(call[0])
    expect(msg).toContain('transform error')
    expect(msg).toContain('write aborted')
    // No async-specific phrasing in prod (otherwise we'd be leaking async-vs-throw).
    expect(msg).not.toContain('Promise')
    expect(msg).not.toContain('async field validation')
    expect(msg).not.toContain('email')

    errSpy.mockRestore()
  })
})
