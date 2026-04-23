/**
 * @vitest-environment jsdom
 */
import { describe, expect, it } from 'vitest'
import { escapeForInlineScript } from '../../src/runtime/core/serialize-script'

const LS = String.fromCharCode(0x2028)
const PS = String.fromCharCode(0x2029)

describe('escapeForInlineScript', () => {
  it('escapes the five characters that break out of inline <script>', () => {
    const input = '<>&' + LS + PS
    const escaped = escapeForInlineScript(input)
    expect(escaped).toBe('\\u003c\\u003e\\u0026\\u2028\\u2029')
    expect(escaped).not.toContain('<')
    expect(escaped).not.toContain('>')
    expect(escaped).not.toContain('&')
    expect(escaped).not.toContain(LS)
    expect(escaped).not.toContain(PS)
  })

  it('leaves ordinary strings untouched', () => {
    const input = 'alice@example.com'
    expect(escapeForInlineScript(input)).toBe(input)
  })

  it('round-trips through JSON.parse(JSON.stringify(...))', () => {
    // Core invariant: the escape is a no-op at the semantic layer.
    // A value serialised -> escaped -> parsed equals the original.
    const original = {
      xss: '</script><script>alert(1)</script>',
      lineSep: 'line 1' + LS + 'line 2',
      ampersand: 'a&b',
      regular: 'nothing interesting',
    }
    const escaped = escapeForInlineScript(JSON.stringify(original))
    const parsed = JSON.parse(escaped)
    expect(parsed).toEqual(original)
  })

  it('neutralises a </script> closing sequence when embedded in HTML', () => {
    // Verify end-to-end: the escaped payload, when dropped into an
    // inline <script> tag, does NOT terminate the script early.
    const payload = escapeForInlineScript(JSON.stringify({ name: '</script>' }))
    const html =
      '<!doctype html><html><body><script>window.__STATE__ = ' + payload + '</script></body></html>'
    const doc = new DOMParser().parseFromString(html, 'text/html')
    const scripts = doc.querySelectorAll('script')
    expect(scripts.length).toBe(1)
    expect(scripts[0]?.textContent ?? '').toContain('\\u003c/script\\u003e')
  })

  it('leaves unrelated backslash sequences intact', () => {
    // JSON.stringify already escapes real backslashes and quotes; our
    // helper must not double-escape them.
    const input = JSON.stringify({ path: 'C:\\users\\n', quote: 'a"b' })
    const escaped = escapeForInlineScript(input)
    expect(JSON.parse(escaped)).toEqual({ path: 'C:\\users\\n', quote: 'a"b' })
  })
})
