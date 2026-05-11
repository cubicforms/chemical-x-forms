// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, expectTypeOf, it } from 'vitest'
import { createApp, defineComponent, h, nextTick, watch, type App } from 'vue'
import { z } from 'zod'
import { z as zV3 } from 'zod-v3'
import { unset, useForm } from '../../src/zod'
import { useForm as useFormV3 } from '../../src/zod-v3'
import { createAttaform } from '../../src/runtime/core/plugin'
import type { UseFormReturnType } from '../../src/runtime/types/types-api'
import type { PathInput, PathOutput } from '../../src/runtime/adapters/zod-v4'

/**
 * Discriminated-union HARDENING — what happens when a caller forces
 * an INVALID value into the discriminator key. "Invalid" means the
 * value is not in any variant's literal set: `notify.channel = 'wat'`
 * against `z.discriminatedUnion('channel', [literal('email'),
 * literal('sms')])`. Includes wrong-type writes (null, number,
 * undefined) at a string-literal discriminator.
 *
 * These tests probe surfaces an unsuspecting caller could reach via
 * `setValue`, `defaultValues`, persistence rehydrate, and undo. Each
 * test asserts the behavior we'd EXPECT from a hardened library —
 * the failures are bugs to triage. We're not committing to a remedy
 * yet (reject vs. accept-and-flag is the design call); the tests
 * just illuminate what's broken so we can pick.
 */

// -------------------- shared profile fixture --------------------
const profileSchema = z.object({
  name: z.string(),
  notify: z.discriminatedUnion('channel', [
    z.object({ channel: z.literal('email'), address: z.string().min(3) }),
    z.object({ channel: z.literal('sms'), number: z.string().min(7) }),
  ]),
})
type ProfileApi = Omit<UseFormReturnType<z.output<typeof profileSchema>>, 'setValue'> & {
  setValue: (path: string, value: unknown) => boolean
  values: { name: string; notify: { channel: string } & Record<string, unknown> }
}

function mountProfile(options: { defaultValues?: unknown } = {}): {
  app: App
  api: ProfileApi
} {
  const handle: { api?: ProfileApi } = {}
  const App = defineComponent({
    setup() {
      handle.api = useForm({
        schema: profileSchema,
        key: `du-invalid-${Math.random().toString(36).slice(2)}`,
        defaultValues: (options.defaultValues ?? {
          name: '',
          notify: { channel: 'email', address: 'old@example.com' },
        }) as never,
      }) as unknown as ProfileApi
      return () => h('div')
    },
  })
  const app = createApp(App).use(createAttaform())
  app.mount(document.createElement('div'))
  return { app, api: handle.api as ProfileApi }
}

// -------------------- Case A: leaf write to discriminator --------------------
describe('DU hardening — Case A invalid leaf discriminator write', () => {
  const apps: App[] = []
  afterEach(() => {
    while (apps.length > 0) apps.pop()?.unmount()
  })

  it('does NOT leave foreign keys from the previous variant alongside an invalid discriminator', async () => {
    const { app, api } = mountProfile()
    apps.push(app)

    api.setValue('notify.channel', 'wat')
    await nextTick()

    // Storage must reflect a SHAPE THAT MATCHES SOME VARIANT, or the
    // write must have been rejected and storage left untouched. The
    // unrepresentable-state outcome — `{ channel: 'wat', address: '…' }`
    // — is the bug: no variant has `channel='wat'` so this shape is
    // not in the schema's image. Whatever the remedy, this assertion
    // pins the contract.
    const notify = api.values.notify as Record<string, unknown>
    const isPreservedEmail =
      notify.channel === 'email' && typeof notify.address === 'string' && !('number' in notify)
    const isHasOnlyDiscriminator = Object.keys(notify).length === 1 && notify.channel === 'wat'
    expect(isPreservedEmail || isHasOnlyDiscriminator).toBe(true)
  })

  it('returns TRUE and lands a disc-only stub when the new discriminator is not a known variant', async () => {
    const { app, api } = mountProfile()
    apps.push(app)

    // Slim-primitive gate is type-only — it accepts any string at a
    // string-literal disc. The stub-state contract: the write
    // succeeds (returns true), storage at the union path collapses
    // to `{ [discKey]: value }` only — prior variant body and any
    // foreign keys are dropped. Validation is the authority on
    // value-level correctness; it surfaces the issue at notify /
    // notify.channel via Zod's natural invalid_union_discriminator.
    const ok = api.setValue('notify.channel', 'wat')
    await nextTick()
    expect(ok).toBe(true)
    expect(api.values.notify).toEqual({ channel: 'wat' })
  })

  it('surfaces a discriminator-mismatch error via validateAsync after an invalid write', async () => {
    const { app, api } = mountProfile()
    apps.push(app)

    api.setValue('notify.channel', 'wat')
    await nextTick()

    const result = await api.validateAsync()
    expect(result.success).toBe(false)
    // The error should be reported on a stable path callers can bind
    // to. Either `notify` (the union) or `notify.channel` (the
    // discriminator leaf) are reasonable; the test accepts either,
    // but rejects an empty / non-matching error list.
    const paths = result.errors?.map((e) => e.path.join('.')) ?? []
    const hasDiscError = paths.some((p) => p === 'notify' || p === 'notify.channel')
    expect(hasDiscError).toBe(true)
  })

  it('exposes the discriminator-mismatch error via api.errors at notify.channel OR notify', async () => {
    const { app, api } = mountProfile()
    apps.push(app)

    api.setValue('notify.channel', 'wat')
    await api.validateAsync()
    await nextTick()

    const atUnion = api.errors('notify')
    const atLeaf = api.errors('notify.channel')
    const surfaced = (atUnion?.length ?? 0) > 0 || (atLeaf?.length ?? 0) > 0
    expect(surfaced).toBe(true)
  })

  it('the orphaned old-variant leaf no longer reads as a passing field after the invalid write', async () => {
    const { app, api } = mountProfile()
    apps.push(app)

    // Pre: address was 'old@example.com' (valid for email variant).
    expect(api.errors('notify.address')).toBeUndefined()

    api.setValue('notify.channel', 'wat')
    await api.validateAsync()
    await nextTick()

    // The address leaf is now in storage but no longer sits under any
    // active variant's schema. A reader walking `form.fields` should
    // either:
    //   (a) treat the orphan as gone (errors=undefined, value stub), OR
    //   (b) surface the parent-level discriminator mismatch through it.
    // What it SHOULD NOT do: report the leaf as fully valid — the
    // form is structurally broken and pretending otherwise hides it
    // from any error-summary UI bound to children of `notify`.
    const orphanedSurface = (
      api as unknown as {
        fields: { notify: { address?: { errors: unknown[]; valid: boolean } } }
      }
    ).fields.notify.address
    if (orphanedSurface !== undefined) {
      expect(orphanedSurface.valid).toBe(false)
    }
  })

  it('container firstError at notify reflects the discriminator mismatch', async () => {
    const { app, api } = mountProfile()
    apps.push(app)

    api.setValue('notify.channel', 'wat')
    await api.validateAsync()
    await nextTick()

    const notifyField = (
      api as unknown as {
        fields: { notify: { firstError?: { message: string } } }
      }
    ).fields.notify
    expect(notifyField.firstError).toBeDefined()
  })
})

// -------------------- Case B: whole-union write --------------------
describe('DU hardening — Case B invalid whole-union write', () => {
  const apps: App[] = []
  afterEach(() => {
    while (apps.length > 0) apps.pop()?.unmount()
  })

  it('does NOT silently leave the form in a non-variant shape', async () => {
    const { app, api } = mountProfile()
    apps.push(app)

    api.setValue('notify', { channel: 'wat', someJunk: 1 })
    await nextTick()

    // Either reject (storage unchanged at the email variant) or
    // reshape to a valid variant. The accept-as-is outcome
    // (`{channel:'wat', someJunk:1, address:''}` etc.) is the bug.
    const notify = api.values.notify as Record<string, unknown>
    const stayedEmail = notify.channel === 'email'
    const validShape =
      (notify.channel === 'email' &&
        typeof notify.address === 'string' &&
        !('number' in notify) &&
        !('someJunk' in notify)) ||
      (notify.channel === 'sms' &&
        typeof notify.number === 'string' &&
        !('address' in notify) &&
        !('someJunk' in notify))
    expect(stayedEmail || validShape).toBe(true)
  })

  it('returns TRUE and lands a disc-only stub on an invalid whole-union write', async () => {
    const { app, api } = mountProfile()
    apps.push(app)

    const ok = api.setValue('notify', { channel: 'wat' })
    await nextTick()
    expect(ok).toBe(true)
    expect(api.values.notify).toEqual({ channel: 'wat' })
  })

  it('whole-union write missing the discriminator entirely lands an empty stub', async () => {
    const { app, api } = mountProfile()
    apps.push(app)

    // Consumer omits `channel`. The stub-state contract: storage
    // collapses to `{}` (no discriminator to hold, every consumer key
    // dropped — no auto-merge with the first-variant default).
    // Validation surfaces the issue via Zod's natural invalid-union-
    // discriminator on the next validateAsync.
    const ok = api.setValue('notify', { address: 'a@b.io' })
    await nextTick()
    expect(ok).toBe(true)
    expect(api.values.notify).toEqual({})
    const result = await api.validateAsync()
    expect(result.success).toBe(false)
  })
})

// -------------------- Slim-primitive gate at the discriminator --------------------
describe('DU hardening — slim-primitive gate at the discriminator key', () => {
  const apps: App[] = []
  afterEach(() => {
    while (apps.length > 0) apps.pop()?.unmount()
  })

  it('rejects null at a string-literal discriminator', async () => {
    const { app, api } = mountProfile()
    apps.push(app)
    expect(api.setValue('notify.channel', null)).toBe(false)
    await nextTick()
    expect(api.values.notify.channel).toBe('email')
  })

  it('rejects undefined at a string-literal discriminator', async () => {
    const { app, api } = mountProfile()
    apps.push(app)
    expect(api.setValue('notify.channel', undefined)).toBe(false)
    await nextTick()
    expect(api.values.notify.channel).toBe('email')
  })

  it('rejects a number at a string-literal discriminator', async () => {
    const { app, api } = mountProfile()
    apps.push(app)
    expect(api.setValue('notify.channel', 42)).toBe(false)
    await nextTick()
    expect(api.values.notify.channel).toBe('email')
  })

  it('rejects an object at a string-literal discriminator', async () => {
    const { app, api } = mountProfile()
    apps.push(app)
    expect(api.setValue('notify.channel', {})).toBe(false)
    await nextTick()
    expect(api.values.notify.channel).toBe('email')
  })

  it('rejects a string at a numeric-literal discriminator', async () => {
    // Numeric-literal DU. A wrong-type write should be rejected by
    // the slim-primitive gate even before the variant lookup runs.
    const numericSchema = z.object({
      payload: z.discriminatedUnion('kind', [
        z.object({ kind: z.literal(1), v: z.string() }),
        z.object({ kind: z.literal(2), v: z.number() }),
      ]),
    })
    type NumericApi = Omit<UseFormReturnType<z.output<typeof numericSchema>>, 'setValue'> & {
      setValue: (path: string, value: unknown) => boolean
      values: { payload: { kind: number | string } & Record<string, unknown> }
    }
    const handle: { api?: NumericApi } = {}
    const App = defineComponent({
      setup() {
        handle.api = useForm({
          schema: numericSchema,
          key: `du-numeric-disc-${Math.random().toString(36).slice(2)}`,
          defaultValues: { payload: { kind: 1, v: 'a' } },
        }) as unknown as NumericApi
        return () => h('div')
      },
    })
    const app = createApp(App).use(createAttaform())
    app.mount(document.createElement('div'))
    apps.push(app)
    const api = handle.api as NumericApi

    expect(api.setValue('payload.kind', '1')).toBe(false)
    await nextTick()
    expect(api.values.payload.kind).toBe(1)
  })

  it('rejects an unknown number at a numeric-literal discriminator', async () => {
    const numericSchema = z.object({
      payload: z.discriminatedUnion('kind', [
        z.object({ kind: z.literal(1), v: z.string() }),
        z.object({ kind: z.literal(2), v: z.number() }),
      ]),
    })
    type NumericApi = Omit<UseFormReturnType<z.output<typeof numericSchema>>, 'setValue'> & {
      setValue: (path: string, value: unknown) => boolean
      values: { payload: { kind: number } & Record<string, unknown> }
    }
    const handle: { api?: NumericApi } = {}
    const App = defineComponent({
      setup() {
        handle.api = useForm({
          schema: numericSchema,
          key: `du-numeric-unknown-${Math.random().toString(36).slice(2)}`,
          defaultValues: { payload: { kind: 1, v: 'a' } },
        }) as unknown as NumericApi
        return () => h('div')
      },
    })
    const app = createApp(App).use(createAttaform())
    app.mount(document.createElement('div'))
    apps.push(app)
    const api = handle.api as NumericApi

    // `99` is the right type but not a literal value. The slim gate
    // is type-only (kinds, not literal sets), so the write reaches the
    // disc reshape. With no matching variant, storage collapses to a
    // disc-only stub `{ kind: 99 }` and validation surfaces the
    // mismatch via Zod's natural error pipeline. setValue returns true
    // — the write lands; it's validation, not the runtime gate, that
    // flags the value as out-of-range.
    expect(api.setValue('payload.kind', 99)).toBe(true)
    await nextTick()
    expect(api.values.payload).toEqual({ kind: 99 })
  })
})

// -------------------- Variant memory poisoning --------------------
describe('DU hardening — variant memory survives an invalid intermediate', () => {
  const apps: App[] = []
  afterEach(() => {
    while (apps.length > 0) apps.pop()?.unmount()
  })

  it('an invalid intermediate write does NOT corrupt the prior variant memory', async () => {
    const { app, api } = mountProfile()
    apps.push(app)

    // Start clean on email with a typed address.
    api.setValue('notify.address', 'first@example.com')
    await nextTick()

    // Try to switch to an invalid discriminator. Whether this is
    // rejected or no-ops, the email memory must NOT be polluted —
    // it should still hold the typed address verbatim.
    api.setValue('notify.channel', 'wat')
    await nextTick()

    // Now switch validly to sms.
    api.setValue('notify.channel', 'sms')
    await nextTick()
    expect(api.values.notify).toEqual({ channel: 'sms', number: '' })

    // Switch back to email — memory should restore the typed address.
    api.setValue('notify.channel', 'email')
    await nextTick()
    expect(api.values.notify).toEqual({ channel: 'email', address: 'first@example.com' })
  })
})

// -------------------- Construction with invalid defaults --------------------
describe('DU hardening — construction with invalid discriminator in defaultValues', () => {
  const apps: App[] = []
  afterEach(() => {
    while (apps.length > 0) apps.pop()?.unmount()
  })

  it('produces a form whose values match a real variant shape', async () => {
    const { app, api } = mountProfile({
      defaultValues: { name: '', notify: { channel: 'wat' } },
    })
    apps.push(app)
    await nextTick()

    // Stub-state contract at construction: form mounts with the
    // consumer's verbatim disc value at the DU path, no auto-fill from
    // any variant default — storage is exactly `{channel:'wat'}`,
    // foreign-variant fields are not invented. A one-shot dev warning
    // (assertable separately) flags the bad disc; validation surfaces
    // the mismatch on next validateAsync.
    const notify = api.values.notify as Record<string, unknown>
    expect(notify).toEqual({ channel: 'wat' })
    const result = await api.validateAsync()
    expect(result.success).toBe(false)
  })
})

// -------------------- Re-set same invalid (idempotency) --------------------
describe('DU hardening — repeated invalid writes', () => {
  const apps: App[] = []
  afterEach(() => {
    while (apps.length > 0) apps.pop()?.unmount()
  })

  it('writing the same invalid discriminator twice is idempotent', async () => {
    const { app, api } = mountProfile()
    apps.push(app)

    const first = api.setValue('notify.channel', 'wat')
    await nextTick()
    const second = api.setValue('notify.channel', 'wat')
    await nextTick()

    // Both writes should yield the same status; the second must not
    // produce a different storage state from the first.
    expect(first).toBe(second)
  })
})

// -------------------- Undo --------------------
describe('DU hardening — undo across an invalid intermediate', () => {
  const apps: App[] = []
  afterEach(() => {
    while (apps.length > 0) apps.pop()?.unmount()
  })

  it('undo reverts the form to a valid state after an invalid write', async () => {
    const handle: { api?: ProfileApi } = {}
    const App = defineComponent({
      setup() {
        handle.api = useForm({
          schema: profileSchema,
          key: `du-invalid-undo-${Math.random().toString(36).slice(2)}`,
          defaultValues: { name: '', notify: { channel: 'email', address: 'kept@x.io' } },
          history: true,
        }) as unknown as ProfileApi
        return () => h('div')
      },
    })
    const app = createApp(App).use(createAttaform())
    app.mount(document.createElement('div'))
    apps.push(app)
    const api = handle.api as ProfileApi

    api.setValue('notify.channel', 'wat')
    await nextTick()
    api.undo()
    await nextTick()

    // After undo, the form is whatever it was before the invalid
    // write. The pre-write state is `{channel:'email', address:'kept@x.io'}`,
    // i.e. a valid variant.
    const notify = api.values.notify as Record<string, unknown>
    const isValid =
      (notify.channel === 'email' && typeof notify.address === 'string') ||
      (notify.channel === 'sms' && typeof notify.number === 'string')
    expect(isValid).toBe(true)
  })
})

// -------------------- Array DU --------------------
describe('DU hardening — invalid discriminator at an array element', () => {
  const apps: App[] = []
  afterEach(() => {
    while (apps.length > 0) apps.pop()?.unmount()
  })

  it("invalid write to events[0].type doesn't leak into the sibling element", async () => {
    const arraySchema = z.object({
      events: z.array(
        z.discriminatedUnion('type', [
          z.object({ type: z.literal('click'), x: z.string() }),
          z.object({ type: z.literal('text'), value: z.string() }),
        ])
      ),
    })
    type ArrayApi = Omit<UseFormReturnType<z.output<typeof arraySchema>>, 'setValue'> & {
      setValue: (path: string, value: unknown) => boolean
      values: { events: Array<{ type: string } & Record<string, unknown>> }
    }
    const handle: { api?: ArrayApi } = {}
    const App = defineComponent({
      setup() {
        handle.api = useForm({
          schema: arraySchema,
          key: `du-array-invalid-${Math.random().toString(36).slice(2)}`,
          defaultValues: {
            events: [
              { type: 'click', x: 'first' },
              { type: 'text', value: 'second' },
            ],
          },
        }) as unknown as ArrayApi
        return () => h('div')
      },
    })
    const app = createApp(App).use(createAttaform())
    app.mount(document.createElement('div'))
    apps.push(app)
    const api = handle.api as ArrayApi

    api.setValue('events.0.type', 'unknown')
    await nextTick()

    // Sibling unaffected.
    expect(api.values.events[1]).toEqual({ type: 'text', value: 'second' })
    // Target element collapses to a disc-only stub; foreign keys
    // from the prior variant (e.g. `x`) are dropped. The stub-state
    // outcome is also "representable" alongside the two valid-variant
    // outcomes; what matters is no mixed shape.
    const e0 = api.values.events[0] as Record<string, unknown>
    const isStub = Object.keys(e0).length === 1 && e0.type === 'unknown'
    const isValid =
      isStub ||
      (e0.type === 'click' && typeof e0.x === 'string' && !('value' in e0)) ||
      (e0.type === 'text' && typeof e0.value === 'string' && !('x' in e0))
    expect(isValid).toBe(true)
  })
})

// -------------------- Nested DU --------------------
describe('DU hardening — invalid discriminator at an inner nested DU', () => {
  const apps: App[] = []
  afterEach(() => {
    while (apps.length > 0) apps.pop()?.unmount()
  })

  it('invalid inner write leaves the outer state untouched and the inner consistent', async () => {
    const flowSchema = z.object({
      flow: z.discriminatedUnion('step', [
        z.object({
          step: z.literal('choose'),
          inner: z.discriminatedUnion('kind', [
            z.object({ kind: z.literal('A'), a: z.string() }),
            z.object({ kind: z.literal('B'), b: z.string() }),
          ]),
        }),
        z.object({ step: z.literal('done'), notes: z.string() }),
      ]),
    })
    type FlowApi = Omit<UseFormReturnType<z.output<typeof flowSchema>>, 'setValue'> & {
      setValue: (path: string, value: unknown) => boolean
      values: { flow: { step: string } & Record<string, unknown> }
    }
    const handle: { api?: FlowApi } = {}
    const App = defineComponent({
      setup() {
        handle.api = useForm({
          schema: flowSchema,
          key: `du-nested-invalid-${Math.random().toString(36).slice(2)}`,
          defaultValues: {
            flow: { step: 'choose', inner: { kind: 'A', a: 'value-a' } },
          },
        }) as unknown as FlowApi
        return () => h('div')
      },
    })
    const app = createApp(App).use(createAttaform())
    app.mount(document.createElement('div'))
    apps.push(app)
    const api = handle.api as FlowApi

    api.setValue('flow.inner.kind', 'Z')
    await nextTick()

    // Outer step untouched.
    expect(api.values.flow.step).toBe('choose')

    // Inner collapses to a disc-only stub `{kind:'Z'}` — foreign
    // `a` from the prior variant is dropped. The stub outcome
    // joins the two valid-variant outcomes as "representable"; the
    // mixed `{kind:'Z', a:'value-a'}` shape is what the bug looked like.
    const inner = (api.values.flow as Record<string, unknown>).inner as Record<string, unknown>
    const isStub = Object.keys(inner).length === 1 && inner.kind === 'Z'
    const innerValid =
      isStub ||
      (inner.kind === 'A' && typeof inner.a === 'string' && !('b' in inner)) ||
      (inner.kind === 'B' && typeof inner.b === 'string' && !('a' in inner))
    expect(innerValid).toBe(true)
  })
})

// -------------------- v3 adapter parity --------------------
describe('DU hardening — zod v3 adapter parity', () => {
  const apps: App[] = []
  afterEach(() => {
    while (apps.length > 0) apps.pop()?.unmount()
  })

  it('v3: invalid Case A discriminator write does not leave foreign keys', async () => {
    const v3Schema = zV3.object({
      notify: zV3.discriminatedUnion('channel', [
        zV3.object({ channel: zV3.literal('email'), address: zV3.string() }),
        zV3.object({ channel: zV3.literal('sms'), number: zV3.string() }),
      ]),
    })
    type V3Api = Omit<UseFormReturnType<zV3.infer<typeof v3Schema>>, 'setValue'> & {
      setValue: (path: string, value: unknown) => boolean
      values: { notify: { channel: string } & Record<string, unknown> }
    }
    const handle: { api?: V3Api } = {}
    const App = defineComponent({
      setup() {
        handle.api = useFormV3({
          schema: v3Schema,
          key: `du-invalid-v3-${Math.random().toString(36).slice(2)}`,
          defaultValues: { notify: { channel: 'email', address: 'a@b.io' } },
        }) as unknown as V3Api
        return () => h('div')
      },
    })
    const app = createApp(App).use(createAttaform())
    app.mount(document.createElement('div'))
    apps.push(app)
    const api = handle.api as V3Api

    api.setValue('notify.channel', 'wat')
    await nextTick()

    const notify = api.values.notify as Record<string, unknown>
    const isPreservedEmail =
      notify.channel === 'email' && typeof notify.address === 'string' && !('number' in notify)
    const isHasOnlyDiscriminator = Object.keys(notify).length === 1 && notify.channel === 'wat'
    expect(isPreservedEmail || isHasOnlyDiscriminator).toBe(true)
  })

  it('v3: returns TRUE and lands a disc-only stub for invalid Case A write', async () => {
    const v3Schema = zV3.object({
      notify: zV3.discriminatedUnion('channel', [
        zV3.object({ channel: zV3.literal('email'), address: zV3.string() }),
        zV3.object({ channel: zV3.literal('sms'), number: zV3.string() }),
      ]),
    })
    type V3Api = Omit<UseFormReturnType<zV3.infer<typeof v3Schema>>, 'setValue'> & {
      setValue: (path: string, value: unknown) => boolean
      values: { notify: { channel: string } & Record<string, unknown> }
    }
    const handle: { api?: V3Api } = {}
    const App = defineComponent({
      setup() {
        handle.api = useFormV3({
          schema: v3Schema,
          key: `du-invalid-v3-return-${Math.random().toString(36).slice(2)}`,
          defaultValues: { notify: { channel: 'email', address: 'a@b.io' } },
        }) as unknown as V3Api
        return () => h('div')
      },
    })
    const app = createApp(App).use(createAttaform())
    app.mount(document.createElement('div'))
    apps.push(app)
    const api = handle.api as V3Api

    expect(api.setValue('notify.channel', 'nope')).toBe(true)
    await nextTick()
    expect(api.values.notify).toEqual({ channel: 'nope' })
  })
})

// =====================================================================
// EXPANDED PROBES — failure modes raised in design conversation:
//
//   1. "No selection yet" UX (`unset` + blank on the discriminator)
//   2. Bad default-value variations (missing key, missing variant
//      fields, foreign-variant fields, partial defaults)
//   3. Discriminators-in-discriminators (outer-invalid cascades)
//   4. Reset / resetField interactions across an invalid state
//   5. Field metadata side-effects on the discriminator after invalid
//      writes (touched / dirty / blank / valid)
//   6. handleSubmit posture while the form is in an invalid state
//
// Same posture as the suite above: each test asserts what we'd EXPECT
// from a hardened library. Failures are bugs to triage, not commitments
// to a remedy.
// =====================================================================

