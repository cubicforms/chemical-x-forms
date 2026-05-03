import type { Path, Segment } from './paths'

/**
 * The minimal slice of `AbstractSchema` the structural-completeness
 * helpers need. Declared inline (not imported from types-api) so this
 * file stays free of cyclic imports — types-api imports types-core,
 * types-core does not import types-api, and this file is consumed by
 * core/create-form-store.ts which sits between the two.
 */
export type SchemaForFill = {
  getDefaultAtPath(path: Path): unknown
}

/**
 * Structured-path get/set primitives. Replace `lodash-es/get` and
 * `lodash-es/set` for internal callers that speak `Path` rather than
 * dotted strings.
 *
 * Semantics:
 * - `getAtPath` returns `undefined` for any path that traverses through
 *   a non-descendable value (null, primitive, function). This preserves
 *   distinctions: `null` at the exact target is returned as `null`, not
 *   as `undefined`; only missing / non-descendable intermediates collapse.
 * - `setAtPath` is copy-on-write at every level from root to target. New
 *   intermediate containers are created according to the segment type:
 *   numeric segments produce arrays, string segments produce plain objects.
 *   Sibling values at each level are preserved by reference (structural
 *   sharing), so the non-touched subtrees stay reference-equal for
 *   downstream `Object.is` checks in `diffAndApply`.
 */

const NOT_FOUND: unique symbol = Symbol('NOT_FOUND')

function descendStep(value: unknown, segment: Segment): unknown | typeof NOT_FOUND {
  if (value === null || value === undefined) return NOT_FOUND
  if (typeof value !== 'object') return NOT_FOUND
  if (Array.isArray(value)) {
    if (typeof segment !== 'number') return NOT_FOUND
    if (segment < 0 || segment >= value.length) return NOT_FOUND
    return value[segment]
  }
  const record = value as Record<string, unknown>
  const key = typeof segment === 'number' ? String(segment) : segment
  if (!(key in record)) return NOT_FOUND
  return record[key]
}

export function getAtPath(root: unknown, path: Path): unknown {
  if (path.length === 0) return root
  let current: unknown = root
  for (const segment of path) {
    const next = descendStep(current, segment)
    if (next === NOT_FOUND) return undefined
    current = next
  }
  return current
}

/**
 * Returns true iff `path` exists in `root` as a descendable chain to a leaf
 * or to a defined value. Distinguishes "exists and is undefined" (rare but
 * possible with explicit assignment) from "missing".
 */
export function hasAtPath(root: unknown, path: Path): boolean {
  if (path.length === 0) return true
  let current: unknown = root
  for (let i = 0; i < path.length - 1; i++) {
    const segment = path[i] as Segment
    const next = descendStep(current, segment)
    if (next === NOT_FOUND) return false
    current = next
  }
  const last = path[path.length - 1] as Segment
  if (current === null || current === undefined) return false
  if (typeof current !== 'object') return false
  if (Array.isArray(current)) {
    return typeof last === 'number' && last >= 0 && last < current.length
  }
  const key = typeof last === 'number' ? String(last) : last
  return key in (current as Record<string, unknown>)
}

export function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object') return false
  if (Array.isArray(value)) return false
  const proto = Object.getPrototypeOf(value) as object | null
  return proto === null || proto === Object.prototype
}

export function setAtPath(root: unknown, path: Path, value: unknown): unknown {
  return setAtPathOffset(root, path, value, 0)
}

function setAtPathOffset(root: unknown, path: Path, value: unknown, offset: number): unknown {
  if (offset >= path.length) return value

  const head = path[offset] as Segment
  const nextOffset = offset + 1

  if (typeof head === 'number') {
    const arr = Array.isArray(root) ? [...root] : []
    // Extend sparse arrays with undefined slots up to the target index.
    while (arr.length <= head) arr.push(undefined)
    arr[head] = setAtPathOffset(arr[head], path, value, nextOffset)
    return arr
  }

  const rec: Record<string, unknown> = isPlainRecord(root) ? { ...root } : {}
  rec[head] = setAtPathOffset(rec[head], path, value, nextOffset)
  return rec
}

