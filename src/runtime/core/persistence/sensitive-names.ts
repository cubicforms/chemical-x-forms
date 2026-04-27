import { SensitivePersistFieldError } from '../errors'
import type { Path, PathKey, Segment } from '../paths'

/**
 * Sensitive-name heuristic: a small, intentionally conservative set of
 * regexes that flag a path segment as "this looks like data the consumer
 * almost certainly does not want serialised to client-side storage."
 *
 * The check fires when a binding opts into persistence
 * (`register(path, { persist: true })`) or when an imperative
 * `form.persist(path)` is called — the binding can override with
 * `{ acknowledgeSensitive: true }` if the persistence is genuinely
 * intentional.
 *
 * **Non-goals.** This is not a soundness guarantee. Adversarial paths
 * (`'pswd'`, `'cred'`, `'sensitive_data'`) can slip through; misnamed
 * fields (`'CCV'` instead of `'CVV'`, `'social-sec-num'`) may not match
 * depending on locale or naming convention. The intent is a code-review
 * trigger for the common-case footgun: a developer adds a `password`
 * field to a form that already has `persist: { storage: 'local' }` and
 * doesn't notice that the existing persistence config now reaches the
 * new field. The per-element opt-in model already requires explicit
 * intent for each field; the sensitive-name heuristic adds a second
 * speed bump for the names everyone agrees never belong in localStorage.
 *
 * Word-boundary anchors (`\b`) on short tokens prevent false positives:
 * `'description'` does not match `pwd`; `'tokenizer'` does not match
 * `token`. Multi-word forms (`api[_\s-]?key`) tolerate snake_case,
 * kebab-case, and space-separated variants for path segments emitted
 * by humans.
 */
export const SENSITIVE_NAME_PATTERNS: readonly RegExp[] = [
  /password/i,
  /passwd/i,
  /\bpwd\b/i,
  /\bcvv\b/i,
  /\bcvc\b/i,
  /\bssn\b/i,
  /social[_\s-]?security/i,
  /\bdob\b/i,
  /date[_\s-]?of[_\s-]?birth/i,
  /\bpin\b/i,
  /\btoken\b/i,
  /secret/i,
  /api[_\s-]?key/i,
  /private[_\s-]?key/i,
  /card[_\s-]?(?:number|num)/i,
  /\bcard\b/i,
  /\biban\b/i,
  /routing[_\s-]?number/i,
  /account[_\s-]?number/i,
  /passport/i,
  /driver[_\s-]?license/i,
  /mfa[_\s-]?(?:secret|seed)/i,
  /recovery[_\s-]?code/i,
] as const

function segmentMatchesSensitive(segment: Segment): boolean {
  if (typeof segment !== 'string') return false
  for (const pattern of SENSITIVE_NAME_PATTERNS) {
    if (pattern.test(segment)) return true
  }
  return false
}

/**
 * True iff any segment of the path matches a sensitive-name pattern.
 * Match is per-segment: `'profile.password'` triggers via the `password`
 * segment; `'description.text'` does NOT match `desc` because of the
 * word boundaries on the short tokens.
 *
 * Accepts either a structured `Path` (canonical segments) or a string
 * `PathKey` (canonicalised JSON form). For PathKey, the JSON-bracket
 * shape `["profile","password"]` parses cleanly into segments; falling
 * back to a dotted-string split keeps simple cases working without
 * a JSON.parse round-trip.
 */
export function isSensitivePath(path: Path | PathKey | string): boolean {
  if (typeof path !== 'string') {
    for (const segment of path) {
      if (segmentMatchesSensitive(segment)) return true
    }
    return false
  }
  // String input: try JSON-array first (PathKey), fall back to dotted.
  if (path.startsWith('[')) {
    try {
      const parsed = JSON.parse(path) as unknown[]
      if (Array.isArray(parsed)) {
        for (const segment of parsed) {
          if (segmentMatchesSensitive(segment as Segment)) return true
        }
        return false
      }
    } catch {
      // fall through
    }
  }
  for (const segment of path.split('.')) {
    if (segmentMatchesSensitive(segment)) return true
  }
  return false
}

/**
 * Throw `SensitivePersistFieldError` if `path` matches the heuristic
 * and `acknowledged` is not true. Idempotent / pure — the call site is
 * the directive's opt-in lifecycle (on every add) and `form.persist`
 * (on every imperative checkpoint).
 */
export function enforceSensitiveCheck(path: Path | PathKey | string, acknowledged: boolean): void {
  if (acknowledged) return
  if (!isSensitivePath(path)) return
  throw new SensitivePersistFieldError(path)
}