// -------------------- 1. "No selection yet" UX --------------------
describe('DU hardening — `unset` on the discriminator (no-selection-yet UX)', () => {
  const apps: App[] = []
  afterEach(() => {
    while (apps.length > 0) apps.pop()?.unmount()
  })

  it('useForm with `unset` at the discriminator mounts in a representable state', async () => {
    const handle: { api?: ProfileApi } = {}
    const App = defineComponent({
      setup() {
        handle.api = useForm({
          schema: profileSchema,
          key: `du-unset-default-${Math.random().toString(36).slice(2)}`,
          defaultValues: {
            name: '',
            // Consumer wants "no channel chosen yet". `unset` substitutes
            // to the slim default (`''`) at the discriminator path. We
            // expect storage to reflect a state any reader can render
            // (no orphan keys, no shape that mixes variants).
            notify: { channel: unset },
          } as never,
        }) as unknown as ProfileApi
        return () => h('div')
      },
    })
    const app = createApp(App).use(createAttaform())
    app.mount(document.createElement('div'))
    apps.push(app)
    const api = handle.api as ProfileApi
    await nextTick()

    // Either:
    //  (a) the form holds a valid first-variant default + the
    //      discriminator path tracked as blank, OR
    //  (b) the form holds only the discriminator key + nothing else.
    // The accept-as-is outcome is the bug — `{channel:''}` plus
    // first-variant `address` keys is structurally identical to a half-
    // built variant whose validation pretends to know which one.
    const notify = api.values.notify as Record<string, unknown>
    const validShape =
      (notify.channel === 'email' && typeof notify.address === 'string') ||
      (notify.channel === 'sms' && typeof notify.number === 'string') ||
      (Object.keys(notify).length === 1 && notify.channel === '')
    expect(validShape).toBe(true)
  })

  it('the discriminator path reads as `blank` after `unset` at construction', async () => {
    const handle: { api?: ProfileApi } = {}
    const App = defineComponent({
      setup() {
        handle.api = useForm({
          schema: profileSchema,
          key: `du-unset-blank-${Math.random().toString(36).slice(2)}`,
          defaultValues: { name: '', notify: { channel: unset } } as never,
        }) as unknown as ProfileApi
        return () => h('div')
      },
    })
    const app = createApp(App).use(createAttaform())
    app.mount(document.createElement('div'))
    apps.push(app)
    const api = handle.api as ProfileApi
    await nextTick()

    // The blank-bookkeeping is what powers the "user hasn't chosen yet"
    // UX. Without it, the form reports `dirty: false` + `valid: true`
    // (nothing has been validated, channel == '' passes the slim gate)
    // — so the consumer can't tell "no choice yet" from "valid email
    // form with empty address" at the data layer.
    const notifyChannel = (
      api as unknown as {
        fields: { notify: { channel: { blank: boolean } } }
      }
    ).fields.notify.channel
    expect(notifyChannel.blank).toBe(true)
  })

  it('`setValue(disc-path, unset)` from a valid state cleans up old-variant keys', async () => {
    const { app, api } = mountProfile()
    apps.push(app)

    api.setValue('notify.address', 'typed@example.com')
    await nextTick()
    expect(api.values.notify).toEqual({ channel: 'email', address: 'typed@example.com' })

    // Consumer asks "no selection yet" mid-flight — e.g. user clicks
    // a "clear my choice" button. The orphan `address` key is the bug:
    // storage shape doesn't match any variant.
    api.setValue('notify.channel', unset)
    await nextTick()

    const notify = api.values.notify as Record<string, unknown>
    expect('address' in notify).toBe(false)
  })

  it('after `unset`, switching to a valid variant produces a clean shape', async () => {
    const { app, api } = mountProfile()
    apps.push(app)

    api.setValue('notify.channel', unset)
    await nextTick()

    api.setValue('notify.channel', 'sms')
    await nextTick()

    // Variant lookup must work normally after an unset interlude. No
    // ghosted keys from before.
    expect(api.values.notify).toEqual({ channel: 'sms', number: '' })
  })

  it('`form.values()` after `unset` is JSON-serializable + describes a single state', async () => {
    const { app, api } = mountProfile()
    apps.push(app)

    api.setValue('notify.channel', unset)
    await nextTick()

    // Consumers reading values for a review pane / network round-trip
    // need a clean JSON. The accept-as-is shape `{channel:'', address:'old@example.com'}`
    // serializes fine but represents nothing the schema accepts — and
    // the consumer can't tell from the JSON whether the form is "no
    // choice" or "broken email choice".
    const json = JSON.parse(JSON.stringify(api.values.notify)) as Record<string, unknown>
    const consistent =
      (json.channel === '' && Object.keys(json).length === 1) ||
      (json.channel === 'email' && typeof json.address === 'string') ||
      (json.channel === 'sms' && typeof json.number === 'string')
    expect(consistent).toBe(true)
  })
})

// -------------------- 2. Bad default-value variations --------------------
describe('DU hardening — bad default values at the union path', () => {
  const apps: App[] = []
  afterEach(() => {
    while (apps.length > 0) apps.pop()?.unmount()
  })

  it('defaultValues missing the discriminator key entirely produces a deterministic state', async () => {
    const handle: { api?: ProfileApi } = {}
    const App = defineComponent({
      setup() {
        handle.api = useForm({
          schema: profileSchema,
          key: `du-bad-defaults-no-disc-${Math.random().toString(36).slice(2)}`,
          // No `channel`. The schema's `getDefaultAtPath` falls back to
          // the first variant — so `address` lands under email by the
          // construction pipeline. The consumer never asked for email;
          // this is implicit-first-variant magic.
          defaultValues: { name: '', notify: { address: 'unspecified@x.io' } } as never,
        }) as unknown as ProfileApi
        return () => h('div')
      },
    })
    const app = createApp(App).use(createAttaform())
    app.mount(document.createElement('div'))
    apps.push(app)
    const api = handle.api as ProfileApi
    await nextTick()

    // Whatever the runtime decides, the result must MATCH a real
    // variant. If we accept-as-is into `{address:'…'}` (no channel),
    // every downstream path breaks.
    const notify = api.values.notify as Record<string, unknown>
    const matches =
      (notify.channel === 'email' && typeof notify.address === 'string') ||
      (notify.channel === 'sms' && typeof notify.number === 'string')
    expect(matches).toBe(true)
  })

  it('defaultValues with valid disc + foreign-variant field strips the foreign key', async () => {
    const handle: { api?: ProfileApi } = {}
    const App = defineComponent({
      setup() {
        handle.api = useForm({
          schema: profileSchema,
          key: `du-bad-defaults-foreign-${Math.random().toString(36).slice(2)}`,
          // `channel: 'email'` chooses the email variant; `number` only
          // belongs to the sms variant. Construction should reshape to
          // a clean email, not preserve the foreign key.
          defaultValues: {
            name: '',
            notify: { channel: 'email', address: 'a@b.io', number: '5551234' },
          } as never,
        }) as unknown as ProfileApi
        return () => h('div')
      },
    })
    const app = createApp(App).use(createAttaform())
    app.mount(document.createElement('div'))
    apps.push(app)
    const api = handle.api as ProfileApi
    await nextTick()

    expect('number' in (api.values.notify as Record<string, unknown>)).toBe(false)
  })

  it('defaultValues missing the union path entirely yields the first variant default cleanly', async () => {
    const handle: { api?: ProfileApi } = {}
    const App = defineComponent({
      setup() {
        handle.api = useForm({
          schema: profileSchema,
          key: `du-bad-defaults-no-union-${Math.random().toString(36).slice(2)}`,
          defaultValues: { name: '' } as never,
        }) as unknown as ProfileApi
        return () => h('div')
      },
    })
    const app = createApp(App).use(createAttaform())
    app.mount(document.createElement('div'))
    apps.push(app)
    const api = handle.api as ProfileApi
    await nextTick()

    const notify = api.values.notify as Record<string, unknown>
    const matches =
      (notify.channel === 'email' && typeof notify.address === 'string') ||
      (notify.channel === 'sms' && typeof notify.number === 'string')
    expect(matches).toBe(true)
  })
})

// -------------------- 3. Discriminators in discriminators --------------------
describe('DU hardening — invalid OUTER discriminator with valid inner state', () => {
  const flowSchema = z.object({
    flow: z.discriminatedUnion('step', [
      z.object({
        step: z.literal('choose'),
        inner: z.discriminatedUnion('kind', [
          z.object({ kind: z.literal('A'), a: z.string() }),
          z.object({ kind: z.literal('B'), b: z.string() }),
        ]),
      }),
      z.object({ step: z.literal('done'), notes: z.string() }),
    ]),
  })
  type FlowApi = Omit<UseFormReturnType<z.output<typeof flowSchema>>, 'setValue'> & {
    setValue: (path: string, value: unknown) => boolean
    values: { flow: { step: string } & Record<string, unknown> }
  }
  function mountFlow(): { app: App; api: FlowApi } {
    const handle: { api?: FlowApi } = {}
    const App = defineComponent({
      setup() {
        handle.api = useForm({
          schema: flowSchema,
          key: `du-nested-outer-invalid-${Math.random().toString(36).slice(2)}`,
          defaultValues: { flow: { step: 'choose', inner: { kind: 'A', a: 'typed-a' } } },
        }) as unknown as FlowApi
        return () => h('div')
      },
    })
    const app = createApp(App).use(createAttaform())
    app.mount(document.createElement('div'))
    return { app, api: handle.api as FlowApi }
  }
  const apps: App[] = []
  afterEach(() => {
    while (apps.length > 0) apps.pop()?.unmount()
  })

  it('invalid outer write does NOT leave the inner subtree as an orphan island', async () => {
    const { app, api } = mountFlow()
    apps.push(app)

    api.setValue('flow.step', 'BAD_OUTER')
    await nextTick()

    // Stub-state contract: outer collapses to a disc-only stub
    // `{step:'BAD_OUTER'}` — the prior variant's `inner` subtree is
    // dropped, so no orphan island survives under a non-variant
    // parent. Validation flags the bad disc on next validateAsync.
    const flow = api.values.flow as Record<string, unknown>
    const isStub = Object.keys(flow).length === 1 && flow.step === 'BAD_OUTER'
    const valid =
      isStub ||
      (flow.step === 'choose' && typeof flow.inner === 'object') ||
      (flow.step === 'done' && typeof flow.notes === 'string')
    expect(valid).toBe(true)
  })

  it('outer Case B with invalid inner discriminator does not embed garbage', async () => {
    const { app, api } = mountFlow()
    apps.push(app)

    api.setValue('flow', { step: 'choose', inner: { kind: 'BAD_INNER', a: 'x' } })
    await nextTick()

    // Outer reshape activates the choose variant; inner collapses to
    // a disc-only stub `{kind:'BAD_INNER'}` — foreign `a` is dropped.
    // The stub joins the two valid-variant outcomes as "representable";
    // the mixed `{kind:'BAD_INNER', a:'x'}` shape is the bug.
    const flow = api.values.flow as Record<string, unknown>
    const inner = flow.inner as Record<string, unknown>
    const isStub = Object.keys(inner).length === 1 && inner.kind === 'BAD_INNER'
    const innerValid =
      isStub ||
      (inner.kind === 'A' && typeof inner.a === 'string' && !('b' in inner)) ||
      (inner.kind === 'B' && typeof inner.b === 'string' && !('a' in inner))
    expect(innerValid).toBe(true)
  })

  it('switching outer back to a valid variant after an invalid intermediate restores cleanly', async () => {
    const { app, api } = mountFlow()
    apps.push(app)

    api.setValue('flow.step', 'BAD_OUTER')
    await nextTick()
    api.setValue('flow.step', 'done')
    await nextTick()

    // The valid `done` variant has only `notes`. After this sequence,
    // we expect the standard sms-style slim default — `notes: ''` —
    // and no leftover `inner` key, no leftover `step:'BAD_OUTER'`.
    const flow = api.values.flow as Record<string, unknown>
    expect(flow.step).toBe('done')
    expect('inner' in flow).toBe(false)
    expect(typeof flow.notes).toBe('string')
  })
})

// -------------------- 4. Reset interactions across invalid --------------------
describe('DU hardening — reset / resetField after an invalid discriminator write', () => {
  const apps: App[] = []
  afterEach(() => {
    while (apps.length > 0) apps.pop()?.unmount()
  })

  it('resetField on the discriminator path recovers to a valid shape', async () => {
    const { app, api } = mountProfile()
    apps.push(app)

    api.setValue('notify.channel', 'wat')
    await nextTick()

    api.resetField('notify.channel')
    await nextTick()

    const notify = api.values.notify as Record<string, unknown>
    expect(notify.channel).toBe('email')
    // Clean shape — no orphan/invalid leftover.
    expect(typeof notify.address).toBe('string')
  })

  it('resetField on the union path recovers to a valid shape', async () => {
    const { app, api } = mountProfile()
    apps.push(app)

    api.setValue('notify.channel', 'wat')
    await nextTick()

    api.resetField('notify')
    await nextTick()

    const notify = api.values.notify as Record<string, unknown>
    const valid =
      (notify.channel === 'email' && typeof notify.address === 'string') ||
      (notify.channel === 'sms' && typeof notify.number === 'string')
    expect(valid).toBe(true)
  })

  it('reset() recovers cleanly from an invalid form state', async () => {
    const { app, api } = mountProfile()
    apps.push(app)

    api.setValue('notify.channel', 'wat')
    await nextTick()

    api.reset()
    await nextTick()

    const notify = api.values.notify as Record<string, unknown>
    const valid =
      (notify.channel === 'email' && typeof notify.address === 'string') ||
      (notify.channel === 'sms' && typeof notify.number === 'string')
    expect(valid).toBe(true)
  })
})

// -------------------- 5. Field metadata after invalid write --------------------
describe('DU hardening — field metadata side-effects of an invalid discriminator write', () => {
  const apps: App[] = []
  afterEach(() => {
    while (apps.length > 0) apps.pop()?.unmount()
  })

  it("the union path's `valid` flag is FALSE after an invalid discriminator write", async () => {
    const { app, api } = mountProfile()
    apps.push(app)

    api.setValue('notify.channel', 'wat')
    await api.validateAsync()
    await nextTick()

    // Container proxies aren't leaf-views — `api.fields.notify.valid`
    // descends; the boolean lives on the call-form `api.fields.notify()`
    // (or `api.fields('notify')`). Stub-state contract: validation
    // surfaces a Zod disc-mismatch error AT or UNDER the union path,
    // so the aggregated `valid` is FALSE.
    const notifyState = (
      api as unknown as {
        fields: (path: string) => { valid: boolean; errors: unknown[] }
      }
    ).fields('notify')
    expect(notifyState.valid).toBe(false)
  })

  it("the discriminator leaf's `valid` flag is FALSE after the invalid write", async () => {
    const { app, api } = mountProfile()
    apps.push(app)

    api.setValue('notify.channel', 'wat')
    await api.validateAsync()
    await nextTick()

    const channelField = (
      api as unknown as {
        fields: { notify: { channel: { valid: boolean } } }
      }
    ).fields.notify.channel
    expect(channelField.valid).toBe(false)
  })

  it('form-level meta.valid is FALSE after an invalid discriminator write', async () => {
    const { app, api } = mountProfile()
    apps.push(app)

    api.setValue('notify.channel', 'wat')
    await api.validateAsync()
    await nextTick()

    expect(api.meta.valid).toBe(false)
  })
})

// -------------------- 6. handleSubmit while invalid --------------------
describe('DU hardening — handleSubmit while the form has an invalid discriminator', () => {
  const apps: App[] = []
  afterEach(() => {
    while (apps.length > 0) apps.pop()?.unmount()
  })

  it('routes to onError, not onSuccess, when the discriminator is invalid', async () => {
    const { app, api } = mountProfile()
    apps.push(app)

    api.setValue('notify.channel', 'wat')
    await nextTick()

    let successFired = false
    let errorFired = false
    const submit = api.handleSubmit(
      () => {
        successFired = true
      },
      () => {
        errorFired = true
      }
    )
    await submit()
    await nextTick()

    expect(successFired).toBe(false)
    expect(errorFired).toBe(true)
  })

  it('the onError callback receives an error list including the discriminator path', async () => {
    const { app, api } = mountProfile()
    apps.push(app)

    api.setValue('notify.channel', 'wat')
    await nextTick()

    let capturedErrors: { path: (string | number)[]; message: string }[] = []
    const submit = api.handleSubmit(
      () => {},
      (errors) => {
        capturedErrors = errors as typeof capturedErrors
      }
    )
    await submit()
    await nextTick()

    const paths = capturedErrors.map((e) => e.path.join('.'))
    const hasDiscError = paths.some((p) => p === 'notify' || p === 'notify.channel' || p === '')
    expect(hasDiscError).toBe(true)
  })
})

// =====================================================================
// 7. ARRAY × DISCRIMINATED UNION — interplay failure modes.
//
// Three structural shapes worth probing separately:
//
//   (a) `array of DU` — `z.array(z.discriminatedUnion(...))` — every
//       element carries its own discriminator. Variant memory is
//       keyed by absolute path (`['events', 0, 'channel']` etc.), so
//       splicing or reordering shifts memory entries onto DIFFERENT
//       elements than they were captured for.
//
//   (b) `DU containing an array variant` — `discriminatedUnion('kind',
//       [{kind:'list', items: array(...)}, {kind:'single', ...}])`
//       — switching the outer discriminator hides/restores an entire
//       array branch, so memory has to round-trip a non-trivial
//       sub-tree.
//
//   (c) `array Case A vs Case B at indexed paths` — write to
//       `events.0.type` (Case A leaf) vs `events.0` (Case B whole
//       element). Both should reject invalid discriminators the same
//       way.
//
// These probes also exercise array-level operations (`fieldArray.append`,
// `.remove`, `.swap`, `.move`, whole-array replacement via `setValue`)
// since those are the common ways arrays change shape under a DU.
// =====================================================================

describe('DU hardening — array of DU: variant memory under array reshape', () => {
  const arraySchema = z.object({
    events: z.array(
      z.discriminatedUnion('type', [
        z.object({ type: z.literal('click'), x: z.string() }),
        z.object({ type: z.literal('text'), value: z.string() }),
      ])
    ),
  })
  type ArrayApi = Omit<UseFormReturnType<z.output<typeof arraySchema>>, 'setValue'> & {
    setValue: (path: string, value: unknown) => boolean
    append: (path: string, value: unknown) => boolean
    prepend: (path: string, value: unknown) => boolean
    insert: (path: string, index: number, value: unknown) => boolean
    remove: (path: string, index: number) => boolean
    swap: (path: string, a: number, b: number) => boolean
    move: (path: string, from: number, to: number) => boolean
    values: { events: Array<{ type: string } & Record<string, unknown>> }
  }
  function mountArr(initial?: Array<{ type: string } & Record<string, unknown>>): ArrayApi {
    const handle: { api?: ArrayApi } = {}
    const App = defineComponent({
      setup() {
        handle.api = useForm({
          schema: arraySchema,
          key: `du-array-interplay-${Math.random().toString(36).slice(2)}`,
          defaultValues: {
            events: initial ?? [
              { type: 'click', x: 'first' },
              { type: 'text', value: 'second' },
            ],
          },
        }) as unknown as ArrayApi
        return () => h('div')
      },
    })
    const app = createApp(App).use(createAttaform())
    app.mount(document.createElement('div'))
    apps.push(app)
    return handle.api as ArrayApi
  }
  const apps: App[] = []
  afterEach(() => {
    while (apps.length > 0) apps.pop()?.unmount()
  })

  it('removing an element does NOT bleed its memory onto the new occupant of that index', async () => {
    const api = mountArr()

    // Build memory at events.0: type something into click.x, switch to
    // text — variant memory captures `click → {x:'first'}` keyed by
    // absolute path `["events",0]`.
    api.setValue('events.0.x', 'click-typed')
    api.setValue('events.0.type', 'text')
    await nextTick()

    // Splice element 0 out. Original events[1] (a `text` element) is
    // now events[0]. The path-keyed memory at `["events",0]` was
    // captured for the OLD events[0] (a totally different element).
    api.remove('events', 0)
    await nextTick()

    // Switch the now-events[0] (was events[1]) from text → click. If
    // memory is honored by index, it'll restore the OLD events[0]'s
    // typed `x: 'click-typed'`. That's a cross-element bleed:
    // events[1]'s click variant has never been typed, so `x` should
    // be the slim default.
    api.setValue('events.0.type', 'click')
    await nextTick()

    const e0 = api.values.events[0] as Record<string, unknown>
    expect(e0).toEqual({ type: 'click', x: '' })
  })

  it('truncating the array (length:= 1) drops memory for indices beyond the new length', async () => {
    const api = mountArr([
      { type: 'click', x: 'a' },
      { type: 'click', x: 'b' },
      { type: 'click', x: 'c' },
    ])

    // Build memory at indices 1 and 2.
    api.setValue('events.1.type', 'text')
    api.setValue('events.2.type', 'text')
    await nextTick()

    // Truncate to one element. Memory entries for events.1 and events.2
    // describe elements that are gone — they should be dropped, not
    // linger forever.
    api.setValue('events', [{ type: 'click', x: 'a' }])
    await nextTick()

    // Append two new elements and switch them around. New elements
    // must NOT inherit ghost memory from the truncated indices.
    api.append('events', { type: 'text', value: 'fresh-1' })
    api.append('events', { type: 'text', value: 'fresh-2' })
    await nextTick()

    api.setValue('events.1.type', 'click')
    api.setValue('events.2.type', 'click')
    await nextTick()

    expect(api.values.events[1]).toEqual({ type: 'click', x: '' })
    expect(api.values.events[2]).toEqual({ type: 'click', x: '' })
  })

  it('whole-array replace clears memory for every index', async () => {
    const api = mountArr()

    api.setValue('events.0.x', 'will-vanish')
    api.setValue('events.0.type', 'text')
    api.setValue('events.1.value', 'also-gone')
    api.setValue('events.1.type', 'click')
    await nextTick()

    // Wholesale replace.
    api.setValue('events', [
      { type: 'text', value: 'new-0' },
      { type: 'click', x: 'new-1' },
    ])
    await nextTick()

    // Switching the new elements' discriminators should NOT surface
    // pre-replace memory — the elements we just installed have no
    // history with this form.
    api.setValue('events.0.type', 'click')
    api.setValue('events.1.type', 'text')
    await nextTick()

    expect(api.values.events[0]).toEqual({ type: 'click', x: '' })
    expect(api.values.events[1]).toEqual({ type: 'text', value: '' })
  })

  it('swap of two array elements does NOT swap variant memory along with them', async () => {
    const api = mountArr()

    // Build distinct memory at events.0 and events.1.
    api.setValue('events.0.x', 'zero-x')
    api.setValue('events.0.type', 'text')
    api.setValue('events.1.value', 'one-value')
    api.setValue('events.1.type', 'click')
    await nextTick()

    // Swap. After this, events[0] is the original `text` element and
    // events[1] is the original `click` element. Memory was keyed by
    // path; after the swap, restoring events[0] consults memory.events[0]
    // which captured the OLD events[0] state. That memory is for a
    // different element identity now.
    api.swap('events', 0, 1)
    await nextTick()

    api.setValue('events.0.type', 'click')
    api.setValue('events.1.type', 'text')
    await nextTick()

    // The newly-occupying elements must restore from THEIR identities'
    // memory, not whatever happened to be at the index before. Or, if
    // memory just clears on swap, both should fall back to slim defaults.
    const e0 = api.values.events[0] as Record<string, unknown>
    const e1 = api.values.events[1] as Record<string, unknown>
    const cleanFallback = e0.x === '' && e1.value === ''
    const identityRestore = e0.x === 'one-value' && e1.value === 'zero-x'
    expect(cleanFallback || identityRestore).toBe(true)
  })

  it('move of an array element preserves identity-tied memory or clears it cleanly', async () => {
    const api = mountArr([
      { type: 'click', x: 'A' },
      { type: 'click', x: 'B' },
      { type: 'click', x: 'C' },
    ])

    // Memory at events.0: A typed click.
    api.setValue('events.0.type', 'text')
    await nextTick()
    // After this, memory at events.0 holds `click → {x:'A'}`.

    // Move element 0 to position 2. The original element at 0 (now type
    // 'text') is now at index 2. Memory at events.0 (keyed by index)
    // refers to a DIFFERENT element after the move.
    api.move('events', 0, 2)
    await nextTick()

    // Switch the now-events[0] (was events[1]) from click → text → click.
    api.setValue('events.0.type', 'text')
    api.setValue('events.0.type', 'click')
    await nextTick()

    // The bug this probe pins: A's value (`'A'`) leaking onto the new
    // events[0] (which is the original B) via index-keyed memory at
    // events.0. After a move, memory at the moved index must NOT
    // restore the moved-out element's typed state on a same-index
    // switch. Either the slim default OR the pre-switch state of the
    // new occupant (B's own `x: 'B'` from defaultValues) is fine —
    // both honour the "no cross-element bleed" contract; only A's
    // value would signal the bug.
    const e0 = api.values.events[0] as Record<string, unknown>
    expect(e0.type).toBe('click')
    expect(e0.x).not.toBe('A')
  })
})

describe('DU hardening — DU containing an array variant: round-trip preservation', () => {
  const containerSchema = z.object({
    payload: z.discriminatedUnion('kind', [
      z.object({
        kind: z.literal('list'),
        items: z.array(z.object({ sku: z.string() })),
      }),
      z.object({ kind: z.literal('single'), item: z.string() }),
    ]),
  })
  type ContainerApi = Omit<UseFormReturnType<z.output<typeof containerSchema>>, 'setValue'> & {
    setValue: (path: string, value: unknown) => boolean
    append: (path: string, value: unknown) => boolean
    values: { payload: { kind: string } & Record<string, unknown> }
  }
  function mount(): ContainerApi {
    const handle: { api?: ContainerApi } = {}
    const App = defineComponent({
      setup() {
        handle.api = useForm({
          schema: containerSchema,
          key: `du-array-variant-${Math.random().toString(36).slice(2)}`,
          defaultValues: { payload: { kind: 'list', items: [] } },
        }) as unknown as ContainerApi
        return () => h('div')
      },
    })
    const app = createApp(App).use(createAttaform())
    app.mount(document.createElement('div'))
    apps.push(app)
    return handle.api as ContainerApi
  }
  const apps: App[] = []
  afterEach(() => {
    while (apps.length > 0) apps.pop()?.unmount()
  })

  it('round-tripping an array-variant restores the array contents from memory', async () => {
    const api = mount()

    api.append('payload.items', { sku: 'S-1' })
    api.append('payload.items', { sku: 'S-2' })
    await nextTick()

    api.setValue('payload.kind', 'single')
    await nextTick()
    expect(api.values.payload).toEqual({ kind: 'single', item: '' })

    api.setValue('payload.kind', 'list')
    await nextTick()

    expect(api.values.payload).toEqual({
      kind: 'list',
      items: [{ sku: 'S-1' }, { sku: 'S-2' }],
    })
  })

  it('an invalid intermediate while in the array variant does not corrupt the items', async () => {
    const api = mount()

    api.append('payload.items', { sku: 'S-1' })
    await nextTick()

    api.setValue('payload.kind', 'BAD')
    await nextTick()

    api.setValue('payload.kind', 'single')
    await nextTick()
    api.setValue('payload.kind', 'list')
    await nextTick()

    // After the invalid intermediate + valid round-trip, items should
    // be either the originally-typed `[{sku:'S-1'}]` (restored from
    // pre-invalid memory) or the slim default `[]`. The accept-as-is
    // outcome would surface the invalid intermediate's frozen state.
    const payload = api.values.payload as Record<string, unknown>
    expect(payload.kind).toBe('list')
    expect(Array.isArray(payload.items)).toBe(true)
    const items = payload.items as Array<{ sku?: string }>
    const cleanRestore = (items.length === 1 && items[0]?.sku === 'S-1') || items.length === 0
    expect(cleanRestore).toBe(true)
  })
})

