// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { defineComponent, h, createApp } from 'vue'
import { z as z4 } from 'zod'
import { z as z3 } from 'zod-v3'

import { useForm as useFormUnified } from '../../src/zod'
import { useForm as useFormV4 } from '../../src/zod-v4'
import { useForm as useFormV3 } from '../../src/zod-v3'
import { useAbstractForm as useFormAbstract } from '../../src/runtime/composables/use-abstract-form'
import { InvalidUseFormConfigError } from '../../src/runtime/core/errors'

/**
 * Captures the synchronous throw inside `setup()`. Returns the thrown
 * value so the caller can `instanceof` check it. Mounts a probe with
 * the given setup and bails on any error.
 */
function runSetup(callback: () => void): unknown {
  let captured: unknown
  const Probe = defineComponent({
    setup() {
      try {
        callback()
      } catch (err) {
        captured = err
      }
      return () => h('div')
    },
  })
  const app = createApp(Probe)
  const host = document.createElement('div')
  app.mount(host)
  app.unmount()
  return captured
}

describe('useForm foot-gun guard — `attaform/zod` (unified)', () => {
  it('throws InvalidUseFormConfigError when called with a Zod v4 schema directly', () => {
    const err = runSetup(() => {
      // The mistake the original feedback flagged: schema as the first arg.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(useFormUnified as any)(z4.object({ email: z4.string() }))
    })
    expect(err).toBeInstanceOf(InvalidUseFormConfigError)
  })

  it('throws InvalidUseFormConfigError when called with a Zod v3 schema directly', () => {
    const err = runSetup(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(useFormUnified as any)(z3.object({ email: z3.string() }))
    })
    expect(err).toBeInstanceOf(InvalidUseFormConfigError)
  })

  it('throws InvalidUseFormConfigError when called with no argument', () => {
    const err = runSetup(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(useFormUnified as any)()
    })
    expect(err).toBeInstanceOf(InvalidUseFormConfigError)
  })

  it('throws InvalidUseFormConfigError for { schema: undefined }', () => {
    const err = runSetup(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(useFormUnified as any)({ schema: undefined })
    })
    expect(err).toBeInstanceOf(InvalidUseFormConfigError)
  })
})

describe('useForm foot-gun guard — `attaform/zod-v4` (explicit v4)', () => {
  it('throws when called with a Zod v4 schema directly', () => {
    const err = runSetup(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(useFormV4 as any)(z4.object({ email: z4.string() }))
    })
    expect(err).toBeInstanceOf(InvalidUseFormConfigError)
  })

  it('throws when called with no argument', () => {
    const err = runSetup(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(useFormV4 as any)()
    })
    expect(err).toBeInstanceOf(InvalidUseFormConfigError)
  })
})

describe('useForm foot-gun guard — `attaform/zod-v3` (explicit v3)', () => {
  it('throws when called with a Zod v3 schema directly', () => {
    const err = runSetup(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(useFormV3 as any)(z3.object({ email: z3.string() }))
    })
    expect(err).toBeInstanceOf(InvalidUseFormConfigError)
  })

  it('throws when called with no argument', () => {
    const err = runSetup(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(useFormV3 as any)()
    })
    expect(err).toBeInstanceOf(InvalidUseFormConfigError)
  })
})

describe('useForm foot-gun guard — `attaform` (abstract root)', () => {
  it('throws when called with a Zod schema directly (no .schema field)', () => {
    const err = runSetup(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(useFormAbstract as any)(z4.object({ email: z4.string() }))
    })
    expect(err).toBeInstanceOf(InvalidUseFormConfigError)
  })

  it('throws when called with no argument', () => {
    const err = runSetup(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(useFormAbstract as any)()
    })
    expect(err).toBeInstanceOf(InvalidUseFormConfigError)
  })

  it('throws when called with { schema: undefined }', () => {
    const err = runSetup(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(useFormAbstract as any)({ schema: undefined })
    })
    expect(err).toBeInstanceOf(InvalidUseFormConfigError)
  })
})
