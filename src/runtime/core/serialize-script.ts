/**
 * Escape a JSON string so it's safe to embed inside an inline `<script>`
 * tag. Plain `JSON.stringify` is NOT safe for this: a form value
 * containing the literal substring `</script>` would break out of the
 * script tag and allow arbitrary markup after it. The five-character
 * set below is the same one React's `serialize-javascript`, Nuxt's
 * payload serialiser, and the HTML5 spec all use:
 *
 * - `<` → `<` (prevents `</script>` termination)
 * - `>` → `>` (symmetric; cheap belt-and-braces)
 * - `&` → `&` (prevents entity-encoded breakout attempts in
 *   legacy `<![CDATA[ ... ]]>` script profiles)
 * - `U+2028` / `U+2029` → `\u2028` / `\u2029` (line terminators that
 *   older JS engines honoured inside string literals, which would
 *   terminate the inline script)
 *
 * The output remains valid JSON — the unicode escapes are recognised by
 * `JSON.parse`, so the client-side round-trip through
 * `JSON.parse(window.__STATE__)` still gets back the original string.
 *
 * Usage (entry-server.ts):
 *
 *   import { escapeForInlineScript, renderChemicalXState } from '@chemical-x/forms'
 *
 *   const payload = escapeForInlineScript(JSON.stringify(renderChemicalXState(app)))
 *   // `<script>window.__STATE__ = ${payload}</script>` is safe.
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