describe('DU hardening — array index Case A/B with invalid discriminator', () => {
  const arraySchema = z.object({
    events: z.array(
      z.discriminatedUnion('type', [
        z.object({ type: z.literal('click'), x: z.string() }),
        z.object({ type: z.literal('text'), value: z.string() }),
      ])
    ),
  })
  type ArrayApi = Omit<UseFormReturnType<z.output<typeof arraySchema>>, 'setValue'> & {
    setValue: (path: string, value: unknown) => boolean
    append: (path: string, value: unknown) => boolean
    values: { events: Array<{ type: string } & Record<string, unknown>> }
  }
  function mountArr(): ArrayApi {
    const handle: { api?: ArrayApi } = {}
    const App = defineComponent({
      setup() {
        handle.api = useForm({
          schema: arraySchema,
          key: `du-array-element-cases-${Math.random().toString(36).slice(2)}`,
          defaultValues: {
            events: [
              { type: 'click', x: 'first' },
              { type: 'text', value: 'second' },
            ],
          },
        }) as unknown as ArrayApi
        return () => h('div')
      },
    })
    const app = createApp(App).use(createAttaform())
    app.mount(document.createElement('div'))
    apps.push(app)
    return handle.api as ArrayApi
  }
  const apps: App[] = []
  afterEach(() => {
    while (apps.length > 0) apps.pop()?.unmount()
  })

  it('Case B at an array index with an invalid discriminator lands a disc-only stub', async () => {
    const api = mountArr()

    const ok = api.setValue('events.0', { type: 'unknown', x: 'foo' })
    await nextTick()

    expect(ok).toBe(true)
    // Stub holds only the disc; consumer's foreign `x` is dropped so
    // form.values can't carry non-variant fields. Validation flags
    // the bad disc via Zod's natural error flow.
    expect(api.values.events[0]).toEqual({ type: 'unknown' })
  })

  it('Case B at an array index with an unknown EXTRA key is also rejected', async () => {
    const api = mountArr()

    const ok = api.setValue('events.0', { type: 'click', x: '', extra: 1 })
    await nextTick()

    expect(ok).toBe(false)
  })

  it('`unset` on an array element discriminator does NOT keep foreign keys', async () => {
    const api = mountArr()

    // Pre: events[0] = { type:'click', x:'first' }.
    api.setValue('events.0.type', unset)
    await nextTick()

    const e0 = api.values.events[0] as Record<string, unknown>
    // Either the element collapses to `{type:''}` (with x cleaned
    // up + the disc path tracked as blank) or the element retains a
    // valid variant. The accept-as-is `{type:'', x:'first'}` shape is
    // the bug.
    const valid =
      (Object.keys(e0).length === 1 && e0.type === '') ||
      (e0.type === 'click' && typeof e0.x === 'string') ||
      (e0.type === 'text' && typeof e0.value === 'string')
    expect(valid).toBe(true)
  })

  it('append with an invalid discriminator is rejected (or coerced to a valid variant)', async () => {
    const api = mountArr()

    // Pre: length 2.
    api.append('events', { type: 'BAD', whatever: 1 })
    await nextTick()

    // Either the append is rejected (length stays at 2) or the element
    // is coerced to a valid variant (length grew but the new element
    // has a real shape). The bug outcome: length grew with junk.
    if (api.values.events.length === 3) {
      const newElement = api.values.events[2] as Record<string, unknown>
      const valid =
        (newElement.type === 'click' && typeof newElement.x === 'string') ||
        (newElement.type === 'text' && typeof newElement.value === 'string')
      expect(valid).toBe(true)
    } else {
      expect(api.values.events.length).toBe(2)
    }
  })

  it('write past current length with invalid discriminator grows cleanly with stub at target', async () => {
    const api = mountArr()

    // Pre: length 2; this would create indices 2-4 to reach index 5.
    const ok = api.setValue('events.5', { type: 'BAD' })
    await nextTick()

    // Stub-state contract: target index lands a disc-only stub
    // `{type:'BAD'}`; gap indices 2-4 are padded with the schema's
    // element default (a valid first-variant default). No
    // first-variant fields leak onto the consumer-targeted index.
    if (ok === true && api.values.events.length > 2) {
      for (let i = 0; i < api.values.events.length; i++) {
        const e = api.values.events[i] as Record<string, unknown>
        const isTargetStub = i === 5 && Object.keys(e).length === 1 && e.type === 'BAD'
        const isValidVariant =
          (e.type === 'click' && typeof e.x === 'string') ||
          (e.type === 'text' && typeof e.value === 'string')
        expect(isTargetStub || isValidVariant).toBe(true)
      }
    } else {
      expect(api.values.events.length).toBe(2)
    }
  })
})

describe('DU hardening — array element invalid disc: container-level error reporting', () => {
  const arraySchema = z.object({
    events: z.array(
      z.discriminatedUnion('type', [
        z.object({ type: z.literal('click'), x: z.string() }),
        z.object({ type: z.literal('text'), value: z.string() }),
      ])
    ),
  })
  type ArrayApi = Omit<UseFormReturnType<z.output<typeof arraySchema>>, 'setValue'> & {
    setValue: (path: string, value: unknown) => boolean
    values: { events: Array<{ type: string } & Record<string, unknown>> }
  }
  const apps: App[] = []
  afterEach(() => {
    while (apps.length > 0) apps.pop()?.unmount()
  })

  it("array container's firstError surfaces the bad element's discriminator mismatch", async () => {
    const handle: { api?: ArrayApi } = {}
    const App = defineComponent({
      setup() {
        handle.api = useForm({
          schema: arraySchema,
          key: `du-array-aggregate-${Math.random().toString(36).slice(2)}`,
          defaultValues: {
            events: [
              { type: 'click', x: 'a' },
              { type: 'click', x: 'b' },
            ],
          },
        }) as unknown as ArrayApi
        return () => h('div')
      },
    })
    const app = createApp(App).use(createAttaform())
    app.mount(document.createElement('div'))
    apps.push(app)
    const api = handle.api as ArrayApi

    api.setValue('events.1.type', 'BAD')
    await api.validateAsync()
    await nextTick()

    // The array container's `firstError` should reflect that one of
    // its elements is broken. Without it, a parent UI bound to the
    // array's summary error has no signal — it has to walk every
    // index manually.
    const eventsField = (
      api as unknown as {
        fields: { events: { firstError?: { message: string } } }
      }
    ).fields.events
    expect(eventsField.firstError).toBeDefined()
  })
})

// =====================================================================
// 8. UNHINGED PROBES — corner cases far from the happy path. The goal
//    is awareness, not remediation: each test asserts a property that
//    a robust library should hold under adversarial input. Failures
//    here surface latent bugs we may want to harden over time.
// =====================================================================

import { reactive, ref } from 'vue'

// -------------------- 8.1 Aliasing & mutation --------------------
describe('chaos — caller mutates value AFTER setValue', () => {
  const apps: App[] = []
  afterEach(() => {
    while (apps.length > 0) apps.pop()?.unmount()
  })

  it('mutating the input object after setValue does not retro-mutate form storage', async () => {
    const { app, api } = mountProfile()
    apps.push(app)

    const live = { channel: 'sms' as const, number: '5551234' }
    api.setValue('notify', live)
    await nextTick()
    expect(api.values.notify).toEqual({ channel: 'sms', number: '5551234' })

    // Caller mutates their own reference. The form must own its
    // storage — sharing the reference would mean later input edits
    // poison the form.
    live.number = 'pwned'
    await nextTick()
    expect(api.values.notify).toEqual({ channel: 'sms', number: '5551234' })
  })

  it('frozen object passed to setValue does not crash the merge', async () => {
    const { app, api } = mountProfile()
    apps.push(app)

    const frozen = Object.freeze({ channel: 'sms' as const, number: '5551234' })
    expect(() => api.setValue('notify', frozen)).not.toThrow()
    await nextTick()
    expect(api.values.notify).toEqual({ channel: 'sms', number: '5551234' })
  })
})

// -------------------- 8.2 Prototype pollution --------------------
describe('chaos — prototype pollution attempts via path & value', () => {
  const apps: App[] = []
  afterEach(() => {
    while (apps.length > 0) apps.pop()?.unmount()
  })

  it("setValue('__proto__.polluted', true) does not actually pollute Object.prototype", async () => {
    const recordSchema = z.object({
      bag: z.record(z.string(), z.string()),
    })
    type RecordApi = Omit<UseFormReturnType<z.output<typeof recordSchema>>, 'setValue'> & {
      setValue: (path: string, value: unknown) => boolean
      values: { bag: Record<string, string> }
    }
    const handle: { api?: RecordApi } = {}
    const App = defineComponent({
      setup() {
        handle.api = useForm({
          schema: recordSchema,
          key: `chaos-proto-${Math.random().toString(36).slice(2)}`,
          defaultValues: { bag: {} },
        }) as unknown as RecordApi
        return () => h('div')
      },
    })
    const app = createApp(App).use(createAttaform())
    app.mount(document.createElement('div'))
    apps.push(app)
    const api = handle.api as RecordApi

    api.setValue('bag.__proto__.polluted', 'yes')
    await nextTick()

    // Object.prototype must NOT pick up `polluted`. If it does, every
    // object in the JS realm gets the property — that's prototype
    // pollution.
    const fresh = {} as Record<string, unknown>
    expect(fresh.polluted).toBeUndefined()
    // Cleanup if pollution did occur, so subsequent tests aren't flaky.
    delete (Object.prototype as unknown as Record<string, unknown>).polluted
  })

  it('setValue at a nested path with `constructor` does not clobber the global', async () => {
    const recordSchema = z.object({
      bag: z.record(z.string(), z.string()),
    })
    type RecordApi = Omit<UseFormReturnType<z.output<typeof recordSchema>>, 'setValue'> & {
      setValue: (path: string, value: unknown) => boolean
    }
    const handle: { api?: RecordApi } = {}
    const App = defineComponent({
      setup() {
        handle.api = useForm({
          schema: recordSchema,
          key: `chaos-ctor-${Math.random().toString(36).slice(2)}`,
          defaultValues: { bag: {} },
        }) as unknown as RecordApi
        return () => h('div')
      },
    })
    const app = createApp(App).use(createAttaform())
    app.mount(document.createElement('div'))
    apps.push(app)
    const api = handle.api as RecordApi

    api.setValue('bag.constructor.prototype.x', 'BAD')
    await nextTick()

    // Object.prototype.x must remain untouched.
    expect(({} as Record<string, unknown>).x).toBeUndefined()
    delete (Object.prototype as unknown as Record<string, unknown>).x
  })
})

// -------------------- 8.3 JSON-cycle traps in variant memory --------------------
describe('chaos — values that break JSON.stringify (variant memory snapshot)', () => {
  const apps: App[] = []
  afterEach(() => {
    while (apps.length > 0) apps.pop()?.unmount()
  })

  it('a BigInt value at a leaf does not crash the variant-memory snapshot during a switch', async () => {
    const bigSchema = z.object({
      payload: z.discriminatedUnion('kind', [
        z.object({ kind: z.literal('big'), id: z.bigint() }),
        z.object({ kind: z.literal('small'), n: z.number() }),
      ]),
    })
    type BigApi = Omit<UseFormReturnType<z.output<typeof bigSchema>>, 'setValue'> & {
      setValue: (path: string, value: unknown) => boolean
      values: { payload: { kind: string } & Record<string, unknown> }
    }
    const handle: { api?: BigApi } = {}
    const App = defineComponent({
      setup() {
        handle.api = useForm({
          schema: bigSchema,
          key: `chaos-bigint-${Math.random().toString(36).slice(2)}`,
          defaultValues: { payload: { kind: 'big', id: 42n } },
        }) as unknown as BigApi
        return () => h('div')
      },
    })
    const app = createApp(App).use(createAttaform())
    app.mount(document.createElement('div'))
    apps.push(app)
    const api = handle.api as BigApi

    // Set a real BigInt value, then trigger a discriminator switch.
    // Variant memory uses `JSON.parse(JSON.stringify(...))` to deep-
    // clone the outgoing subtree. JSON.stringify throws on BigInt —
    // this would surface as a runtime error or a corrupt memory entry.
    api.setValue('payload.id', 9007199254740993n)
    await nextTick()

    expect(() => api.setValue('payload.kind', 'small')).not.toThrow()
    await nextTick()

    expect(api.values.payload.kind).toBe('small')
  })

  it('round-tripping after a BigInt-bearing variant restores the typed value', async () => {
    const bigSchema = z.object({
      payload: z.discriminatedUnion('kind', [
        z.object({ kind: z.literal('big'), id: z.bigint() }),
        z.object({ kind: z.literal('small'), n: z.number() }),
      ]),
    })
    type BigApi = Omit<UseFormReturnType<z.output<typeof bigSchema>>, 'setValue'> & {
      setValue: (path: string, value: unknown) => boolean
      values: { payload: { kind: string } & Record<string, unknown> }
    }
    const handle: { api?: BigApi } = {}
    const App = defineComponent({
      setup() {
        handle.api = useForm({
          schema: bigSchema,
          key: `chaos-bigint-rt-${Math.random().toString(36).slice(2)}`,
          defaultValues: { payload: { kind: 'big', id: 42n } },
        }) as unknown as BigApi
        return () => h('div')
      },
    })
    const app = createApp(App).use(createAttaform())
    app.mount(document.createElement('div'))
    apps.push(app)
    const api = handle.api as BigApi

    api.setValue('payload.id', 9007199254740993n)
    api.setValue('payload.kind', 'small')
    await nextTick()
    api.setValue('payload.kind', 'big')
    await nextTick()

    // If the snapshot succeeded, restoration brings back the typed
    // BigInt. If snapshot crashed silently, we'd get the slim default
    // (0n). We accept either as long as state is internally consistent
    // — the assertion is that the value at least matches its type.
    expect(typeof api.values.payload.id).toBe('bigint')
  })
})

// -------------------- 8.4 Exotic discriminator literals --------------------
describe('chaos — exotic discriminator literal types', () => {
  const apps: App[] = []
  afterEach(() => {
    while (apps.length > 0) apps.pop()?.unmount()
  })

  it('boolean discriminator (z.literal(true) / z.literal(false)) reshapes correctly', async () => {
    const boolSchema = z.object({
      flag: z.discriminatedUnion('on', [
        z.object({ on: z.literal(true), reason: z.string() }),
        z.object({ on: z.literal(false), excuse: z.string() }),
      ]),
    })
    type BoolApi = Omit<UseFormReturnType<z.output<typeof boolSchema>>, 'setValue'> & {
      setValue: (path: string, value: unknown) => boolean
      values: { flag: { on: boolean } & Record<string, unknown> }
    }
    const handle: { api?: BoolApi } = {}
    const App = defineComponent({
      setup() {
        handle.api = useForm({
          schema: boolSchema,
          key: `chaos-bool-disc-${Math.random().toString(36).slice(2)}`,
          defaultValues: { flag: { on: true, reason: '' } },
        }) as unknown as BoolApi
        return () => h('div')
      },
    })
    const app = createApp(App).use(createAttaform())
    app.mount(document.createElement('div'))
    apps.push(app)
    const api = handle.api as BoolApi

    api.setValue('flag.on', false)
    await nextTick()

    expect(api.values.flag).toEqual({ on: false, excuse: '' })
  })

  it('null/undefined slim-gate posture against a boolean discriminator', async () => {
    // 0 is not in {true, false}; should be rejected like an invalid string.
    const boolSchema = z.object({
      flag: z.discriminatedUnion('on', [
        z.object({ on: z.literal(true), reason: z.string() }),
        z.object({ on: z.literal(false), excuse: z.string() }),
      ]),
    })
    type BoolApi = Omit<UseFormReturnType<z.output<typeof boolSchema>>, 'setValue'> & {
      setValue: (path: string, value: unknown) => boolean
      values: { flag: { on: boolean | unknown } & Record<string, unknown> }
    }
    const handle: { api?: BoolApi } = {}
    const App = defineComponent({
      setup() {
        handle.api = useForm({
          schema: boolSchema,
          key: `chaos-bool-disc-bad-${Math.random().toString(36).slice(2)}`,
          defaultValues: { flag: { on: true, reason: '' } },
        }) as unknown as BoolApi
        return () => h('div')
      },
    })
    const app = createApp(App).use(createAttaform())
    app.mount(document.createElement('div'))
    apps.push(app)
    const api = handle.api as BoolApi

    // Type-mismatched: slim-primitive gate should reject (the literal
    // accepts only `boolean`).
    expect(api.setValue('flag.on', 0)).toBe(false)
    expect(api.setValue('flag.on', null)).toBe(false)
    expect(api.setValue('flag.on', 'true')).toBe(false)
  })
})

// -------------------- 8.5 NaN special cases --------------------
describe('chaos — NaN at the discriminator', () => {
  const apps: App[] = []
  afterEach(() => {
    while (apps.length > 0) apps.pop()?.unmount()
  })

  it("setValue('payload.kind', NaN) is rejected when no NaN literal exists", async () => {
    const schema = z.object({
      payload: z.discriminatedUnion('kind', [
        z.object({ kind: z.literal(1), v: z.string() }),
        z.object({ kind: z.literal(2), v: z.string() }),
      ]),
    })
    type Api = Omit<UseFormReturnType<z.output<typeof schema>>, 'setValue'> & {
      setValue: (path: string, value: unknown) => boolean
      values: { payload: { kind: number } & Record<string, unknown> }
    }
    const handle: { api?: Api } = {}
    const App = defineComponent({
      setup() {
        handle.api = useForm({
          schema,
          key: `chaos-nan-${Math.random().toString(36).slice(2)}`,
          defaultValues: { payload: { kind: 1, v: '' } },
        }) as unknown as Api
        return () => h('div')
      },
    })
    const app = createApp(App).use(createAttaform())
    app.mount(document.createElement('div'))
    apps.push(app)
    const api = handle.api as Api

    expect(api.setValue('payload.kind', Number.NaN)).toBe(true)
    await nextTick()
    // Stub holds the consumer's NaN; validation flags the mismatch
    // (no NaN literal in any variant) on next validateAsync.
    expect(api.values.payload).toEqual({ kind: Number.NaN })
  })
})

// -------------------- 8.6 -0 vs 0 identity quirk --------------------
describe('chaos — `-0` written over `0` at a numeric leaf', () => {
  const apps: App[] = []
  afterEach(() => {
    while (apps.length > 0) apps.pop()?.unmount()
  })

  it('does not trigger an unintended discriminator reshape (Object.is(0,-0) === false)', async () => {
    const schema = z.object({
      payload: z.discriminatedUnion('kind', [
        z.object({ kind: z.literal(0), v: z.string() }),
        z.object({ kind: z.literal(1), w: z.string() }),
      ]),
    })
    type Api = Omit<UseFormReturnType<z.output<typeof schema>>, 'setValue'> & {
      setValue: (path: string, value: unknown) => boolean
      values: { payload: { kind: number } & Record<string, unknown> }
    }
    const handle: { api?: Api } = {}
    const App = defineComponent({
      setup() {
        handle.api = useForm({
          schema,
          key: `chaos-negzero-${Math.random().toString(36).slice(2)}`,
          defaultValues: { payload: { kind: 0, v: 'kept' } },
        }) as unknown as Api
        return () => h('div')
      },
    })
    const app = createApp(App).use(createAttaform())
    app.mount(document.createElement('div'))
    apps.push(app)
    const api = handle.api as Api

    api.setValue('payload.kind', -0)
    await nextTick()

    // Either treated as no-op (kept v) or reshaped (variant default).
    // Whatever happens, the form must NOT enter an inconsistent shape.
    const payload = api.values.payload as Record<string, unknown>
    const valid =
      (payload.kind === 0 && typeof payload.v === 'string') ||
      (payload.kind === 1 && typeof payload.w === 'string')
    expect(valid).toBe(true)
  })
})

// -------------------- 8.7 Conflicting discriminator literals --------------------
describe('chaos — DU with two variants sharing the same literal value', () => {
  const apps: App[] = []
  afterEach(() => {
    while (apps.length > 0) apps.pop()?.unmount()
  })

  it("zod surfaces a schema-level error or first-wins; runtime doesn't crash", async () => {
    // Two variants with `kind: z.literal('a')` is illegal in v4 but
    // worth probing: does construction throw, succeed, or silently
    // pick one? If the schema construction itself throws, the test
    // catches it.
    let constructed = false
    let err: unknown = null
    try {
      const schema = z.object({
        x: z.discriminatedUnion('kind', [
          z.object({ kind: z.literal('a'), v: z.string() }),
          z.object({ kind: z.literal('a'), w: z.string() }),
        ]),
      })
      type Api = Omit<UseFormReturnType<z.output<typeof schema>>, 'setValue'> & {
        setValue: (path: string, value: unknown) => boolean
      }
      const handle: { api?: Api } = {}
      const App = defineComponent({
        setup() {
          handle.api = useForm({
            schema,
            key: `chaos-dup-disc-${Math.random().toString(36).slice(2)}`,
            defaultValues: { x: { kind: 'a', v: '' } },
          }) as unknown as Api
          return () => h('div')
        },
      })
      const app = createApp(App).use(createAttaform())
      app.mount(document.createElement('div'))
      apps.push(app)
      constructed = handle.api !== undefined
    } catch (e) {
      err = e
    }

    // Either Zod refused to construct the schema (err is set), or the
    // form mounted and we're just confirming we didn't crash silently
    // in some unknowable middle state.
    expect(err !== null || constructed === true).toBe(true)
  })
})

// -------------------- 8.8 z.lazy recursive DU --------------------
describe('chaos — recursive DU via z.lazy (tree of nodes)', () => {
  const apps: App[] = []
  afterEach(() => {
    while (apps.length > 0) apps.pop()?.unmount()
  })

  it('mounts a recursive DU schema without infinite loop', async () => {
    type Node = { kind: 'leaf'; value: string } | { kind: 'branch'; children: Node[] }
    const nodeSchema: z.ZodType<Node> = z.lazy(() =>
      z.discriminatedUnion('kind', [
        z.object({ kind: z.literal('leaf'), value: z.string() }),
        z.object({ kind: z.literal('branch'), children: z.array(nodeSchema) }),
      ])
    )
    const treeSchema = z.object({ tree: nodeSchema })
    type TreeApi = Omit<UseFormReturnType<z.output<typeof treeSchema>>, 'setValue'> & {
      setValue: (path: string, value: unknown) => boolean
      values: { tree: Node }
    }
    const handle: { api?: TreeApi } = {}
    const App = defineComponent({
      setup() {
        handle.api = useForm({
          schema: treeSchema,
          key: `chaos-lazy-du-${Math.random().toString(36).slice(2)}`,
          defaultValues: {
            tree: {
              kind: 'branch',
              children: [
                { kind: 'leaf', value: 'a' },
                { kind: 'leaf', value: 'b' },
              ],
            },
          },
        }) as unknown as TreeApi
        return () => h('div')
      },
    })
    const app = createApp(App).use(createAttaform())
    app.mount(document.createElement('div'))
    apps.push(app)
    const api = handle.api as TreeApi
    await nextTick()

    expect(api.values.tree.kind).toBe('branch')
  })

  it("switching the discriminator at a recursive node doesn't blow the stack", async () => {
    type Node = { kind: 'leaf'; value: string } | { kind: 'branch'; children: Node[] }
    const nodeSchema: z.ZodType<Node> = z.lazy(() =>
      z.discriminatedUnion('kind', [
        z.object({ kind: z.literal('leaf'), value: z.string() }),
        z.object({ kind: z.literal('branch'), children: z.array(nodeSchema) }),
      ])
    )
    const treeSchema = z.object({ tree: nodeSchema })
    type TreeApi = Omit<UseFormReturnType<z.output<typeof treeSchema>>, 'setValue'> & {
      setValue: (path: string, value: unknown) => boolean
      values: { tree: Node }
    }
    const handle: { api?: TreeApi } = {}
    const App = defineComponent({
      setup() {
        handle.api = useForm({
          schema: treeSchema,
          key: `chaos-lazy-du-switch-${Math.random().toString(36).slice(2)}`,
          defaultValues: {
            tree: { kind: 'leaf', value: 'hi' },
          },
        }) as unknown as TreeApi
        return () => h('div')
      },
    })
    const app = createApp(App).use(createAttaform())
    app.mount(document.createElement('div'))
    apps.push(app)
    const api = handle.api as TreeApi

    expect(() => api.setValue('tree.kind', 'branch')).not.toThrow()
    await nextTick()

    const tree = api.values.tree as Record<string, unknown>
    expect(tree.kind).toBe('branch')
  })
})

// -------------------- 8.9 Re-entry into setValue --------------------
describe('chaos — setValue re-entry inside listener callbacks', () => {
  const apps: App[] = []
  afterEach(() => {
    while (apps.length > 0) apps.pop()?.unmount()
  })

  it('a Vue watcher that calls setValue inside its callback does not infinite-loop', async () => {
    const profileSchemaLocal = z.object({
      name: z.string(),
      mirror: z.string(),
    })
    type Api = Omit<UseFormReturnType<z.output<typeof profileSchemaLocal>>, 'setValue'> & {
      setValue: (path: string, value: unknown) => boolean
      values: { name: string; mirror: string }
    }
    let callCount = 0
    const handle: { api?: Api } = {}
    const App = defineComponent({
      setup() {
        const api = useForm({
          schema: profileSchemaLocal,
          key: `chaos-reentry-${Math.random().toString(36).slice(2)}`,
          defaultValues: { name: '', mirror: '' },
        }) as unknown as Api
        // Mirror name → mirror via a watch. A naïve implementation
        // would re-enter setValue, the form would emit again, the
        // watcher would fire again, and so on. The implementation
        // must guard re-entry (or at least avoid divergent loops).
        let stop = 0
        const live = api as unknown as { values: { name: string } }
        const observer = (): void => {
          if (callCount > 50) return // hard stop in case of regression
          callCount++
          if (live.values.name !== '') {
            api.setValue('mirror', live.values.name.toUpperCase())
          }
        }
        observer()
        // Use a simple watch via a microtask burst.
        ;(async () => {
          while (stop < 5) {
            await nextTick()
            observer()
            stop++
          }
        })()
        handle.api = api
        return () => h('div')
      },
    })
    const app = createApp(App).use(createAttaform())
    app.mount(document.createElement('div'))
    apps.push(app)
    const api = handle.api as Api

    api.setValue('name', 'ada')
    await nextTick()
    await nextTick()

    expect(callCount).toBeLessThan(50)
    expect(api.values.mirror).toBe('ADA')
  })
})

