import { computed, ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { buildStepperStatusesProxy } from '../../src/runtime/core/stepper-statuses-proxy'
import type { FormStatus } from '../../src/runtime/types/types-stepper'

/**
 * `buildStepperStatusesProxy(statusMap)` mirrors `form.values`'
 * call-or-read pattern at one level of depth.
 *
 *   stepper.statuses.cargo          // FormStatus (readable)
 *   stepper.statuses('cargo')       // FormStatus (callable single-key)
 *   stepper.statuses()              // Record<key, FormStatus> (callable no-arg)
 *
 * Reactivity contract: each per-key entry is a `ComputedRef<FormStatus>`,
 * unwrapped by the proxy at read time so consumers don't deal with
 * `.value`. Writes are blocked.
 */

const pending: FormStatus = {
  isValid: false,
  isDirty: false,
  isSubmitted: false,
  errorCount: 0,
}

function makeProxy(map: Record<string, FormStatus>) {
  const sources = Object.fromEntries(
    Object.entries(map).map(([key, value]) => [key, ref(value)])
  ) as Record<string, ReturnType<typeof ref<FormStatus>>>
  const computeds = Object.fromEntries(
    Object.entries(sources).map(([key, source]) => [key, computed(() => source.value)])
  ) as Record<string, ReturnType<typeof computed<FormStatus>>>
  return { proxy: buildStepperStatusesProxy(computeds), sources }
}

describe('buildStepperStatusesProxy', () => {
  it('exposes per-key entries via property access', () => {
    const { proxy } = makeProxy({
      a: { isValid: true, isDirty: false, isSubmitted: false, errorCount: 0 },
      b: { isValid: false, isDirty: true, isSubmitted: false, errorCount: 2 },
    })
    expect(proxy.a.isValid).toBe(true)
    expect(proxy.b.errorCount).toBe(2)
  })

  it('returns a single entry via callable form', () => {
    const { proxy } = makeProxy({
      cargo: { isValid: true, isDirty: false, isSubmitted: false, errorCount: 0 },
    })
    const status = proxy('cargo') as FormStatus
    expect(status.isValid).toBe(true)
  })

  it('returns the full record via no-arg callable form', () => {
    const { proxy } = makeProxy({
      a: pending,
      b: { isValid: true, isDirty: false, isSubmitted: false, errorCount: 0 },
    })
    const all = proxy() as Record<string, FormStatus>
    expect(all.a).toMatchObject(pending)
    expect(all.b.isValid).toBe(true)
  })

  it('reflects reactive updates from the underlying computeds', () => {
    const { proxy, sources } = makeProxy({ a: pending })
    expect(proxy.a.isValid).toBe(false)
    const aSource = sources.a as ReturnType<typeof ref<FormStatus>>
    aSource.value = { isValid: true, isDirty: true, isSubmitted: true, errorCount: 0 }
    expect(proxy.a.isValid).toBe(true)
    expect(proxy.a.isDirty).toBe(true)
  })

  it('returns undefined for an unknown key in property access', () => {
    const { proxy } = makeProxy({ a: pending })
    expect((proxy as Record<string, unknown>).unknown).toBeUndefined()
  })

  it('returns undefined when called with an unknown key', () => {
    const { proxy } = makeProxy({ a: pending })
    const result = (proxy as (key?: string) => FormStatus | Record<string, FormStatus> | undefined)(
      'unknown'
    )
    expect(result).toBeUndefined()
  })

  it('blocks writes with a dev-only warning', () => {
    const warnings: string[] = []
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
      warnings.push(args.map((a) => String(a)).join(' '))
    })
    const { proxy } = makeProxy({ a: pending })
    try {
      ;(proxy as unknown as { a: FormStatus }).a = pending
    } catch {
      // strict-mode environments may throw — fine either way
    }
    warnSpy.mockRestore()
    expect(warnings.some((w) => w.includes('read-only'))).toBe(true)
  })

  it('serializes via toJSON to the current record snapshot', () => {
    const { proxy } = makeProxy({
      a: { isValid: true, isDirty: false, isSubmitted: false, errorCount: 0 },
    })
    const serialized = JSON.parse(JSON.stringify(proxy))
    expect(serialized.a.isValid).toBe(true)
  })
})
