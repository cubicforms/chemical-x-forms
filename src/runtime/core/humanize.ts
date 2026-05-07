/**
 * Convert a path segment into a presentable label. Used as the
 * fallback for `FieldState.label` when no explicit label is
 * registered with the schema. Splits camelCase, snake_case, and
 * kebab-case into separate words and title-cases each word.
 *
 * Numeric segments (array indices) collapse to an empty string —
 * `items[3]` should not present as `'3'`. Callers can substitute
 * their own fallback (e.g. `'Item 3'`) when this returns empty.
 *
 * Pure function, no I/O. Safe to call eagerly.
 */
export function humanize(segment: string | number): string {
  if (typeof segment === 'number') return ''
  const str = String(segment)
  if (str.length === 0) return ''
  // Numeric-string segments (array indices like '3'): treat as
  // empty so `items.3` doesn't surface as 'Item 3'.
  if (/^\d+$/.test(str)) return ''
  // Split camelCase boundaries, snake_case, kebab-case, and
  // collapse runs of whitespace.
  const tokens = str
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter((part) => part.length > 0)
  if (tokens.length === 0) return ''
  return tokens
    .map((part) => {
      const head = part[0]
      return head === undefined ? part : head.toUpperCase() + part.slice(1).toLowerCase()
    })
    .join(' ')
}