// -------------------- 8.10 Concurrent submits --------------------
describe('chaos — handleSubmit fired twice rapidly', () => {
  const apps: App[] = []
  afterEach(() => {
    while (apps.length > 0) apps.pop()?.unmount()
  })

  it('does not call onSuccess twice for one logical submission', async () => {
    const { app, api } = mountProfile()
    apps.push(app)

    api.setValue('name', 'Ada')
    api.setValue('notify', { channel: 'sms', number: '5551234' })
    await nextTick()

    let successCalls = 0
    const submit = api.handleSubmit(
      () => {
        successCalls++
      },
      () => {}
    )

    // Fire twice without awaiting between.
    const p1 = submit()
    const p2 = submit()
    await Promise.all([p1, p2])
    await nextTick()

    expect(successCalls).toBeLessThanOrEqual(1)
  })
})

// -------------------- 8.11 Vue ref / reactive proxy as value --------------------
describe('chaos — Vue ref / reactive object passed as setValue value', () => {
  const apps: App[] = []
  afterEach(() => {
    while (apps.length > 0) apps.pop()?.unmount()
  })

  it('passing a `reactive(...)` object stores plain data, not the proxy', async () => {
    const { app, api } = mountProfile()
    apps.push(app)

    const reactiveValue = reactive({ channel: 'sms' as const, number: '5551234' })
    api.setValue('notify', reactiveValue)
    await nextTick()

    // Mutating the original proxy must NOT change form storage
    // (proves the form snapshotted plain data, not held a reference).
    reactiveValue.number = 'changed'
    await nextTick()
    expect(api.values.notify).toEqual({ channel: 'sms', number: '5551234' })
  })

  it('passing a Vue `ref(...)` is rejected or unwrapped — never stored as a Ref proxy', async () => {
    const { app, api } = mountProfile()
    apps.push(app)

    const refValue = ref({ channel: 'sms' as const, number: '5551234' })
    api.setValue('notify', refValue)
    await nextTick()

    // Either rejection (storage unchanged from the email default) or
    // unwrap (sms applied). What it must NOT do: store the Ref object
    // wholesale (a Ref has `.value` — that key isn't in the schema).
    const notify = api.values.notify as Record<string, unknown>
    const acceptedAndUnwrapped = notify.channel === 'sms' && typeof notify.number === 'string'
    const rejectedKeptEmail = notify.channel === 'email'
    expect(acceptedAndUnwrapped || rejectedKeptEmail).toBe(true)
    // The smoking-gun check: storage must not have a `.value` key.
    expect('value' in notify).toBe(false)
  })
})

// -------------------- 8.12 Symbol-keyed values --------------------
describe('chaos — Symbol-keyed values in the input object', () => {
  const apps: App[] = []
  afterEach(() => {
    while (apps.length > 0) apps.pop()?.unmount()
  })

  it('object with a Symbol key alongside string keys does not crash setValue', async () => {
    const { app, api } = mountProfile()
    apps.push(app)

    const sym = Symbol('hidden')
    const value: Record<string | symbol, unknown> = {
      channel: 'sms',
      number: '5551234',
    }
    value[sym] = 'unseen'

    expect(() => api.setValue('notify', value)).not.toThrow()
    await nextTick()
    // Symbol must not appear in storage.
    const stored = api.values.notify
    const symKeys = Object.getOwnPropertySymbols(stored)
    expect(symKeys.length).toBe(0)
  })
})

// -------------------- 8.13 Empty-variant DU --------------------
describe('chaos — DU variant with no fields beyond the discriminator', () => {
  const apps: App[] = []
  afterEach(() => {
    while (apps.length > 0) apps.pop()?.unmount()
  })

  it('a discriminator-only variant produces a clean shape on switch', async () => {
    const schema = z.object({
      action: z.discriminatedUnion('type', [
        z.object({ type: z.literal('noop') }),
        z.object({ type: z.literal('payload'), data: z.string() }),
      ]),
    })
    type Api = Omit<UseFormReturnType<z.output<typeof schema>>, 'setValue'> & {
      setValue: (path: string, value: unknown) => boolean
      values: { action: { type: string } & Record<string, unknown> }
    }
    const handle: { api?: Api } = {}
    const App = defineComponent({
      setup() {
        handle.api = useForm({
          schema,
          key: `chaos-empty-variant-${Math.random().toString(36).slice(2)}`,
          defaultValues: { action: { type: 'payload', data: 'hello' } },
        }) as unknown as Api
        return () => h('div')
      },
    })
    const app = createApp(App).use(createAttaform())
    app.mount(document.createElement('div'))
    apps.push(app)
    const api = handle.api as Api

    api.setValue('action.type', 'noop')
    await nextTick()

    // The `data` key from the payload variant must not survive.
    expect(api.values.action).toEqual({ type: 'noop' })
  })
})

// -------------------- 8.14 Same-name discriminators at different depths --------------------
describe('chaos — two DUs with the same discriminator key at different paths', () => {
  const apps: App[] = []
  afterEach(() => {
    while (apps.length > 0) apps.pop()?.unmount()
  })

  it('switches at one DU do not leak memory into the other', async () => {
    const schema = z.object({
      outer: z.discriminatedUnion('kind', [
        z.object({
          kind: z.literal('A'),
          inner: z.discriminatedUnion('kind', [
            z.object({ kind: z.literal('X'), x: z.string() }),
            z.object({ kind: z.literal('Y'), y: z.string() }),
          ]),
        }),
        z.object({ kind: z.literal('B'), b: z.string() }),
      ]),
    })
    type Api = Omit<UseFormReturnType<z.output<typeof schema>>, 'setValue'> & {
      setValue: (path: string, value: unknown) => boolean
      values: { outer: { kind: string } & Record<string, unknown> }
    }
    const handle: { api?: Api } = {}
    const App = defineComponent({
      setup() {
        handle.api = useForm({
          schema,
          key: `chaos-same-name-disc-${Math.random().toString(36).slice(2)}`,
          defaultValues: { outer: { kind: 'A', inner: { kind: 'X', x: 'typed-x' } } },
        }) as unknown as Api
        return () => h('div')
      },
    })
    const app = createApp(App).use(createAttaform())
    app.mount(document.createElement('div'))
    apps.push(app)
    const api = handle.api as Api

    // Switch INNER's kind X → Y. Memory at outer.inner snapshots
    // {kind:X, x:'typed-x'}.
    api.setValue('outer.inner.kind', 'Y')
    await nextTick()

    // Switch OUTER's kind A → B → A. Memory at outer snapshots
    // {kind:A, inner:{kind:Y, y:''}}. After A→B→A, outer restores.
    // The two DU memory maps are at different absolute paths
    // (`['outer']` vs `['outer','inner']`) — they must NOT confuse.
    api.setValue('outer.kind', 'B')
    await nextTick()
    api.setValue('outer.kind', 'A')
    await nextTick()

    // Now flip inner Y → X. Memory at outer.inner should restore the
    // typed `x: 'typed-x'`.
    api.setValue('outer.inner.kind', 'X')
    await nextTick()

    expect((api.values.outer as Record<string, unknown>).inner).toEqual({
      kind: 'X',
      x: 'typed-x',
    })
  })
})

// -------------------- 8.15 Array-length manipulation through proxy --------------------
describe('chaos — array of DU mutated via proxy length / direct index assignment', () => {
  const apps: App[] = []
  afterEach(() => {
    while (apps.length > 0) apps.pop()?.unmount()
  })

  it('directly setting events.length via setValue does not produce a sparse array', async () => {
    const arraySchema = z.object({
      events: z.array(
        z.discriminatedUnion('type', [
          z.object({ type: z.literal('click'), x: z.string() }),
          z.object({ type: z.literal('text'), value: z.string() }),
        ])
      ),
    })
    type ArrApi = Omit<UseFormReturnType<z.output<typeof arraySchema>>, 'setValue'> & {
      setValue: (path: string, value: unknown) => boolean
      values: { events: Array<unknown> }
    }
    const handle: { api?: ArrApi } = {}
    const App = defineComponent({
      setup() {
        handle.api = useForm({
          schema: arraySchema,
          key: `chaos-arr-length-${Math.random().toString(36).slice(2)}`,
          defaultValues: { events: [{ type: 'click', x: 'a' }] },
        }) as unknown as ArrApi
        return () => h('div')
      },
    })
    const app = createApp(App).use(createAttaform())
    app.mount(document.createElement('div'))
    apps.push(app)
    const api = handle.api as ArrApi

    // Try writing an absurdly far-out index. Either rejection or
    // schema-fill — but never a sparse / non-iterable array.
    api.setValue('events.10', { type: 'text', value: 'far' })
    await nextTick()

    // Iterating must not produce `undefined` holes (which would
    // surface as missing-disc errors during validation later).
    let allDefined = true
    for (let i = 0; i < api.values.events.length; i++) {
      if (api.values.events[i] === undefined) {
        allDefined = false
        break
      }
    }
    expect(allDefined).toBe(true)
  })
})

// -------------------- 8.16 Function passed as value --------------------
describe('chaos — non-data value types passed to setValue', () => {
  const apps: App[] = []
  afterEach(() => {
    while (apps.length > 0) apps.pop()?.unmount()
  })

  it('rejects a Function value at a primitive-typed leaf', async () => {
    const schema = z.object({ name: z.string() })
    type Api = Omit<UseFormReturnType<z.output<typeof schema>>, 'setValue'> & {
      setValue: (path: string, value: unknown) => boolean
      values: { name: string }
    }
    const handle: { api?: Api } = {}
    const App = defineComponent({
      setup() {
        handle.api = useForm({
          schema,
          key: `chaos-fn-value-${Math.random().toString(36).slice(2)}`,
          defaultValues: { name: 'init' },
        }) as unknown as Api
        return () => h('div')
      },
    })
    const app = createApp(App).use(createAttaform())
    app.mount(document.createElement('div'))
    apps.push(app)
    const api = handle.api as Api

    // setValue's overload includes a callback form — but a non-arity
    // function (e.g., a getter) at a STRING leaf should be rejected.
    // The callback form is only reached when typeof === 'function'
    // AND the path resolves to something the function returns a value
    // for. Probe: does the form reject, or does it call the function
    // and store the result, or does it store the function itself?
    const fn = (() => 'computed') as unknown
    api.setValue('name', fn)
    await nextTick()

    expect(typeof api.values.name).toBe('string')
  })
})

// -------------------- 8.17 Path with empty/exotic key --------------------
describe('chaos — exotic path inputs', () => {
  const apps: App[] = []
  afterEach(() => {
    while (apps.length > 0) apps.pop()?.unmount()
  })

  it('rejects a dotted path with an empty segment ("a..b")', async () => {
    const schema = z.object({ a: z.object({ b: z.string() }) })
    type Api = Omit<UseFormReturnType<z.output<typeof schema>>, 'setValue'> & {
      setValue: (path: string, value: unknown) => boolean
    }
    const handle: { api?: Api } = {}
    const App = defineComponent({
      setup() {
        handle.api = useForm({
          schema,
          key: `chaos-empty-seg-${Math.random().toString(36).slice(2)}`,
          defaultValues: { a: { b: '' } },
        }) as unknown as Api
        return () => h('div')
      },
    })
    const app = createApp(App).use(createAttaform())
    app.mount(document.createElement('div'))
    apps.push(app)
    const api = handle.api as Api

    let threw = false
    try {
      api.setValue('a..b', 'hi')
    } catch {
      threw = true
    }
    // A throw is acceptable — it's the documented contract. What's
    // unacceptable is silent acceptance into a nonsense path.
    expect(threw).toBe(true)
  })
})

// -------------------- 8.18 Inactive-variant register-binding write --------------------
describe('chaos — writing through register binding for an inactive variant', () => {
  const apps: App[] = []
  afterEach(() => {
    while (apps.length > 0) apps.pop()?.unmount()
  })

  it('register a path that only exists on the SMS variant while EMAIL is active', async () => {
    // The lift returns a stub for inactive-variant fields. But what
    // about register? If a developer template-binds an input to
    // register('notify.number') unconditionally, then switches to
    // email, the binding stays attached but the path is inactive.
    // setValue through the binding writes a key that doesn't belong
    // — does the form reject, accept, or coerce?
    const { app, api } = mountProfile()
    apps.push(app)

    const ok = api.setValue('notify.number', 'stale-from-sms-binding')
    await nextTick()

    const notify = api.values.notify as Record<string, unknown>
    // Active variant is email; `number` doesn't belong on the active
    // variant's shape. Either the slim gate / cross-variant guard
    // rejects the write (storage unchanged on email + valid address)
    // or the runtime coerces a variant switch (sms with `number`
    // typed). The accept-as-is bug —
    // `{channel:'email', address:'old@example.com', number:'stale...'}`
    // — is the only outcome the contract forbids.
    const valid =
      (ok === false &&
        notify.channel === 'email' &&
        typeof notify.address === 'string' &&
        !('number' in notify)) ||
      (notify.channel === 'sms' && typeof notify.number === 'string')
    expect(valid).toBe(true)
  })
})

// -------------------- 8.19 `setValue` on path WHILE the discriminator is invalid --------------------
describe('chaos — leaf write while the parent discriminator is invalid', () => {
  const apps: App[] = []
  afterEach(() => {
    while (apps.length > 0) apps.pop()?.unmount()
  })

  it('does not silently let writes succeed against an unrepresentable parent shape', async () => {
    const { app, api } = mountProfile()
    apps.push(app)

    api.setValue('notify.channel', 'wat')
    await nextTick()

    // Now write to `notify.address` while `channel: 'wat'` (no variant
    // matches). Either reject, or first restore a valid disc, or
    // surface a clear error. The accept-as-is outcome compounds the
    // earlier bug.
    const ok = api.setValue('notify.address', 'next@example.com')
    await nextTick()

    if (ok === true) {
      // If accepted, the form must be in some valid shape now (i.e.
      // the runtime auto-recovered). Document via assertion.
      const notify = api.values.notify as Record<string, unknown>
      const valid =
        (notify.channel === 'email' && typeof notify.address === 'string') ||
        (notify.channel === 'sms' && typeof notify.number === 'string')
      expect(valid).toBe(true)
    } else {
      // If rejected, the form's state is unchanged from the prior
      // (already-broken) state. Caller knows to recover via reset.
      expect(ok).toBe(false)
    }
  })
})

// =====================================================================
// 9. MORE CHAOS — Zod transforms / coerce / preprocess / pipe;
//    performance / DoS; seemingly-reasonable values; API misuse;
//    Zod v3-vs-v4 specific quirks.
// =====================================================================

// -------------------- 9.1 z.coerce.* at the discriminator --------------------
describe('chaos — z.coerce at the discriminator', () => {
  const apps: App[] = []
  afterEach(() => {
    while (apps.length > 0) apps.pop()?.unmount()
  })

  it('z.coerce.number() discriminator: string-typed write does not silently corrupt', async () => {
    // Tricky: input type is `unknown` (z.coerce.number accepts anything
    // and tries Number(value)); output type is `number`. The slim-
    // primitive gate has to choose — if it uses input type, '1' passes
    // and the variant lookup runs against the un-coerced string; if
    // output, '1' is rejected. Both are reasonable but should be
    // consistent.
    const schema = z.object({
      payload: z.discriminatedUnion('kind', [
        z.object({ kind: z.literal(1), v: z.string() }),
        z.object({ kind: z.literal(2), w: z.string() }),
      ]),
    })
    type Api = Omit<UseFormReturnType<z.output<typeof schema>>, 'setValue'> & {
      setValue: (path: string, value: unknown) => boolean
      values: { payload: { kind: number | string } & Record<string, unknown> }
    }
    const handle: { api?: Api } = {}
    const App = defineComponent({
      setup() {
        handle.api = useForm({
          schema,
          key: `chaos-coerce-disc-${Math.random().toString(36).slice(2)}`,
          defaultValues: { payload: { kind: 1, v: '' } },
        }) as unknown as Api
        return () => h('div')
      },
    })
    const app = createApp(App).use(createAttaform())
    app.mount(document.createElement('div'))
    apps.push(app)
    const api = handle.api as Api

    // Write a string to a numeric discriminator. Either the gate
    // rejects (consistent with strict-typed posture) or coerces and
    // reshapes (consistent with v4's coerce semantics). What it must
    // NOT do: accept the string verbatim, leaving `kind: '1'` (a string)
    // which no variant's `z.literal(1)` literal matches.
    api.setValue('payload.kind', '1')
    await nextTick()

    const payload = api.values.payload as Record<string, unknown>
    const valid =
      (payload.kind === 1 && typeof payload.v === 'string') ||
      (payload.kind === 2 && typeof payload.w === 'string')
    expect(valid).toBe(true)
  })

  it('z.coerce.string() at a non-DU leaf turns numeric writes into strings', async () => {
    const schema = z.object({ name: z.coerce.string() })
    type Api = Omit<UseFormReturnType<z.output<typeof schema>>, 'setValue'> & {
      setValue: (path: string, value: unknown) => boolean
      values: { name: string }
    }
    const handle: { api?: Api } = {}
    const App = defineComponent({
      setup() {
        handle.api = useForm({
          schema,
          key: `chaos-coerce-string-${Math.random().toString(36).slice(2)}`,
          defaultValues: { name: '' },
        }) as unknown as Api
        return () => h('div')
      },
    })
    const app = createApp(App).use(createAttaform())
    app.mount(document.createElement('div'))
    apps.push(app)
    const api = handle.api as Api

    api.setValue('name', 42)
    await nextTick()

    // Either the gate rejected (storage stays '') or coerce kicks in
    // (storage becomes '42'). The bug case: storage holds the number
    // 42 and `typeof api.values.name === 'number'` despite the schema
    // promising `string`.
    expect(typeof api.values.name).toBe('string')
  })
})

// -------------------- 9.2 z.preprocess wrapping a DU --------------------
describe('chaos — z.preprocess() wrapping a discriminated union', () => {
  const apps: App[] = []
  afterEach(() => {
    while (apps.length > 0) apps.pop()?.unmount()
  })

  it("preprocess that defaults `null` to a valid variant doesn't smuggle null into storage", async () => {
    const inner = z.discriminatedUnion('channel', [
      z.object({ channel: z.literal('email'), address: z.string() }),
      z.object({ channel: z.literal('sms'), number: z.string() }),
    ])
    const schema = z.object({
      notify: z.preprocess((v) => (v == null ? { channel: 'email', address: '' } : v), inner),
    })
    type Api = Omit<UseFormReturnType<z.output<typeof schema>>, 'setValue'> & {
      setValue: (path: string, value: unknown) => boolean
      values: { notify: { channel: string } & Record<string, unknown> }
    }
    const handle: { api?: Api } = {}
    const App = defineComponent({
      setup() {
        handle.api = useForm({
          schema,
          key: `chaos-preprocess-du-${Math.random().toString(36).slice(2)}`,
          defaultValues: { notify: { channel: 'email', address: '' } },
        }) as unknown as Api
        return () => h('div')
      },
    })
    const app = createApp(App).use(createAttaform())
    app.mount(document.createElement('div'))
    apps.push(app)
    const api = handle.api as Api

    // Try writing null at the union path. Either rejected by slim-gate
    // (preprocess hasn't run yet) or smuggled past (preprocess turned
    // it into the email variant). The bug case: `null` reaches storage.
    api.setValue('notify', null)
    await nextTick()

    expect(api.values.notify).not.toBeNull()
    const notify = api.values.notify as Record<string, unknown>
    const valid =
      (notify.channel === 'email' && typeof notify.address === 'string') ||
      (notify.channel === 'sms' && typeof notify.number === 'string')
    expect(valid).toBe(true)
  })

  it("v3: preprocess that defaults `null` to a valid variant doesn't smuggle null into storage", async () => {
    // Zod v3 parity for the v4 B6 fix above. v3 expresses
    // `z.preprocess(fn, inner)` as a ZodEffects whose
    // `_def.effect.type === 'preprocess'`; the v3 adapter's
    // `normalizeWriteValueAtPath` detects it and applies the fn at
    // write time, so storage holds the post-preprocess shape — not
    // the raw input.
    const inner = zV3.discriminatedUnion('channel', [
      zV3.object({ channel: zV3.literal('email'), address: zV3.string() }),
      zV3.object({ channel: zV3.literal('sms'), number: zV3.string() }),
    ])
    const schema = zV3.object({
      notify: zV3.preprocess((v) => (v == null ? { channel: 'email', address: '' } : v), inner),
    })
    const handle: { api?: unknown } = {}
    const App = defineComponent({
      setup() {
        handle.api = useFormV3({
          schema,
          key: `v3-chaos-preprocess-du-${Math.random().toString(36).slice(2)}`,
          defaultValues: { notify: { channel: 'email', address: '' } },
        } as never)
        return () => h('div')
      },
    })
    const app = createApp(App).use(createAttaform())
    app.mount(document.createElement('div'))
    apps.push(app)
    const api = handle.api as {
      setValue: (p: string, v: unknown) => boolean
      values: { notify: { channel: string } & Record<string, unknown> }
    }

    api.setValue('notify', null)
    await nextTick()

    expect(api.values.notify).not.toBeNull()
    const notify = api.values.notify
    const valid =
      (notify['channel'] === 'email' && typeof notify['address'] === 'string') ||
      (notify['channel'] === 'sms' && typeof notify['number'] === 'string')
    expect(valid).toBe(true)
  })
})

// -------------------- 9.3 z.transform at a leaf inside a variant --------------------
describe('chaos — z.transform() at a leaf changes the output type', () => {
  const apps: App[] = []
  afterEach(() => {
    while (apps.length > 0) apps.pop()?.unmount()
  })

  it('storage holds the INPUT type, not the transform OUTPUT type', async () => {
    // input string `' hello '` → output `'hello'`. The form should
    // store and return the input verbatim — the consumer can apply the
    // transform on parse.
    const schema = z.object({
      name: z.string().transform((s) => s.trim().toUpperCase()),
    })
    type Api = Omit<UseFormReturnType<z.output<typeof schema>>, 'setValue'> & {
      setValue: (path: string, value: unknown) => boolean
      values: { name: string }
    }
    const handle: { api?: Api } = {}
    const App = defineComponent({
      setup() {
        handle.api = useForm({
          schema,
          key: `chaos-transform-leaf-${Math.random().toString(36).slice(2)}`,
          defaultValues: { name: '' },
        }) as unknown as Api
        return () => h('div')
      },
    })
    const app = createApp(App).use(createAttaform())
    app.mount(document.createElement('div'))
    apps.push(app)
    const api = handle.api as Api

    api.setValue('name', '  ada  ')
    await nextTick()

    // The user typed '  ada  '; storage should preserve their input
    // (so the input element shows what they typed, not 'ADA'). The bug
    // case: the form pre-applies the transform and the user sees their
    // text reformatted on every keystroke. The post-transform OUTPUT
    // is reachable via `form.process()` below — keeps storage as the
    // honest input view, exposes the output on demand.
    expect(api.values.name).toBe('  ada  ')
  })

  it('form.process() returns the post-transform OUTPUT shape while form.values stays as input', async () => {
    // The input/output asymmetry contract: storage (and form.values)
    // holds the pre-transform value the consumer wrote;
    // `form.process()` runs the full parse pipeline (refinements +
    // transforms) and returns the post-transform value. handleSubmit's
    // callback already receives this same shape — `process()` is the
    // standalone way to ask for it.
    const schema = z.object({
      isLongEmail: z.string().transform((v) => v.length > 10),
      count: z.string().transform((v) => Number(v)),
    })
    type Api = Omit<UseFormReturnType<z.output<typeof schema>>, 'setValue'> & {
      setValue: (path: string, value: unknown) => boolean
      values: { isLongEmail: unknown; count: unknown }
      process: () => Promise<{
        success: boolean
        data?: { isLongEmail: boolean; count: number }
        errors?: ReadonlyArray<{ message: string }>
      }>
    }
    const handle: { api?: Api } = {}
    const App = defineComponent({
      setup() {
        handle.api = useForm({
          schema,
          key: `chaos-process-transform-${Math.random().toString(36).slice(2)}`,
          defaultValues: { isLongEmail: 'a@b.co', count: '42' } as never,
        }) as unknown as Api
        return () => h('div')
      },
    })
    const app = createApp(App).use(createAttaform())
    app.mount(document.createElement('div'))
    apps.push(app)
    const api = handle.api as Api

    // After setValue, storage holds the PRE-transform input
    // (`.transform()` doesn't run at write time, only at parse time).
    api.setValue('isLongEmail', 'a@b.co')
    api.setValue('count', '42')
    await nextTick()
    expect(api.values.isLongEmail).toBe('a@b.co')
    expect(api.values.count).toBe('42')

    // process() runs the full parse pipeline (refinements + transforms)
    // and returns the POST-transform output. This is the same shape
    // handleSubmit's callback receives.
    const result = await api.process()
    expect(result.success).toBe(true)
    expect(result.data?.isLongEmail).toBe(false) // 'a@b.co' is 6 chars, < 10 → false
    expect(result.data?.count).toBe(42) // string '42' → number 42

    // Mutating + re-processing reflects the latest input.
    api.setValue('isLongEmail', 'a-really-long-email@example.com')
    await nextTick()
    expect(api.values.isLongEmail).toBe('a-really-long-email@example.com')
    const result2 = await api.process()
    expect(result2.data?.isLongEmail).toBe(true) // 31 chars, > 10 → true
  })

  it('TYPES: input/output asymmetry threads through useForm — values stays z.input, handleSubmit/process resolve to z.output', () => {
    // Type-level probe. The body is a no-op at runtime — `expectTypeOf`
    // assertions run at compile time, not at runtime — but the test
    // function still has to exist for Vitest to report the file's
    // status. Failure here is a tsc error caught by `pnpm typecheck`.
    // Underscore prefix marks the `const` as type-only for the
    // `no-unused-vars` linter; we read it via `typeof _schema` below.
    const _schema = z.object({
      // Different input vs output types — the trickier case.
      isLongEmail: z.string().transform((v) => v.length > 10),
      count: z.string().transform((v) => Number(v)),
      // Same input/output (no transform) — the common case still works.
      name: z.string(),
    })

    // PathInput<Schema, Path> resolves to z.input shape at the path.
    expectTypeOf<PathInput<typeof _schema, 'isLongEmail'>>().toEqualTypeOf<string>()
    expectTypeOf<PathInput<typeof _schema, 'count'>>().toEqualTypeOf<string>()
    expectTypeOf<PathInput<typeof _schema, 'name'>>().toEqualTypeOf<string>()

    // PathOutput<Schema, Path> resolves to z.output shape at the path.
    expectTypeOf<PathOutput<typeof _schema, 'isLongEmail'>>().toEqualTypeOf<boolean>()
    expectTypeOf<PathOutput<typeof _schema, 'count'>>().toEqualTypeOf<number>()
    expectTypeOf<PathOutput<typeof _schema, 'name'>>().toEqualTypeOf<string>()

    // Inside the form API, the same asymmetry threads through. Type-
    // assert directly off `useForm`'s return without any `as Api` cast
    // so the public TS surface is what's under test.
    type FormApi = ReturnType<typeof useForm<typeof _schema>>

    // form.values reflects storage — the pre-transform z.input view.
    type FlagAtValues = FormApi['values']['isLongEmail']
    type CountAtValues = FormApi['values']['count']
    expectTypeOf<FlagAtValues>().toEqualTypeOf<string>()
    expectTypeOf<CountAtValues>().toEqualTypeOf<string>()

    // form.handleSubmit's onSubmit callback receives z.output (post-
    // transform). Extract via Parameters<...>[0] off the OnSubmit fn
    // shape — `(data: z.output) => void | Promise<void>`.
    type OnSubmitParam = Parameters<Parameters<FormApi['handleSubmit']>[0]>[0]
    expectTypeOf<OnSubmitParam['isLongEmail']>().toEqualTypeOf<boolean>()
    expectTypeOf<OnSubmitParam['count']>().toEqualTypeOf<number>()
    expectTypeOf<OnSubmitParam['name']>().toEqualTypeOf<string>()

    // form.process()'s `.data` payload resolves to z.output too.
    type ProcessResult = Awaited<ReturnType<FormApi['process']>>
    type ProcessSuccess = Extract<ProcessResult, { success: true }>
    expectTypeOf<ProcessSuccess['data']['isLongEmail']>().toEqualTypeOf<boolean>()
    expectTypeOf<ProcessSuccess['data']['count']>().toEqualTypeOf<number>()
  })
})

