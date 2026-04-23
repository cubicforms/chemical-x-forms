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
  })

  describe('fail-safe', () => {
    it('does not throw on malformed templates — errors are logged, AST untouched', () => {
      // A valid-enough template that would previously have caused the
      // transform to take a crash path. Just proves the try/catch wrapper
      // is in place; if the transform throws, the compile call also throws.
      expect(() => compileWithTransform(`<input v-register />`)).not.toThrow()
    })
  })
})
