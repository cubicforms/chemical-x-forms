import type { AbstractSchema } from '../types/types-api'
import { canonicalizePath, type Path, type Segment } from './paths'

/**
 * Leaf-aware callable Proxy machinery shared by `form.values`,
 * `form.errors`, and `form.fields`. One generic builder; per-surface
 * specialisation lives in the surface's own factory file (see
 * `field-state-proxy.ts` for fields).
 *
 * Two-level contract:
 *
 * - At a **container path** (`schema.isLeafAtPath(segments) === false`)
 *   the `get` trap descends to a sub-proxy. No leaf-key injection — a
 *   schema field literally named `dirty` at depth 2+ stays reachable.
 * - At a **leaf path** (`schema.isLeafAtPath(segments) === true`)
 *   the `get` trap terminates. Two flavours:
 *   - `leafKeys` undefined (errors/values): returns
 *     `resolveLeaf(segments)` directly. The terminal IS the value.
 *   - `leafKeys` provided (fields): returns a leaf-VIEW proxy that
 *     exposes only `leafKeys` as terminal reads off `resolveLeaf`'s
 *     return. FIELD_STATE_KEYS injection happens HERE only.
 *
 * Both proxies are callable (function-target with `apply` trap):
 * - `proxy()` → root proxy (same as no-paren)
 * - `proxy('a.b.c')` / `proxy(['a', 'b', 'c'])` → walks to that path,
 *   returns whatever the dotted form would (leaf or container proxy).
 *
 * Symbol keys pass through to the function target so Vue's reactivity
 * sigils (`Symbol(__v_isRef)`, `Symbol(__v_isReadonly)`, etc.) and
 * iteration symbols don't accidentally route through the schema-aware
 * branch.
 *
 * Per-path proxy memoisation: each surface keeps its own
 * `Map<PathKey, CallableSurface>` so repeated reads of the same path
 * return the same Proxy object — referential equality matters for
 * downstream effect tracking and Vue's render diff.
 */

/**
 * Tests an integer-like string without leading zeros. Mirrors the
 * `INTEGER_SEGMENT` regex in paths.ts. Inlined here to avoid exporting
 * an internal helper across the module boundary.
 */
const INTEGER_SEGMENT = /^(?:0|[1-9]\d*)$/

/**
 * Convert a string property key to the canonical Segment form. Integer-
 * looking strings (`'0'`, `'1'`, `'42'`) become numbers so that paths
 * accumulated through proxy descent match what `canonicalizePath`
 * produces from a dotted-string call (e.g. `proxy('users.0.name')`).
 */
function keyToSegment(key: string): Segment {
  return INTEGER_SEGMENT.test(key) ? Number(key) : key
}

export type SurfaceOptions<TLeaf> = {
  /** Schema instance; queried via `isLeafAtPath` at every descent. */
  readonly schema: AbstractSchema<unknown, unknown>
  /**
   * Resolve the surface's terminal value at a leaf path. Called at every
   * leaf-path read; consumers should memoise inside `resolveLeaf` if the
   * resolution is expensive (the field-state surface uses
   * `buildFieldStateAccessor` which returns a memoised `ComputedRef`).
   */
  readonly resolveLeaf: (path: Path) => TLeaf
  /**
   * If provided: at a leaf path, the surface proxy returns a leaf-VIEW
   * proxy exposing only these keys as terminal reads off the resolved
   * leaf. `readLeafKey` performs the extraction.
   *
   * If undefined: at a leaf path, the surface proxy returns
   * `resolveLeaf(path)` directly. No further proxy wrap.
   */
  readonly leafKeys?: ReadonlySet<string>
  /**
   * Extracts a leaf-key value from the resolved leaf. Required when
   * `leafKeys` is provided. The `key` arg is guaranteed to be in
   * `leafKeys`. Reads inside this function happen during a Vue effect's
   * run, so dependency tracking propagates from `resolveLeaf`'s return.
   */
  readonly readLeafKey?: (leaf: TLeaf, key: string) => unknown
  /**
   * Materialise the container at `segments` into a plain JSON-friendly
   * object. Called by the container proxy's `toJSON` / `toString` /
   * `Symbol.toPrimitive('default')` traps every time a consumer
   * stringifies the proxy. Reads inside this callback happen at call
   * time inside the consumer's active effect, so Vue's dependency
   * tracking captures every reactive read (error stores, the form
   * Ref, computed maps) — `JSON.stringify(form.errors)` in a render
   * function or `{{ form.errors }}` in a template re-runs whenever
   * the underlying state changes.
   *
   * If undefined: containers serialise to `{}` (the pre-0.14.x
   * behaviour). Provided so each surface controls its own
   * materialisation strategy:
   * - `errors`: sparse — only paths that actually have errors,
   *   active-path-filtered.
   * - `fields`: dense — every schema-leaf descendant snapshotted as
   *   a `FieldStateView`.
   * - `values`: not built on this generic; its own proxy serialises
   *   the inner readonly proxy directly.
   */
  readonly materializeContainer?: (segments: readonly Segment[]) => unknown
}