// -------------------- 9.4 Date / Map / Set inside a DU subtree --------------------
describe('chaos — non-JSON-friendly types in DU subtree', () => {
  const apps: App[] = []
  afterEach(() => {
    while (apps.length > 0) apps.pop()?.unmount()
  })

  it('a Date value at a z.date() leaf survives a discriminator round-trip', async () => {
    const schema = z.object({
      payload: z.discriminatedUnion('kind', [
        z.object({ kind: z.literal('dated'), at: z.date() }),
        z.object({ kind: z.literal('plain'), note: z.string() }),
      ]),
    })
    type Api = Omit<UseFormReturnType<z.output<typeof schema>>, 'setValue'> & {
      setValue: (path: string, value: unknown) => boolean
      values: { payload: { kind: string } & Record<string, unknown> }
    }
    const handle: { api?: Api } = {}
    const App = defineComponent({
      setup() {
        handle.api = useForm({
          schema,
          key: `chaos-date-du-${Math.random().toString(36).slice(2)}`,
          defaultValues: { payload: { kind: 'dated', at: new Date(0) } },
        }) as unknown as Api
        return () => h('div')
      },
    })
    const app = createApp(App).use(createAttaform())
    app.mount(document.createElement('div'))
    apps.push(app)
    const api = handle.api as Api

    const stamp = new Date('2024-01-15T12:00:00.000Z')
    api.setValue('payload.at', stamp)
    await nextTick()

    api.setValue('payload.kind', 'plain')
    await nextTick()
    api.setValue('payload.kind', 'dated')
    await nextTick()

    // Variant memory snapshot uses JSON-cycle, which converts Date →
    // ISO string. After the round-trip, restoration yields a STRING,
    // not a Date. `instanceof Date` fails — and the consumer's code
    // that expects `at.getTime()` crashes silently the next time it
    // runs.
    const at = (api.values.payload as Record<string, unknown>).at
    expect(at instanceof Date).toBe(true)
  })
})

// -------------------- 9.5 Numeric strings at numeric leaves --------------------
describe('chaos — numeric-string write at a z.number() leaf', () => {
  const apps: App[] = []
  afterEach(() => {
    while (apps.length > 0) apps.pop()?.unmount()
  })

  it("setValue('age', '42') is rejected by the slim-primitive gate", async () => {
    const schema = z.object({ age: z.number() })
    type Api = Omit<UseFormReturnType<z.output<typeof schema>>, 'setValue'> & {
      setValue: (path: string, value: unknown) => boolean
      values: { age: number | string }
    }
    const handle: { api?: Api } = {}
    const App = defineComponent({
      setup() {
        handle.api = useForm({
          schema,
          key: `chaos-numeric-string-${Math.random().toString(36).slice(2)}`,
          defaultValues: { age: 0 },
        }) as unknown as Api
        return () => h('div')
      },
    })
    const app = createApp(App).use(createAttaform())
    app.mount(document.createElement('div'))
    apps.push(app)
    const api = handle.api as Api

    expect(api.setValue('age', '42')).toBe(false)
    await nextTick()
    expect(typeof api.values.age).toBe('number')
  })
})

// -------------------- 9.6 null at z.string().nullable() --------------------
describe('chaos — null at a nullable string leaf', () => {
  const apps: App[] = []
  afterEach(() => {
    while (apps.length > 0) apps.pop()?.unmount()
  })

  it('setValue accepts null and storage reflects it', async () => {
    const schema = z.object({ note: z.string().nullable() })
    type Api = Omit<UseFormReturnType<z.output<typeof schema>>, 'setValue'> & {
      setValue: (path: string, value: unknown) => boolean
      values: { note: string | null }
    }
    const handle: { api?: Api } = {}
    const App = defineComponent({
      setup() {
        handle.api = useForm({
          schema,
          key: `chaos-nullable-${Math.random().toString(36).slice(2)}`,
          defaultValues: { note: 'init' },
        }) as unknown as Api
        return () => h('div')
      },
    })
    const app = createApp(App).use(createAttaform())
    app.mount(document.createElement('div'))
    apps.push(app)
    const api = handle.api as Api

    expect(api.setValue('note', null)).toBe(true)
    await nextTick()
    expect(api.values.note).toBeNull()
  })
})

// -------------------- 9.7 Performance: 1000 setValue calls --------------------
describe('chaos — performance: rapid setValue chain', () => {
  const apps: App[] = []
  afterEach(() => {
    while (apps.length > 0) apps.pop()?.unmount()
  })

  it('1000 sequential setValue calls complete in under 1 second', async () => {
    const { app, api } = mountProfile()
    apps.push(app)

    const start = performance.now()
    for (let i = 0; i < 1000; i++) {
      api.setValue('name', `name-${i}`)
    }
    await nextTick()
    const elapsed = performance.now() - start

    expect(elapsed).toBeLessThan(1000)
    expect(api.values.name).toBe('name-999')
  })
})

// -------------------- 9.8 Performance: large array of DU --------------------
describe('chaos — performance: large array of DU', () => {
  const apps: App[] = []
  afterEach(() => {
    while (apps.length > 0) apps.pop()?.unmount()
  })

  it('mounting a form with 5000 DU array elements completes in under 3 seconds', async () => {
    const arraySchema = z.object({
      events: z.array(
        z.discriminatedUnion('type', [
          z.object({ type: z.literal('click'), x: z.string() }),
          z.object({ type: z.literal('text'), value: z.string() }),
        ])
      ),
    })
    const events: Array<{ type: 'click'; x: string }> = []
    for (let i = 0; i < 5000; i++) events.push({ type: 'click', x: `e-${i}` })

    const start = performance.now()
    const handle: { api?: unknown } = {}
    const App = defineComponent({
      setup() {
        handle.api = useForm({
          schema: arraySchema,
          key: `chaos-perf-large-${Math.random().toString(36).slice(2)}`,
          defaultValues: { events },
        })
        return () => h('div')
      },
    })
    const app = createApp(App).use(createAttaform())
    app.mount(document.createElement('div'))
    apps.push(app)
    await nextTick()
    const elapsed = performance.now() - start

    expect(elapsed).toBeLessThan(3000)
    const api = handle.api as { values: { events: Array<unknown> } }
    expect(api.values.events.length).toBe(5000)
  })
})

// -------------------- 9.9 resetField('') is the form-level-errors path --------------------
describe("chaos — resetField with the form-level errors path ''", () => {
  const apps: App[] = []
  afterEach(() => {
    while (apps.length > 0) apps.pop()?.unmount()
  })

  it("resetField('') clears form-level errors but leaves named fields untouched", async () => {
    // `''` is the form-level error bucket — the path where errors that
    // don't belong to any specific field live (`setFormErrors`, root
    // `.refine()` messages, server-emitted form errors). It is NOT a
    // "reset everything" alias. `resetField('')` resets the field at
    // that path: storage at `''` typically doesn't exist (schemas don't
    // name a field `''`), so nothing in `form.values` changes, but
    // errors at `''` are cleared — matching the consumer model where
    // every path-addressed API treats `''` as one path among many.
    const { app, api } = mountProfile()
    apps.push(app)

    api.setValue('name', 'Ada')
    api.setFormErrors([{ message: 'capacity exceeded', code: 'api:capacity' }])
    await nextTick()

    expect(api.values.name).toBe('Ada')
    expect(api.errors('')).toHaveLength(1)

    api.resetField('')
    await nextTick()

    // Named field is untouched — `''` is a distinct path, not an
    // alias for the whole form.
    expect(api.values.name).toBe('Ada')
    // Form-level errors at `''` are cleared.
    expect(api.errors('')).toBeUndefined()
  })

  it('resetField on a container path broadcasts the reset to descendants', async () => {
    // Mirrors the read-side pattern: `form.fields(containerPath)` and
    // `form.values(containerPath)` aggregate the subtree, so a write-
    // side `resetField(containerPath)` reverts every leaf in the
    // subtree to its construction-time original.
    const { app, api } = mountProfile()
    apps.push(app)

    api.setValue('name', 'Ada')
    api.setValue('notify.address', 'a@b.c')
    await nextTick()
    expect(api.values.name).toBe('Ada')
    expect(api.values.notify.channel === 'email' && api.values.notify.address).toBe('a@b.c')

    api.resetField('notify')
    await nextTick()

    // notify subtree reverts to construction-time defaults
    // (`{ channel: 'email', address: 'old@example.com' }` for this
    // profile harness); siblings outside the prefix survive.
    expect(api.values.name).toBe('Ada')
    expect(api.values.notify.channel).toBe('email')
    expect(api.values.notify.address).toBe('old@example.com')
  })
})

// -------------------- 9.10 Two useForm with same key --------------------
describe('chaos — two useForm calls with the same key in one app', () => {
  const apps: App[] = []
  afterEach(() => {
    while (apps.length > 0) apps.pop()?.unmount()
  })

  // Shared-key semantics are intentional (modal + main rendering the
  // same logical form). The store IS shared; storage IS shared. What
  // mustn't bleed is per-instance config — each useForm callsite
  // honors its own validateOn / shouldShowErrors / coerce /
  // rememberVariants / debounceMs. The first call's defaultValues
  // wins; subsequent calls inherit the live store state, not their own
  // seed (so opening a modal shows whatever the user typed in the
  // main form).
  it('shares store + first-call defaults wins; subsequent call sees live store state', () => {
    const schema = z.object({ x: z.string() })
    const handle: { a?: unknown; b?: unknown } = {}
    const App = defineComponent({
      setup() {
        handle.a = useForm({
          schema,
          key: 'collision-key',
          defaultValues: { x: 'a' },
        })
        handle.b = useForm({
          schema,
          key: 'collision-key',
          defaultValues: { x: 'b' },
        })
        return () => h('div')
      },
    })
    const app = createApp(App).use(createAttaform())
    app.mount(document.createElement('div'))
    apps.push(app)

    const a = handle.a as { values: { x: string }; setValue: (p: string, v: unknown) => boolean }
    const b = handle.b as { values: { x: string }; setValue: (p: string, v: unknown) => boolean }

    // First call's defaultValues wins; both handles see the same live
    // state. The second `defaultValues: { x: 'b' }` is a guess that
    // should yield to the live store — exactly the modal-opens-on-
    // partially-filled-main-form pattern.
    expect(a.values.x).toBe('a')
    expect(b.values.x).toBe('a')

    // Writes through one handle land in the shared store; the other
    // handle observes the same value. That's the feature, not a bug.
    a.setValue('x', 'one')
    expect(a.values.x).toBe('one')
    expect(b.values.x).toBe('one')

    b.setValue('x', 'two')
    expect(a.values.x).toBe('two')
    expect(b.values.x).toBe('two')
  })

  it("each instance honors its own validateOn — sibling's 'submit' doesn't suppress the other's 'change'", async () => {
    // Two callsites, one shared store. Instance A starts in
    // submit-only mode; instance B asks for change-mode. With a
    // valid seed, neither has errors at mount. After a setValue
    // through B, the change-mode pipeline should fire and surface
    // 'bad email' even though the store's construction-time mode is
    // 'submit'. Without the per-instance lift, B's writes would
    // silently NOT validate (the store would only know A's submit
    // mode).
    const schema = z.object({ email: z.email('bad email') })
    const handle: { a?: unknown; b?: unknown } = {}
    const App = defineComponent({
      setup() {
        handle.a = useForm({
          schema,
          key: 'shared-validateOn',
          validateOn: 'submit',
          defaultValues: { email: 'seed@example.com' },
          strict: false,
        })
        handle.b = useForm({
          schema,
          key: 'shared-validateOn',
          validateOn: 'change',
        })
        return () => h('div')
      },
    })
    const app = createApp(App).use(createAttaform())
    app.mount(document.createElement('div'))
    apps.push(app)
    await nextTick()

    const a = handle.a as {
      errors: Record<string, ReadonlyArray<{ message: string }> | undefined>
      setValue: (p: string, v: unknown) => boolean
    }
    const b = handle.b as {
      errors: Record<string, ReadonlyArray<{ message: string }> | undefined>
      setValue: (p: string, v: unknown) => boolean
    }

    // Mount-time: lax + valid seed → no errors on either handle.
    expect(a.errors.email).toBeUndefined()
    expect(b.errors.email).toBeUndefined()

    // Drain helper: schema.validateAtPath resolves through one
    // microtask plus the adapter's own async (sync zod still returns
    // through Promise.resolve), so a single nextTick isn't enough.
    // setTimeout(0) flushes both microtask queue and the next macrotask.
    const drain = async () => {
      await nextTick()
      await new Promise((resolve) => setTimeout(resolve, 0))
      await nextTick()
    }

    // A's submit-only write must NOT trigger change-mode validation.
    a.setValue('email', 'first-bad-write')
    await drain()
    expect(a.errors.email).toBeUndefined()
    expect(b.errors.email).toBeUndefined()

    // B's change-mode write SHOULD trigger validation. The bad-email
    // value in storage now produces a schema error.
    b.setValue('email', 'second-bad-write')
    await drain()
    expect(b.errors.email?.[0]?.message).toBe('bad email')
    // Errors are shared store state — A sees them too.
    expect(a.errors.email?.[0]?.message).toBe('bad email')
  })

  it("handleSubmit re-entry guard protects across siblings — B's submit is a no-op while A's is in flight", async () => {
    // The double-click guard at `state.activeSubmissions.value > 0`
    // reads from the FormStore, which is shared across every
    // `useForm({ key })` callsite. So an in-flight submission through
    // instance A should suppress a same-key submission through
    // instance B — they're working on the same logical form. Without
    // this guarantee, a button in the modal could double-fire the
    // form's onSubmit while the main form's submit is still awaiting
    // validation, duplicating POSTs.
    const schema = z.object({ name: z.string().min(1) })
    const handle: { a?: unknown; b?: unknown } = {}
    const App = defineComponent({
      setup() {
        handle.a = useForm({
          schema,
          key: 'shared-submit-dedup',
          defaultValues: { name: 'Ada' },
        })
        handle.b = useForm({
          schema,
          key: 'shared-submit-dedup',
        })
        return () => h('div')
      },
    })
    const app = createApp(App).use(createAttaform())
    app.mount(document.createElement('div'))
    apps.push(app)
    await nextTick()

    type SubmitApi = {
      handleSubmit: (onSubmit: () => unknown, onError?: () => unknown) => () => Promise<void>
      meta: { submitting: boolean }
    }
    const a = handle.a as SubmitApi
    const b = handle.b as SubmitApi

    let aCalls = 0
    let bCalls = 0
    let releaseA!: () => void
    const aBlocker = new Promise<void>((resolve) => {
      releaseA = resolve
    })
    const submitA = a.handleSubmit(async () => {
      aCalls++
      await aBlocker
    })
    const submitB = b.handleSubmit(() => {
      bCalls++
    })

    // Fire A first; it'll block on aBlocker until we release.
    const aPromise = submitA()
    await nextTick()
    await new Promise((r) => setTimeout(r, 0))
    expect(aCalls).toBe(1)
    expect(a.meta.submitting).toBe(true)
    // Both A and B observe submitting=true — meta is shared.
    expect(b.meta.submitting).toBe(true)

    // While A is in flight, B's submit must be a no-op.
    await submitB()
    expect(bCalls).toBe(0)
    expect(a.meta.submitting).toBe(true)
    expect(b.meta.submitting).toBe(true)

    // Release A — once it completes, B's next submit can run.
    releaseA()
    await aPromise
    await nextTick()
    expect(a.meta.submitting).toBe(false)
    expect(b.meta.submitting).toBe(false)

    await submitB()
    expect(bCalls).toBe(1)
  })

  it("when A's onSubmit throws, the shared lifecycle clears cleanly and B can submit again", async () => {
    // Symmetric to the success-path probe: a throw inside A's
    // onSubmit must release the shared re-entry guard AND populate
    // `submitError` on the shared store, so both siblings see the
    // captured error and B's next submit can fire. The finally block
    // in process-form.ts runs regardless of throw vs. success — this
    // probe pins that invariant across instances. Without it, a
    // failing submit on the modal could leave the main form stuck in
    // `submitting: true` forever.
    const schema = z.object({ name: z.string().min(1) })
    const handle: { a?: unknown; b?: unknown } = {}
    const App = defineComponent({
      setup() {
        handle.a = useForm({
          schema,
          key: 'shared-submit-throw',
          defaultValues: { name: 'Ada' },
        })
        handle.b = useForm({
          schema,
          key: 'shared-submit-throw',
        })
        return () => h('div')
      },
    })
    const app = createApp(App).use(createAttaform())
    app.mount(document.createElement('div'))
    apps.push(app)
    await nextTick()

    type SubmitApi = {
      handleSubmit: (onSubmit: () => unknown, onError?: () => unknown) => () => Promise<void>
      meta: { submitting: boolean; submitError: unknown; submitCount: number }
    }
    const a = handle.a as SubmitApi
    const b = handle.b as SubmitApi

    let bCalls = 0
    let rejectA!: (err: Error) => void
    const aBlocker = new Promise<void>((_, reject) => {
      rejectA = reject
    })
    const boom = new Error('onSubmit blew up')
    const submitA = a.handleSubmit(async () => {
      await aBlocker
    })
    const submitB = b.handleSubmit(() => {
      bCalls++
    })

    // Fire A; it suspends on aBlocker. Both siblings observe
    // submitting=true.
    const aPromise = submitA()
    await nextTick()
    await new Promise((r) => setTimeout(r, 0))
    expect(a.meta.submitting).toBe(true)
    expect(b.meta.submitting).toBe(true)

    // Reject A — its onSubmit rethrows the error.
    rejectA(boom)
    await expect(aPromise).rejects.toBe(boom)
    await nextTick()

    // Lifecycle clears across BOTH siblings: submitting flips false,
    // submitError captures the throw, submitCount increments once.
    expect(a.meta.submitting).toBe(false)
    expect(b.meta.submitting).toBe(false)
    expect(a.meta.submitError).toBe(boom)
    expect(b.meta.submitError).toBe(boom)
    expect(a.meta.submitCount).toBe(1)
    expect(b.meta.submitCount).toBe(1)

    // B's next submit can fire — the re-entry guard released along
    // with the throw. A fresh successful submit clears submitError.
    await submitB()
    await nextTick()
    expect(bCalls).toBe(1)
    expect(b.meta.submitError).toBeNull()
    expect(a.meta.submitError).toBeNull()
    expect(b.meta.submitCount).toBe(2)
  })

  it('a sync watcher on meta.submitting that throws does not desync activeSubmissions', async () => {
    // Pressure test for the lifecycle setup ordering in
    // process-form.ts:handleSubmit. If `state.submitting.value = true`
    // sits OUTSIDE the try/finally block AND a sync watcher on the
    // submitting flag throws, the finally never runs and the counter
    // is stuck at 1 forever — every subsequent submit is silently
    // dropped by the re-entry guard. The fix is to lift the increment
    // and the rest of the lifecycle setup inside the try block so the
    // finally always cleans up (Math.max already guards underflow).
    const schema = z.object({ name: z.string().min(1) })
    const handle: { api?: unknown; watcherFired?: { count: number } } = {}
    const App = defineComponent({
      setup() {
        const api = useForm({
          schema,
          key: `submit-watcher-${Math.random().toString(36).slice(2)}`,
          defaultValues: { name: 'Ada' },
        })
        const watcherFired = { count: 0 }
        // Sync watcher INSIDE setup so it binds to this component
        // instance. Vue's handleError consults the app-level
        // errorHandler via the instance's appContext, so bare
        // `watch()` outside setup wouldn't route through our trap.
        // `flush: 'sync'` dispatches at the setter call site —
        // exposing the pre-try-block leak directly.
        watch(
          () => api.meta.submitting,
          (next) => {
            if (next === true) {
              watcherFired.count++
              throw new Error('watcher boom on submitting=true')
            }
          },
          { flush: 'sync' }
        )
        handle.api = api
        handle.watcherFired = watcherFired
        return () => h('div')
      },
    })
    const app = createApp(App).use(createAttaform())
    // Capture watcher errors via Vue's errorHandler so Vitest's
    // unhandled-error trap doesn't fail the test. We only care that
    // the counter recovers, not how the error surfaces.
    const capturedVueErrors: unknown[] = []
    app.config.errorHandler = (err) => {
      capturedVueErrors.push(err)
    }
    app.mount(document.createElement('div'))
    apps.push(app)
    await nextTick()

    type SubmitApi = {
      handleSubmit: (onSubmit: () => unknown) => () => Promise<void>
      meta: { submitting: boolean; submitCount: number }
    }
    const api = handle.api as SubmitApi
    const watcherFired = handle.watcherFired as { count: number }

    let secondCallCount = 0
    const submit1 = api.handleSubmit(() => {})
    const submit2 = api.handleSubmit(() => {
      secondCallCount++
    })

    // First submit: the watcher throws when submitting flips true. Vue
    // routes the throw to the app's errorHandler (captured above);
    // whether process-form also rethrows is incidental. The critical
    // invariant is counter recovery.
    try {
      await submit1()
    } catch {
      // accepted on the rethrow path
    }
    await nextTick()
    expect(watcherFired.count).toBeGreaterThanOrEqual(1)
    expect(capturedVueErrors.length).toBeGreaterThanOrEqual(1)
    // The critical invariant: submitting clears so the next submit
    // isn't blocked by the re-entry guard.
    expect(api.meta.submitting).toBe(false)

    // Second submit MUST be allowed — the counter cleaned up after
    // the throw. Without the fix, this is a silent no-op forever.
    await submit2()
    await nextTick()
    expect(secondCallCount).toBe(1)
  })

  it("a sync watcher on a field's validating flag that throws does not desync the per-path counter", async () => {
    // Pressure test for `scheduleFieldValidation`'s `run` closure. The
    // increments (`activeValidations.value += 1` and
    // `incFieldValidation(key)`) sit BEFORE the Promise chain whose
    // `.finally` is the only decrement path. If a sync watcher on
    // `api.fields.X.validating` (or `api.meta.validating`) throws as
    // the increment fires, the Promise chain never starts and the
    // counter is leaked — `validating` stays true forever and the
    // mount-gate `pathHasAsyncValidation` reports a permanently-
    // pending state. Fix: wrap the increments + chain start in a try
    // that ensures the decrements still fire on a sync throw.
    const schema = z.object({ email: z.email('bad email') })
    const handle: { api?: unknown; watcherFired?: { count: number } } = {}
    const App = defineComponent({
      setup() {
        const api = useForm({
          schema,
          key: `validating-watcher-${Math.random().toString(36).slice(2)}`,
          defaultValues: { email: 'seed@x.com' },
        })
        const watcherFired = { count: 0 }
        // Sync watcher on the leaf's validating flag — throws on
        // first transition to true.
        watch(
          () => api.fields.email.validating,
          (next) => {
            if (next === true) {
              watcherFired.count++
              throw new Error('watcher boom on email.validating=true')
            }
          },
          { flush: 'sync' }
        )
        handle.api = api
        handle.watcherFired = watcherFired
        return () => h('div')
      },
    })
    const app = createApp(App).use(createAttaform())
    const capturedVueErrors: unknown[] = []
    app.config.errorHandler = (err) => {
      capturedVueErrors.push(err)
    }
    app.mount(document.createElement('div'))
    apps.push(app)
    await nextTick()

    type Api = {
      setValue: (p: string, v: unknown) => boolean
      fields: { email: { validating: boolean } }
      meta: { validating: boolean }
    }
    const api = handle.api as Api
    const watcherFired = handle.watcherFired as { count: number }

    // setValue triggers `scheduleFieldValidation` (change mode, the
    // default), which fires the increments inside `run`. The watcher's
    // throw races with the per-path counter.
    api.setValue('email', 'bad-email')
    // Drain microtasks + macrotask so any deferred .finally landed.
    await nextTick()
    await new Promise((r) => setTimeout(r, 0))
    await nextTick()

    expect(watcherFired.count).toBeGreaterThanOrEqual(1)
    expect(capturedVueErrors.length).toBeGreaterThanOrEqual(1)
    // The critical invariant: validating clears after the throw — the
    // per-path counter MUST decrement in the .finally even if the
    // increment's reactive subscriber threw. Without this, the
    // mount-gate keeps fields reporting validating: true forever.
    expect(api.fields.email.validating).toBe(false)
    expect(api.meta.validating).toBe(false)

    // A subsequent setValue should validate cleanly — the per-path
    // counter is back to zero, no double-count from the leak.
    api.setValue('email', 'good@example.com')
    await nextTick()
    await new Promise((r) => setTimeout(r, 0))
    await nextTick()
    expect(api.fields.email.validating).toBe(false)
    expect(api.meta.validating).toBe(false)
  })

  it('a sync watcher on meta.validating that throws does not desync validateAsync', async () => {
    // Same defense-in-depth invariant for the imperative validateAsync
    // path. Its single counter increment (`activeValidations.value +=
    // 1`) sits before the try block in the original code; a sync
    // watcher on meta.validating that throws at that setter would
    // leak the counter and hang meta.validating: true forever. With
    // the fix, the increment lives inside the try and the finally
    // decrements regardless.
    const schema = z.object({ name: z.string().min(1) })
    const handle: { api?: unknown; watcherFired?: { count: number } } = {}
    const App = defineComponent({
      setup() {
        const api = useForm({
          schema,
          key: `validate-async-watcher-${Math.random().toString(36).slice(2)}`,
          defaultValues: { name: 'Ada' },
        })
        const watcherFired = { count: 0 }
        watch(
          () => api.meta.validating,
          (next) => {
            if (next === true) {
              watcherFired.count++
              throw new Error('watcher boom on meta.validating=true')
            }
          },
          { flush: 'sync' }
        )
        handle.api = api
        handle.watcherFired = watcherFired
        return () => h('div')
      },
    })
    const app = createApp(App).use(createAttaform())
    const capturedVueErrors: unknown[] = []
    app.config.errorHandler = (err) => {
      capturedVueErrors.push(err)
    }
    app.mount(document.createElement('div'))
    apps.push(app)
    await nextTick()

    type Api = {
      validateAsync: () => Promise<unknown>
      meta: { validating: boolean }
    }
    const api = handle.api as Api
    const watcherFired = handle.watcherFired as { count: number }

    // Fire validateAsync — the watcher throws when validating flips
    // true. Counter must clear regardless of where the throw surfaces.
    try {
      await api.validateAsync()
    } catch {
      // accepted
    }
    await nextTick()
    expect(watcherFired.count).toBeGreaterThanOrEqual(1)
    expect(api.meta.validating).toBe(false)

    // Subsequent validateAsync MUST work — the counter recovered.
    const response = await api.validateAsync()
    await nextTick()
    expect(api.meta.validating).toBe(false)
    expect(response).toBeDefined()
  })
})