/**
 * Copy-on-write deletion of `path` from `root`. Returns a fresh root
 * with the targeted leaf (or container) removed; siblings stay
 * reference-equal. Missing intermediates short-circuit and return
 * `root` unchanged.
 *
 * Array semantics: deleting a numeric index splices the array (length
 * shrinks by one). Object semantics: deleting a string key removes the
 * own-property and shrinks the key set by one.
 *
 * Used by the persistence layer's `clearPersistedDraft(path)` to wipe
 * a single subpath from the persisted entry without disturbing other
 * paths the user might have opted in.
 */
export function deleteAtPath(root: unknown, path: Path): unknown {
  return deleteAtPathOffset(root, path, 0)
}

function deleteAtPathOffset(root: unknown, path: Path, offset: number): unknown {
  if (offset >= path.length) return undefined

  const head = path[offset] as Segment
  const isLeafStep = offset === path.length - 1
  const nextOffset = offset + 1

  if (typeof head === 'number') {
    if (!Array.isArray(root)) return root
    if (head < 0 || head >= root.length) return root
    if (isLeafStep) {
      const arr = [...root]
      arr.splice(head, 1)
      return arr
    }
    const arr = [...root]
    arr[head] = deleteAtPathOffset(arr[head], path, nextOffset)
    return arr
  }

  if (!isPlainRecord(root)) return root
  if (isLeafStep) {
    const rec: Record<string, unknown> = { ...root }
    delete rec[head]
    return rec
  }
  if (!(head in root)) return root
  const rec: Record<string, unknown> = { ...root }
  rec[head] = deleteAtPathOffset(rec[head], path, nextOffset)
  return rec
}

/**
 * Recursive merge that fills consumer-supplied gaps with the schema's
 * prescribed defaults. The runtime calls this on every `setValueAtPath`
 * write (and on whole-form callback returns) so the form remains
 * structurally complete after the write.
 *
 * Semantics:
 * - Plain object: every schema-default key not present in `consumer`
 *   is filled with the schema default's value at that key. Schema-only
 *   keys recurse into structural completeness; consumer-only keys (not
 *   in the schema) survive untouched (validation flags them).
 * - Array: each consumer element is merged with the SCHEMA element
 *   default (looked up via `schema.getDefaultAtPath([...path, i])`).
 *   Length follows the consumer — padding past the consumer's length
 *   is `setAtPathWithSchemaFill`'s job, not this function's.
 * - `null` consumer wins (a deliberate "clear" signal — validation
 *   catches misuse against non-nullable shapes).
 * - `undefined` consumer falls back to the schema default (treats
 *   undefined as "missing"). When the schema default is also
 *   undefined the result is undefined — schema and consumer agree.
 * - Primitives, Date, RegExp, Map, Set, class instances: consumer
 *   wins; no recursion (these are leaves under `isPlainRecord`).
 *
 * Idempotent short-circuit: when consumer is structurally complete
 * relative to defaults the function returns `consumer` by reference,
 * so common-case writes (consumer already complete) allocate nothing.
 */
export function mergeStructural(
  schema: SchemaForFill,
  path: Path,
  consumer: unknown,
  defaultValue: unknown = schema.getDefaultAtPath(path)
): unknown {
  // Internal recursion uses a single mutable scratch path: each level
  // pushes its segment before descending and pops on return. Eliminates
  // the per-recursion `[...path, key]` / `[...path, i]` allocation
  // that previously fired on every object key + every array element.
  // Schema adapters (zod / standard-schema) read `getDefaultAtPath`
  // synchronously and don't retain the path, so passing the live
  // scratch is safe; if a future adapter needed retention, snapshot
  // inside that adapter rather than allocating per-call here.
  const scratch: Segment[] = path.slice()
  return mergeStructuralImpl(schema, scratch, consumer, defaultValue)
}

