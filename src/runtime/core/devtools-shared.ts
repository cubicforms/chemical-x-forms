/**
 * Shared building blocks for Attaform's two devtools surfaces — the Vue
 * DevTools (Chrome-extension) inspector wired up in `./devtools.ts`, and
 * the Nuxt DevTools (overlay) panel wired up via `../../nuxt.ts` +
 * `../pages/_attaform_devtools.vue`.
 *
 * Centralizing the redaction policy and the window-bridge contract here
 * keeps both surfaces aligned: a future tightening of the sensitive-name
 * heuristic, or a new field added to the bridge, lands in one file.
 */
import type { AttaformRegistry } from './registry'
import type { Segment } from './paths'

export const REDACTED = '[redacted]'

/**
 * Walk `value` and replace any leaf whose enclosing path matches the
 * sensitive-name heuristic with the string `'[redacted]'`. Returns a
 * new tree (no mutation of the input). Object keys + array indices are
 * preserved; only the leaf payloads change.
 *
 * Applied to BOTH devtools surfaces' Form-value rendering AND every
 * timeline event payload — leaks via either surface are treatable as
 * "any developer with the panel open during user testing can read a
 * customer's password," which is exactly the failure mode the
 * sensitive-name guard exists to prevent on the storage side.
 *
 * Leaves whose path doesn't match a pattern pass through untouched.
 * `acknowledgeSensitive: true` on persistence does NOT bypass this — if
 * the consumer opted into persisting the value, they still shouldn't
 * see it in DevTools timelines that grow unbounded.
 *
 * Implementation note: tracks an `inSensitiveSubtree` flag through the
 * recursion instead of allocating a fresh path array per node + calling
 * `isSensitivePath` per leaf. Once any ancestor segment matches the
 * heuristic, the flag stays set for every descendant — the leaf simply
 * returns `REDACTED` without re-scanning the path. For a 100-leaf form:
 * ~100 path allocations + ~100 full-path regex sweeps → 0 path
 * allocations + ~100 single-segment regex sweeps, with whole-subtree
 * short-circuit when sensitive ancestors are found early.
 */
export function redactSensitiveLeaves(
  value: unknown,
  matchSensitive: (segment: Segment) => boolean
): unknown {
  return redactImpl(value, false, matchSensitive)
}

function redactImpl(
  value: unknown,
  inSensitiveSubtree: boolean,
  matchSensitive: (segment: Segment) => boolean
): unknown {
  if (value === null || value === undefined) return value
  if (typeof value !== 'object') {
    return inSensitiveSubtree ? REDACTED : value
  }
  if (Array.isArray(value)) {
    // Numeric segments never match the sensitive-name heuristic
    // (segmentMatchesSensitive rejects non-string segments), so the
    // flag passes through unchanged when descending into arrays.
    return value.map((item) => redactImpl(item, inSensitiveSubtree, matchSensitive))
  }
  // Non-plain object (Map / Set / Date / class instance) — redact
  // wholesale if we're already in a sensitive subtree; otherwise pass
  // through. DevTools rendering of these is already heuristic, so we
  // don't try to descend into them.
  //
  // Use `Object.prototype.toString.call(value)` rather than a
  // `getPrototypeOf` comparison because `Object.prototype` is
  // realm-scoped — the Nuxt DevTools overlay panel runs in an iframe
  // whose Vue runtime is separate from the host's, so the host's
  // reactive proxies have a prototype that doesn't equal the panel's
  // `Object.prototype`. The `toString` tag check is realm-aware via
  // `@@toStringTag` and returns `'[object Object]'` for plain objects
  // (including Vue reactive proxies of plain objects) regardless of
  // which iframe they were created in.
  if (Object.prototype.toString.call(value) !== '[object Object]') {
    return inSensitiveSubtree ? REDACTED : value
  }
  const out: Record<string, unknown> = {}
  for (const key of Object.keys(value as Record<string, unknown>)) {
    const childSensitive = inSensitiveSubtree || matchSensitive(key)
    out[key] = redactImpl((value as Record<string, unknown>)[key], childSensitive, matchSensitive)
  }
  return out
}

/**
 * Property key on `window` that the Nuxt-side dev plugin attaches the
 * bridge object to. The iframe-mounted overlay panel reads
 * `window.parent[DEVTOOLS_WINDOW_KEY]` to reach the host app's registry.
 *
 * Underscored + namespaced to make accidental collision with consumer
 * globals vanishingly unlikely. Stable across versions — bumping it
 * would silently disconnect older library builds from newer overlay
 * panels in the same browser tab during a library upgrade.
 */
export const DEVTOOLS_WINDOW_KEY = '__attaform_devtools__'

/**
 * Shape of the object the host plugin attaches to `window` in dev mode.
 * The iframe overlay panel reads this to discover the live registry and
 * render its forms.
 *
 * Single-registry assumption: the latest `createAttaform()` install
 * wins. Multi-app pages (rare; typically only seen in micro-frontend
 * setups) will only see one app's forms in the panel. Documented but
 * not actively supported — the alternative (a Set of registries with
 * union-rendering) is a future call if a real consumer hits it.
 */
export interface AttaformDevtoolsBridge {
  registry: AttaformRegistry
  /**
   * The library version, surfaced in the panel's footer for support /
   * bug-report context. Read from `package.json` at host-plugin init.
   */
  version: string
}

declare global {
  interface Window {
    [DEVTOOLS_WINDOW_KEY]?: AttaformDevtoolsBridge
  }
}