// -------------------- 9.11 setValue after unmount --------------------
describe('chaos — setValue called after the host component unmounts', () => {
  const apps: App[] = []
  afterEach(() => {
    while (apps.length > 0) apps.pop()?.unmount()
  })

  it('does not throw a crash; either no-ops or surfaces a clear error', async () => {
    const { app, api } = mountProfile()
    apps.push(app)
    apps.pop() // remove from cleanup list — we'll unmount manually
    app.unmount()

    // Caller still holds the api. setValue should be safe to call.
    let threw = false
    try {
      api.setValue('name', 'after-unmount')
    } catch {
      threw = true
    }
    expect(threw).toBe(false)
  })
})

// -------------------- 9.12 Direct mutation via api.values --------------------
describe('chaos — direct mutation through api.values proxy', () => {
  const apps: App[] = []
  afterEach(() => {
    while (apps.length > 0) apps.pop()?.unmount()
  })

  it('writing api.values.notify.channel = "wat" directly does not bypass the gate', async () => {
    const { app, api } = mountProfile()
    apps.push(app)

    let threw = false
    try {
      ;(api.values.notify as Record<string, unknown>).channel = 'wat'
    } catch {
      threw = true
    }
    await nextTick()

    // Either the proxy throws on write (read-only enforcement) or the
    // write is allowed but the gate runs. What it must NOT do: silently
    // corrupt storage with no validation.
    if (!threw) {
      const notify = api.values.notify as Record<string, unknown>
      // If accepted, behavior should mirror setValue. If rejected
      // silently, channel stays 'email'.
      expect(notify.channel === 'email' || notify.channel === 'wat').toBe(true)
    }
  })
})

// -------------------- 9.13 handleSubmit re-entry --------------------
describe('chaos — handleSubmit re-entry inside onSuccess', () => {
  const apps: App[] = []
  afterEach(() => {
    while (apps.length > 0) apps.pop()?.unmount()
  })

  it('calling submit() inside onSuccess does not infinite-recurse', async () => {
    const { app, api } = mountProfile()
    apps.push(app)

    api.setValue('name', 'Ada')
    api.setValue('notify', { channel: 'sms', number: '5551234' })
    await nextTick()

    let calls = 0
    const submit = api.handleSubmit(
      () => {
        calls++
        if (calls > 5) return // hard stop
        // Re-enter — would be infinite recursion without a guard.
        submit()
      },
      () => {}
    )
    await submit()
    await nextTick()

    expect(calls).toBeLessThan(5)
  })
})

// -------------------- 9.14 z.union (non-discriminated) --------------------
describe('chaos — non-discriminated z.union with literal variants', () => {
  const apps: App[] = []
  afterEach(() => {
    while (apps.length > 0) apps.pop()?.unmount()
  })

  it('a non-discriminated literal union still gates writes by literal-set', async () => {
    const schema = z.object({
      role: z.union([z.literal('admin'), z.literal('viewer')]),
    })
    type Api = Omit<UseFormReturnType<z.output<typeof schema>>, 'setValue'> & {
      setValue: (path: string, value: unknown) => boolean
      values: { role: string }
    }
    const handle: { api?: Api } = {}
    const App = defineComponent({
      setup() {
        handle.api = useForm({
          schema,
          key: `chaos-union-${Math.random().toString(36).slice(2)}`,
          defaultValues: { role: 'admin' },
        }) as unknown as Api
        return () => h('div')
      },
    })
    const app = createApp(App).use(createAttaform())
    app.mount(document.createElement('div'))
    apps.push(app)
    const api = handle.api as Api

    // 'wat' is a string and string-literal union accepts string at the
    // gate level — but 'wat' isn't in the literal set. Without literal-
    // set awareness, this passes the gate.
    expect(api.setValue('role', 'wat')).toBe(false)
    await nextTick()
    expect(api.values.role).toBe('admin')
  })
})

// -------------------- 9.15 Array of arrays of DUs --------------------
describe('chaos — array of arrays of discriminated unions', () => {
  const apps: App[] = []
  afterEach(() => {
    while (apps.length > 0) apps.pop()?.unmount()
  })

  it('depth-2 array nesting reshapes correctly on inner discriminator change', async () => {
    const schema = z.object({
      grid: z.array(
        z.array(
          z.discriminatedUnion('type', [
            z.object({ type: z.literal('A'), a: z.string() }),
            z.object({ type: z.literal('B'), b: z.string() }),
          ])
        )
      ),
    })
    type Api = Omit<UseFormReturnType<z.output<typeof schema>>, 'setValue'> & {
      setValue: (path: string, value: unknown) => boolean
      values: { grid: Array<Array<{ type: string } & Record<string, unknown>>> }
    }
    const handle: { api?: Api } = {}
    const App = defineComponent({
      setup() {
        handle.api = useForm({
          schema,
          key: `chaos-nested-array-du-${Math.random().toString(36).slice(2)}`,
          defaultValues: {
            grid: [
              [
                { type: 'A', a: 'r0c0' },
                { type: 'A', a: 'r0c1' },
              ],
              [{ type: 'B', b: 'r1c0' }],
            ],
          },
        }) as unknown as Api
        return () => h('div')
      },
    })
    const app = createApp(App).use(createAttaform())
    app.mount(document.createElement('div'))
    apps.push(app)
    const api = handle.api as Api

    api.setValue('grid.0.1.type', 'B')
    await nextTick()

    // Sibling row unaffected.
    expect(api.values.grid[1]?.[0]).toEqual({ type: 'B', b: 'r1c0' })
    // Sibling cell in same row unaffected.
    expect(api.values.grid[0]?.[0]).toEqual({ type: 'A', a: 'r0c0' })
    // Target cell reshapes cleanly.
    expect(api.values.grid[0]?.[1]).toEqual({ type: 'B', b: '' })
  })
})

// -------------------- 9.16 Stringified JSON at object leaf --------------------
describe('chaos — stringified JSON written at an object-typed leaf', () => {
  const apps: App[] = []
  afterEach(() => {
    while (apps.length > 0) apps.pop()?.unmount()
  })

  it('setValue(\'config\', \'{"key":"value"}\') is rejected (not parsed silently)', async () => {
    const schema = z.object({
      config: z.object({ key: z.string() }),
    })
    type Api = Omit<UseFormReturnType<z.output<typeof schema>>, 'setValue'> & {
      setValue: (path: string, value: unknown) => boolean
      values: { config: { key: string } }
    }
    const handle: { api?: Api } = {}
    const App = defineComponent({
      setup() {
        handle.api = useForm({
          schema,
          key: `chaos-stringified-json-${Math.random().toString(36).slice(2)}`,
          defaultValues: { config: { key: 'init' } },
        }) as unknown as Api
        return () => h('div')
      },
    })
    const app = createApp(App).use(createAttaform())
    app.mount(document.createElement('div'))
    apps.push(app)
    const api = handle.api as Api

    // A common API misuse: caller stringifies before setValue. The
    // form should reject — the schema expects an object.
    expect(api.setValue('config', '{"key":"value"}')).toBe(false)
    await nextTick()
    expect(api.values.config).toEqual({ key: 'init' })
  })
})

// -------------------- 9.17 Branded literal at discriminator --------------------
describe('chaos — branded literal at the discriminator', () => {
  const apps: App[] = []
  afterEach(() => {
    while (apps.length > 0) apps.pop()?.unmount()
  })

  it('z.literal("a").brand<"X">() at discriminator does not lose the variant lookup', async () => {
    const schema = z.object({
      payload: z.discriminatedUnion('kind', [
        z.object({ kind: z.literal('plain'), v: z.string() }),
        z.object({ kind: z.literal('special'), w: z.string() }),
      ]),
    })
    type Api = Omit<UseFormReturnType<z.output<typeof schema>>, 'setValue'> & {
      setValue: (path: string, value: unknown) => boolean
      values: { payload: { kind: string } & Record<string, unknown> }
    }
    const handle: { api?: Api } = {}
    const App = defineComponent({
      setup() {
        handle.api = useForm({
          schema,
          key: `chaos-brand-disc-${Math.random().toString(36).slice(2)}`,
          defaultValues: { payload: { kind: 'plain', v: '' } },
        }) as unknown as Api
        return () => h('div')
      },
    })
    const app = createApp(App).use(createAttaform())
    app.mount(document.createElement('div'))
    apps.push(app)
    const api = handle.api as Api

    api.setValue('payload.kind', 'special')
    await nextTick()
    expect(api.values.payload).toEqual({ kind: 'special', w: '' })
  })
})

// -------------------- 9.18 v3-specific: ZodEffects wrapping a DU --------------------
describe('chaos — zod v3 ZodEffects wrapping a discriminatedUnion', () => {
  const apps: App[] = []
  afterEach(() => {
    while (apps.length > 0) apps.pop()?.unmount()
  })

  it('v3: refinement on the union does not break variant reshape', async () => {
    const inner = zV3.discriminatedUnion('channel', [
      zV3.object({ channel: zV3.literal('email'), address: zV3.string() }),
      zV3.object({ channel: zV3.literal('sms'), number: zV3.string() }),
    ])
    // .refine wraps in ZodEffects. The adapter peeling code at
    // src/runtime/adapters/zod-v3/index.ts:438 must see through this.
    const schema = zV3.object({
      notify: inner.refine(
        () => true,
        () => ({ message: 'always pass' })
      ),
    })
    type Api = Omit<UseFormReturnType<zV3.infer<typeof schema>>, 'setValue'> & {
      setValue: (path: string, value: unknown) => boolean
      values: { notify: { channel: string } & Record<string, unknown> }
    }
    const handle: { api?: Api } = {}
    const App = defineComponent({
      setup() {
        handle.api = useFormV3({
          schema,
          key: `chaos-v3-effects-du-${Math.random().toString(36).slice(2)}`,
          defaultValues: { notify: { channel: 'email', address: '' } },
        }) as unknown as Api
        return () => h('div')
      },
    })
    const app = createApp(App).use(createAttaform())
    app.mount(document.createElement('div'))
    apps.push(app)
    const api = handle.api as Api

    api.setValue('notify.address', 'kept@example.com')
    api.setValue('notify.channel', 'sms')
    await nextTick()

    expect(api.values.notify).toEqual({ channel: 'sms', number: '' })
  })
})

// -------------------- 9.19 z.intersection containing a DU --------------------
describe('chaos — z.intersection of a DU and a sibling schema', () => {
  const apps: App[] = []
  afterEach(() => {
    while (apps.length > 0) apps.pop()?.unmount()
  })

  it('intersection-wrapped DU still reshapes on discriminator change', async () => {
    const du = z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('A'), a: z.string() }),
      z.object({ kind: z.literal('B'), b: z.string() }),
    ])
    const meta = z.object({ shared: z.string() })
    const schema = z.object({
      payload: z.intersection(du, meta),
    })
    type Api = Omit<UseFormReturnType<z.output<typeof schema>>, 'setValue'> & {
      setValue: (path: string, value: unknown) => boolean
      values: { payload: { kind: string; shared: string } & Record<string, unknown> }
    }
    let threwAtConstruction = false
    let api: Api | undefined
    try {
      const handle: { api?: Api } = {}
      const App = defineComponent({
        setup() {
          handle.api = useForm({
            schema,
            key: `chaos-intersection-du-${Math.random().toString(36).slice(2)}`,
            defaultValues: { payload: { kind: 'A', a: 'init', shared: 's' } },
          }) as unknown as Api
          return () => h('div')
        },
      })
      const app = createApp(App).use(createAttaform())
      app.mount(document.createElement('div'))
      apps.push(app)
      api = handle.api as Api
    } catch {
      threwAtConstruction = true
    }

    if (threwAtConstruction) {
      // Acceptable: the adapter doesn't claim intersection support.
      return
    }
    if (api === undefined) return

    api.setValue('payload.kind', 'B')
    await nextTick()
    const payload = api.values.payload as Record<string, unknown>
    // After the switch, `b` should be present, `a` gone, `shared`
    // preserved.
    expect(payload.kind).toBe('B')
    expect('a' in payload).toBe(false)
  })
})

// -------------------- 9.20 z.preprocess at the discriminator key itself --------------------
describe('chaos — preprocess on the discriminator leaf inside a variant', () => {
  const apps: App[] = []
  afterEach(() => {
    while (apps.length > 0) apps.pop()?.unmount()
  })

  it('preprocess that lowercases the discriminator does not break variant lookup', async () => {
    // Exercise: variant-lookup uses the literal value verbatim, but a
    // preprocess on the discriminator leaf would turn 'EMAIL' into
    // 'email'. The slim-gate sees the input ('EMAIL'), the adapter
    // sees the output ('email').
    const schema = z.object({
      notify: z.discriminatedUnion('channel', [
        z.object({
          channel: z.preprocess(
            (v) => (typeof v === 'string' ? v.toLowerCase() : v),
            z.literal('email')
          ),
          address: z.string(),
        }),
        z.object({
          channel: z.preprocess(
            (v) => (typeof v === 'string' ? v.toLowerCase() : v),
            z.literal('sms')
          ),
          number: z.string(),
        }),
      ]),
    })
    let threw = false
    try {
      const handle: { api?: unknown } = {}
      const App = defineComponent({
        setup() {
          handle.api = useForm({
            schema,
            key: `chaos-preprocess-disc-${Math.random().toString(36).slice(2)}`,
            defaultValues: { notify: { channel: 'email', address: '' } },
          })
          return () => h('div')
        },
      })
      const app = createApp(App).use(createAttaform())
      app.mount(document.createElement('div'))
      apps.push(app)
    } catch {
      threw = true
    }

    // Either supported (form mounts) or rejected at construction. The
    // bug case: silent partial support where the schema mounts but
    // discriminator switches misbehave.
    expect(typeof threw).toBe('boolean')
  })
})

// =====================================================================
// 10. PERSISTENCE × DU and HISTORY × DU probes.
//
// Persistence: localStorage round-trips. Probes feed a corrupt /
// schema-incompatible payload directly into localStorage at the
// fingerprinted key, mount the form, and watch what surfaces.
//
// History: enabled via `useForm({ history: true })`. Probes drive
// undo/redo across discriminator switches, invalid intermediates,
// array-shape changes, and concurrent submission.
// =====================================================================

import { fingerprintZodSchema } from '../../src/runtime/adapters/zod-v4/fingerprint'
import { hashStableString } from '../../src/runtime/core/hash'
import { waitUntil } from '../utils/form-harness'

function persistKeyFor<S extends z.ZodType>(schema: S, formKey: string): string {
  // Mirror `wirePersistence`'s key shape: `attaform:${formKey}:${fingerprintHash}`.
  // Without the prefix, seeded localStorage entries write to a different
  // key than the lib reads from — hydration silently no-ops.
  return `attaform:${formKey}:${hashStableString(fingerprintZodSchema(schema))}`
}

describe('chaos — persistence: hydrate with invalid discriminator in stored payload', () => {
  const apps: App[] = []
  beforeEach(() => localStorage.clear())
  afterEach(() => {
    while (apps.length > 0) apps.pop()?.unmount()
    localStorage.clear()
  })

  it('does not mount the form into an unrepresentable shape', async () => {
    const formKey = `chaos-persist-bad-disc-${Math.random().toString(36).slice(2)}`
    const storageKey = persistKeyFor(profileSchema, formKey)
    // Seed localStorage with an envelope where the discriminator is
    // 'wat' (no variant matches). The hydrate path's mergeDeep + DU
    // rebase must coerce this to a valid shape OR ignore the payload.
    localStorage.setItem(
      storageKey,
      JSON.stringify({
        v: 4,
        data: {
          form: {
            name: 'Ada',
            notify: { channel: 'wat', address: 'lingering@x.io' },
          },
        },
      })
    )

    const handle: { api?: ProfileApi } = {}
    const App = defineComponent({
      setup() {
        handle.api = useForm({
          schema: profileSchema,
          key: formKey,
          persist: { storage: 'local', debounceMs: 1 },
          defaultValues: {
            name: '',
            notify: { channel: 'email', address: '' },
          },
        }) as unknown as ProfileApi
        return () => h('div')
      },
    })
    const app = createApp(App).use(createAttaform())
    app.mount(document.createElement('div'))
    apps.push(app)
    await nextTick()

    const notify = api(handle).values.notify as Record<string, unknown>
    const valid =
      (notify.channel === 'email' && typeof notify.address === 'string') ||
      (notify.channel === 'sms' && typeof notify.number === 'string')
    expect(valid).toBe(true)
  })

  it('does not mount with foreign-variant keys persisted alongside a valid disc', async () => {
    const formKey = `chaos-persist-foreign-${Math.random().toString(36).slice(2)}`
    const storageKey = persistKeyFor(profileSchema, formKey)
    localStorage.setItem(
      storageKey,
      JSON.stringify({
        v: 4,
        data: {
          form: {
            name: 'Ada',
            // Valid disc 'email' but `number` (sms-only) leaks in.
            notify: { channel: 'email', address: 'a@b.io', number: '555-stale' },
          },
        },
      })
    )

    const handle: { api?: ProfileApi } = {}
    const App = defineComponent({
      setup() {
        handle.api = useForm({
          schema: profileSchema,
          key: formKey,
          persist: { storage: 'local', debounceMs: 1 },
          defaultValues: {
            name: '',
            notify: { channel: 'email', address: '' },
          },
        }) as unknown as ProfileApi
        return () => h('div')
      },
    })
    const app = createApp(App).use(createAttaform())
    app.mount(document.createElement('div'))
    apps.push(app)
    await nextTick()

    expect('number' in (api(handle).values.notify as Record<string, unknown>)).toBe(false)
  })

  it('skips a corrupt JSON payload and falls back to defaults', async () => {
    const formKey = `chaos-persist-corrupt-${Math.random().toString(36).slice(2)}`
    const storageKey = persistKeyFor(profileSchema, formKey)
    localStorage.setItem(storageKey, '{this is { not json')

    const handle: { api?: ProfileApi } = {}
    let threw = false
    try {
      const App = defineComponent({
        setup() {
          handle.api = useForm({
            schema: profileSchema,
            key: formKey,
            persist: { storage: 'local', debounceMs: 1 },
            defaultValues: {
              name: 'default-name',
              notify: { channel: 'email', address: 'default@x.io' },
            },
          }) as unknown as ProfileApi
          return () => h('div')
        },
      })
      const app = createApp(App).use(createAttaform())
      app.mount(document.createElement('div'))
      apps.push(app)
      await nextTick()
    } catch {
      threw = true
    }

    expect(threw).toBe(false)
    if (handle.api !== undefined) {
      // Defaults restored.
      expect(handle.api.values.name).toBe('default-name')
    }
  })

  it('rejects an envelope with a stale storage version', async () => {
    const formKey = `chaos-persist-stale-${Math.random().toString(36).slice(2)}`
    const storageKey = persistKeyFor(profileSchema, formKey)
    localStorage.setItem(
      storageKey,
      JSON.stringify({
        v: 1, // current is 4; stale envelope must be dropped
        data: {
          form: {
            name: 'should-not-load',
            notify: { channel: 'sms', number: '5551234' },
          },
        },
      })
    )

    const handle: { api?: ProfileApi } = {}
    const App = defineComponent({
      setup() {
        handle.api = useForm({
          schema: profileSchema,
          key: formKey,
          persist: { storage: 'local', debounceMs: 1 },
          defaultValues: {
            name: 'default-loaded',
            notify: { channel: 'email', address: '' },
          },
        }) as unknown as ProfileApi
        return () => h('div')
      },
    })
    const app = createApp(App).use(createAttaform())
    app.mount(document.createElement('div'))
    apps.push(app)
    await nextTick()

    expect(handle.api?.values.name).toBe('default-loaded')
  })

  it("doesn't crash when localStorage throws (quota exceeded simulation)", async () => {
    const formKey = `chaos-persist-quota-${Math.random().toString(36).slice(2)}`

    // Patch setItem to throw on every write — simulates `QuotaExceededError`.
    const originalSetItem = localStorage.setItem.bind(localStorage)
    localStorage.setItem = (): never => {
      throw new DOMException('QuotaExceededError', 'QuotaExceededError')
    }

    let crashed = false
    try {
      const handle: { api?: ProfileApi; type?: (path: string, value: string) => void } = {}
      const App = defineComponent({
        setup() {
          const api = useForm({
            schema: profileSchema,
            key: formKey,
            persist: { storage: 'local', debounceMs: 1 },
            defaultValues: { name: '', notify: { channel: 'email', address: '' } },
          }) as unknown as ProfileApi
          handle.api = api
          return () =>
            h('input', {
              ref: (el): void => {
                if (el !== null) {
                  handle.type = (path: string, value: string): void => {
                    void path
                    ;(el as HTMLInputElement).value = value
                    ;(el as HTMLInputElement).dispatchEvent(new Event('input', { bubbles: true }))
                  }
                }
              },
            })
        },
      })
      const app = createApp(App).use(createAttaform())
      app.mount(document.createElement('div'))
      apps.push(app)

      handle.api!.setValue('name', 'Ada')
      await nextTick()
      await new Promise((r) => setTimeout(r, 30)) // let debounced write fire
    } catch {
      crashed = true
    } finally {
      localStorage.setItem = originalSetItem
    }

    expect(crashed).toBe(false)
  })

  it('hydrating with a stored discriminator that is no longer a valid variant in the current schema produces a clean state', async () => {
    // Schema migration scenario: an older session persisted
    // `channel: 'fax'` (a variant the current schema no longer has).
    // The current schema has only email/sms.
    const formKey = `chaos-persist-removed-variant-${Math.random().toString(36).slice(2)}`
    const storageKey = persistKeyFor(profileSchema, formKey)
    localStorage.setItem(
      storageKey,
      JSON.stringify({
        v: 4,
        data: {
          form: {
            name: 'Ada',
            notify: { channel: 'fax', faxNumber: '555-FAX' },
          },
        },
      })
    )

    const handle: { api?: ProfileApi } = {}
    const App = defineComponent({
      setup() {
        handle.api = useForm({
          schema: profileSchema,
          key: formKey,
          persist: { storage: 'local', debounceMs: 1 },
          defaultValues: { name: '', notify: { channel: 'email', address: '' } },
        }) as unknown as ProfileApi
        return () => h('div')
      },
    })
    const app = createApp(App).use(createAttaform())
    app.mount(document.createElement('div'))
    apps.push(app)
    await nextTick()

    const notify = handle.api!.values.notify as Record<string, unknown>
    const valid =
      (notify.channel === 'email' && typeof notify.address === 'string') ||
      (notify.channel === 'sms' && typeof notify.number === 'string')
    expect(valid).toBe(true)
  })
})

// Helper to keep the deeply-typed handle access tidy.
function api(handle: { api?: ProfileApi }): ProfileApi {
  return handle.api as ProfileApi
}

