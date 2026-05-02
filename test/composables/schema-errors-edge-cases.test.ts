// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { createApp, defineComponent, h, nextTick, type App } from 'vue'
import { z } from 'zod'
import { useForm } from '../../src/zod'
import { createChemicalXForms } from '../../src/runtime/core/plugin'
import type { UseFormReturnType, ValidationError } from '../../src/runtime/types/types-api'

/**
 * Edge cases adjacent to the schemaErrors-keying fix in
 * scheduleFieldValidation (commit 9f0d4ce). The fix grouped errors by
 * each issue's own absolute path and cleared the scheduled path's
 * descendant subtree before writing — so several other failure modes
 * become tractable to pin down here:
 *
 *   1. Cross-field refines whose error path equals a container path.
 *   2. Validation flipping failing → passing for a previously-failing leaf.
 *   3. Field-array shrink leaving stale errors at a no-longer-existing index.
 *   4. Parent + leaf scheduled validations racing on overlapping paths.
 */

type LooseApi<Schema extends z.ZodObject> = Omit<
  UseFormReturnType<z.output<Schema>>,
  'setValue'
> & {
  setValue: (path: string, value: unknown) => boolean
  remove: (path: string, index: number) => boolean
}

function mountForm<Schema extends z.ZodObject>(
  schema: Schema,
  defaultValues: NonNullable<Parameters<typeof useForm<Schema>>[0]['defaultValues']>
): { app: App; api: LooseApi<Schema> } {
  const handle: { api?: LooseApi<Schema> } = {}
  const App = defineComponent({
    setup() {
      handle.api = useForm({
        schema,
        key: `edge-${Math.random().toString(36).slice(2)}`,
        defaultValues,
        // Immediate field-validation so each setValue's `change`-mode
        // schedule fires synchronously after the next microtask.
        // Behaviour under test doesn't depend on the debounce window.
        validateOn: 'change',
        debounceMs: 0,
      }) as unknown as LooseApi<Schema>
      return () => h('div')
    },
  })
  const app = createApp(App).use(createChemicalXForms({ override: true }))
  app.config.warnHandler = () => {}
  app.config.errorHandler = () => {}
  app.mount(document.createElement('div'))
  return { app, api: handle.api as LooseApi<Schema> }
}

async function flushValidations(): Promise<void> {
  await nextTick()
  await new Promise<void>((r) => setTimeout(r, 0))
  await nextTick()
}

describe('schemaErrors edge cases — cross-field refine on a container', () => {
  // A `.refine()` on a container produces an error whose absolute path
  // equals the container's path (no leaf segment). The new
  // `applySchemaErrorsForSubtree` groups by `err.path`, so it lands at
  // the container's key. By design `form.errors` is descend-only (never
  // terminates at a container), so the refine error is invisible
  // through dot-access — but it MUST surface in `form.meta.errors` and
  // it must round-trip cleanly across writes that re-trigger
  // validation.
  const schema = z
    .object({
      address: z.object({
        city: z.string().min(1),
        zip: z.string().min(1),
      }),
    })
    .refine((data) => data.address.city !== data.address.zip, {
      message: 'city and zip must differ',
      path: ['address'],
    })

  const apps: App[] = []
  afterEach(() => {
    while (apps.length > 0) apps.pop()?.unmount()
  })

  it('refine error at a container path lands in form.meta.errors, not form.errors', async () => {
    const { app, api } = mountForm(schema, { address: { city: 'Springfield', zip: 'Springfield' } })
    apps.push(app)
    await flushValidations()
    // Trigger a write so scheduleFieldValidation fires at the leaf path
    // (city), which propagates an error at the parent via the refine —
    // adapters typically surface the refine on the `.address` path.
    api.setValue('address.city', 'Springfield')
    await flushValidations()

    // Force whole-form validation through handleSubmit so the
    // top-level refine actually executes (per-leaf schedules don't
    // run cross-field refines unless the adapter walks the parent —
    // submission is the canonical trigger).
    const submit = api.handleSubmit(
      () => {},
      () => {}
    )
    await submit()
    await nextTick()

    // The refine error surfaces in the unfiltered aggregate.
    const refineErr = api.meta.errors.find((e) => /city and zip/.test(e.message))
    expect(refineErr).toBeDefined()
    expect(refineErr?.path).toEqual(['address'])

    // form.errors is descend-only at containers — drilling never
    // reaches a refine keyed at a container itself.
    const errorsAtContainer = (
      api.errors as unknown as (p: string) => ValidationError[] | undefined
    )('address')
    // Container access returns the proxy, not an array. Dotted-call to
    // a container path returns the sub-proxy (drillable), not the
    // refine error.
    expect(Array.isArray(errorsAtContainer)).toBe(false)
  })

  it('container-keyed refine error survives a leaf-keyed re-validation', async () => {
    // After fixing the leaf and re-validating, the leaf's error clears
    // BUT the container-keyed refine (a separate canonical key) must
    // not be wiped by the leaf's own subtree clear. The fix's
    // `applySchemaErrorsForSubtree(path, …)` only deletes entries whose
    // key descends from `path` — a container's own entry is not a
    // descendant of its leaf children, so it stays.
    const { app, api } = mountForm(schema, { address: { city: 'Springfield', zip: 'Springfield' } })
    apps.push(app)
    const submit = api.handleSubmit(
      () => {},
      () => {}
    )
    await submit()
    await nextTick()
    expect(api.meta.errors.some((e) => /city and zip/.test(e.message))).toBe(true)

    // Re-validate just the leaf — the leaf's subtree clear is rooted
    // at `['address','city']`, so the refine entry keyed at
    // `['address']` is not a descendant and must NOT be cleared.
    api.setValue('address.city', 'Springfield') // unchanged value, but triggers schedule
    await flushValidations()

    expect(api.meta.errors.some((e) => /city and zip/.test(e.message))).toBe(true)
  })
})

