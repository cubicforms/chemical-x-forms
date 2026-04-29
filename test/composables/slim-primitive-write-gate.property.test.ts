// @vitest-environment jsdom
import { fc, test } from '@fast-check/vitest'
import { afterEach, beforeEach, describe, expect, vi } from 'vitest'
import type { App } from 'vue'
import { z } from 'zod'
import { useForm } from '../../src/zod'
import { zodAdapter } from '../../src/runtime/adapters/zod-v4'
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
 * Property tests for the slim-primitive write gate (zod v4 adapter).
 *
 * Three properties cover the gate's contract end-to-end. The "manifest
 * sanity" property must run first conceptually — if it fails, the
 * generator (and therefore the other two properties) is testing the
 * wrong thing.
 *
 * Mirror file: `slim-primitive-write-gate-v3.property.test.ts` runs
 * the same three properties against the v3 adapter; the generator is
 * shared via `test/utils/schema-manifest.ts`.
 */

const arbSchema = buildSchemaWithManifest(z, 3)

// `setValue`'s typed signature on `useForm<S>` is `(path: string, value: any)
// => boolean` for non-callback writes; cast through `unknown` once at
// the helper boundary so each call site stays terse.
type SetValueFn = (path: string, value: unknown) => boolean

describe('slim-primitive write gate — property: manifest sanity (v4)', () => {
  // No setValue here — directly reconciles the generator's recorded
  // accept-set against the adapter's `getSlimPrimitiveTypesAtPath`.
  // Failure means the generator (the test's oracle) is wrong.
  test.prop([arbSchema])(
    'manifest leaf accept-sets equal adapter.getSlimPrimitiveTypesAtPath',
    ({ schema, leaves }) => {
      const adapter = zodAdapter(schema as z.ZodObject)('manifest-sanity')
      for (const leaf of leaves) {
        const adapterSet = adapter.getSlimPrimitiveTypesAtPath(leaf.path)
        expect([...adapterSet].sort()).toEqual([...leaf.acceptSet].sort())
      }
    }
  )
})

describe('slim-primitive write gate — property: known leaf paths (v4)', () => {
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
    // Two-stage chain: first generate the schema (so we know its
    // leaves), then pick a leaf index and a kind, then sample a value
    // of that kind. Using `chain` keeps everything correlated within
    // a single arbitrary so fast-check's shrinker can collapse the
    // whole tuple toward a minimal failing case.
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
      if (leaf === undefined) return // generator invariant; never reached
      const expected = leaf.acceptSet.has(kind as SlimPrimitiveKind)

      const { api, app } = makeMounter(useForm, sm.schema)()
      apps.push(app)

      // Capture the form ref's pre-write value identity. Accepted writes
      // that produce a real change replace `form.value` via
      // `applyFormReplacement` (create-form-store.ts:649); rejected
      // writes return early at the slim-gate (line 603) and don't
      // touch the ref. Identity equality is therefore a tight
      // "no mutation happened" check that sidesteps cloning Vue's
      // reactive proxy (structuredClone refuses it).
      const beforeForm = api.getValue().value

      const ok = (api.setValue as SetValueFn)(leaf.path.join('.'), value)
      await flush()

      expect(ok).toBe(expected)

      if (expected) {
        // Leaf at the written path must equal the written value.
        // `toEqual` handles Date/BigInt/null/undefined/primitives uniformly.
        expect(getAtPath(api.getValue().value, leaf.path)).toEqual(value)
      } else {
        // Rejected: form ref must hold the same identity. A "rejected
        // but partially applied" bug would replace the ref and fail this.
        expect(api.getValue().value).toBe(beforeForm)
      }
    }
  )
})

describe('slim-primitive write gate — property: unknown paths (v4)', () => {
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

      // Append a sentinel segment that the schema generator can never
      // emit. The object-key arbitrary requires
      // `^[a-zA-Z_][a-zA-Z0-9_]*$` with maxLength 4 — `__unknown_xx`
      // is 12 chars, so it cannot match a generated key regardless of
      // schema shape. Tacking it onto a real path produces "real
      // parent + unknown tail" coverage; the schema variation across
      // runs gives us the missing-root-segment case naturally too.
      const unknownPath = [...realLeaf.path, '__unknown_xx'].join('.')

      const { api, app } = makeMounter(useForm, sm.schema)()
      apps.push(app)

      const beforeForm = api.getValue().value
      const ok = (api.setValue as SetValueFn)(unknownPath, value)
      await flush()

      expect(ok).toBe(false)
      expect(api.getValue().value).toBe(beforeForm)
    }
  )
})
