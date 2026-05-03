// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { createApp, defineComponent, h, nextTick, watchEffect, type App } from 'vue'
import { z } from 'zod'
import { useForm } from '../../src/zod'
import { createAttaform } from '../../src/runtime/core/plugin'
import type { UseFormReturnType, ValidationError } from '../../src/runtime/types/types-api'

/**
 * Visual flicker on DU variant switch: spike.vue shows the
 * materialised `form.errors` momentarily collapse to `{}` between
 * email-variant errors (E) and sms-variant errors (S) — i.e. the user
 * sees `E → {} → S` instead of `E → S`.
 *
 * Mechanics: reshape mutates `form.value` synchronously, which queues
 * a Vue render microtask. SchemaErrors update lands LATER (after
 * `scheduleFieldValidation`'s setTimeout fires + Promise pipeline
 * runs). The first render reads the new `form.value` but stale
 * schemaErrors; the active-path filter hides the email-variant
 * entries (their leaf no longer exists in the new shape) and the
 * sms-variant entries haven't been written yet — so the materialiser
 * emits `{}`. A second render fires once validation lands, finally
 * showing S.
 *
 * Contract this file pins: AFTER the dust settles, the snapshot
 * sequence must NOT contain `{}` between the first non-empty
 * (E-shaped) snapshot and the last non-empty (S-shaped) snapshot.
 * In other words, the materialised errors transition from one
 * meaningful state to another without an intermediate empty frame.
 */

const profileSchema = z.object({
  notify: z.discriminatedUnion('channel', [
    z.object({ channel: z.literal('email'), address: z.email() }),
    z.object({ channel: z.literal('sms'), number: z.string().min(7) }),
  ]),
})

type ProfileApi = Omit<UseFormReturnType<z.output<typeof profileSchema>>, 'setValue'> & {
  setValue: (path: string, value: unknown) => boolean
}

function mountWithSnapshotter(): { app: App; api: ProfileApi; snapshots: string[] } {
  const handle: { api?: ProfileApi } = {}
  const snapshots: string[] = []
  const App = defineComponent({
    setup() {
      handle.api = useForm({
        schema: profileSchema,
        key: `flicker-${Math.random().toString(36).slice(2)}`,
        defaultValues: { notify: { channel: 'email', address: '' } },
        // debounceMs: 0 disables debouncing so validation runs
        // synchronously inside the keystroke handler — minimising the
        // flicker window without going through `setTimeout`.
        validateOn: 'change',
        debounceMs: 0,
      }) as unknown as ProfileApi
      // Capture every distinct render's view of `form.errors`.
      watchEffect(() => {
        snapshots.push(JSON.stringify(handle.api?.errors))
      })
      return () => h('div')
    },
  })
  const app = createApp(App).use(createAttaform({ override: true }))
  app.config.warnHandler = () => {}
  app.config.errorHandler = () => {}
  app.mount(document.createElement('div'))
  return { app, api: handle.api as ProfileApi, snapshots }
}

async function flushAll(): Promise<void> {
  await nextTick()
  await new Promise<void>((r) => setTimeout(r, 0))
  await nextTick()
  await new Promise<void>((r) => setTimeout(r, 0))
  await nextTick()
}

describe('DU variant switch — error materialisation flicker', () => {
  const apps: App[] = []
  afterEach(() => {
    while (apps.length > 0) apps.pop()?.unmount()
  })

  it('email→sms transition does not pass through {} between non-empty states', async () => {
    const { app, api, snapshots } = mountWithSnapshotter()
    apps.push(app)

    // Wait for the initial-mount validation to settle: E should be
    // present (notify.address fails z.email() against '').
    await flushAll()
    const initialIdx = snapshots.findIndex((s) => /notify.+address/.test(s))
    expect(initialIdx).toBeGreaterThanOrEqual(0)

    // Switch to sms — number is empty, fails .min(7).
    api.setValue('notify.channel', 'sms')
    await flushAll()

    // Final snapshot must contain the sms-variant error.
    const finalSnapshot = snapshots[snapshots.length - 1]
    expect(finalSnapshot).toMatch(/notify.+number/)

    // The sequence between initial-E and final-S must NOT contain `{}`.
    // Today: snapshots after `initialIdx` look like
    //   [..., '{}', '{"notify":{"number":[…]}}', …]
    // because the reshape's render fires BEFORE schedule's validation
    // lands. The contract: no empty snapshot between non-empty ones.
    const transition = snapshots.slice(initialIdx)
    const lastNonEmptyIdx = (() => {
      for (let i = transition.length - 1; i >= 0; i--) {
        if (transition[i] !== '{}') return i
      }
      return -1
    })()
    const inBetween = transition.slice(0, lastNonEmptyIdx)
    const blanks = inBetween.filter((s) => s === '{}')
    expect(blanks).toEqual([])
  })

  it('sms→email transition does not pass through {} either (symmetric)', async () => {
    const { app, api, snapshots } = mountWithSnapshotter()
    apps.push(app)
    await flushAll()

    // Pre-flight: switch to sms first so we start with S.
    api.setValue('notify.channel', 'sms')
    await flushAll()
    const sIdx = snapshots.findIndex((s) => /notify.+number/.test(s))
    expect(sIdx).toBeGreaterThanOrEqual(0)

    // Reset capture window: now switch back to email.
    const startIdx = snapshots.length
    api.setValue('notify.channel', 'email')
    await flushAll()

    const finalSnapshot = snapshots[snapshots.length - 1]
    expect(finalSnapshot).toMatch(/notify.+address/)

    const transition = snapshots.slice(startIdx)
    const lastNonEmptyIdx = (() => {
      for (let i = transition.length - 1; i >= 0; i--) {
        if (transition[i] !== '{}') return i
      }
      return -1
    })()
    const inBetween = transition.slice(0, lastNonEmptyIdx)
    const blanks = inBetween.filter((s) => s === '{}')
    expect(blanks).toEqual([])
  })

  it('after settle, errors at the new variant leaf are readable per-leaf', async () => {
    // Sanity: the new variant's leaf errors must be readable through
    // the canonical key lookup AFTER the validation completes. This
    // overlaps with the keying-fix tests but pins the post-flicker
    // state explicitly so a future regression can be diagnosed
    // independently of the snapshot-history check above.
    const { app, api } = mountWithSnapshotter()
    apps.push(app)
    await flushAll()
    api.setValue('notify.channel', 'sms')
    await flushAll()

    const numberErrors = (api.errors as unknown as (p: string) => ValidationError[] | undefined)(
      'notify.number'
    )
    expect(numberErrors).toBeDefined()
    expect(numberErrors?.[0]?.path).toEqual(['notify', 'number'])
  })
})
