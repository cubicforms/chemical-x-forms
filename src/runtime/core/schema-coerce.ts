/**
 * Schema-driven coercion of user-typed DOM values at the v-register
 * directive layer. When the slim schema declares a numeric or
 * boolean type at a path, the directive coerces incoming string
 * values (`'25'` → `25`, `'true'` → `true`) before the slim-primitive
 * gate sees the write — making the schema authoritative for storage
 * shape and freeing consumers from sprinkling `.number` modifiers
 * across templates.
 *
 * Coercion is consumer-extensible: a `CoercionRegistry` is just an
 * `Array<CoercionEntry>` keyed at config time by `(input, output)`
 * `SlimPrimitiveKind` literals. The library ships
 * `defaultCoercionRules` (string→number, string→boolean) and
 * `defineCoercion` for type-narrowed authoring; consumers spread the
 * defaults to extend or supply their own array to replace.
 *
 * Coercion applies ONLY to user-typed DOM values flowing through
 * the directive's assigner. Programmatic writes (`form.setValue`,
 * `setValueWithInternalPath`) bypass coercion — they're authoritative
 * writes whose strict typing is on the caller. This mirrors the
 * `transforms` pipeline's user-input-only contract.
 */
import type {
  AbstractSchema,
  CoercionEntry,
  CoercionRegistry,
  CoercionResult,
  SlimPrimitiveKind,
} from '../types/types-api'
import type { Path } from './paths'
import { slimKindOf } from './slim-primitive-gate'
import { __DEV__ } from './dev'

/**
 * Type-narrowing helper for authoring entries. At runtime it's
 * identity; at compile time it preserves the `input` / `output`
 * literal types so `transform`'s parameter is narrowed to the
 * runtime type instead of widening to `SlimRuntimeOf<SlimPrimitiveKind>`.
 *
 * Without this helper, authoring `{ input: 'string', output:
 * 'number', transform: (s) => ... }` against the broader
 * `CoercionEntry` widens `s` to `string | number | boolean | ...`,
 * forcing a cast in every transform body. `defineCoercion` is the
 * opaque-free idiom.
 */
export function defineCoercion<I extends SlimPrimitiveKind, O extends SlimPrimitiveKind>(
  entry: CoercionEntry<I, O>
): CoercionEntry<I, O> {
  return entry
}

/**
 * Internal index built from a `CoercionRegistry` at config-resolve
 * time. Keyed by `${input}->${output}` for O(1) per-keystroke
 * dispatch. The authoring shape (array, ergonomic, type-narrowing-
 * friendly) and the dispatch shape (Map, fast) decouple cleanly.
 */
export type CoercionIndex = ReadonlyMap<`${SlimPrimitiveKind}->${SlimPrimitiveKind}`, CoercionEntry>

/** Identity function reused by `buildCoerceFn` when coercion is
 *  disabled or the path admits no coercion target. */
export const IDENTITY: (v: unknown) => unknown = (v) => v

/** Frozen empty index — reference-equal sentinel that lets
 *  `buildCoerceFn` short-circuit to `IDENTITY` without allocation. */
const EMPTY_INDEX: CoercionIndex = new Map()

/**
 * The library's built-in registry. Two cells: string→number and
 * string→boolean. Re-exported so consumers can spread it when
 * supplying a custom registry that extends defaults.
 */
export const defaultCoercionRules: CoercionRegistry = [
  defineCoercion({
    input: 'string',
    output: 'number',
    transform: (s) => {
      // Trim first so whitespace-only inputs don't slip past the
      // empty-string guard via `Number('  ') === 0`. The blank-paths
      // machinery owns the empty-input shape; coerce only fires when
      // there's a non-blank token to consider.
      const trimmed = s.trim()
      if (trimmed === '') return { coerced: false }
      const n = Number(trimmed)
      if (!Number.isFinite(n)) return { coerced: false }
      return { coerced: true, value: n }
    },
  }),
  defineCoercion({
    input: 'string',
    output: 'boolean',
    transform: (s) => {
      // Case-insensitive + whitespace-tolerant. Aligns with the
      // aria-style boolean-token convention (`aria-checked` accepts
      // "true"/"True"/"TRUE"). DOM `value=` attributes preserve
      // whatever case the dev wrote, and `value="True"` is common
      // enough that strict-lowercase-only would be a footgun.
      const normalized = s.trim().toLowerCase()
      if (normalized === 'true') return { coerced: true, value: true }
      if (normalized === 'false') return { coerced: true, value: false }
      return { coerced: false }
    },
  }),
]

