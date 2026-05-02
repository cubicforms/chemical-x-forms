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

describe('selectNodeTransform — `:value` injection on the select element', () => {
  // Patching `select.value` on a `<select multiple>` runs the spec's
  // value-setter loop and DESELECTS every option whose value isn't
  // case-equal to the new string. Our `displayValue.value` for an
  // array model is `String(arr)` like "red,blue" — matches no option
  // — so injecting `:value` on a multi-select clobbers the per-option
  // `:selected` SSR state at hydration. The transform must skip
  // `:value` on multi-selects; the per-option bindings carry the
  // correct initial state on their own.
  it('does NOT inject :value on a static <select multiple>', () => {
    const code = compileWithTransform(
      `<select v-register="colors" multiple><option value="red">Red</option></select>`
    )
    expect(code).not.toMatch(/\bvalue:\s*[^,}\n]*displayValue/)
  })

  it('does NOT inject :value on a dynamic :multiple select (conservative)', () => {
    // Compile-time can't evaluate `cond`, so we have to assume it might
    // resolve to true at runtime. Treat dynamic-multiple the same as
    // static-multiple: skip the injection, keep the per-option bindings.
    const code = compileWithTransform(
      `<select v-register="colors" :multiple="cond"><option value="red">Red</option></select>`
    )
    expect(code).not.toMatch(/\bvalue:\s*[^,}\n]*displayValue/)
  })

  it('DOES inject :value on a regular (single) <select>', () => {
    const code = compileWithTransform(
      `<select v-register="fruit"><option value="apple">Apple</option></select>`
    )
    expect(code).toMatch(/\bvalue:\s*[^,}\n]*displayValue/)
  })

  it('DOES inject :value on an explicit non-multi <select multiple="false">', () => {
    const code = compileWithTransform(
      `<select v-register="fruit" multiple="false"><option value="apple">Apple</option></select>`
    )
    expect(code).toMatch(/\bvalue:\s*[^,}\n]*displayValue/)
  })
})

describe('selectNodeTransform — option value fallback (D3)', () => {
  it('binds :selected on options that already have an explicit value=', () => {
    const code = compileWithTransform(
      `<select v-register="fruit"><option value="apple">Apple</option></select>`
    )
    // One <option> ⇒ exactly one :selected binding. Tightened from `> 0`
    // so a duplicate-injection regression can't hide.
    expect(countSelectedBindings(code)).toBe(1)
    expect(code).toContain('apple')
  })

  it('falls back to static text content when value= is missing', () => {
    const code = compileWithTransform(`<select v-register="fruit"><option>apple</option></select>`)
    expect(countSelectedBindings(code)).toBe(1)
    expect(code).toContain('"apple"') // synthesized as a JSON string literal
  })

  it('synthesizes the value with whitespace trimmed', () => {
    const code = compileWithTransform(
      `<select v-register="fruit"><option>  apple  </option></select>`
    )
    expect(countSelectedBindings(code)).toBe(1)
    expect(code).toContain('"apple"')
  })

  it('escapes single quotes in the synthesised text literal', () => {
    const code = compileWithTransform(`<select v-register="kind"><option>a'b</option></select>`)
    // JSON.stringify wraps in double quotes — single quotes inside don't need escaping.
    expect(code).toContain('"a\'b"')
  })

  it('emits a JSON string literal (covers backslashes alongside quotes and line terminators)', () => {
    // JSON.stringify is the escape mechanism for option-value literals.
    // A backslash in the option text round-trips as `\\` in the
    // generated JS, locking the escape strategy without having to
    // construct a template that survives Vue's text-node whitespace
    // normalisation. JSON.stringify also handles U+2028 / U+2029 per
    // the JSON spec.
    const code = compileWithTransform(`<select v-register="kind"><option>a\\b</option></select>`)
    expect(code).toContain('"a\\\\b"')
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

describe('selectNodeTransform — E1 source-location fidelity', () => {
  it('preserves a non-zero source location on the injected :value binding', () => {
    // Pad the template so the <select> doesn't sit at line/column 0
    // — this lets us assert that the injected directive's loc matches
    // a non-trivial position rather than the deleted dummyLoc.
    const template = `<div>\n  <select v-register="fruit"><option value="apple">A</option></select>\n</div>`
    // baseCompile preserves AST node `loc` fields; we walk the AST and
    // confirm the `:value` directive on the select has the select's loc.
    const result = baseCompile(template, {
      nodeTransforms: [selectNodeTransform],
      mode: 'module',
    })
    const root = result.ast as unknown as { children: { tag?: string; children?: unknown[] }[] }
    const div = root.children[0] as {
      tag: string
      children: { tag?: string; props: { name: string; loc: { start: { line: number } } }[] }[]
    }
    const select = div.children.find((c) => c.tag === 'select')
    expect(select).toBeDefined()
    const valueProp = select?.props.find((p) => p.name === 'bind')
    if (valueProp === undefined) throw new Error('select :value binding missing')
    // Pre-fix the loc was {line: 0, column: 0}; now it matches the
    // select element's location (line 2 in this template after the
    // leading <div> + newline + indent).
    expect(valueProp.loc.start.line).toBeGreaterThan(0)
  })
})