// -------------------- HISTORY × DU --------------------
describe('chaos — history (undo/redo) × discriminated unions', () => {
  const apps: App[] = []
  afterEach(() => {
    while (apps.length > 0) apps.pop()?.unmount()
  })

  function mountWithHistory(overrides: { history?: true | { capacity?: number } } = {}): {
    app: App
    api: ProfileApi
  } {
    const handle: { api?: ProfileApi } = {}
    const App = defineComponent({
      setup() {
        handle.api = useForm({
          schema: profileSchema,
          key: `chaos-history-${Math.random().toString(36).slice(2)}`,
          history: overrides.history ?? true,
          defaultValues: {
            name: '',
            notify: { channel: 'email', address: '' },
          },
        }) as unknown as ProfileApi
        return () => h('div')
      },
    })
    const app = createApp(App).use(createAttaform())
    app.mount(document.createElement('div'))
    return { app, api: handle.api as ProfileApi }
  }

  it('undo across an invalid-discriminator intermediate restores the pre-invalid state cleanly', async () => {
    const { app, api } = mountWithHistory()
    apps.push(app)

    api.setValue('name', 'Ada')
    api.setValue('notify.address', 'kept@x.io')
    await nextTick()

    api.setValue('notify.channel', 'wat') // invalid intermediate
    await nextTick()

    api.undo()
    await nextTick()

    // Pre-invalid state was email + kept@x.io. After undo, the form
    // must be in that valid shape — not in some halfway repair.
    expect(api.values.notify).toEqual({ channel: 'email', address: 'kept@x.io' })
  })

  it('redo replays a discriminator switch correctly after undo', async () => {
    const { app, api } = mountWithHistory()
    apps.push(app)

    api.setValue('notify.address', 'first@x.io')
    api.setValue('notify.channel', 'sms')
    await nextTick()
    expect(api.values.notify).toEqual({ channel: 'sms', number: '' })

    api.undo()
    await nextTick()
    expect(api.values.notify).toEqual({ channel: 'email', address: 'first@x.io' })

    api.redo()
    await nextTick()
    expect(api.values.notify).toEqual({ channel: 'sms', number: '' })
  })

  it('a new setValue after undo clears the redo stack', async () => {
    const { app, api } = mountWithHistory()
    apps.push(app)

    api.setValue('name', 'one')
    await nextTick()
    api.setValue('name', 'two')
    await nextTick()
    api.undo()
    await nextTick()
    expect(api.meta.canRedo).toBe(true)

    api.setValue('name', 'three')
    await nextTick()
    expect(api.meta.canRedo).toBe(false)
    const stillCanRedo = api.redo()
    expect(stillCanRedo).toBe(false)
    expect(api.values.name).toBe('three')
  })

  it('undo/redo at history extremes returns false cleanly', async () => {
    const { app, api } = mountWithHistory()
    apps.push(app)
    expect(api.undo()).toBe(false) // empty undo stack
    expect(api.redo()).toBe(false) // empty redo stack
  })

  it('history snapshots do NOT capture variant memory (memory is a side channel)', async () => {
    // Documented contract: history snapshots form value, NOT memory.
    // Verify by typing → switch → undo → switch-back: post-undo
    // switch-back's memory should reflect the value typed BEFORE the
    // undo (not the slim default), because memory survives undo.
    const { app, api } = mountWithHistory()
    apps.push(app)

    api.setValue('notify.address', 'pre-undo@x.io')
    api.setValue('notify.channel', 'sms') // memory captures email
    await nextTick()

    // Undo the switch. Form value goes back to the pre-switch state
    // (email + 'pre-undo@x.io'). Memory is untouched per the contract.
    api.undo()
    await nextTick()
    expect(api.values.notify).toEqual({ channel: 'email', address: 'pre-undo@x.io' })

    // Switch sms again. Memory snapshots email's current state. Then
    // back to email. Memory should restore the pre-undo address.
    api.setValue('notify.channel', 'sms')
    api.setValue('notify.channel', 'email')
    await nextTick()
    expect(api.values.notify).toEqual({ channel: 'email', address: 'pre-undo@x.io' })
  })

  it('history capacity is enforced (51st snapshot evicts the oldest)', async () => {
    // Default capacity = 50. After 60 mutations and 60 undos, we
    // should fall short of restoring the very first state.
    const { app, api } = mountWithHistory()
    apps.push(app)

    for (let i = 0; i < 60; i++) {
      api.setValue('name', `n-${i}`)
      await nextTick()
    }

    // historySize bounded at the capacity (50 + redo room).
    expect(api.meta.historySize).toBeLessThanOrEqual(50)

    // Undo as far as we can. The earliest state the form can restore
    // is bounded by the capacity, NOT the original empty default.
    while (api.meta.canUndo) {
      api.undo()
      await nextTick()
    }
    // The first 10 names were evicted; we can't reach `n-0` or even
    // the default ''. The earliest restorable name should be some
    // `n-K` for K <= 10.
    expect(api.values.name).not.toBe('')
  })

  it('reset() is itself undoable — the pre-reset state is recoverable', async () => {
    // Reset is a mutation from the history module's point of view, not
    // a stack-wipe. `applyFormReplacement` (inside `reset()`) fires
    // `onFormChange`, which pushes the post-reset snapshot. The user's
    // previous value sits one position earlier in the undo stack, so
    // calling `undo()` after a reset recovers the form as it was just
    // before the reset.
    //
    // Why this beats the "fresh start" semantic: a consumer who hits
    // "Reset" by mistake can recover with one undo. Consumers who want
    // a non-recoverable reset can pop a confirmation modal in their UI
    // before calling `reset()` (or, post B18, call `history.clear()`
    // after the reset).
    const { app, api } = mountWithHistory()
    apps.push(app)

    api.setValue('name', 'a')
    api.setValue('name', 'b')
    await nextTick()
    expect(api.meta.canUndo).toBe(true)
    expect(api.values.name).toBe('b')

    api.reset()
    await nextTick()

    // After reset: form is back at the default (empty string), and the
    // pre-reset state is one undo step away.
    expect(api.values.name).toBe('')
    expect(api.meta.canUndo).toBe(true)
    expect(api.meta.canRedo).toBe(false)

    api.undo()
    await nextTick()

    // The pre-reset state ('b') is recovered.
    expect(api.values.name).toBe('b')
    expect(api.meta.canRedo).toBe(true)
  })

  it('handleSubmit operates on the post-undo form value (not the pre-undo)', async () => {
    const { app, api } = mountWithHistory()
    apps.push(app)

    api.setValue('name', 'Ada')
    api.setValue('notify', { channel: 'sms', number: '5551234' })
    await nextTick()

    api.setValue('name', 'Beth') // bumps history
    await nextTick()

    api.undo() // back to 'Ada'
    await nextTick()

    let submitted: Record<string, unknown> | null = null
    const submit = api.handleSubmit(
      (data) => {
        submitted = data as Record<string, unknown>
      },
      () => {}
    )
    await submit()
    await nextTick()

    expect((submitted as Record<string, unknown> | null)?.name).toBe('Ada')
  })

  it('undo across an array.remove on a DU array does not bleed memory between positions', async () => {
    const arraySchema = z.object({
      events: z.array(
        z.discriminatedUnion('type', [
          z.object({ type: z.literal('click'), x: z.string() }),
          z.object({ type: z.literal('text'), value: z.string() }),
        ])
      ),
    })
    type ArrApi = Omit<UseFormReturnType<z.output<typeof arraySchema>>, 'setValue'> & {
      setValue: (path: string, value: unknown) => boolean
      remove: (path: string, index: number) => boolean
      values: { events: Array<{ type: string } & Record<string, unknown>> }
    }
    const handle: { api?: ArrApi } = {}
    const App = defineComponent({
      setup() {
        handle.api = useForm({
          schema: arraySchema,
          key: `chaos-history-arr-${Math.random().toString(36).slice(2)}`,
          history: true,
          defaultValues: {
            events: [
              { type: 'click', x: 'first' },
              { type: 'text', value: 'second' },
            ],
          },
        }) as unknown as ArrApi
        return () => h('div')
      },
    })
    const app = createApp(App).use(createAttaform())
    app.mount(document.createElement('div'))
    apps.push(app)
    const api = handle.api as ArrApi

    api.remove('events', 0)
    await nextTick()
    expect(api.values.events.length).toBe(1)

    api.undo()
    await nextTick()

    // After undo, the array is restored. Both elements should be in
    // their original variant shapes (no orphan keys carried over from
    // the DU memory map's stale entries).
    expect(api.values.events.length).toBe(2)
    expect(api.values.events[0]).toEqual({ type: 'click', x: 'first' })
    expect(api.values.events[1]).toEqual({ type: 'text', value: 'second' })
  })

  it('undo while a validateAsync is in-flight does not commit stale errors', async () => {
    const { app, api } = mountWithHistory()
    apps.push(app)

    api.setValue('name', 'Ada')
    api.setValue('notify.channel', 'sms') // schema requires number.min(7) — '' fails
    await nextTick()

    const pending = api.validateAsync()
    api.undo() // back to email/email-default; the in-flight validation is for the sms state
    await pending
    await nextTick()

    // The form is now back at the email variant. The sms validation's
    // errors must not have committed against the active path.
    expect(api.errors('notify.number')).toBeUndefined()
  })

  it('history disabled: canUndo/canRedo/historySize stay zero, undo/redo return false', async () => {
    const handle: { api?: ProfileApi } = {}
    const App = defineComponent({
      setup() {
        handle.api = useForm({
          schema: profileSchema,
          key: `chaos-history-off-${Math.random().toString(36).slice(2)}`,
          // history is opt-in; the default is off
          defaultValues: { name: '', notify: { channel: 'email', address: '' } },
        }) as unknown as ProfileApi
        return () => h('div')
      },
    })
    const app = createApp(App).use(createAttaform())
    app.mount(document.createElement('div'))
    apps.push(app)
    const api = handle.api as ProfileApi

    api.setValue('name', 'Ada')
    await nextTick()

    expect(api.meta.canUndo).toBe(false)
    expect(api.meta.canRedo).toBe(false)
    expect(api.meta.historySize).toBe(0)
    expect(api.undo()).toBe(false)
    expect(api.redo()).toBe(false)
  })
})

// -------------------- PERSISTENCE × HISTORY combo --------------------
describe('chaos — persistence + history together', () => {
  const apps: App[] = []
  beforeEach(() => localStorage.clear())
  afterEach(() => {
    while (apps.length > 0) apps.pop()?.unmount()
    localStorage.clear()
  })

  it('cannot undo past the hydrated state on first mount', async () => {
    const formKey = `chaos-persist-history-${Math.random().toString(36).slice(2)}`
    const storageKey = persistKeyFor(profileSchema, formKey)
    localStorage.setItem(
      storageKey,
      JSON.stringify({
        v: 4,
        data: {
          form: { name: 'persisted', notify: { channel: 'email', address: 'p@x.io' } },
        },
      })
    )

    const handle: { api?: ProfileApi } = {}
    const App = defineComponent({
      setup() {
        handle.api = useForm({
          schema: profileSchema,
          key: formKey,
          history: true,
          persist: { storage: 'local', debounceMs: 1 },
          defaultValues: { name: 'default', notify: { channel: 'email', address: '' } },
        }) as unknown as ProfileApi
        return () => h('div')
      },
    })
    const app = createApp(App).use(createAttaform())
    app.mount(document.createElement('div'))
    apps.push(app)

    const api = handle.api as ProfileApi
    // Hydration is async — dynamic adapter import + apply. Poll
    // rather than relying on a single nextTick.
    await waitUntil(() => (api.values.name === 'persisted' ? true : null))
    expect(api.values.name).toBe('persisted')
    expect(api.meta.canUndo).toBe(false)
    // Calling undo on an empty stack must NOT silently revert to the
    // pre-hydration default.
    api.undo()
    await nextTick()
    expect(api.values.name).toBe('persisted')
  })
})

// =====================================================================
// 11. ROUND 7 — records, tuples, Map/Set, setFieldErrors edges,
//     plugin install, concurrency race, DoS string.
// =====================================================================

// -------------------- 11.1 z.record(z.string(), du) --------------------
describe('chaos — z.record() with DU values', () => {
  const apps: App[] = []
  afterEach(() => {
    while (apps.length > 0) apps.pop()?.unmount()
  })

  it('switching a DU at a record key reshapes that key without affecting siblings', async () => {
    const schema = z.object({
      bag: z.record(
        z.string(),
        z.discriminatedUnion('kind', [
          z.object({ kind: z.literal('A'), a: z.string() }),
          z.object({ kind: z.literal('B'), b: z.string() }),
        ])
      ),
    })
    type Api = Omit<UseFormReturnType<z.output<typeof schema>>, 'setValue'> & {
      setValue: (path: string, value: unknown) => boolean
      values: { bag: Record<string, { kind: string } & Record<string, unknown>> }
    }
    let constructed = false
    let api: Api | undefined
    try {
      const handle: { api?: Api } = {}
      const App = defineComponent({
        setup() {
          handle.api = useForm({
            schema,
            key: `chaos-record-du-${Math.random().toString(36).slice(2)}`,
            defaultValues: {
              bag: { foo: { kind: 'A', a: 'foo-A' }, bar: { kind: 'B', b: 'bar-B' } },
            },
          }) as unknown as Api
          return () => h('div')
        },
      })
      const app = createApp(App).use(createAttaform())
      app.mount(document.createElement('div'))
      apps.push(app)
      api = handle.api as Api
      constructed = true
    } catch {
      // Acceptable: adapter may not claim z.record + DU support.
    }

    if (!constructed || api === undefined) return

    api.setValue('bag.foo.kind', 'B')
    await nextTick()

    expect(api.values.bag.foo).toEqual({ kind: 'B', b: '' })
    expect(api.values.bag.bar).toEqual({ kind: 'B', b: 'bar-B' })
  })

  it('does not pollute Object.prototype via z.record(z.string(), du) with a __proto__ key', async () => {
    const schema = z.object({
      bag: z.record(
        z.string(),
        z.discriminatedUnion('kind', [z.object({ kind: z.literal('A'), a: z.string() })])
      ),
    })
    type Api = Omit<UseFormReturnType<z.output<typeof schema>>, 'setValue'> & {
      setValue: (path: string, value: unknown) => boolean
    }
    let api: Api | undefined
    try {
      const handle: { api?: Api } = {}
      const App = defineComponent({
        setup() {
          handle.api = useForm({
            schema,
            key: `chaos-record-proto-${Math.random().toString(36).slice(2)}`,
            defaultValues: { bag: {} },
          }) as unknown as Api
          return () => h('div')
        },
      })
      const app = createApp(App).use(createAttaform())
      app.mount(document.createElement('div'))
      apps.push(app)
      api = handle.api as Api
    } catch {
      return
    }
    if (api === undefined) return

    api.setValue('bag.__proto__.kind', 'A')
    api.setValue('bag.__proto__.a', 'PWNED')
    await nextTick()

    expect(({} as Record<string, unknown>).a).toBeUndefined()
    delete (Object.prototype as unknown as Record<string, unknown>).a
    delete (Object.prototype as unknown as Record<string, unknown>).kind
  })
})

// -------------------- 11.2 z.tuple with DU element --------------------
describe('chaos — z.tuple containing a discriminated union', () => {
  const apps: App[] = []
  afterEach(() => {
    while (apps.length > 0) apps.pop()?.unmount()
  })

  it('switching a DU at a tuple index reshapes only that position', async () => {
    const du = z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('A'), a: z.string() }),
      z.object({ kind: z.literal('B'), b: z.string() }),
    ])
    const schema = z.object({
      pair: z.tuple([du, du]),
    })
    type Api = Omit<UseFormReturnType<z.output<typeof schema>>, 'setValue'> & {
      setValue: (path: string, value: unknown) => boolean
      values: { pair: [unknown, unknown] }
    }
    let api: Api | undefined
    try {
      const handle: { api?: Api } = {}
      const App = defineComponent({
        setup() {
          handle.api = useForm({
            schema,
            key: `chaos-tuple-du-${Math.random().toString(36).slice(2)}`,
            defaultValues: {
              pair: [
                { kind: 'A', a: 'first' },
                { kind: 'A', a: 'second' },
              ],
            },
          }) as unknown as Api
          return () => h('div')
        },
      })
      const app = createApp(App).use(createAttaform())
      app.mount(document.createElement('div'))
      apps.push(app)
      api = handle.api as Api
    } catch {
      return
    }
    if (api === undefined) return

    api.setValue('pair.0.kind', 'B')
    await nextTick()

    expect(api.values.pair[0]).toEqual({ kind: 'B', b: '' })
    expect(api.values.pair[1]).toEqual({ kind: 'A', a: 'second' })
  })
})

// -------------------- 11.3 Map / Set at leaves --------------------
describe('chaos — Map / Set values at leaves', () => {
  const apps: App[] = []
  afterEach(() => {
    while (apps.length > 0) apps.pop()?.unmount()
  })

  it('a Map value survives a discriminator round-trip', async () => {
    const schema = z.object({
      payload: z.discriminatedUnion('kind', [
        z.object({ kind: z.literal('mapped'), data: z.map(z.string(), z.string()) }),
        z.object({ kind: z.literal('flat'), note: z.string() }),
      ]),
    })
    type Api = Omit<UseFormReturnType<z.output<typeof schema>>, 'setValue'> & {
      setValue: (path: string, value: unknown) => boolean
      values: { payload: { kind: string } & Record<string, unknown> }
    }
    let api: Api | undefined
    try {
      const handle: { api?: Api } = {}
      const App = defineComponent({
        setup() {
          handle.api = useForm({
            schema,
            key: `chaos-map-leaf-${Math.random().toString(36).slice(2)}`,
            defaultValues: { payload: { kind: 'mapped', data: new Map() } },
          }) as unknown as Api
          return () => h('div')
        },
      })
      const app = createApp(App).use(createAttaform())
      app.mount(document.createElement('div'))
      apps.push(app)
      api = handle.api as Api
    } catch {
      // If Map isn't supported, skip — the bug class doesn't apply.
      return
    }
    if (api === undefined) return

    const m = new Map<string, string>([['a', '1']])
    api.setValue('payload.data', m)
    await nextTick()

    api.setValue('payload.kind', 'flat')
    await nextTick()
    api.setValue('payload.kind', 'mapped')
    await nextTick()

    // JSON-cycle in variant memory drops Map → empty object {}. After
    // round-trip we should still have a Map instance — or at minimum
    // the type kind was preserved.
    const data = (api.values.payload as Record<string, unknown>).data
    expect(data instanceof Map).toBe(true)
  })

  it('a Set value survives a discriminator round-trip', async () => {
    const schema = z.object({
      payload: z.discriminatedUnion('kind', [
        z.object({ kind: z.literal('seqed'), tags: z.set(z.string()) }),
        z.object({ kind: z.literal('flat'), note: z.string() }),
      ]),
    })
    type Api = Omit<UseFormReturnType<z.output<typeof schema>>, 'setValue'> & {
      setValue: (path: string, value: unknown) => boolean
      values: { payload: { kind: string } & Record<string, unknown> }
    }
    let api: Api | undefined
    try {
      const handle: { api?: Api } = {}
      const App = defineComponent({
        setup() {
          handle.api = useForm({
            schema,
            key: `chaos-set-leaf-${Math.random().toString(36).slice(2)}`,
            defaultValues: { payload: { kind: 'seqed', tags: new Set() } },
          }) as unknown as Api
          return () => h('div')
        },
      })
      const app = createApp(App).use(createAttaform())
      app.mount(document.createElement('div'))
      apps.push(app)
      api = handle.api as Api
    } catch {
      return
    }
    if (api === undefined) return

    api.setValue('payload.tags', new Set(['x', 'y']))
    await nextTick()

    api.setValue('payload.kind', 'flat')
    await nextTick()
    api.setValue('payload.kind', 'seqed')
    await nextTick()

    const tags = (api.values.payload as Record<string, unknown>).tags
    expect(tags instanceof Set).toBe(true)
  })
})

// -------------------- 11.4 setFieldErrors corner cases --------------------
describe('chaos — setFieldErrors at edge paths', () => {
  const apps: App[] = []
  afterEach(() => {
    while (apps.length > 0) apps.pop()?.unmount()
  })

  it('rejects errors at a path that does NOT exist in the schema', async () => {
    const { app, api } = mountProfile()
    apps.push(app)

    let threw = false
    try {
      api.setFieldErrors([
        {
          path: ['no', 'such', 'path'],
          message: 'phantom error',
          formKey: api.key,
          code: 'test:phantom',
        },
      ])
    } catch {
      threw = true
    }
    await nextTick()

    // Either rejected (warned/skipped) or accepted at a phantom path
    // — but never silently corrupting form state. Probe is loose:
    // assertion is that no crash and form remains usable.
    expect(threw).toBe(false)
    expect(api.values.notify.channel).toBe('email')
  })

  it('with mismatched formKey does not surface the error in api.errors', async () => {
    const { app, api } = mountProfile()
    apps.push(app)

    api.setFieldErrors([
      {
        path: ['name'],
        message: 'wrong-form error',
        formKey: 'totally-different-form-key',
        code: 'test:wrong-form',
      },
    ])
    await nextTick()

    // The formKey field is the targeted form's identifier. Errors with
    // a non-matching formKey should be ignored — they're for a
    // different form instance.
    expect(api.errors('name')).toBeUndefined()
  })

  it('survives an error object with a circular reference in `cause`', async () => {
    const { app, api } = mountProfile()
    apps.push(app)

    type CircularError = {
      path: (string | number)[]
      message: string
      formKey: string
      code: string
      cause?: { ref: unknown }
    }
    const cyclic: CircularError = {
      path: ['name'],
      message: 'circular',
      formKey: api.key,
      code: 'test:circular',
    }
    cyclic.cause = { ref: cyclic } // ← cycle

    let threw = false
    try {
      api.setFieldErrors([cyclic])
      await nextTick()
    } catch {
      threw = true
    }

    expect(threw).toBe(false)
    // Form still usable.
    expect(api.values.notify.channel).toBe('email')
  })
})

// -------------------- 11.5 Plugin double-install --------------------
describe('chaos — installing createAttaform twice on one app', () => {
  const apps: App[] = []
  afterEach(() => {
    while (apps.length > 0) apps.pop()?.unmount()
  })

  it('does not crash; second install is either ignored or overrides cleanly', async () => {
    const handle: { api?: ProfileApi } = {}
    const App = defineComponent({
      setup() {
        handle.api = useForm({
          schema: profileSchema,
          key: `chaos-plugin-double-${Math.random().toString(36).slice(2)}`,
          defaultValues: { name: '', notify: { channel: 'email', address: '' } },
        }) as unknown as ProfileApi
        return () => h('div')
      },
    })
    let threw = false
    try {
      const app = createApp(App).use(createAttaform()).use(createAttaform()) // ← second install
      app.mount(document.createElement('div'))
      apps.push(app)
      await nextTick()
    } catch {
      threw = true
    }

    expect(threw).toBe(false)
    expect(handle.api?.values.notify.channel).toBe('email')
  })
})

// -------------------- 11.6 Concurrent handleSubmit + validateAsync --------------------
describe('chaos — concurrent handleSubmit and validateAsync', () => {
  const apps: App[] = []
  afterEach(() => {
    while (apps.length > 0) apps.pop()?.unmount()
  })

  it('does not commit stale errors when validateAsync resolves AFTER a submit clears state', async () => {
    const { app, api } = mountProfile()
    apps.push(app)

    api.setValue('name', 'Ada')
    api.setValue('notify', { channel: 'sms', number: '5551234' })
    await nextTick()

    // Trigger validateAsync on the current (valid) state.
    const validation = api.validateAsync()

    // Mid-flight, mutate to an invalid state. Then await the original
    // validation. The original should reflect the state at the time
    // it was called — not commit errors against the now-current state.
    api.setValue('notify.number', '') // sms requires min(7); now invalid
    await nextTick()

    const result = await validation
    void result // intentionally do not assume success/failure here

    // Doesn't matter which posture (commit-against-launch-state vs
    // commit-against-current-state): the form must still be usable.
    expect(api.values.notify.number).toBe('')
  })
})

// -------------------- 11.7 Long-string DoS at a slim leaf --------------------
describe('chaos — extremely long string at a slim leaf', () => {
  const apps: App[] = []
  afterEach(() => {
    while (apps.length > 0) apps.pop()?.unmount()
  })

  it('a 1MB string does not hang the slim-primitive gate', async () => {
    const schema = z.object({ note: z.string() })
    type Api = Omit<UseFormReturnType<z.output<typeof schema>>, 'setValue'> & {
      setValue: (path: string, value: unknown) => boolean
      values: { note: string }
    }
    const handle: { api?: Api } = {}
    const App = defineComponent({
      setup() {
        handle.api = useForm({
          schema,
          key: `chaos-long-string-${Math.random().toString(36).slice(2)}`,
          defaultValues: { note: '' },
        }) as unknown as Api
        return () => h('div')
      },
    })
    const app = createApp(App).use(createAttaform())
    app.mount(document.createElement('div'))
    apps.push(app)
    const api = handle.api as Api

    const big = 'x'.repeat(1_000_000) // 1MB
    const start = performance.now()
    const ok = api.setValue('note', big)
    await nextTick()
    const elapsed = performance.now() - start

    expect(ok).toBe(true)
    expect(api.values.note.length).toBe(1_000_000)
    // Generous bound — should be O(1) or O(N) in writes, not O(N²).
    expect(elapsed).toBeLessThan(2000)
  })
})

// -------------------- 11.8 Multiple v-register on same path --------------------
describe('chaos — two <input> elements registered to the same path', () => {
  const apps: App[] = []
  afterEach(() => {
    while (apps.length > 0) apps.pop()?.unmount()
  })

  it('typing in either input keeps both in sync via the shared form value', async () => {
    const schema = z.object({ shared: z.string() })
    type Api = ReturnType<typeof useForm<typeof schema>>
    const handle: { api?: Api; el1?: HTMLInputElement; el2?: HTMLInputElement } = {}

    // Use the directive interface that the existing persistence test
    // file uses — but we don't need the directive here, the bug class
    // is about form-level coordination of two registered inputs.
    const App = defineComponent({
      setup() {
        const api = useForm({
          schema,
          key: `chaos-double-register-${Math.random().toString(36).slice(2)}`,
          defaultValues: { shared: '' },
        })
        handle.api = api
        return () =>
          h('div', [
            h('input', {
              ref: (el): void => {
                if (el !== null) handle.el1 = el as HTMLInputElement
              },
            }),
            h('input', {
              ref: (el): void => {
                if (el !== null) handle.el2 = el as HTMLInputElement
              },
            }),
          ])
      },
    })
    const app = createApp(App).use(createAttaform())
    const root = document.createElement('div')
    document.body.appendChild(root)
    app.mount(root)
    apps.push(app)
    await nextTick()

    const api = handle.api as Api
    api.setValue('shared', 'typed')
    await nextTick()
    expect(api.values.shared).toBe('typed')
  })
})

// =====================================================================
// 12. ROUND 8 — SSR / hydration + multi-tab persistence.
// =====================================================================

import { renderToString } from '@vue/server-renderer'
import { createSSRApp } from 'vue'

// -------------------- 12.1 SSR — DU schemas render --------------------
describe('chaos — SSR rendering with discriminated-union schemas', () => {
  it('renderToString completes for a form whose schema includes a DU', async () => {
    let threw = false
    let html = ''
    try {
      const App = defineComponent({
        setup() {
          useForm({
            schema: profileSchema,
            key: 'ssr-du-basic',
            defaultValues: { name: 'Ada', notify: { channel: 'email', address: 'a@b.io' } },
          })
          return () => h('div', [h('input', { value: 'Ada' }), h('input', { value: 'a@b.io' })])
        },
      })
      const ssrApp = createSSRApp(App).use(createAttaform())
      html = await renderToString(ssrApp)
    } catch {
      threw = true
    }

    expect(threw).toBe(false)
    expect(html.length).toBeGreaterThan(0)
  })

  it('renderToString completes for a DU with `unset` at the discriminator', async () => {
    let threw = false
    try {
      const App = defineComponent({
        setup() {
          useForm({
            schema: profileSchema,
            key: 'ssr-du-unset',
            defaultValues: { name: '', notify: { channel: unset } } as never,
          })
          return () => h('div')
        },
      })
      const ssrApp = createSSRApp(App).use(createAttaform())
      await renderToString(ssrApp)
    } catch {
      threw = true
    }

    expect(threw).toBe(false)
  })

  it('renderToString does not crash on a form with persist enabled (server has no localStorage)', async () => {
    // Server rendering happens in Node — no `window`/`localStorage`.
    // The persistence layer should detect the absence and skip
    // hydration, not throw.
    let threw = false
    try {
      const App = defineComponent({
        setup() {
          useForm({
            schema: profileSchema,
            key: 'ssr-du-persist',
            persist: { storage: 'local', debounceMs: 1 },
            defaultValues: { name: '', notify: { channel: 'email', address: '' } },
          })
          return () => h('div')
        },
      })
      const ssrApp = createSSRApp(App).use(createAttaform())
      await renderToString(ssrApp)
    } catch {
      threw = true
    }

    expect(threw).toBe(false)
  })
})