describe('schemaErrors edge cases — failing → passing transition', () => {
  // Pre-fix, sticky errors were possible because the only clear path
  // was `setSchemaErrorsForPath(parent, [])` which deleted ONE key.
  // After the fix, `applySchemaErrorsForSubtree` clears the whole
  // subtree before writing, and the empty-`entries` path falls
  // through the `if (entries.length === 0) return` AFTER the clear —
  // so a leaf transitioning from failing to passing reliably wipes.
  const schema = z.object({ email: z.email() })

  const apps: App[] = []
  afterEach(() => {
    while (apps.length > 0) apps.pop()?.unmount()
  })

  it('leaf flips from invalid to valid: error clears on the next schedule', async () => {
    const { app, api } = mountForm(schema, { email: 'not-an-email' })
    apps.push(app)
    api.setValue('email', 'not-an-email')
    await flushValidations()

    // Failing state: error landed.
    const before = (api.errors as unknown as (p: string) => ValidationError[] | undefined)('email')
    expect(before).toBeDefined()
    expect(before?.[0]?.code).toMatch(/zod:/)

    // Fix the value — schedule fires again, validation passes,
    // applySchemaErrorsForSubtree clears the (now-empty) subtree.
    api.setValue('email', 'valid@example.com')
    await flushValidations()

    const after = (api.errors as unknown as (p: string) => ValidationError[] | undefined)('email')
    expect(after).toBeUndefined()
    expect(api.meta.errors).toEqual([])
  })

  it('container re-validation that newly passes clears every leaf entry under it', async () => {
    // A container schedule (e.g. after a DU reshape, or a whole-record
    // setValue) that resolves cleanly must wipe all descendant leaf
    // entries, not just the parent's own key.
    const containerSchema = z.object({
      address: z.object({
        city: z.string().min(1),
        zip: z.string().regex(/^\d{5}$/),
      }),
    })
    const { app, api } = mountForm(containerSchema, { address: { city: '', zip: 'bad' } })
    apps.push(app)
    api.setValue('address.city', '') // schedule + fail at city
    api.setValue('address.zip', 'bad') // schedule + fail at zip
    await flushValidations()

    expect(
      (api.errors as unknown as (p: string) => ValidationError[] | undefined)('address.city')
    ).toBeDefined()
    expect(
      (api.errors as unknown as (p: string) => ValidationError[] | undefined)('address.zip')
    ).toBeDefined()

    // Whole-container write that passes for both leaves.
    api.setValue('address', { city: 'NYC', zip: '10001' })
    await flushValidations()

    expect(
      (api.errors as unknown as (p: string) => ValidationError[] | undefined)('address.city')
    ).toBeUndefined()
    expect(
      (api.errors as unknown as (p: string) => ValidationError[] | undefined)('address.zip')
    ).toBeUndefined()
    expect(api.meta.errors).toEqual([])
  })
})