function mergeStructuralImpl(
  schema: SchemaForFill,
  scratch: Segment[],
  consumer: unknown,
  defaultValue: unknown
): unknown {
  // Consumer is missing — fall back to the schema default. When the
  // schema default itself is `undefined` (path doesn't exist in the
  // schema), the result is `undefined` and we don't fight it.
  if (consumer === undefined) return defaultValue

  // Null wins: deliberate consumer signal. Schema-validation catches
  // null-vs-non-nullable; runtime doesn't override consumer intent.
  if (consumer === null) return null

  // Array branch: distinguish tuple-like (fixed length) from array
  // (unbounded). Probe at a high index — tuples return `undefined`,
  // arrays return the element default. For tuple-like, pad consumer
  // up to the structural length; for arrays, length tracks consumer.
  if (Array.isArray(consumer)) {
    const TUPLE_PROBE_INDEX = 1_000_000
    scratch.push(TUPLE_PROBE_INDEX)
    const probe = schema.getDefaultAtPath(scratch)
    scratch.pop()
    let targetLen = consumer.length
    if (probe === undefined) {
      // Tuple-like: find structural length via sequential probe. Cap
      // protects against pathological recursive lazies.
      let n = consumer.length
      while (n < 1024) {
        scratch.push(n)
        const v = schema.getDefaultAtPath(scratch)
        scratch.pop()
        if (v === undefined) break
        n++
      }
      targetLen = n
    }
    let mutated = targetLen > consumer.length
    const out = consumer.slice() as unknown[]
    while (out.length < targetLen) out.push(undefined)
    for (let i = 0; i < targetLen; i++) {
      scratch.push(i)
      const elemDefault = schema.getDefaultAtPath(scratch)
      const consumerElem = i < consumer.length ? consumer[i] : undefined
      const merged = mergeStructuralImpl(schema, scratch, consumerElem, elemDefault)
      scratch.pop()
      if (merged !== consumerElem) {
        out[i] = merged
        mutated = true
      }
    }
    return mutated ? out : consumer
  }

  // Plain object: fill missing keys from default, recurse on present
  // keys. Consumer-only keys pass through.
  if (isPlainRecord(consumer)) {
    if (!isPlainRecord(defaultValue)) {
      // Default is non-record (or undefined / leaf) — nothing to fill;
      // consumer wins as-is. Recurse just in case consumer holds nested
      // keys that the schema knows about at deeper paths (rare).
      return consumer
    }
    let mutated = false
    const out: Record<string, unknown> = { ...consumer }
    // Fill schema-default keys missing from consumer.
    for (const key of Object.keys(defaultValue)) {
      if (!(key in consumer) || consumer[key] === undefined) {
        const defAtKey = defaultValue[key]
        // Recurse so that filling produces a structurally-complete
        // sub-tree (covers nested-object defaults that themselves
        // contain wrappers / unions).
        scratch.push(key)
        const filled = mergeStructuralImpl(schema, scratch, undefined, defAtKey)
        scratch.pop()
        if (filled !== undefined) {
          out[key] = filled
          mutated = true
        }
      }
    }
    // Recurse into consumer-supplied keys to catch nested gaps.
    for (const key of Object.keys(consumer)) {
      scratch.push(key)
      const merged = mergeStructuralImpl(schema, scratch, consumer[key], defaultValue[key])
      scratch.pop()
      if (merged !== consumer[key]) {
        out[key] = merged
        mutated = true
      }
    }
    return mutated ? out : consumer
  }

  // Leaf-ish (primitives, Date, RegExp, Map, Set, class instances) —
  // consumer wins, no recursion.
  return consumer
}

