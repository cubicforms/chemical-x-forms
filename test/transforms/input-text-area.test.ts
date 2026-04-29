import { baseCompile } from '@vue/compiler-core'
import { describe, expect, it } from 'vitest'
import { inputTextAreaNodeTransform } from '../../src/runtime/lib/core/transforms/input-text-area-transform'

/*
 * Compile a template through @vue/compiler-core with our transform registered,
 * then inspect the generated render code string for the expected injected
 * binding. We don't eval the template — the generated code is inspected as
 * a source-level check, which is far less flaky than a full mount test.
 */

function compileWithTransform(template: string): string {
  const result = baseCompile(template, {
    nodeTransforms: [inputTextAreaNodeTransform],
    mode: 'module',
  })
  return result.code
}

describe('inputTextAreaNodeTransform', () => {
  describe('happy path', () => {
    it('injects a :value binding for <input v-register>', () => {
      const code = compileWithTransform(`<input v-register="email" />`)
      // Transform emits a bind with the selection-label expression as arg and
      // `.innerRef?.value` access in the value expression.
      expect(code).toContain('innerRef')
    })

    it('injects for <textarea v-register>', () => {
      const code = compileWithTransform(`<textarea v-register="note" />`)
      expect(code).toContain('innerRef')
    })
  })

  describe('hostile prop names (exact-key match prevents false positives)', () => {
    it('does NOT inject when only a custom prop contains "register" in its name', () => {
      // Pre-rewrite: .includes('register') matched this and broke.
      const code = compileWithTransform(`<input :data-register-id="'x'" />`)
      expect(code).not.toContain('innerRef')
    })

    it('does NOT inject when a custom prop contains "value" in its name (no v-register present)', () => {
      const code = compileWithTransform(`<input :valueFoo="x" />`)
      expect(code).not.toContain('innerRef')
    })

    it('does NOT inject on a plain input with no v-register', () => {
      const code = compileWithTransform(`<input type="text" />`)
      expect(code).not.toContain('innerRef')
    })
  })

  describe('type="file" refusal', () => {
    it('skips <input type="file" v-register>', () => {
      // Compile-time skip; the runtime directive also routes to a no-op.
      const code = compileWithTransform(`<input type="file" v-register="upload" />`)
      // The generated render code should NOT reference innerRef for a file
      // input — setting el.value throws DOMException on file inputs.
      expect(code).not.toContain('innerRef')
    })

    it('still transforms <input type="text" v-register>', () => {
      const code = compileWithTransform(`<input type="text" v-register="name" />`)
      expect(code).toContain('innerRef')
    })

    // Conservative skip on dynamic / template-literal type bindings — they
    // could resolve to "file" at runtime and trigger DOMException on
    // el.value assignment.
    it('skips <input :type="userKind" v-register> (dynamic identifier)', () => {
      const code = compileWithTransform(`<input :type="userKind" v-register="x" />`)
      expect(code).not.toContain('innerRef')
    })

    it('skips <input :type="`prefix-${suffix}`" v-register> (template literal with interpolation)', () => {
      const code = compileWithTransform('<input :type="`prefix-${suffix}`" v-register="x" />')
      expect(code).not.toContain('innerRef')
    })

    it('skips <input :type="\'file\'" v-register> (literal expression form)', () => {
      const code = compileWithTransform(`<input :type="'file'" v-register="x" />`)
      expect(code).not.toContain('innerRef')
    })

    it('still transforms <input :type="\'text\'" v-register> (provably non-file literal)', () => {
      const code = compileWithTransform(`<input :type="'text'" v-register="x" />`)
      expect(code).toContain('innerRef')
    })

    it('skips <input type="FILE" v-register> (HTML type is ASCII case-insensitive)', () => {
      // The HTML spec matches `type` case-insensitively, so `FILE`, `File`
      // and `file` all produce the same runtime element. The skip must too.
      const code = compileWithTransform(`<input type="FILE" v-register="upload" />`)
      expect(code).not.toContain('innerRef')
    })

    it('skips <input :type="\'File\'" v-register> (mixed-case literal)', () => {
      const code = compileWithTransform(`<input :type="'File'" v-register="upload" />`)
      expect(code).not.toContain('innerRef')
    })
  })

  describe('fail-safe', () => {
    it('does not throw on malformed templates — errors are logged, AST untouched', () => {
      // A valid-enough template that would previously have caused the
      // transform to take a crash path. Just proves the try/catch wrapper
      // is in place; if the transform throws, the compile call also throws.
      expect(() => compileWithTransform(`<input v-register />`)).not.toThrow()
    })
  })

  /**
   * Repro for the playground bug: `<input type="checkbox" value="apple"
   * v-register="...">` lost its static `value` attribute in the
   * generated render code, so SSR HTML had no `value` attribute. Post-
   * hydration the directive's change handler couldn't determine the
   * option-value of the checkbox in an array group.
   *
   * The static `value=` on a checkbox / radio is the OPTION-value (a
   * discriminator within the group), not display state — it must
   * survive the transform. The synthesized binding the transform
   * injects resolves to `:checked` for checkbox / radio at runtime,
   * which is a different attribute key from `value`, so keeping the
   * static `value` attribute alongside it is conflict-free.
   */
  describe('preserves static value attribute on checkbox / radio', () => {
    // The assertions look for the literal in the form `value: "apple"`
    // — that's how Vue's compiler emits an object-property entry for a
    // static attribute. The literal `"apple"` ALSO appears inside the
    // synthesized equality expression (`...?.includes("apple")`), so
    // `toContain('"apple"')` would false-pass even pre-fix; the
    // key-value-pair regex is what specifically catches "did the
    // static attribute survive as an own prop on the props object".
    it('keeps value="apple" on a static-type checkbox', () => {
      const code = compileWithTransform(
        `<input type="checkbox" value="apple" v-register="fruits" />`
      )
      expect(code).toMatch(/\bvalue:\s*"apple"/)
    })

    it('keeps value="apple" on a static-type radio', () => {
      const code = compileWithTransform(`<input type="radio" value="apple" v-register="fruit" />`)
      expect(code).toMatch(/\bvalue:\s*"apple"/)
    })

    it('still strips a colliding value attr on a text-type input', () => {
      // Negative case — for text inputs, the synthesized binding
      // resolves to `:value` and would clash with a static `value`.
      // The transform's removal still applies there.
      const code = compileWithTransform(`<input type="text" value="ignored" v-register="email" />`)
      // The static `value: "ignored"` key-value pair must NOT appear
      // in the props object. (The literal `"ignored"` itself does
      // appear inside the synthesized conditional's equality leg —
      // that's expected and unrelated.)
      expect(code).not.toMatch(/\bvalue:\s*"ignored"/)
    })
  })

  /**
   * Repro for the playground newsletter bug: the checkbox flashed
   * checked → unchecked → checked on every refresh.
   *
   * Pre-fix the synthesized `:checked` equality compared the model
   * against a SINGLE element-side value (the static `value=` attr,
   * defaulting to `''` when missing) for ALL three branches —
   * Array.includes, Set.has, AND scalar `===`. That works for the
   * array / Set group case (where `value="apple"` is the option-value)
   * but is wrong for two scalar shapes:
   *
   *   1. Single boolean (`z.boolean()` with no value attr): the
   *      equality is `model === ''` — always false, even when the
   *      box should be checked. SSR renders unchecked, the directive's
   *      setChecked corrects after mount → visible flash.
   *   2. Single string mapped via `:true-value` (e.g. `z.enum([...])`
   *      with `:true-value="'subscribe'"`): the equality is
   *      `model === ''` instead of `model === 'subscribe'`. Same
   *      flash.
   *
   * Post-fix the scalar branch uses the `:true-value` (or, for the
   * boolean case, the literal `true`) — matching the runtime's
   * `getCheckboxValue(el, true)` fallback. SSR renders checked when
   * it should be, and there's no flash on hydration.
   */
  describe('checkbox scalar equality target', () => {
    it('uses :true-value as the scalar equality target', () => {
      const code = compileWithTransform(
        `<input type="checkbox" :true-value="'subscribe'" v-register="newsletter" />`
      )
      // The scalar leg should compare against 'subscribe', not ''.
      // We assert the literal appears in an equality position
      // immediately followed by `)` (the scalar branch's closing).
      expect(code).toMatch(/===\s*\('subscribe'\)/)
    })

    it('uses literal `true` as the scalar equality target when no value / true-value', () => {
      const code = compileWithTransform(`<input type="checkbox" v-register="agreed" />`)
      // Boolean checkbox: the scalar branch must compare against
      // `true`, not `''` (which would always evaluate false against
      // `false`/`true` model values).
      expect(code).toMatch(/===\s*\(true\)/)
    })

    it('uses value= as the scalar equality target on radio', () => {
      // Radio model is always scalar; the option-value (`value=`)
      // IS the right discriminator there.
      const code = compileWithTransform(`<input type="radio" value="apple" v-register="fruit" />`)
      expect(code).toMatch(/===\s*\("apple"\)/)
    })

    it('checkbox group keeps option-value for the array/Set legs', () => {
      // The group case must still use `value="apple"` for
      // includes / has — only the scalar branch changes.
      const code = compileWithTransform(
        `<input type="checkbox" value="apple" v-register="fruits" />`
      )
      expect(code).toContain('?.includes("apple")')
      expect(code).toContain('?.has("apple")')
    })
  })
})