/**
 * The public shape of a built surface. Drill (dot/bracket) OR call
 * (apply trap with a path arg). The TypeScript shape stays loose at
 * the runtime layer; per-surface types in `types-api.ts` narrow the
 * descent.
 */
export type SurfaceProxy = ((path?: string | Path) => unknown) & Record<string, unknown>

export function buildSurfaceProxy<TLeaf>(opts: SurfaceOptions<TLeaf>): SurfaceProxy {
  // Per-path container Proxy cache. Key = canonical PathKey
  // (`JSON.stringify(segments)`). Lifetime = one buildSurfaceProxy call.
  const containerCache = new Map<string, SurfaceProxy>()
  // Per-path leaf-VIEW Proxy cache. Only populated when `leafKeys` is
  // configured. Same key shape, separate Map so a path with the same
  // canonical key but different leaf-ness (impossible in practice) wouldn't
  // collide.
  const leafViewCache = new Map<string, SurfaceProxy>()
  // Per-path "schema has a field here" cache. Used by the
  // schema-authority check that resolves collisions between built-in
  // method names (`toString`, `valueOf`) and schema fields literally
  // sharing those names. Same lifetime as the leaf/container caches.
  const existsCache = new Map<string, boolean>()

  /** True iff the schema has a field at `segs` (leaf OR container). */
  function schemaHasPath(segs: readonly Segment[]): boolean {
    const cacheKey = JSON.stringify(segs)
    const cached = existsCache.get(cacheKey)
    if (cached !== undefined) return cached
    const result = opts.schema.getSlimPrimitiveTypesAtPath(segs).size > 0
    existsCache.set(cacheKey, result)
    return result
  }

  /** Resolve a path to its leaf terminal or container sub-proxy. */
  function descendOrTerminate(segs: readonly Segment[]): unknown {
    const isLeaf = opts.schema.isLeafAtPath(segs)
    if (isLeaf) {
      if (opts.leafKeys !== undefined) return leafViewProxyAt(segs)
      return opts.resolveLeaf(segs)
    }
    return containerProxyAt(segs)
  }

  function navigateTo(input: string | Path | undefined): unknown {
    if (input === undefined) return rootProxy
    const { segments } = canonicalizePath(input)
    return descendOrTerminate(segments)
  }

  function containerProxyAt(segments: readonly Segment[]): SurfaceProxy {
    const cacheKey = JSON.stringify(segments)
    const existing = containerCache.get(cacheKey)
    if (existing !== undefined) return existing

    // Container-shaped primitive coercion. The materialiser (when set)
    // is invoked on every call so reactive reads (error stores, the
    // form Ref) are tracked inside the consumer's active effect — the
    // proxy itself is cached per-path, but its serialised form is
    // computed fresh on every stringify, so there is no staleness.
    //
    // - `valueOf` follows `Object.prototype.valueOf` semantics: return
    //   the receiver (the proxy itself, via dynamic `this`). Returning
    //   a non-primitive keeps OrdinaryToPrimitive's `valueOf` →
    //   `toString` fallback well-formed for any code path that
    //   bypasses our `Symbol.toPrimitive` shortcut.
    // - `toString` returns `JSON.stringify(materialised)` so direct
    //   method calls produce the same string as operator coercion.
    // - `Symbol.toPrimitive('number')` always returns `NaN` — a
    //   container has no meaningful number coercion.
    const snapshotContainer = (): unknown =>
      opts.materializeContainer === undefined ? {} : opts.materializeContainer(segments)
    const containerToJSON = (): unknown => snapshotContainer()
    const containerToString = (): string => JSON.stringify(snapshotContainer())
    function containerValueOf(this: unknown): unknown {
      return this
    }
    const containerToPrimitive = (hint: string): string | number =>
      hint === 'number' ? NaN : containerToString()

    // Arrow-function target (so `typeof proxy === 'function'` and `apply`
    // fires). Arrow functions have no `prototype` property, which avoids
    // the "ownKeys trap must include 'prototype'" Proxy invariant — `length`
    // and `name` ARE present but configurable=true, so we can omit them
    // from ownKeys safely.
    const target = (() => {}) as unknown as SurfaceProxy
    const proxy = new Proxy(target, {
      apply(_, __, args: unknown[]): unknown {
        // proxy() → return THIS proxy (i.e. the root or this container).
        // proxy('a.b.c') → walk from root, NOT relative to this proxy.
        // The plan: callable returns the root proxy when called from
        // anywhere (consistent semantic). Relative-walk via dot-access.
        const arg = args[0] as string | Path | undefined
        if (arg === undefined) return proxy
        return navigateTo(arg)
      },
      get(_, key: string | symbol): unknown {
        // Symbol passthrough: Vue's reactivity sigils + iteration symbols
        // resolve against the function target, not the schema-aware branch.
        if (typeof key === 'symbol') {
          // `Symbol.toPrimitive`: handles `String(proxy)` / `Number(proxy)`
          // / template-literal coercion in one shot, bypassing
          // OrdinaryToPrimitive's `toString` → `valueOf` walk (both of
          // which would otherwise route through schema descent below and
          // return sub-proxies — non-primitives — making the coercion
          // throw `TypeError("Cannot convert object to primitive value")`).
          if (key === Symbol.toPrimitive) return containerToPrimitive
          return Reflect.get(target, key)
        }
        if (typeof key !== 'string') return undefined
        // `toJSON`: containers serialise to `{}`. The function-target
        // Proxy is `typeof === 'function'`, which JSON.stringify normally
        // omits — `toJSON` short-circuits that path. Consumers who want
        // structural data use `form.values.<container>` instead.
        if (key === 'toJSON') return containerToJSON
        const childSegs = [...segments, keyToSegment(key)]
        // Direct method-call coercion (`proxy.toString()` /
        // `proxy.valueOf()`): without intercepting these names, the
        // schema-aware descent below would return a sub-proxy and the
        // caller would get back another callable, not a primitive. We
        // resolve the collision with **schema authority**: if the
        // schema has a field literally named `toString` / `valueOf` at
        // this depth, that field wins (descent proceeds). Otherwise the
        // primitive-coercion handler wins. This keeps the Symbol.toPrimitive
        // shortcut consistent with direct method calls AND avoids the
        // FIELD_STATE_KEYS-style shadowing that 0.14 explicitly killed.
        if (key === 'toString' || key === 'valueOf') {
          if (!schemaHasPath(childSegs)) {
            return key === 'toString' ? containerToString : containerValueOf
          }
          // Schema has it — fall through to descent.
        }
        return descendOrTerminate(childSegs)
      },
      has(_, key: string | symbol): boolean {
        if (typeof key === 'symbol') return Reflect.has(target, key)
        // Conservatively true — the proxy navigates any path; whether
        // the path resolves to a schema-defined slot is the consumer's
        // concern (read returns the deep proxy or terminal as usual).
        return true
      },
      // Containers are descend-only — `JSON.stringify(form.fields.address)`
      // returns `{}` (no leaf keys to enumerate). Consumers who want
      // structural data use `form.values.<container>` instead.
      ownKeys: () => [],
      getOwnPropertyDescriptor: () => undefined,
      // Block writes at the proxy boundary. Mutations go through
      // `setValue`, the directive, or the field-array helpers.
      set: () => false,
      deleteProperty: () => false,
      defineProperty: () => false,
    })
    containerCache.set(cacheKey, proxy)
    return proxy
  }

  function leafViewProxyAt(segments: readonly Segment[]): SurfaceProxy {
    const cacheKey = JSON.stringify(segments)
    const existing = leafViewCache.get(cacheKey)
    if (existing !== undefined) return existing

    const leafKeys = opts.leafKeys
    const readLeafKey = opts.readLeafKey
    if (leafKeys === undefined || readLeafKey === undefined) {
      // Defensive: leaf-VIEW proxy only constructed when leafKeys is
      // configured. The branch in navigateTo + containerProxyAt's `get`
      // both guard this — keep the runtime safe regardless.
      throw new Error('leafViewProxyAt called without leafKeys/readLeafKey configured')
    }

    // Snapshot builder shared by `toJSON` and the primitive-coercion
    // handlers. Reads through `resolveLeaf` and `readLeafKey` happen at
    // call time inside the consumer's active effect, so Vue's dependency
    // tracking captures the leaf's reactive deps (the
    // `ComputedRef<FieldStateView>` for fields).
    const snapshotLeaf = (): Record<string, unknown> => {
      const leaf = opts.resolveLeaf(segments)
      const snapshot: Record<string, unknown> = {}
      for (const leafKey of leafKeys) {
        snapshot[leafKey] = readLeafKey(leaf, leafKey)
      }
      return snapshot
    }
    const leafToString = (): string => JSON.stringify(snapshotLeaf())
    function leafValueOf(this: unknown): unknown {
      return this
    }
    const leafToPrimitive = (hint: string): string | number =>
      hint === 'number' ? NaN : leafToString()

    const target = (() => {}) as unknown as SurfaceProxy
    const proxy = new Proxy(target, {
      apply(_, __, args: unknown[]): unknown {
        // Calling a leaf-view proxy is unusual but well-defined: with no
        // arg, return the resolved leaf object itself; with a path, walk
        // from the root.
        const arg = args[0] as string | Path | undefined
        if (arg === undefined) return opts.resolveLeaf(segments)
        return navigateTo(arg)
      },
      get(_, key: string | symbol): unknown {
        if (typeof key === 'symbol') {
          // See containerProxyAt for the rationale. Leaf-views return
          // the JSON-stringified snapshot so primitive coercion produces
          // a useful display (e.g. `String(form.fields.email)` shows the
          // FieldStateView shape rather than throwing).
          if (key === Symbol.toPrimitive) return leafToPrimitive
          return Reflect.get(target, key)
        }
        if (typeof key !== 'string') return undefined
        // Direct method-call path for primitive coercion. `toString`
        // returns the same JSON snapshot as `Symbol.toPrimitive`;
        // `valueOf` returns the receiver (non-primitive) so
        // OrdinaryToPrimitive's `valueOf` → `toString` walk falls through
        // for any code path that bypasses `Symbol.toPrimitive`. No schema
        // collision is possible at this depth: leaves are primitives, so
        // they have no schema children. Collisions at higher container
        // depths (a schema field literally named `toString`) are
        // resolved by `containerProxyAt`'s schema-authority check.
        if (key === 'toString') return leafToString
        if (key === 'valueOf') return leafValueOf
        // `toJSON`: leaf-views serialise to a snapshot object containing
        // every leaf-key value at the moment of the call. Matches the
        // legacy `JSON.stringify(form.getFieldState(path).value)` shape
        // and unblocks SSR templates that serialise `form.fields.<leaf>`
        // into the hydration payload.
        if (key === 'toJSON') return snapshotLeaf
        // Reads inside the trap stay inside the consumer's active effect —
        // `resolveLeaf` returns a `ComputedRef` (for fields) and `.value`
        // is read inside `readLeafKey`, so Vue's dep tracking captures
        // the dependency at access time.
        if (leafKeys.has(key)) {
          const leaf = opts.resolveLeaf(segments)
          return readLeafKey(leaf, key)
        }
        // Schema field at a leaf-prop name: descend further. The leaf-prop
        // and the schema field name occupy DIFFERENT proxy depths because
        // the schema's leaf-aware structure puts them on different paths.
        // Example: schema `{ address: { isValid: z.boolean() } }`:
        //   form.fields.address          → container proxy
        //   form.fields.address.isValid  → leaf-view (here)
        //   form.fields.address.isValid.isValid → THIS read; 'isValid'
        //                                          IS in leafKeys → returns
        //                                          the FieldStateView's
        //                                          isValid prop.
        // For non-leafKeys reads, descend by appending the key to segments
        // and re-checking leaf-ness. This handles container-shaped
        // schema fields hanging off a leaf-named ancestor (rare but
        // possible).
        return descendOrTerminate([...segments, keyToSegment(key)])
      },
      has(_, key: string | symbol): boolean {
        if (typeof key === 'symbol') return Reflect.has(target, key)
        if (typeof key === 'string' && leafKeys.has(key)) return true
        return true
      },
      // Iteration: leaf-views expose the leaf-key set so
      // `JSON.stringify(form.fields.email)` produces the expected
      // FieldStateView snapshot (matching the legacy
      // `JSON.stringify(form.getFieldState('email').value)` shape).
      ownKeys: () => Array.from(leafKeys),
      getOwnPropertyDescriptor(_, key: string | symbol): PropertyDescriptor | undefined {
        if (typeof key !== 'string') return undefined
        if (!leafKeys.has(key)) return undefined
        const leaf = opts.resolveLeaf(segments)
        return {
          configurable: true,
          enumerable: true,
          value: readLeafKey(leaf, key),
          writable: false,
        }
      },
      set: () => false,
      deleteProperty: () => false,
      defineProperty: () => false,
    })
    leafViewCache.set(cacheKey, proxy)
    return proxy
  }

  // Root proxy. Constructed via `containerProxyAt([])` — root is always
  // a container (every form has at least one field). The cache holds
  // a stable reference; `proxy()` returns the root for the no-arg case.
  const rootProxy = containerProxyAt([])
  return rootProxy
}
