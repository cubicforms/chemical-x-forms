// @vitest-environment jsdom
import { fc, test } from '@fast-check/vitest'
import { afterEach, beforeEach, describe, expect, vi } from 'vitest'
import type { App } from 'vue'
import { z } from 'zod-v3'
import { useForm } from '../../src/zod-v3'
import { zodAdapter } from '../../src/runtime/adapters/zod-v3'
import { getAtPath } from '../../src/runtime/core/path-walker'
import type { SlimPrimitiveKind } from '../../src/runtime/types/types-api'
import { flush, makeMounter } from '../utils/form-harness'
import {
  arbitraryValueOfKind,
  buildSchemaWithManifest,
  COMPARABLE_KINDS,
  type ComparableKind,
} from '../utils/schema-manifest'

/**
 * Mirror of `slim-primitive-write-gate.property.test.ts`, targeting
 * the zod v3 adapter. The generator and harness are shared; this file
 * differs only in its imports (`zod-v3`, the v3 useForm/zodAdapter).
 *
 * The v3 adapter shipped the same unknown-path bug as v4 (returning
 * `PERMISSIVE` instead of an empty set) and got the same fix; this
 * test confirms the fix holds at the v3 boundary too.
 */

const arbSchema = buildSchemaWithManifest(z, 3)

type SetValueFn = (path: string, value: unknown) => boolean

describe('slim-primitive write gate — property: manifest sanity (v3)', () => {
  test.prop([arbSchema])(
    'manifest leaf accept-sets equal adapter.getSlimPrimitiveTypesAtPath',
    ({ schema, leaves }) => {
      const adapter = zodAdapter(schema as z.ZodObject<z.ZodRawShape>)('manifest-sanity')
      for (const leaf of leaves) {
        const adapterSet = adapter.getSlimPrimitiveTypesAtPath(leaf.path)
        expect([...adapterSet].sort()).toEqual([...leaf.acceptSet].sort())
      }
    }
  )
})

describe('slim-primitive write gate — property: known leaf paths (v3)', () => {
  const apps: App[] = []
  let warnSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
  })
  afterEach(async () => {
    while (apps.length > 0) apps.pop()?.unmount()
    warnSpy.mockRestore()
    await flush()
  })

  test.prop([
    arbSchema.chain((sm) =>
      fc
        .record({
          leafIdx: fc.nat({ max: sm.leaves.length - 1 }),
          kind: fc.constantFrom<ComparableKind>(...COMPARABLE_KINDS),
        })
        .chain(({ leafIdx, kind }) =>
          arbitraryValueOfKind(kind).map((value) => ({ sm, leafIdx, kind, value }))
        )
    ),
  ])(
    'setValue accepts iff value-kind ∈ leaf.acceptSet; leaf reflects the write',
    async ({ sm, leafIdx, kind, value }) => {
      const leaf = sm.leaves[leafIdx]
      if (leaf === undefined) return
      const expected = leaf.acceptSet.has(kind as SlimPrimitiveKind)

      const { api, app } = makeMounter(useForm, sm.schema)()
      apps.push(app)

      const beforeForm = api.values
      const ok = (api.setValue as SetValueFn)(leaf.path.join('.'), value)
      await flush()

      expect(ok).toBe(expected)

      if (expected) {
        expect(getAtPath(api.values(), leaf.path)).toEqual(value)
      } else {
        expect(api.values).toBe(beforeForm)
      }
    }
  )
})

describe('slim-primitive write gate — property: unknown paths (v3)', () => {
  const apps: App[] = []
  let warnSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
  })
  afterEach(async () => {
    while (apps.length > 0) apps.pop()?.unmount()
    warnSpy.mockRestore()
    await flush()
  })

  test.prop([
    arbSchema.chain((sm) =>
      fc
        .record({
          leafIdx: fc.nat({ max: sm.leaves.length - 1 }),
          kind: fc.constantFrom<ComparableKind>(...COMPARABLE_KINDS),
        })
        .chain(({ leafIdx, kind }) =>
          arbitraryValueOfKind(kind).map((value) => ({ sm, leafIdx, value }))
        )
    ),
  ])(
    'setValue to a path not defined in the schema rejects; form unchanged',
    async ({ sm, leafIdx, value }) => {
      const realLeaf = sm.leaves[leafIdx]
      if (realLeaf === undefined) return

      const unknownPath = [...realLeaf.path, '__unknown_xx'].join('.')

      const { api, app } = makeMounter(useForm, sm.schema)()
      apps.push(app)

      const beforeForm = api.values
      const ok = (api.setValue as SetValueFn)(unknownPath, value)
      await flush()

      expect(ok).toBe(false)
      expect(api.values).toBe(beforeForm)
    }
  )
})