/**
 * Schema-aware variant of `setAtPath`. When extending past array
 * length, pads new positions with the schema's element default
 * instead of `undefined`. When descending into an object whose
 * intermediate property is missing, fills the intermediate with
 * the schema's default at that sub-path.
 *
 * `value` is the already-mergeStructural'd target value — this
 * function only handles INTERMEDIATE fill. The caller (typically
 * `setValueAtPath` on the form store) is responsible for completing
 * the leaf.
 *
 * Performance: schema lookups happen only at gap sites. The common
 * case (write to existing slot) does a copy-on-write spread without
 * touching the schema. Misuse (`setValue('posts.21', x)` against an
 * empty array) costs `getDefaultAtPath` once for the array element
 * default (cached via `lastArrayDefault`/`lastArrayPathPrefix` for
 * the duration of the call) and N pad inserts.
 */
export function setAtPathWithSchemaFill(
  root: unknown,
  schema: SchemaForFill,
  fullPath: Path,
  value: unknown
): unknown {
  if (fullPath.length === 0) return value
  return setAtPathWithSchemaFillImpl(root, schema, fullPath, value, 0)
}

function setAtPathWithSchemaFillImpl(
  root: unknown,
  schema: SchemaForFill,
  fullPath: Path,
  value: unknown,
  startIdx: number
): unknown {
  if (startIdx >= fullPath.length) return value

  const head = fullPath[startIdx] as Segment
  const isLeafStep = startIdx === fullPath.length - 1

  if (typeof head === 'number') {
    const arr = Array.isArray(root) ? [...root] : []
    const prefix = fullPath.slice(0, startIdx)
    // Pad with element defaults if extending past length. Tuple-vs-
    // array detection mirrors mergeStructural: probe at a high index
    // — tuples return `undefined` (out of range), unbounded arrays
    // return the element default. The previous heuristic (compare two
    // adjacent defaults via Object.is) gave wrong answers for arrays
    // of objects (each call yields a fresh object, identity differs)
    // AND for tuples of identical primitives (Object.is(0, 0) === true).
    if (arr.length < head) {
      const TUPLE_PROBE_INDEX = 1_000_000
      const probe = schema.getDefaultAtPath([...prefix, TUPLE_PROBE_INDEX])
      const tupleLike = probe === undefined
      // For unbounded arrays, every position resolves to the same
      // element default — cache the lookup once. For tuples, query
      // per-position so each slot's default lands at its own index.
      const cachedArrayDefault = tupleLike ? undefined : schema.getDefaultAtPath([...prefix, 0])
      while (arr.length < head) {
        const idx = arr.length
        arr.push(tupleLike ? schema.getDefaultAtPath([...prefix, idx]) : cachedArrayDefault)
      }
    }

    if (isLeafStep) {
      arr[head] = value
      return arr
    }

    // Intermediate step: ensure the slot at `head` is structurally
    // complete BEFORE recursing into the rest of the path. Without
    // this fill, recursion starts from `undefined` and the next level
    // builds a fresh `{}` populated only by the keys the path
    // actually touches — sibling fields (other Person keys, other
    // Address keys) get silently dropped. Same intermediate-fill
    // semantic the object branch applies a few lines below.
    let childRoot = arr[head]
    if (childRoot === undefined || (childRoot !== null && typeof childRoot !== 'object')) {
      childRoot = schema.getDefaultAtPath([...prefix, head])
    }
    arr[head] = setAtPathWithSchemaFillImpl(childRoot, schema, fullPath, value, startIdx + 1)
    return arr
  }

  // Object key.
  const rec: Record<string, unknown> = isPlainRecord(root) ? { ...root } : {}
  if (isLeafStep) {
    rec[head] = value
    return rec
  }

  // Intermediate: ensure the child exists, filling from the schema
  // default if missing or non-descendable.
  const existing = rec[head]
  let childRoot: unknown
  if (existing === undefined || (existing !== null && typeof existing !== 'object')) {
    const intermPath: Segment[] = [...fullPath.slice(0, startIdx + 1)]
    const intermDefault = schema.getDefaultAtPath(intermPath)
    childRoot = intermDefault
  } else {
    childRoot = existing
  }
  rec[head] = setAtPathWithSchemaFillImpl(childRoot, schema, fullPath, value, startIdx + 1)
  return rec
}
