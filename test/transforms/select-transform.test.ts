import { baseCompile } from '@vue/compiler-core'
import { describe, expect, it } from 'vitest'
import { selectNodeTransform } from '../../src/runtime/lib/core/transforms/select-transform'

/**
 * Compile a template through @vue/compiler-core with the select
 * transform registered and inspect the generated render code.
 *
 * D3 — `<option>` without an explicit `value=` attribute should fall
 * back to the option's static text content. Pre-fix the transform
 * silently dropped these, leaving them unselectable through
 * `register('fruit')`.
 */

function compileWithTransform(template: string): string {
  const result = baseCompile(template, {
    nodeTransforms: [selectNodeTransform],
    mode: 'module',
  })
  return result.code
}

// Vue's compiler emits the injected directive as a JS object key —
// `{ selected: ... }`, unquoted. We assert against the unquoted form
// (`/\bselected:/`) so a future generator change to quoting style
// doesn't false-fail. Counting via String.match() rather than
// RegExp.test() to avoid lastIndex carry-over with the /g flag.
function countSelectedBindings(code: string): number {
  return (code.match(/\bselected:/g) ?? []).length
}

describe('selectNodeTransform — option value fallback (D3)', () => {
  it('binds :selected on options that already have an explicit value=', () => {
    const code = compileWithTransform(
      `<select v-register="fruit"><option value="apple">Apple</option></select>`
    )
    expect(countSelectedBindings(code)).toBeGreaterThan(0)
    expect(code).toContain('apple')
  })

  it('falls back to static text content when value= is missing', () => {
    const code = compileWithTransform(`<select v-register="fruit"><option>apple</option></select>`)
    expect(countSelectedBindings(code)).toBeGreaterThan(0)
    expect(code).toContain("'apple'") // synthesized as a string literal
  })

  it('synthesizes the value with whitespace trimmed', () => {
    const code = compileWithTransform(
      `<select v-register="fruit"><option>  apple  </option></select>`
    )
    expect(countSelectedBindings(code)).toBeGreaterThan(0)
    expect(code).toContain("'apple'")
  })

  it('escapes single quotes in the synthesised text literal', () => {
    const code = compileWithTransform(`<select v-register="kind"><option>a'b</option></select>`)
    expect(code).toContain("'a\\'b'")
  })

  it('skips :selected binding when option children are interpolated', () => {
    // `<option>{{ x }}</option>` has a single INTERPOLATION child,
    // not a TEXT child. The transform can't synthesize a static
    // value, so it bails — better than emitting a wrong binding.
    const code = compileWithTransform(
      `<select v-register="fruit"><option>{{ x }}</option></select>`
    )
    expect(countSelectedBindings(code)).toBe(0)
  })

  it('skips :selected binding when option has mixed children', () => {
    const code = compileWithTransform(
      `<select v-register="fruit"><option>label: {{ x }}</option></select>`
    )
    expect(countSelectedBindings(code)).toBe(0)
  })

  it('honours both forms in the same select (mixed)', () => {
    const code = compileWithTransform(
      `<select v-register="fruit"><option>apple</option><option value="banana">Banana</option></select>`
    )
    // Both options' :selected bindings are injected.
    expect(countSelectedBindings(code)).toBe(2)
  })
})
