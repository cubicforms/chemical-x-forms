# Performance notes

The library's hot paths have bench coverage in `bench/`. Absolute
ops/sec change across Node versions and hardware; these notes cover
the shape of the cost, not the numbers.

## The hot path: keystroke → form mutation

A single `register`-bound input firing `input` on every keystroke
goes through:

1. The directive picks up the new DOM value and calls
   `RegisterValue.setValueWithInternalPath(value)`.
2. That calls `setValueAtPath` on the form's state.
3. `setValueAtPath` composes `setAtPath` (path-walker) to produce a
   new root value, then `applyFormReplacement`.
4. `applyFormReplacement` runs `diffAndApply` from the old root to
   the new one, emitting patches only for leaves that actually
   changed (and touching the matching field records).

The keystroke bench (`bench/keystroke.bench.ts`) measures the cost
of step 4 in isolation on a 100- and a 500-leaf form. Current
baseline is 6–12× faster than the pre-rewrite algorithm; the
regression floor in `scripts/check-bench.mjs` is 3×.

## Schema depth and leaf count

`deriveDefault` (zod-v4 adapter) is O(leaf count) — every leaf in the
schema contributes one walk step at form mount. 500 leaves is
comfortable; 5 000+ will show up on the profiler. If you're at that
scale, consider splitting the form into sub-forms with distinct
`key`s rather than wrapping one giant schema.

Deep (>8 levels) nesting has no direct runtime cost beyond the
allocation of one path-walker frame per level. The diff-apply walker
recurses once per level on changed subtrees only, so depth-on-the-
unchanged-side is free.

## Array size

Field-array helpers (`append` / `prepend` / `insert` / `remove` /
`swap` / `move`) all copy the target array before mutating, so each
call is O(N) in the array length. A 1 000-item array still appends
at ~1.8 k ops/sec on laptop hardware — fast enough that user
interaction feels instant, but not free. Two patterns worth knowing:

- **Bulk appends**: building an array by calling `append` N times is
  O(N²). For a large seed, prefer one `setValue('items', nextArray)`
  with the full array built outside the helper.
- **Keying in `v-for`**: use a stable per-row key (IDs from the data
  if you have them, or a client-generated `crypto.randomUUID()`
  stored on the row). Keying by index breaks when rows move — Vue
  will re-render more than necessary and focus/scroll state on
  rearranged rows will flicker.

## Discriminated unions

Validation on a DU schema filters active-branch options via the
discriminator key. The DU-aware path walker (`zod-v4/path-walker.ts`)
descends into branches whose shape contains the next segment —
O(branch count × depth). For a 3-branch DU with typical shape this
is indistinguishable from a plain object; for 50+ branches it starts
to show. Flat unions (`z.union([...])` without a discriminator) walk
every branch unconditionally, which is more expensive still — prefer
DU when you have a common discriminant.

## Reactivity scope

`FormState.fields` / `errors` / `elements` are reactive `Map`s. Vue's
collection handlers key-track, so a computed that reads
`errors.get('email')` only re-runs when the `email` key changes —
not when unrelated keys mutate. `isDirty` is one exception: it
iterates the whole `originals` map, so it invalidates any time a
tracked leaf's `updatedAt` ticks. For large forms where `isDirty`
renders in a hot template, gate the computed behind a more specific
predicate (e.g. derive per-field `isDirty` via the leaf's
original-vs-current comparison).

## Path canonicalisation

`canonicalizePath` (`src/runtime/core/paths.ts`) runs on every
`register` / `setValue` / `getValue` / `validate` / `resetField` call
and on every diff-apply patch emitted during a form mutation. Dotted-
string inputs are LRU-cached (128-entry cap); array inputs bypass the
cache since they're already structured. For a typical form that
re-canonicalises a small working-set of paths thousands of times per
session (one per keystroke on each registered field), the LRU turns
the repeat cost into an O(1) Map hit.

`isDirty`'s `originals` loop used to `JSON.parse(pathKey)` per entry
to recover the canonical Path. As of phase 5.1 the originals Map
stores the `segments` alongside each value, so the loop skips the
parse entirely. On a 100-leaf pristine form this is ~4× faster than
the pre-5.1 shape — measurable because the comparison walks every
entry (pristine short-circuits only when a dirty leaf is found).

Both improvements have regression gates in `bench/paths.bench.ts`
under `scripts/check-bench.mjs` (3× ratio floor).

## Reset cost

`reset()` walks the `fields` / `errors` / `originals` maps and
replaces entries on each. On a 100-leaf form it's sub-millisecond;
on 500 leaves it's a few milliseconds. `resetField(path)` is O(leaves
under the subtree) — typically much smaller — and preferable for
localized reversions.

## Measuring your own form

Clone the repo and drop a bench in `bench/`:

```ts
import { bench, describe } from 'vitest'
import { z } from 'zod'
import { useForm } from '@chemical-x/forms/zod'

const schema = z.object({ /* your shape */ })

describe('my form — typical interaction', () => {
  // ... set up form (see existing benches for SSR mount pattern)
  bench('the operation I care about', () => {
    // ...
  })
})
```

Run with `pnpm bench`. The `scripts/check-bench.mjs` gate only fires
for benches that follow the `old: / new:` pairing convention —
informational benches like this run without gating.

## Peer-dep coverage

Per-PR CI (`.github/workflows/matrix.yml`) runs the full quality gate
on Node 18 / 20 / 22 / LTS against the devDep-pinned peer versions
(Vue 3.5.13, Vite 6.2.x, Nuxt 3.16.x). A separate weekly workflow
(`.github/workflows/peer-matrix.yml`) sweeps the declared peer-dep
range — Vue 3.5 floor through 3.6, Vite 5 and 6, Nuxt 3.16 floor
through Nuxt 4 — via `pnpm.overrides` injected before install. Jobs
report independently (`fail-fast: false`); versions that aren't
released yet (e.g. Vue 3.6 before its publish) surface as failed
cells rather than blocking the workflow.
