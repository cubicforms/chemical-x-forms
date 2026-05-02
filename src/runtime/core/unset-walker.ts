import type { AbstractSchema } from '../types/types-api'
import type { GenericForm } from '../types/types-core'
import { __DEV__ } from './dev'
import { canonicalizePath, type PathKey, type Segment } from './paths'
import { isUnset } from './unset'

/**
 * Walk a defaults / setValue / reset payload depth-first and produce
 * the cleaned-up storage tree plus the set of paths to mark as blank.
 * Used at three boundaries:
 *
 *   - `useAbstractForm` construction (defaultValues pre-pass)
 *   - `setValue(path, unset)` translation
 *   - `reset(nextDefaultValues)` translation
 *
 * `blank` is the runtime's bookkeeping for **storage / display
 * divergence** — see `docs/blank.md` for the concept. Two sources of
 * marks, gated by that purpose:
 *
 *   1. **Explicit `unset` (any primitive leaf)** — the consumer wrote
 *      `unset` at a primitive leaf (`defaultValues: { count: unset }` /
 *      `setValue('count', unset)` / `reset({ count: unset })`). The
 *      sentinel is replaced with the schema's slim default and the
 *      path is added to the result. Explicit user intent applies
 *      across every primitive type (string / number / boolean /
 *      bigint), so the mark records "the consumer asked for blank
 *      here" regardless of whether storage and display would otherwise
 *      diverge.
 *
 *   2. **Unspecified numeric leaf (auto-mark)** — the consumer's
 *      payload is partial (or omitted entirely) and the schema has a
 *      `number` / `bigint` leaf the consumer did not cover. The slim
 *      default (`0` / `0n`) lands in storage and the path is
 *      auto-marked. Rationale: numeric storage forces a value (`0`,
 *      `0n`) that the DOM input represents as `''` — the runtime
 *      can't tell "user typed 0" from "user supplied nothing" without
 *      this side-channel. Strings and booleans are NOT auto-marked:
 *      their slim defaults (`''` / `false`) match what the DOM shows
 *      natively, so there's no divergence to record. Adding an
 *      auto-mark for those types would be the library second-
 *      guessing the schema's accepted-empty verdict, which is the
 *      schema author's call to express via `.min(1)` /
 *      `z.literal(true)` / refinements.
 *
 * Recurses into plain objects, arrays, and tuples; non-recursable
 * containers (`Date`, `RegExp`, `Map`, `Set`, functions) pass through
 * unchanged. Arrays are NOT auto-mark-recursed (their elements are
 * runtime-added; per-element opt-in via explicit `unset`).
 *
 * Runtime guard: if `unset` lands at a path whose slim default isn't
 * a primitive, emit a one-time dev-warn and recurse into the slim
 * subtree for auto-mark — the path itself is NOT marked.
 * `DefaultValuesShape<T>` blocks this at compile time; the runtime
 * check is a guardrail for plain-JS consumers and dynamic plumbing.
 */
export function walkUnsetSentinels<T>(
  values: T,
  schema: AbstractSchema<GenericForm, GenericForm>
): { cleanedValues: T; paths: PathKey[] } {
  const paths: PathKey[] = []
  // No defaults supplied — auto-mark every primitive leaf reachable
  // from the schema's slim root default. cleanedValues stays `undefined`
  // to preserve createFormStore's existing "no user defaults" code path.
  if (values === undefined) {
    const rootSlim = schema.getDefaultAtPath([])
    walkUnspecified(rootSlim, [], paths)
    return { cleanedValues: undefined as unknown as T, paths }
  }
  const cleaned = walk(values as unknown, [], schema, paths)
  return { cleanedValues: cleaned as T, paths }
}

