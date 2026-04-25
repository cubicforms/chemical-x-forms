import { baseCompile } from '@vue/compiler-core'
import { describe, expect, it } from 'vitest'
import { vRegisterHintTransform } from '../../src/runtime/lib/core/transforms/v-register-hint-transform'

/**
 * Compile a template through @vue/compiler-core with the hint transform
 * registered, then assert against the generated render code string.
 * Source-level inspection — same posture as input-text-area.test.ts.
 */
function compileWithTransform(template: string): string {
  const result = baseCompile(template, {
    nodeTransforms: [vRegisterHintTransform],
    mode: 'module',
  })
  return result.code
}

describe('vRegisterHintTransform', () => {
  describe('happy path', () => {
    it('wraps an inline form.register(path) binding', () => {
      const code = compileWithTransform(`<input v-register="form.register('email')" />`)
      // The wrapping IIFE must appear AND retain the original call inside.
      expect(code).toContain('markConnectedOptimistically')
      expect(code).toContain("form.register('email')")
    })

    it('wraps a hoisted RegisterValue identifier', () => {
      // emailReg = form.register(...) at setup; v-register receives the
      // pre-built RegisterValue. The wrapper still fires the optimistic
      // mark because the method lives on the RegisterValue object.
      const code = compileWithTransform(`<input v-register="emailReg" />`)
      expect(code).toContain('markConnectedOptimistically')
      expect(code).toContain('emailReg')
    })

    it('wraps a binding on textarea + select', () => {
      const codeTextarea = compileWithTransform(`<textarea v-register="note" />`)
      const codeSelect = compileWithTransform(`<select v-register="role"><option/></select>`)
      expect(codeTextarea).toContain('markConnectedOptimistically')
      expect(codeSelect).toContain('markConnectedOptimistically')
    })

    it('wraps a dynamic-path register call (template literal)', () => {
      // The transform doesn't inspect the path string — any expression
      // returning a RegisterValue is wrapped uniformly.
      const code = compileWithTransform('<input v-register="form.register(`${prefix}.email`)" />')
      expect(code).toContain('markConnectedOptimistically')
    })
  })

  describe('non-targets', () => {
    it('does NOT wrap elements without v-register', () => {
      const code = compileWithTransform(`<input :value="x" />`)
      expect(code).not.toContain('markConnectedOptimistically')
    })

    it('does NOT match user props whose name contains "register" as a substring', () => {
      // Exact directive-name match — `register-id` is a custom prop, not v-register.
      const code = compileWithTransform(`<input :data-register-id="'x'" />`)
      expect(code).not.toContain('markConnectedOptimistically')
    })
  })

  describe('idempotency', () => {
    it('does not double-wrap when applied twice', () => {
      // Some bundler configurations register the same transform twice.
      // The second pass must detect the marker and skip — otherwise
      // every render path would carry an arbitrarily deep IIFE chain.
      const result = baseCompile(`<input v-register="form.register('email')" />`, {
        nodeTransforms: [vRegisterHintTransform, vRegisterHintTransform],
        mode: 'module',
      })
      const occurrences = result.code.match(/markConnectedOptimistically/g)?.length ?? 0
      expect(occurrences).toBe(1)
    })
  })

  describe('coexistence with other v-register transforms', () => {
    it('does not break inputTextAreaNodeTransform', async () => {
      // The hint transform must run alongside the other transforms in
      // the chain without producing malformed output. We register both
      // in the canonical order and just assert the compile succeeds and
      // contains both signals.
      const { inputTextAreaNodeTransform } =
        await import('../../src/runtime/lib/core/transforms/input-text-area-transform')
      const result = baseCompile(`<input v-register="form.register('email')" />`, {
        nodeTransforms: [inputTextAreaNodeTransform, vRegisterHintTransform],
        mode: 'module',
      })
      expect(result.code).toContain('markConnectedOptimistically')
      expect(result.code).toContain('innerRef')
    })
  })
})
