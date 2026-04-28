import type { AbstractSchema } from '../types/types-api'
import type { GenericForm } from '../types/types-core'
import { __DEV__ } from './dev'
import { canonicalizePath, type PathKey, type Segment } from './paths'
import { isUnset } from './unset'

/**
 * Walk a defaults / setValue / reset payload depth-first, replacing
 * every `unset` sentinel with the schema's slim default at that path
 * and reporting the set of paths that were marked. Used at three
 * boundaries:
 *
 *   - `useAbstractForm` construction (defaultValues pre-pass)
 *   - `setValue(path, unset)` translation
 *   - `reset(nextDefaultValues)` translation
 *
 * Recurses into plain objects, arrays, and tuples; non-recursable
 * containers (`Date`, `RegExp`, `Map`, `Set`, functions) pass through
 * unchanged. Mirrors `DefaultValuesShape<T>`'s recursion exactly so
 * the runtime accepts what the type system permits.
 *
 * Runtime guard: if `unset` lands at a path whose slim default isn't
 * a primitive (`string` / `number` / `boolean` / `bigint`, possibly
 * `undefined` / `null` for optional / nullable), emit a one-time dev-
 * warn and replace with the slim default WITHOUT marking the path.
 * `DefaultValuesShape<T>` blocks this at compile time; the runtime
 * check is a guardrail for plain-JS consumers and dynamic plumbing.
 */
export function walkUnsetSentinels<T>(
  values: T,
  schema: AbstractSchema<GenericForm, GenericForm>
): { cleanedValues: T; paths: PathKey[] } {
  const paths: PathKey[] = []
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
      return slim
    }
    paths.push(canonicalizePath(segments).key)
    return slim
  }
  if (input === null || input === undefined) return input
  // Don't recurse into Date / RegExp / Map / Set / functions —
  // mirrors DefaultValuesShape's exclusion list.
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
    const out: Record<string, unknown> = {}
    for (const key of Object.keys(input)) {
      out[key] = walk((input as Record<string, unknown>)[key], [...segments, key], schema, paths)
    }
    return out
  }
  return input
}

function isPrimitiveOrEmpty(value: unknown): boolean {
  if (value === null || value === undefined) return true
  const t = typeof value
  return t === 'string' || t === 'number' || t === 'boolean' || t === 'bigint'
}

const warnedNonPrimitivePaths: Set<string> | null = __DEV__ ? new Set<string>() : null

function warnNonPrimitiveLeaf(segments: Segment[], slim: unknown): void {
  if (warnedNonPrimitivePaths === null) return
  const dotted = segments.map(String).join('.')
  if (warnedNonPrimitivePaths.has(dotted)) return
  warnedNonPrimitivePaths.add(dotted)
  const slimType = slim === null ? 'null' : slim instanceof Date ? 'Date' : typeof slim
  console.warn(
    `[@chemical-x/forms] \`unset\` is only supported at primitive leaves ` +
      `(string / number / boolean / bigint, plus their optional / nullable ` +
      `variants); got "${slimType}" at "${dotted || '<root>'}". The slim ` +
      `default is written to storage but the path is NOT marked transient-` +
      `empty. The TypeScript \`DefaultValuesShape<T>\` widening prevents ` +
      `this at compile time — this dev-warn fires once per offending path ` +
      `to catch plain-JS consumers and dynamic plumbing that bypasses TS.`
  )
}