/**
 * Resolve the consumer's `coerce` config slot to a concrete index.
 * `true` / `undefined` → indexed defaults; `false` → empty index;
 * custom registry → indexed (with duplicate-pair dev-warn).
 *
 * Called once per FormStore in `createFormStore`.
 */
export function resolveCoercionIndex(
  config: boolean | CoercionRegistry | undefined
): CoercionIndex {
  if (config === false) return EMPTY_INDEX
  const rules = config === undefined || config === true ? defaultCoercionRules : config
  return indexRules(rules)
}

function indexRules(rules: CoercionRegistry): CoercionIndex {
  const idx = new Map<`${SlimPrimitiveKind}->${SlimPrimitiveKind}`, CoercionEntry>()
  for (const entry of rules) {
    // The static type says `entry: CoercionEntry`, but consumers can
    // pass in registries assembled at runtime (parsed JSON, plugin
    // config) where individual entries may be malformed. Cast through
    // `unknown` to inspect runtime shape without lint complaining about
    // an "always true" type-narrowing branch.
    const candidate = entry as unknown
    if (
      candidate === null ||
      typeof candidate !== 'object' ||
      typeof (candidate as { transform?: unknown }).transform !== 'function'
    ) {
      if (__DEV__) {
        console.warn('[@chemical-x/forms] coercion entry missing or invalid `transform` — skipped.')
      }
      continue
    }
    const key = `${entry.input}->${entry.output}` as const
    if (idx.has(key) && __DEV__) {
      console.warn(`[@chemical-x/forms] duplicate coercion rule for '${key}' — last entry wins.`)
    }
    idx.set(key, entry)
  }
  return idx
}

/**
 * Build the per-register coerce closure. The closure captures the
 * resolved `accepted` set + the index, so the per-event hot path
 * doesn't re-walk the schema on every keystroke. Returns `IDENTITY`
 * when coerce is disabled — zero allocation for the common case.
 */
export function buildCoerceFn(
  schema: AbstractSchema<unknown, unknown>,
  segments: Path,
  index: CoercionIndex
): (value: unknown) => unknown {
  if (index === EMPTY_INDEX) return IDENTITY
  if (index.size === 0) return IDENTITY
  const accepted = schema.getSlimPrimitiveTypesAtPath(segments)
  const elementAccepted =
    accepted.has('array') || accepted.has('set')
      ? schema.getSlimPrimitiveTypesAtPath([...segments, 0])
      : undefined
  return (value) => coerceValue(value, accepted, elementAccepted, index)
}

/**
 * Element-level coerce closure. Returns `undefined` when the path
 * isn't a container (scalar paths use `buildCoerceFn` exclusively).
 *
 * Why this is separate from `buildCoerceFn`: the path-level closure
 * handles the WRITE path correctly — given a container value, it
 * iterates and coerces each element internally. But the directive's
 * READ-side comparisons (`setChecked` array/Set branches,
 * `setSelected` multi-select) compare a SCALAR DOM-side value (the
 * option's `value` attribute) against the post-coerce container
 * elements. The path-level closure can't help here because it would
 * see a scalar and look up the path's accept set (`{ array }`),
 * which has no scalar coercion target. The element-level closure
 * skips ahead to the element-type accept set.
 */
export function buildElementCoerceFn(
  schema: AbstractSchema<unknown, unknown>,
  segments: Path,
  index: CoercionIndex
): ((value: unknown) => unknown) | undefined {
  if (index === EMPTY_INDEX) return undefined
  if (index.size === 0) return undefined
  const accepted = schema.getSlimPrimitiveTypesAtPath(segments)
  if (!accepted.has('array') && !accepted.has('set')) return undefined
  const elementAccepted = schema.getSlimPrimitiveTypesAtPath([...segments, 0])
  return (value) => coerceScalar(value, elementAccepted, index)
}

/**
 * Pick the unambiguous coercion target for an accept set. Returns
 * the target kind only when it's the SOLE coercible kind — if the
 * path admits both `string` and `number`, the schema explicitly
 * accepts either, so silent retyping is wrong (passthrough).
 */