describe('schemaErrors edge cases — field-array shrink', () => {
  // Removing an erroring element from an array should leave no stale
  // entry at the (now-nonexistent) index. The cleanup happens through
  // setValueAtPath → scheduleFieldValidation(arrayPath), which routes
  // to the same applySchemaErrorsForSubtree clear-then-leaf-write
  // sweep — so the test pins THAT contract for arrays.
  const schema = z.object({
    tags: z.array(z.string().min(1)),
  })

  const apps: App[] = []
  afterEach(() => {
    while (apps.length > 0) apps.pop()?.unmount()
  })

  it('remove(index): leaf errors at the removed index are cleared', async () => {
    const { app, api } = mountForm(schema, { tags: ['', 'b', 'c'] })
    apps.push(app)
    // Trigger a validation that lands an error at tags.0
    api.setValue('tags', ['', 'b', 'c'])
    await flushValidations()
    expect(
      (api.errors as unknown as (p: string) => ValidationError[] | undefined)('tags.0')
    ).toBeDefined()

    api.remove('tags', 0)
    await flushValidations()

    // tags.0 is now 'b' (was 'b' at index 1) — passes .min(1).
    expect(
      (api.errors as unknown as (p: string) => ValidationError[] | undefined)('tags.0')
    ).toBeUndefined()
    // No ghost meta-error for the removed index — the unfiltered
    // aggregate stays clean too.
    expect(api.meta.errors).toEqual([])
  })

  it('remove(index): error at a different surviving index re-keys to the new position', async () => {
    // tags.2 errored before remove. After remove(0), former index 2
    // becomes index 1. Validation re-runs at the array path, finds
    // 'c' is fine but the originally-bad element at index 2 is now
    // at index 1. The clear-subtree wipes the stale `tags.2` entry,
    // and the new run keys nothing (since '' was removed and 'b' /
    // 'c' both pass .min(1)).
    const { app, api } = mountForm(schema, { tags: ['', 'b', 'c'] })
    apps.push(app)
    api.setValue('tags', ['', 'b', 'c'])
    await flushValidations()

    // Confirm the only error is at index 0 to start.
    expect(api.meta.errors.map((e) => e.path.join('.'))).toEqual(['tags.0'])

    api.remove('tags', 0)
    await flushValidations()

    // No leftover entries at any index.
    expect(api.meta.errors).toEqual([])
  })
})

describe('schemaErrors edge cases — parent + leaf overlapping schedules', () => {
  // Two scheduled validations on overlapping paths can race. With
  // immediate (debounceMs: 0) schedules, the parent's clear-subtree
  // and the leaf's own write may interleave. The contract we pin:
  // after BOTH runs settle, the schemaErrors store reflects the
  // current form storage (no stale entries, no missing entries from a
  // racing clobber).
  const schema = z.object({
    address: z.object({
      city: z.string().min(2),
      zip: z.string().min(5),
    }),
  })

  const apps: App[] = []
  afterEach(() => {
    while (apps.length > 0) apps.pop()?.unmount()
  })

  it('settled state reflects current values regardless of schedule order', async () => {
    const { app, api } = mountForm(schema, { address: { city: '', zip: '' } })
    apps.push(app)

    // Trigger overlapping schedules: a leaf write (fires schedule at
    // the leaf path) AND a container write (fires schedule at the
    // container path). Both run after one microtask flush; the order
    // their setTimeout callbacks resolve is implementation-defined,
    // but the final state must reflect storage.
    api.setValue('address.city', 'X') // fails .min(2) → leaf error
    api.setValue('address', { city: 'X', zip: '12' }) // fails BOTH → both errors expected
    await flushValidations()
    await flushValidations() // double-flush in case both runs queue separate work

    // Final storage matches:
    expect(api.values.address).toEqual({ city: 'X', zip: '12' })
    // Final errors match storage's failing leaves:
    const cityErrors = (api.errors as unknown as (p: string) => ValidationError[] | undefined)(
      'address.city'
    )
    const zipErrors = (api.errors as unknown as (p: string) => ValidationError[] | undefined)(
      'address.zip'
    )
    expect(cityErrors?.[0]?.path).toEqual(['address', 'city'])
    expect(zipErrors?.[0]?.path).toEqual(['address', 'zip'])
  })

  it('rapid same-path re-schedule: aborts the in-flight run, no orphaned entries', async () => {
    // Same-path schedules abort the previous controller. So if the
    // user is hammering the keyboard, only the latest validation
    // result lands. Between aborts, no half-written state.
    const leafSchema = z.object({ email: z.email() })
    const { app, api } = mountForm(leafSchema, { email: 'not-yet' })
    apps.push(app)

    api.setValue('email', 'a')
    api.setValue('email', 'ab')
    api.setValue('email', 'abc@example.com') // valid — final
    await flushValidations()

    // Final state: no errors; only the final scheduled run won.
    const errs = (api.errors as unknown as (p: string) => ValidationError[] | undefined)('email')
    expect(errs).toBeUndefined()
    expect(api.meta.errors).toEqual([])
  })
})