function walk(
  input: unknown,
  segments: Segment[],
  schema: AbstractSchema<GenericForm, GenericForm>,
  paths: PathKey[]
): unknown {
  if (isUnset(input)) {
    const slim = schema.getDefaultAtPath(segments)
    if (!isPrimitiveOrEmpty(slim)) {
      warnNonPrimitiveLeaf(segments, slim)
      // Recurse into slim subtree so unspecified primitive leaves
      // below this misused `unset` still get auto-marked.
      return walkUnspecified(slim, segments, paths)
    }
    paths.push(canonicalizePath(segments).key)
    return slim
  }
  // User omitted this key — fall through to walkUnspecified on the
  // schema's slim default at this path so primitive leaves get marked.
  if (input === undefined) {
    const slim = schema.getDefaultAtPath(segments)
    return walkUnspecified(slim, segments, paths)
  }
  // Explicit null is the user's choice, not absence — pass through.
  if (input === null) return null
  if (
    input instanceof Date ||
    input instanceof RegExp ||
    input instanceof Map ||
    input instanceof Set ||
    typeof input === 'function'
  ) {
    return input
  }
  if (Array.isArray(input)) {
    const out = new Array(input.length)
    for (let i = 0; i < input.length; i++) {
      out[i] = walk(input[i], [...segments, i], schema, paths)
    }
    return out
  }
  if (typeof input === 'object') {
    // Walk both user-supplied keys AND schema-only keys so unspecified
    // primitive leaves get auto-marked even inside a partially-supplied
    // object (e.g., `defaultValues: { user: { name: 'a' } }` against a
    // schema with `user.{name, age}` marks `user.age`).
    const slim = schema.getDefaultAtPath(segments)
    const allKeys = new Set<string>(Object.keys(input as object))
    if (
      slim !== null &&
      slim !== undefined &&
      typeof slim === 'object' &&
      !Array.isArray(slim) &&
      !(slim instanceof Date) &&
      !(slim instanceof RegExp) &&
      !(slim instanceof Map) &&
      !(slim instanceof Set)
    ) {
      for (const k of Object.keys(slim as object)) allKeys.add(k)
    }
    const out: Record<string, unknown> = {}
    for (const key of allKeys) {
      out[key] = walk((input as Record<string, unknown>)[key], [...segments, key], schema, paths)
    }
    return out
  }
  return input
}

/**
 * Recurse into a schema slim-default subtree, auto-marking every
 * **numeric** primitive leaf encountered. Called from `walk` whenever
 * the user's payload is missing at a path, and from the top-level
 * walker entry point when no defaults are supplied at all. Strings,
 * booleans, and other non-numeric leaves are left unmarked — the
 * library only auto-marks where storage and display diverge, which
 * for slim primitives is exclusively `number` and `bigint`. See the
 * docblock on `walkUnsetSentinels` for the full rationale.
 *
 * Exported so the discriminated-union variant-switch reshape in
 * `create-form-store.ts` can re-mark numeric leaves of the newly
 * activated variant after replacing the union's parent storage.
 */
export function walkUnspecified(slim: unknown, segments: Segment[], paths: PathKey[]): unknown {
  if (isPrimitiveOrEmpty(slim)) {
    if (isNumericPrimitive(slim)) {
      paths.push(canonicalizePath(segments).key)
    }
    return slim
  }
  if (
    slim instanceof Date ||
    slim instanceof RegExp ||
    slim instanceof Map ||
    slim instanceof Set ||
    typeof slim === 'function'
  ) {
    return slim
  }
  // Arrays: pass through without recursion. Elements are runtime-added;
  // tuple-shaped fixed arrays opt-in via explicit per-element `unset`.
  if (Array.isArray(slim)) return slim
  if (slim !== null && typeof slim === 'object') {
    const out: Record<string, unknown> = {}
    for (const key of Object.keys(slim as object)) {
      out[key] = walkUnspecified((slim as Record<string, unknown>)[key], [...segments, key], paths)
    }
    return out
  }
  return slim
}

function isPrimitiveOrEmpty(value: unknown): boolean {
  if (value === null || value === undefined) return true
  const t = typeof value
  return t === 'string' || t === 'number' || t === 'boolean' || t === 'bigint'
}

/**
 * `true` when `value` is a numeric primitive — the only types where
 * storage and display diverge enough that the runtime needs the
 * `blank` side-channel to tell "user typed 0" from "user supplied
 * nothing." Strings (`''` storage = `''` display), booleans (`false`
 * storage = unchecked display), null, and undefined never auto-mark.
 */
function isNumericPrimitive(value: unknown): boolean {
  const t = typeof value
  return t === 'number' || t === 'bigint'
}

const warnedNonPrimitivePaths: Set<string> | null = __DEV__ ? new Set<string>() : null

function warnNonPrimitiveLeaf(segments: Segment[], slim: unknown): void {
  if (warnedNonPrimitivePaths === null) return
  const dotted = segments.map(String).join('.')
  if (warnedNonPrimitivePaths.has(dotted)) return
  warnedNonPrimitivePaths.add(dotted)
  const slimType = slim === null ? 'null' : slim instanceof Date ? 'Date' : typeof slim
  console.warn(
    `[decant] \`unset\` at "${dotted || '<root>'}" is a no-op — ` +
      `unset only works at primitive leaves (string / number / boolean / bigint, ` +
      `plus their optional / nullable variants), got "${slimType}". ` +
      `The slim default was written but the path is NOT marked blank. ` +
      `(TypeScript catches this at compile time; this warn covers plain-JS callers.)`
  )
}