function pickScalarTarget(accepted: ReadonlySet<SlimPrimitiveKind>): SlimPrimitiveKind | null {
  if (accepted.has('string')) return null
  if (accepted.has('number')) return 'number'
  if (accepted.has('boolean')) return 'boolean'
  if (accepted.has('bigint')) return 'bigint'
  return null
}

/**
 * Per-store WeakMap dedupe of dev-warns from coercion. Mirrors the
 * slim-gate's pattern (`slim-primitive-gate.ts:28-42`) so the same
 * (rule, error) pair doesn't flood the console during a v-for re-
 * render. Key shape: `<input>-><output>::<reason>`.
 */
const warnedCoerce: WeakMap<object, Set<string>> | null = __DEV__
  ? new WeakMap<object, Set<string>>()
  : null
const sharedWarnStore: object = {}

function shouldWarnOnce(key: string): boolean {
  if (warnedCoerce === null) return false
  let set = warnedCoerce.get(sharedWarnStore)
  if (set === undefined) {
    set = new Set()
    warnedCoerce.set(sharedWarnStore, set)
  }
  if (set.has(key)) return false
  set.add(key)
  return true
}

function coerceScalar(
  value: unknown,
  accepted: ReadonlySet<SlimPrimitiveKind>,
  index: CoercionIndex
): unknown {
  if (accepted.size === 0) return value
  const sourceKind = slimKindOf(value)
  if (accepted.has(sourceKind)) return value
  const target = pickScalarTarget(accepted)
  if (target === null) return value
  const entry = index.get(`${sourceKind}->${target}`)
  if (entry === undefined) return value
  let result: CoercionResult<unknown>
  try {
    result = entry.transform(value as never) as CoercionResult<unknown>
  } catch (err) {
    if (__DEV__ && shouldWarnOnce(`${entry.input}->${entry.output}::throw`)) {
      console.warn(
        `[@chemical-x/forms] coercion '${entry.input}->${entry.output}' threw — write passes through.`,
        err
      )
    }
    return value
  }
  if (!result.coerced) return value
  // Post-validate: the rule claimed it coerced, but did it actually
  // produce a value matching the declared `output`? Defends against
  // buggy consumer rules without forcing them to validate themselves.
  const returnedKind = slimKindOf(result.value)
  if (returnedKind !== entry.output) {
    if (__DEV__ && shouldWarnOnce(`${entry.input}->${entry.output}::wrong-kind:${returnedKind}`)) {
      console.warn(
        `[@chemical-x/forms] coercion '${entry.input}->${entry.output}' produced a ${returnedKind} — write passes through.`
      )
    }
    return value
  }
  if (entry.output === 'number' && !Number.isFinite(result.value as number)) {
    if (__DEV__ && shouldWarnOnce(`${entry.input}->${entry.output}::nan`)) {
      console.warn(
        `[@chemical-x/forms] coercion '${entry.input}->${entry.output}' produced a non-finite number — write passes through.`
      )
    }
    return value
  }
  return result.value
}

function coerceArrayMembers(
  arr: readonly unknown[],
  elementAccepted: ReadonlySet<SlimPrimitiveKind>,
  index: CoercionIndex
): readonly unknown[] {
  let changed = false
  const out: unknown[] = []
  for (const el of arr) {
    const next = coerceScalar(el, elementAccepted, index)
    if (next !== el) changed = true
    out.push(next)
  }
  return changed ? out : arr
}

function coerceSetMembers(
  set: ReadonlySet<unknown>,
  elementAccepted: ReadonlySet<SlimPrimitiveKind>,
  index: CoercionIndex
): ReadonlySet<unknown> {
  let changed = false
  const out: unknown[] = []
  for (const el of set) {
    const next = coerceScalar(el, elementAccepted, index)
    if (next !== el) changed = true
    out.push(next)
  }
  return changed ? new Set(out) : set
}

function coerceValue(
  value: unknown,
  accepted: ReadonlySet<SlimPrimitiveKind>,
  elementAccepted: ReadonlySet<SlimPrimitiveKind> | undefined,
  index: CoercionIndex
): unknown {
  if (Array.isArray(value)) {
    if (!accepted.has('array') || elementAccepted === undefined) return value
    return coerceArrayMembers(value, elementAccepted, index)
  }
  if (value instanceof Set) {
    if (!accepted.has('set') || elementAccepted === undefined) return value
    return coerceSetMembers(value, elementAccepted, index)
  }
  return coerceScalar(value, accepted, index)
}
