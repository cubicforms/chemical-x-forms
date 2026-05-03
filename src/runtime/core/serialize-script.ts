/**
 * Escape a JSON string so it's safe to embed inside an inline
 * `<script>` tag during SSR. Plain `JSON.stringify` is not safe — a
 * form value containing the literal substring `</script>` would
 * break out of the script tag.
 *
 * ```ts
 * const payload = escapeForInlineScript(JSON.stringify(renderAttaformState(app)))
 * // `<script>window.__ATTAFORM_STATE__ = ${payload}</script>` is safe.
 * ```
 *
 * Output remains valid JSON — `JSON.parse` round-trips back to the
 * original value on the client.
 */
export function escapeForInlineScript(json: string): string {
  return json.replace(/[<>&\u2028\u2029]/g, (char) => {
    switch (char) {
      case '<':
        return '\\u003c'
      case '>':
        return '\\u003e'
      case '&':
        return '\\u0026'
      case '\u2028':
        return '\\u2028'
      case '\u2029':
        return '\\u2029'
      default:
        return char
    }
  })
}
