---
description: 'How Attaform stays fast in Vue 3 apps: schema fingerprinting, debounced validation, slim primitives, and the runtime guards that catch perf footguns early.'
---

# Performance

Notes on the hot paths — keystrokes, submits, validation, reset —
and what to look at if a form starts feeling slow. CI runs the
benchmark suite under `bench/` on every PR with thresholds tracked
in [`bench/`](https://github.com/attaform/attaform/tree/main/bench).

## Measured numbers

Real-browser numbers from `pnpm bench`, single-threaded on
contemporary hardware. Your machine will land elsewhere on the
number line; the orders of magnitude won't.

| Operation                                                      | Cost    |
| -------------------------------------------------------------- | ------- |
| Single-field keystroke, 100-leaf form                          | 6 µs    |
| Single-field keystroke, 500-leaf form                          | 30 µs   |
| Validation overhead per keystroke (`validateOn: 'change'`)     | 5 µs    |
| Submit lifecycle (validate → submit → parse → setFieldErrors)  | 3.4 µs  |
| Path canonicalisation (cache hit)                              | 60 ns   |
| Sensitive-name check (common pattern, early hit)               | 70 ns   |
| Persistence write — `'local'` / `'session'` (100-leaf payload) | 2.8 µs  |
| Persistence write — `'indexeddb'` (100-leaf payload)           | 62 µs   |
| Debounced-writer schedule (steady-state typing)                | 0.18 µs |
| Discriminated union — write into active variant                | 19 µs   |
| Discriminated union — cross-variant flip                       | 25 µs   |
| Reset, 100-leaf object form                                    | 678 µs  |
| Field-array append, 100-item                                   | 2.5 ms  |
| Field-array append, 1000-item                                  | 9 ms    |
| Field-array swap on 500-item                                   | 3.9 ms  |

A 60 fps frame is **16.7 ms**. Single-keystroke work clears the
budget by three orders of magnitude on a 100-leaf form and by
two on a 500-leaf form — Vue's render gets the rest of the frame
to itself.

## Hot-path characteristics

- **Keystrokes** — the `register` → form-state path runs against a
  per-PR threshold; see [`bench/keystroke.bench.ts`](https://github.com/attaform/attaform/blob/main/bench/keystroke.bench.ts)
  for the measured scenarios (100-leaf and 500-leaf forms,
  single-leaf mutation).
- **`form.meta.dirty`** — iterates the tracked leaves with no
  per-leaf parse cost.
- **Path resolution** — dotted-string paths are LRU-cached (128
  entries), so repeat canonicalisation reduces to a map lookup.

Sub-500-leaf forms don't surface in profiling.

## Sizing guidance

| Scale              | Guidance                                                                                                           |
| ------------------ | ------------------------------------------------------------------------------------------------------------------ |
| ≤ 500 leaves       | Default. No tuning needed.                                                                                         |
| 500 – 5,000 leaves | Still fine. Watch out for templates that render every leaf's `form.fields.<path>.dirty` in a hot scope.            |
| 5,000+ leaves      | Consider splitting into sub-forms with distinct `key`s. One giant schema is not what the library is optimised for. |

## Array helpers are O(N)

`append` / `prepend` / `insert` / `remove` / `swap` / `move` all
copy the target array before mutating. That's cheap in the common
case (dozens of items), fine at hundreds, but **quadratic if you
loop `append` to seed a large list**. For a large seed, assign the
whole array in one shot:

```ts
form.setValue('items', preBuiltArray) // O(N)
```

## Keying `v-for` rows

Use a stable per-row key — either an ID carried on the data or a
client-generated `crypto.randomUUID()` stored when you append.
Keying by index re-renders more than necessary when rows move and
flickers focus / scroll state on reordered rows.

## Discriminated unions vs plain unions

Discriminated unions (`z.discriminatedUnion`) walk only the active
branch. Plain unions (`z.union`) walk every branch unconditionally
— use a DU when you have a shared key.

## `form.meta.dirty` in hot templates

`form.meta.dirty` is a whole-form aggregate — it invalidates whenever
any tracked leaf's `updatedAt` ticks. If you render it in a hot
path (e.g., a header that re-renders on every keystroke), derive a
more specific predicate instead:

```ts
// Faster than gating on the whole-form form.meta.dirty:
const isEmailDirty = computed(() => form.fields.email.dirty)
```

## Reset cost

`reset()` is sub-millisecond on a 100-leaf form (~680 µs in the
suite — see Measured numbers above). `resetField(path)` scales with
the subtree — prefer it for localised reversions.

## Benching your own form

Clone the repo and drop a bench in `bench/`:

```ts
import { bench, describe } from 'vitest'
import { z } from 'zod'
// import your form setup

describe('my form — typical interaction', () => {
  bench('the operation I care about', () => {
    // ...
  })
})
```

Run with `pnpm bench`. The regression gate only fires on benches
that follow the `old: / new:` pairing convention — informational
benches run without gating.

## Peer-dep coverage

Per-PR CI covers Node 18 / 20 / 22 / LTS against the devDep-pinned
peer versions. A weekly workflow sweeps Vue 3.5 through 3.6, Vite
5 / 6, Nuxt 3.16 through Nuxt 4. Jobs fail independently — versions
not yet released surface as failed cells without blocking the main
CI.
