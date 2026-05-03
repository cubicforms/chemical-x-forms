import { baseCompile } from '@vue/compiler-core'
import { describe, expect, it } from 'vitest'
import { vRegisterHintTransform } from '../../src/runtime/lib/core/transforms/v-register-hint-transform'
import { vRegisterPreambleTransform } from '../../src/runtime/lib/core/transforms/v-register-preamble-transform'

/**
 * Compile a template through @vue/compiler-core with both the preamble
 * AND the hint transform registered (in canonical order — preamble
 * first), then assert against the generated render code string.
 */
function compileWithTransforms(template: string): string {
  const result = baseCompile(template, {
    nodeTransforms: [vRegisterPreambleTransform, vRegisterHintTransform],
    mode: 'module',
  })
  return result.code
}

function compileWithPreambleOnly(template: string): string {
  const result = baseCompile(template, {
    nodeTransforms: [vRegisterPreambleTransform],
    mode: 'module',
  })
  return result.code
}

describe('vRegisterPreambleTransform', () => {
  describe('happy path', () => {
    it('emits a data-atta-pre-mark prop on the root element when v-register bindings exist', () => {
      const code = compileWithTransforms(
        `<div>
           <pre>{{ form.fields.password }}</pre>
           <input v-register="form.register('password')" />
         </div>`
      )
      expect(code).toContain('data-atta-pre-mark')
      // The preamble's collected expression must reference the user's
      // path-bearing call. processExpression prefixes free identifiers
      // with `_ctx.`, so we look for the prefixed form.
      expect(code).toMatch(/_ctx\.form\.register\(['"]password['"]\)/)
      // markConnectedOptimistically gets called from BOTH the preamble
      // (every captured binding fires it) and the hint transform's
      // per-element wrapper. At least 2 occurrences for one binding.
      const occurrences = code.match(/markConnectedOptimistically/g)?.length ?? 0
      expect(occurrences).toBeGreaterThanOrEqual(2)
    })

    it('captures multiple v-register bindings into a single preamble', () => {
      const code = compileWithTransforms(
        `<div>
           <input v-register="form.register('email')" />
           <input v-register="form.register('password')" />
           <textarea v-register="form.register('note')" />
         </div>`
      )
      expect(code).toContain('data-atta-pre-mark')
      // All three paths appear once in the preamble call list, plus
      // once each in their per-element directive bindings.
      expect(code).toMatch(/_ctx\.form\.register\(['"]email['"]\)/)
      expect(code).toMatch(/_ctx\.form\.register\(['"]password['"]\)/)
      expect(code).toMatch(/_ctx\.form\.register\(['"]note['"]\)/)
    })

    it('captures un-wrapped expressions when registered before the hint transform', () => {
      // Critical ordering invariant: preamble's pre-order capture must
      // see the original expression, not the IIFE-wrapped form. If this
      // breaks, the preamble's text would contain `__cxRv` references
      // pointing at a free identifier (the wrapper's parameter is gone
      // by the time the preamble injects).
      const code = compileWithPreambleOnly(
        `<div><input v-register="form.register('email')" /></div>`
      )
      // Preamble references markConnectedOptimistically once per
      // captured binding. With only the preamble registered, there's
      // no per-element wrapper in the directive expression.
      const occurrences = code.match(/markConnectedOptimistically/g)?.length ?? 0
      expect(occurrences).toBe(1)
      // The captured expression in the preamble does NOT contain the
      // hint wrapper's marker (`__cxRv`), proving we captured pre-wrap.
      expect(code).not.toContain('__cxRv')
    })
  })

  describe('v-for filtering', () => {
    it('does NOT capture bindings on elements with v-for directly', () => {
      const code = compileWithTransforms(
        `<div>
           <input v-for="i in 10" v-register="form.register('item.' + i)" :key="i" />
         </div>`
      )
      // No data-atta-pre-mark emitted because the only v-register is on
      // an iterated element — its path expression references the loop
      // local `i`, which isn't in scope at root level. Hoisting it
      // would produce a runtime ReferenceError.
      expect(code).not.toContain('data-atta-pre-mark')
    })

    it('does NOT capture bindings nested inside a v-for ancestor', () => {
      const code = compileWithTransforms(
        `<div>
           <div v-for="item in items" :key="item.id">
             <input v-register="form.register('field-' + item.id)" />
           </div>
         </div>`
      )
      expect(code).not.toContain('data-atta-pre-mark')
    })

    it('still captures static bindings in templates that ALSO have v-for elsewhere', () => {
      // A page with both static and v-for bindings: the static one gets
      // hoisted; the v-for one stays handled by the per-element wrapper.
      const code = compileWithTransforms(
        `<div>
           <input v-register="form.register('header')" />
           <input v-for="i in 10" v-register="form.register('item.' + i)" :key="i" />
         </div>`
      )
      expect(code).toContain('data-atta-pre-mark')
      expect(code).toMatch(/_ctx\.form\.register\(['"]header['"]\)/)
    })
  })

  describe('emptiness / no-ops', () => {
    it('does not inject when there are no v-register bindings', () => {
      const code = compileWithTransforms(`<div><input type="text" /></div>`)
      expect(code).not.toContain('data-atta-pre-mark')
    })

    it('does not inject when the only root content is text', () => {
      // No element to host the preamble — bail silently rather than
      // synthesizing a wrapper element.
      const code = compileWithTransforms(`hello world`)
      expect(code).not.toContain('data-atta-pre-mark')
    })
  })

  describe('idempotency', () => {
    it('does not double-capture when the preamble transform runs twice', () => {
      // When the same transform is registered twice in the
      // `nodeTransforms` array (some bundler chains do this), the
      // pre-order runs twice per node. Without idempotency each
      // capture would land in `state.captured` twice, doubling the
      // mark calls inside the injected expression.
      //
      // Counting `data-atta-pre-mark` is misleading: Vue codegen lists
      // dynamic prop names in its PROPS patch flag too (e.g.
      // `["data-atta-pre-mark"]`), so the literal appears at least
      // twice in compiled output regardless. We instead count
      // `markConnectedOptimistically` invocations — exactly one per
      // collected binding when idempotent.
      const result = baseCompile(`<div><input v-register="form.register('email')" /></div>`, {
        nodeTransforms: [vRegisterPreambleTransform, vRegisterPreambleTransform],
        mode: 'module',
      })
      const occurrences = result.code.match(/markConnectedOptimistically/g)?.length ?? 0
      expect(occurrences).toBe(1)
    })
  })
})