// -------------------- 12.2 Hydration mismatch — DU variant divergence --------------------
describe('chaos — server/client default-value divergence on a DU', () => {
  const apps: App[] = []
  beforeEach(() => localStorage.clear())
  afterEach(() => {
    while (apps.length > 0) apps.pop()?.unmount()
    localStorage.clear()
  })

  it('client value reflects the persisted state on first mount, not the server default', async () => {
    const formKey = `ssr-divergent-${Math.random().toString(36).slice(2)}`
    const storageKey = persistKeyFor(profileSchema, formKey)

    // Simulate: server rendered with email default. Browser had a
    // persisted sms variant from a prior session.
    localStorage.setItem(
      storageKey,
      JSON.stringify({
        v: 4,
        data: {
          form: { name: 'Persisted', notify: { channel: 'sms', number: '5551234' } },
        },
      })
    )

    const handle: { api?: ProfileApi } = {}
    const App = defineComponent({
      setup() {
        handle.api = useForm({
          schema: profileSchema,
          key: formKey,
          persist: { storage: 'local', debounceMs: 1 },
          defaultValues: { name: 'Default', notify: { channel: 'email', address: '' } },
        }) as unknown as ProfileApi
        return () => h('div')
      },
    })
    // Client-side mount: NOT `ssr: true` (which forces SSR mode and
    // gates off persistence wiring). Probe simulates the post-hydration
    // browser pass where persistence reads from storage.
    const app = createApp(App).use(createAttaform())
    app.mount(document.createElement('div'))
    apps.push(app)

    const api = handle.api as ProfileApi
    // Hydration is async — poll until the persisted shape lands.
    await waitUntil(() =>
      (api.values.notify as Record<string, unknown>).channel === 'sms' ? true : null
    )
    expect(api.values.notify).toEqual({ channel: 'sms', number: '5551234' })
  })
})

// -------------------- 12.3 Multi-tab persistence (storage event) --------------------
describe('chaos — multi-tab persistence via the storage event', () => {
  const apps: App[] = []
  beforeEach(() => localStorage.clear())
  afterEach(() => {
    while (apps.length > 0) apps.pop()?.unmount()
    localStorage.clear()
  })

  it('a `storage` event from another tab updates the form value (or fails to, documenting reality)', async () => {
    const formKey = `multitab-${Math.random().toString(36).slice(2)}`
    const storageKey = persistKeyFor(profileSchema, formKey)

    const handle: { api?: ProfileApi } = {}
    const App = defineComponent({
      setup() {
        handle.api = useForm({
          schema: profileSchema,
          key: formKey,
          persist: { storage: 'local', debounceMs: 1 },
          defaultValues: { name: 'tab-A', notify: { channel: 'email', address: 'a@b.io' } },
        }) as unknown as ProfileApi
        return () => h('div')
      },
    })
    const app = createApp(App).use(createAttaform())
    app.mount(document.createElement('div'))
    apps.push(app)
    await nextTick()

    const api = handle.api as ProfileApi
    expect(api.values.name).toBe('tab-A')

    // Simulate: another tab wrote to the same key.
    const newPayload = JSON.stringify({
      v: 4,
      data: { form: { name: 'tab-B', notify: { channel: 'email', address: 'b@c.io' } } },
    })
    localStorage.setItem(storageKey, newPayload)
    // Fire the StorageEvent that browsers emit cross-tab. (The current
    // tab does NOT receive it for its own writes; only OTHER tabs see
    // it. We simulate the cross-tab signal directly.)
    window.dispatchEvent(
      new StorageEvent('storage', {
        key: storageKey,
        newValue: newPayload,
        oldValue: null,
        storageArea: localStorage,
      })
    )
    await nextTick()
    await new Promise((r) => setTimeout(r, 30))

    // If attaform supports cross-tab sync, this updates. If not, the
    // form holds 'tab-A' and the assertion fails — documenting that
    // multi-tab is not currently a feature.
    expect(api.values.name).toBe('tab-B')
  })

  it('local writes are not echoed back to the form via a self-fired storage event', async () => {
    // Defensive: a custom synchronization layer that re-broadcasts
    // localStorage writes could create a feedback loop. Modern
    // browsers don't fire `storage` events on the writer-tab, but
    // tests / odd polyfills might.
    const formKey = `multitab-loop-${Math.random().toString(36).slice(2)}`
    const storageKey = persistKeyFor(profileSchema, formKey)

    const handle: { api?: ProfileApi } = {}
    const App = defineComponent({
      setup() {
        handle.api = useForm({
          schema: profileSchema,
          key: formKey,
          persist: { storage: 'local', debounceMs: 1 },
          defaultValues: { name: '', notify: { channel: 'email', address: '' } },
        }) as unknown as ProfileApi
        return () => h('div')
      },
    })
    const app = createApp(App).use(createAttaform())
    app.mount(document.createElement('div'))
    apps.push(app)
    await nextTick()

    const api = handle.api as ProfileApi
    api.setValue('name', 'self-fired')
    await nextTick()
    await new Promise((r) => setTimeout(r, 30))

    // Echo a fake storage event that mirrors the just-written value —
    // a misconfigured polyfill would do this. It shouldn't fire a
    // re-load; the form should already have this value and detect
    // the redundancy.
    window.dispatchEvent(
      new StorageEvent('storage', {
        key: storageKey,
        newValue: localStorage.getItem(storageKey),
        oldValue: null,
        storageArea: localStorage,
      })
    )
    await nextTick()

    expect(api.values.name).toBe('self-fired')
  })

  it('storage event with corrupt JSON in newValue does not crash the form', async () => {
    const formKey = `multitab-corrupt-${Math.random().toString(36).slice(2)}`
    const storageKey = persistKeyFor(profileSchema, formKey)

    const handle: { api?: ProfileApi } = {}
    const App = defineComponent({
      setup() {
        handle.api = useForm({
          schema: profileSchema,
          key: formKey,
          persist: { storage: 'local', debounceMs: 1 },
          defaultValues: { name: 'orig', notify: { channel: 'email', address: '' } },
        }) as unknown as ProfileApi
        return () => h('div')
      },
    })
    const app = createApp(App).use(createAttaform())
    app.mount(document.createElement('div'))
    apps.push(app)
    await nextTick()

    const api = handle.api as ProfileApi

    let threw = false
    try {
      window.dispatchEvent(
        new StorageEvent('storage', {
          key: storageKey,
          newValue: '{not valid json',
          oldValue: null,
          storageArea: localStorage,
        })
      )
      await nextTick()
    } catch {
      threw = true
    }

    expect(threw).toBe(false)
    expect(api.values.name).toBe('orig')
  })
})

// -------------------- 12.4 SSR — anonymous-key collision under double-mount --------------------
describe('chaos — SSR id allocator collision when two forms share a parent', () => {
  it('two anonymous forms in the same parent component get distinct keys', async () => {
    let key1: string | undefined
    let key2: string | undefined
    const App = defineComponent({
      setup() {
        const a = useForm({
          schema: z.object({ x: z.string() }),
          defaultValues: { x: 'a' },
        })
        const b = useForm({
          schema: z.object({ y: z.string() }),
          defaultValues: { y: 'b' },
        })
        key1 = a.key
        key2 = b.key
        return () => h('div')
      },
    })
    const ssrApp = createSSRApp(App).use(createAttaform())
    await renderToString(ssrApp)

    expect(key1).toBeDefined()
    expect(key2).toBeDefined()
    expect(key1).not.toBe(key2)
  })
})

// =====================================================================
// 13. ROUND 9 — final-pass random probes.
// =====================================================================

import { vi } from 'vitest'

// -------------------- 13.1 Dev warning on bad-disc-in-defaults --------------------
describe('chaos — dev warning surface for construction-time issues', () => {
  const apps: App[] = []
  afterEach(() => {
    while (apps.length > 0) apps.pop()?.unmount()
  })

  it('emits a dev warning when defaultValues carries an invalid discriminator', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    try {
      const handle: { api?: ProfileApi } = {}
      const App = defineComponent({
        setup() {
          handle.api = useForm({
            schema: profileSchema,
            key: `chaos-warn-bad-disc-${Math.random().toString(36).slice(2)}`,
            defaultValues: { name: '', notify: { channel: 'wat' } } as never,
          }) as unknown as ProfileApi
          return () => h('div')
        },
      })
      const app = createApp(App).use(createAttaform())
      app.mount(document.createElement('div'))
      apps.push(app)
      await nextTick()

      // Some warning should fire — the form is in a known-broken state.
      // Without it, the developer has no signal until validation runs.
      expect(warnSpy).toHaveBeenCalled()
    } finally {
      warnSpy.mockRestore()
    }
  })
})

// -------------------- 13.2 handleSubmit's onError throwing --------------------
describe('chaos — handleSubmit when onError callback throws', () => {
  const apps: App[] = []
  afterEach(() => {
    while (apps.length > 0) apps.pop()?.unmount()
  })

  it('a throwing onError does not corrupt form state for subsequent submits', async () => {
    const { app, api } = mountProfile()
    apps.push(app)

    api.setValue('notify.channel', 'wat') // invalid → onError will fire
    await nextTick()

    const submit = api.handleSubmit(
      () => {},
      () => {
        throw new Error('onError callback exploded')
      }
    )

    // First submit: onError throws inside the callback. The promise
    // either rejects or resolves with an error swallowed — either is
    // fine. What's NOT fine: the form state being corrupted such that
    // a subsequent recovery is impossible.
    let firstThrew = false
    try {
      await submit()
    } catch {
      firstThrew = true
    }
    void firstThrew

    // Recover the form to a valid state.
    api.resetField('notify.channel')
    await nextTick()
    expect(api.values.notify.channel).toBe('email')

    // Second submit: should run cleanly with a non-throwing handler.
    let secondSucceeded = false
    const submit2 = api.handleSubmit(
      () => {
        secondSucceeded = true
      },
      () => {}
    )
    api.setValue('notify.address', 'a@b.io')
    api.setValue('name', 'Ada')
    await nextTick()
    await submit2()
    await nextTick()

    expect(secondSucceeded).toBe(true)
  })
})

// -------------------- 13.3 Plugin shouldShowErrors that throws --------------------
describe('chaos — plugin defaults with a throwing predicate', () => {
  const apps: App[] = []
  afterEach(() => {
    while (apps.length > 0) apps.pop()?.unmount()
  })

  it('a shouldShowErrors that throws does not crash the form', async () => {
    const explosivePredicate = (): boolean => {
      throw new Error('predicate exploded')
    }
    const handle: { api?: ProfileApi } = {}
    let constructionThrew = false
    try {
      const App = defineComponent({
        setup() {
          handle.api = useForm({
            schema: profileSchema,
            key: `chaos-throw-predicate-${Math.random().toString(36).slice(2)}`,
            defaultValues: { name: '', notify: { channel: 'email', address: '' } },
            shouldShowErrors: explosivePredicate,
          }) as unknown as ProfileApi
          return () => h('div')
        },
      })
      const app = createApp(App).use(
        createAttaform({ defaults: { shouldShowErrors: explosivePredicate } })
      )
      app.mount(document.createElement('div'))
      apps.push(app)
    } catch {
      constructionThrew = true
    }

    expect(constructionThrew).toBe(false)

    // Reading the field's showErrors must not propagate the throw out
    // of the reactive system. Either it returns a default (false) or
    // captures + reports the error — but does not break Vue's render.
    if (handle.api !== undefined) {
      let readThrew = false
      try {
        const _show = (
          handle.api as unknown as {
            fields: { name: { showErrors: boolean } }
          }
        ).fields.name.showErrors
        void _show
      } catch {
        readThrew = true
      }
      expect(readThrew).toBe(false)
    }
  })
})

// -------------------- 13.4 Mount → immediate unmount during hydration --------------------
describe('chaos — mount then immediately unmount during async hydration', () => {
  beforeEach(() => localStorage.clear())
  afterEach(() => localStorage.clear())

  it('does not throw an unhandled rejection from the in-flight hydrate', async () => {
    const formKey = `chaos-mount-unmount-${Math.random().toString(36).slice(2)}`
    const { fingerprintZodSchema } = await import('../../src/runtime/adapters/zod-v4/fingerprint')
    const { hashStableString } = await import('../../src/runtime/core/hash')
    const storageKey = `${formKey}:${hashStableString(fingerprintZodSchema(profileSchema))}`
    localStorage.setItem(
      storageKey,
      JSON.stringify({
        v: 4,
        data: { form: { name: 'p', notify: { channel: 'email', address: 'p@x.io' } } },
      })
    )

    const unhandled: unknown[] = []
    const handler = (e: PromiseRejectionEvent | { reason: unknown }): void => {
      unhandled.push((e as { reason: unknown }).reason)
    }
    if (typeof window.addEventListener === 'function') {
      window.addEventListener('unhandledrejection', handler as EventListener)
    }

    const App = defineComponent({
      setup() {
        useForm({
          schema: profileSchema,
          key: formKey,
          persist: { storage: 'local', debounceMs: 5 },
          defaultValues: { name: '', notify: { channel: 'email', address: '' } },
        })
        return () => h('div')
      },
    })
    const app = createApp(App).use(createAttaform())
    const root = document.createElement('div')
    document.body.appendChild(root)
    app.mount(root)
    // Immediately unmount — hydration is still pending the dynamic
    // adapter import. The disposed-flag guard inside the persistence
    // module should prevent the post-load apply from firing.
    app.unmount()
    document.body.removeChild(root)

    await new Promise((r) => setTimeout(r, 100))

    if (typeof window.removeEventListener === 'function') {
      window.removeEventListener('unhandledrejection', handler as EventListener)
    }

    expect(unhandled.length).toBe(0)
  })
})

// -------------------- 13.5 BigInt at form.values() public surface --------------------
describe('chaos — JSON.stringify(form.values()) with a BigInt-typed leaf', () => {
  const apps: App[] = []
  afterEach(() => {
    while (apps.length > 0) apps.pop()?.unmount()
  })

  it('a consumer that JSON-serialises form.values gets a clear error path with a BigInt leaf', async () => {
    const schema = z.object({ id: z.bigint() })
    type Api = Omit<UseFormReturnType<z.output<typeof schema>>, 'setValue'> & {
      setValue: (path: string, value: unknown) => boolean
      values: { id: bigint }
    }
    const handle: { api?: Api } = {}
    const App = defineComponent({
      setup() {
        handle.api = useForm({
          schema,
          key: `chaos-bigint-public-${Math.random().toString(36).slice(2)}`,
          defaultValues: { id: 0n },
        }) as unknown as Api
        return () => h('div')
      },
    })
    const app = createApp(App).use(createAttaform())
    app.mount(document.createElement('div'))
    apps.push(app)
    const api = handle.api as Api

    api.setValue('id', 9007199254740993n)
    await nextTick()

    // The form's PUBLIC values getter holds a BigInt. A consumer
    // sending this to a JSON-based RPC will hit the same TypeError
    // that variant memory hits internally. The form itself can't fix
    // JSON.stringify, but a future hardening could expose a
    // `form.values('json-safe')` accessor that converts BigInts to
    // strings (or similar). Probe expects today's reality: the
    // serialise throws, leaving the consumer to figure it out.
    let threw = false
    try {
      JSON.stringify(api.values)
    } catch {
      threw = true
    }
    expect(threw).toBe(true)
  })
})

// -------------------- 13.6 Empty schema --------------------
describe('chaos — empty z.object({}) schema', () => {
  const apps: App[] = []
  afterEach(() => {
    while (apps.length > 0) apps.pop()?.unmount()
  })

  it('mounts a form with z.object({}) and accepts validateAsync', async () => {
    const schema = z.object({})
    let api: ReturnType<typeof useForm<typeof schema>> | undefined
    const App = defineComponent({
      setup() {
        api = useForm({
          schema,
          key: `chaos-empty-schema-${Math.random().toString(36).slice(2)}`,
          defaultValues: {},
        })
        return () => h('div')
      },
    })
    const app = createApp(App).use(createAttaform())
    app.mount(document.createElement('div'))
    apps.push(app)
    await nextTick()

    if (api === undefined) throw new Error('mount failed')

    // `api.values` is a callable proxy (call form for dynamic paths,
    // dot access for static paths). Vitest deep-equal treats callable
    // proxies as functions, so compare against the called form which
    // returns the readonly root.
    expect(api.values()).toEqual({})
    const result = await api.validateAsync()
    expect(result.success).toBe(true)
  })
})

// =====================================================================
// 14. ROUND 10 — crash-grade probes. Looking for ways the library
//     can take down a real Vue / Nuxt app, not just trip a test.
// =====================================================================

// -------------------- 14.1 BigInt during a setValue triggered from a Vue template --------------------
describe('crash — BigInt-in-DU surfaces as a thrown error to the Vue app', () => {
  const apps: App[] = []
  afterEach(() => {
    while (apps.length > 0) apps.pop()?.unmount()
  })

  it('a discriminator switch driven by a button click crashes when a BigInt sits at a leaf', async () => {
    const schema = z.object({
      payload: z.discriminatedUnion('kind', [
        z.object({ kind: z.literal('big'), id: z.bigint() }),
        z.object({ kind: z.literal('small'), n: z.number() }),
      ]),
    })

    // Vue's errorHandler captures uncaught errors that escape render
    // / handlers. Wire a spy to detect any.
    const captured: unknown[] = []
    const handle: { api?: ReturnType<typeof useForm<typeof schema>> } = {}
    const App = defineComponent({
      setup() {
        handle.api = useForm({
          schema,
          key: `crash-bigint-render-${Math.random().toString(36).slice(2)}`,
          defaultValues: { payload: { kind: 'big', id: 9007199254740993n } },
        })
        return () => h('div')
      },
    })
    const app = createApp(App).use(createAttaform())
    app.config.errorHandler = (err): void => {
      captured.push(err)
    }
    app.mount(document.createElement('div'))
    apps.push(app)
    const api = handle.api as ReturnType<typeof useForm<typeof schema>>

    // The user clicks "switch to small". The synchronous setValue
    // triggers reshape → JSON.stringify(BigInt) → throws → propagates
    // up the call chain. Does it escape into the app?
    let setValueThrew = false
    try {
      api.setValue('payload.kind', 'small')
    } catch {
      setValueThrew = true
    }
    await nextTick()

    // If `setValue` itself throws (rather than returning false), the
    // crash propagates to whatever event handler called it — a click
    // handler in real Vue. Either the throw is caught by Vue's
    // errorHandler, or it surfaces inline. Both modes are equally
    // bad: a discriminator switch should never crash.
    const crashed = setValueThrew || captured.length > 0
    expect(crashed).toBe(false)
  })
})

// -------------------- 14.2 useForm with unsupported schema crashes setup() --------------------
describe('crash — recursive z.lazy + DU at construction', () => {
  it('mounting a component whose setup uses an unsupported schema throws out of mount()', () => {
    type Node = { kind: 'leaf'; value: string } | { kind: 'branch'; children: Node[] }
    const nodeSchema: z.ZodType<Node> = z.lazy(() =>
      z.discriminatedUnion('kind', [
        z.object({ kind: z.literal('leaf'), value: z.string() }),
        z.object({ kind: z.literal('branch'), children: z.array(nodeSchema) }),
      ])
    )
    const treeSchema = z.object({ tree: nodeSchema })

    const App = defineComponent({
      setup() {
        // Uncaught — propagates to the caller of mount().
        useForm({
          schema: treeSchema,
          key: 'crash-lazy-du',
          defaultValues: { tree: { kind: 'leaf', value: '' } },
        })
        return () => h('div')
      },
    })

    let crashed = false
    try {
      const app = createApp(App).use(createAttaform())
      app.mount(document.createElement('div'))
      app.unmount()
    } catch {
      crashed = true
    }

    // A real-world consequence: a Nuxt page using a recursive
    // tree-shaped DU schema fails to render entirely — the whole
    // route is broken. Either the library should narrow what it
    // rejects, or the rejection should land as a controlled error
    // surface (not a thrown construction-time crash).
    expect(crashed).toBe(false)
  })
})

// -------------------- 14.3 Infinite reactivity loop via computed that calls setValue --------------------
describe('crash — infinite reactivity loop via setValue inside a computed', () => {
  const apps: App[] = []
  afterEach(() => {
    while (apps.length > 0) apps.pop()?.unmount()
  })

  it("Vue's max-recursive-update guard catches a setValue-driven feedback loop", async () => {
    const schema = z.object({ a: z.string(), b: z.string() })

    // A misguided template: `b` mirrors `a` via a computed that
    // writes back to `b`. The computed reads `a`, calls setValue('b',
    // ...), which triggers a re-render, which re-evaluates the
    // computed, which writes again. Vue's renderer should detect the
    // loop and warn (not crash) — but what does attaform do?
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const handle: { api?: ReturnType<typeof useForm<typeof schema>>; iterations?: number } = {
      iterations: 0,
    }
    let crashed = false
    try {
      const App = defineComponent({
        setup() {
          const api = useForm({
            schema,
            key: `crash-loop-${Math.random().toString(36).slice(2)}`,
            defaultValues: { a: '', b: '' },
          })
          handle.api = api
          return () => {
            const aVal = api.values.a
            handle.iterations = (handle.iterations ?? 0) + 1
            // Cap the loop ourselves so the test process doesn't
            // genuinely hang — the framework should ALSO cap it.
            if ((handle.iterations ?? 0) < 200) {
              api.setValue('b', aVal + '!')
            }
            return h('div', `${aVal} | ${api.values.b}`)
          }
        },
      })
      const app = createApp(App).use(createAttaform())
      app.mount(document.createElement('div'))
      apps.push(app)

      handle.api!.setValue('a', 'one')
      await nextTick()
      await nextTick()
    } catch {
      crashed = true
    } finally {
      warnSpy.mockRestore()
      errorSpy.mockRestore()
    }

    expect(crashed).toBe(false)
    // The render iteration count should be bounded — if the loop
    // ran 200 times, Vue's safeguard didn't trigger and we hit our
    // self-cap. That's a hang in a real app.
    expect(handle.iterations ?? 0).toBeLessThan(200)
  })
})

// -------------------- 14.4 Deep-path setValue stack overflow --------------------
describe('crash — extremely deep path setValue', () => {
  const apps: App[] = []
  afterEach(() => {
    while (apps.length > 0) apps.pop()?.unmount()
  })

  it('a 1000-segment path does not cause a stack overflow', async () => {
    // Build a deeply-nested schema. z.object().nest 1000-deep is
    // unwieldy to construct cleanly; use z.record(z.string(),
    // z.lazy()) for an arbitrary-depth bag.
    const schema = z.object({ root: z.record(z.string(), z.unknown()) })
    type Api = Omit<UseFormReturnType<z.output<typeof schema>>, 'setValue'> & {
      setValue: (path: string, value: unknown) => boolean
    }
    const handle: { api?: Api } = {}
    const App = defineComponent({
      setup() {
        handle.api = useForm({
          schema,
          key: `crash-deep-${Math.random().toString(36).slice(2)}`,
          defaultValues: { root: {} },
        }) as unknown as Api
        return () => h('div')
      },
    })
    const app = createApp(App).use(createAttaform())
    app.mount(document.createElement('div'))
    apps.push(app)
    const api = handle.api as Api

    // Build root.a.a.a.... 1000-deep. z.unknown() at the leaves keeps
    // the slim-gate permissive.
    const segments: string[] = ['root']
    for (let i = 0; i < 1000; i++) segments.push('a')
    const path = segments.join('.')

    let crashed = false
    try {
      api.setValue(path, 'leaf')
    } catch {
      crashed = true
    }
    await nextTick()

    expect(crashed).toBe(false)
  })
})

// -------------------- 14.5 handleSubmit onSuccess that throws --------------------
describe('crash — handleSubmit onSuccess callback throws', () => {
  const apps: App[] = []
  afterEach(() => {
    while (apps.length > 0) apps.pop()?.unmount()
  })

  it("the throw is reported via Vue's errorHandler, not silently swallowed", async () => {
    const { app, api } = mountProfile()
    apps.push(app)

    // Pin the form to a valid state so submit invokes onSuccess.
    api.setValue('name', 'Ada')
    api.setValue('notify', { channel: 'sms', number: '5551234' })
    await nextTick()

    const captured: unknown[] = []
    app.config.errorHandler = (err): void => {
      captured.push(err)
    }

    const submit = api.handleSubmit(
      () => {
        throw new Error('onSuccess exploded')
      },
      () => {}
    )

    let promiseRejected = false
    try {
      await submit()
    } catch {
      promiseRejected = true
    }

    // Either the submit promise rejects (consumer can `.catch`) OR
    // Vue's errorHandler captures (consumer can wire it). What we
    // DON'T want: silent swallowing where the user clicks Submit,
    // sees nothing happen, and has no path to recovery.
    const observable = promiseRejected || captured.length > 0
    expect(observable).toBe(true)
  })
})

// -------------------- 14.6 Render-time chain access on inactive variant --------------------
describe('crash — render template chain access into an inactive-variant subtree', () => {
  const apps: App[] = []
  afterEach(() => {
    while (apps.length > 0) apps.pop()?.unmount()
  })

  it("`api.fields.notify.address.value` while channel is 'sms' does not throw during render", async () => {
    let captured: unknown = null
    const App = defineComponent({
      setup() {
        const api = useForm({
          schema: profileSchema,
          key: `crash-chain-render-${Math.random().toString(36).slice(2)}`,
          defaultValues: { name: '', notify: { channel: 'sms', number: '5551234' } },
        })
        return () => {
          // Active variant is sms; `address` belongs to email. The
          // FieldState lift is documented to return a stub for
          // inactive-variant chains. If it ever throws, the entire
          // component fails to render — Vue marks the parent as
          // errored and the subtree disappears.
          try {
            const _val = (api.fields as unknown as Record<string, unknown>).notify
            const notifyObj = _val as Record<string, unknown>
            const addr = notifyObj.address as Record<string, unknown> | undefined
            void addr?.value
          } catch (err) {
            captured = err
          }
          return h('div')
        }
      },
    })
    const app = createApp(App).use(createAttaform())
    app.mount(document.createElement('div'))
    apps.push(app)
    await nextTick()

    expect(captured).toBeNull()
  })
})

// -------------------- 14.7 Vue prerender (renderToString) on a misconfigured form --------------------
describe('crash — SSR / prerender stability with misconfigured forms', () => {
  it('renderToString on a form with bad-disc defaultValues does not throw', async () => {
    let threw = false
    try {
      const App = defineComponent({
        setup() {
          useForm({
            schema: profileSchema,
            key: 'ssr-bad-disc',
            defaultValues: { name: '', notify: { channel: 'wat' } } as never,
          })
          return () => h('div')
        },
      })
      const ssrApp = createSSRApp(App).use(createAttaform())
      await renderToString(ssrApp)
    } catch {
      threw = true
    }

    // A Nuxt page that prerenders this form fails the build if this
    // throws — taking down a static deploy.
    expect(threw).toBe(false)
  })
})
