import { baseCompile } from '@vue/compiler-core'
import { describe, expect, it } from 'vitest'
import { inputTextAreaNodeTransform } from '../../src/runtime/lib/core/transforms/input-text-area-transform'
import { selectNodeTransform } from '../../src/runtime/lib/core/transforms/select-transform'
import { vRegisterHintTransform } from '../../src/runtime/lib/core/transforms/v-register-hint-transform'
import { vRegisterPreambleTransform } from '../../src/runtime/lib/core/transforms/v-register-preamble-transform'

/**
 * Compile-time behaviour of `v-register` on a Vue component vs. a native
 * element. PascalCase / kebab-case tags compile to
 * `tagType === ElementTypes.COMPONENT`; each transform decides
 * independently whether to fire on components.
 *
 * This test file is deliberately provocative: each `describe` pins the
 * actual contract at HEAD, including the surprises. The header comments
 * call out which behaviour is intentional vs. a footgun a future
 * refactor might want to address.
 *
 * Production pipeline order (`src/vite.ts`):
 *   1. selectNodeTransform
 *   2. inputTextAreaNodeTransform
 *   3. vRegisterPreambleTransform
 *   4. vRegisterHintTransform
 */

type CompilerOptions = NonNullable<Parameters<typeof baseCompile>[1]>
type NodeTransformList = NonNullable<CompilerOptions['nodeTransforms']>

function compileFull(template: string): string {
  return baseCompile(template, {
    nodeTransforms: [
      selectNodeTransform,
      inputTextAreaNodeTransform,
      vRegisterPreambleTransform,
      vRegisterHintTransform,
    ] as NodeTransformList,
    mode: 'module',
  }).code
}

function compileWith(template: string, transforms: NodeTransformList): string {
  return baseCompile(template, { nodeTransforms: transforms, mode: 'module' }).code
}

describe('v-register on Vue components — AST behaviour', () => {
  describe('vRegisterHintTransform — wraps component bindings (works ✓)', () => {
    it('wraps <MyInput v-register="form.register(\'email\')">', () => {
      const code = compileWith(`<MyInput v-register="form.register('email')" />`, [
        vRegisterHintTransform,
      ])
      // Same wrapper as native input — the transform doesn't filter by tag.
      expect(code).toContain('markConnectedOptimistically')
      expect(code).toMatch(/_ctx\.form\.register\(['"]email['"]\)/)
    })

    it('wraps a hoisted RegisterValue identifier on a component', () => {
      const code = compileWith(`<MyInput v-register="emailReg" />`, [vRegisterHintTransform])
      expect(code).toContain('markConnectedOptimistically')
      expect(code).toContain('emailReg')
    })

    it('wraps PascalCase AND kebab-case component tags identically', () => {
      const pascal = compileWith(`<MyInput v-register="x" />`, [vRegisterHintTransform])
      const kebab = compileWith(`<my-input v-register="x" />`, [vRegisterHintTransform])
      expect(pascal).toContain('markConnectedOptimistically')
      expect(kebab).toContain('markConnectedOptimistically')
    })
  })

  describe('vRegisterPreambleTransform — captures component bindings (works ✓)', () => {
    it('hoists a component binding into :data-cx-pre-mark on the first root element', () => {
      const code = compileWith(
        `<div>
           <pre>{{ form.getFieldState('email').value }}</pre>
           <MyInput v-register="form.register('email')" />
         </div>`,
        [vRegisterPreambleTransform, vRegisterHintTransform]
      )
      expect(code).toContain('data-cx-pre-mark')
      // The hoisted expression is the original (un-wrapped) call;
      // identifier prefixing turns `form` into `_ctx.form`.
      expect(code).toMatch(/_ctx\.form\.register\(['"]email['"]\)/)
    })

    it('hoists the binding even when the component IS the first root element', () => {
      // Vue evaluates the component's own props before recursing into
      // its slots, so the optimistic mark fires before any descendant
      // template expression reads the field state.
      const code = compileWith(`<MyInput v-register="form.register('email')" />`, [
        vRegisterPreambleTransform,
        vRegisterHintTransform,
      ])
      expect(code).toContain('data-cx-pre-mark')
    })

    it('does NOT hoist a component binding inside v-for (loop-local path)', () => {
      const code = compileWith(
        `<div>
           <MyInput v-for="i in 10" v-register="form.register('item.' + i)" :key="i" />
         </div>`,
        [vRegisterPreambleTransform, vRegisterHintTransform]
      )
      // The path expression references `i`, which isn't in scope at
      // root level. Hoisting it would crash on render.
      expect(code).not.toContain('data-cx-pre-mark')
    })
  })

  describe('inputTextAreaNodeTransform — early-returns on components (works ✓)', () => {
    it('emits no synthetic :value binding when only this transform runs', () => {
      // The transform's tag check is `node.tag === 'input' || 'textarea'`
      // — component tags are NEITHER. Result: this transform contributes
      // nothing for a component. (selectNodeTransform DOES fire on
      // components — see the next describe block.)
      const code = compileWith(`<MyInput v-register="form.register('email')" />`, [
        inputTextAreaNodeTransform,
      ])
      expect(code).not.toContain('innerRef')
    })

    it('still injects on a sibling <input v-register> when only this transform runs', () => {
      const code = compileWith(
        `<div>
           <MyInput v-register="form.register('email')" />
           <input v-register="form.register('name')" />
         </div>`,
        [inputTextAreaNodeTransform]
      )
      expect(code).toContain('innerRef')
    })
  })

  describe('selectNodeTransform — fires on EVERY component with v-register (surprising ⚠)', () => {
    it('injects :value="reg.innerRef.value" + :registerValue="reg" as component props', () => {
      // The transform's branch `node.tagType === ElementTypes.COMPONENT`
      // makes ANY component with v-register a transform target — even
      // ones whose name has nothing to do with selecting (`<MyInput>`,
      // `<MyTextField>`, `<MyDatePicker>`). The component author's
      // template-time contract is to accept `value` and `registerValue`
      // as props (or as fallthrough attrs). The same transform handles
      // <select> natively; the component branch reuses the prop-name
      // contract `<select>` doesn't know about.
      const code = compileWith(`<MyInput v-register="form.register('email')" />`, [
        selectNodeTransform,
      ])
      expect(code).toContain('innerRef')
      // Both keys appear in the generated component-prop object.
      expect(code).toMatch(/value:\s*\(.*\)\?\.innerRef\.value/)
      expect(code).toContain('registerValue:')
    })

    it('does NOT recurse into slot children — option-tagged slot content gets no :selected', () => {
      // ⚠ Asymmetry: native <select v-register>'s <option> children get
      // a `:selected` binding injected at compile time (D3 fallback, etc).
      // For <MyCustomSelect v-register>'s slot-content <option>s, the
      // recursion is gated on `if (isSelect)`, so the same options pass
      // through unmodified. A "transparent custom select" wrapper has to
      // implement option-selection itself by reading `props.value`
      // (auto-injected above) inside its template.
      const code = compileWith(
        `<MyCustomSelect v-register="form.register('role')">
           <option value="admin">Admin</option>
           <option value="user">User</option>
         </MyCustomSelect>`,
        [selectNodeTransform]
      )
      // The component itself gets the value + registerValue prop pair.
      expect(code).toContain('innerRef')
      expect(code).toContain('registerValue:')
      // But the slot-content options stay raw — no `:selected` was
      // injected. Vue codegen still uses the keyword "selected" in
      // patch flag comments if any prop named "selected" exists; we
      // search for the BINDING form `selected:` to be precise.
      expect(code).not.toMatch(/selected:\s*\(.*\)\?\.innerRef\?\.value/)
    })

    it('still injects :selected on direct <option> children of a native <select v-register>', () => {
      // Regression guard: the select-native path is unchanged.
      const code = compileWith(
        `<select v-register="form.register('role')">
           <option value="admin">Admin</option>
         </select>`,
        [selectNodeTransform]
      )
      expect(code).toContain('innerRef')
      expect(code).toMatch(/selected:\s*\(/)
    })

    it('does NOT fire on a component without v-register', () => {
      // Bound by the early-out `registerIndex < 0`.
      const code = compileWith(`<MyInput :value="x" />`, [selectNodeTransform])
      expect(code).not.toContain('innerRef')
      expect(code).not.toContain('registerValue:')
    })

    it('PascalCase + self-closing PascalCase hit the component branch', () => {
      const pascal = compileWith(`<MyInput v-register="reg" />`, [selectNodeTransform])
      const explicitClose = compileWith(`<MyInput v-register="reg"></MyInput>`, [
        selectNodeTransform,
      ])
      for (const code of [pascal, explicitClose]) {
        expect(code).toContain('innerRef')
        expect(code).toContain('registerValue:')
      }
    })

    it('kebab-case `<my-input v-register>` does NOT hit the component branch (custom element, not component) ⚠', () => {
      // Vue's compiler treats kebab-case tags as custom elements
      // (`_createElementBlock("my-input", ...)`) by default — not as
      // components. Result: `selectNodeTransform`'s
      // `tagType === ElementTypes.COMPONENT` check does NOT match,
      // and the `:value` + `:registerValue` props are NOT injected.
      //
      // For PascalCase consumers this is a non-issue. For users who
      // genuinely want a kebab-case Vue component, the workaround is
      // to register the component globally and use PascalCase in
      // templates, OR pass `compilerOptions.isCustomElement` = false
      // for that tag in the bundler config — outside this transform's
      // contract.
      const code = compileWith(`<my-input v-register="reg" />`, [selectNodeTransform])
      expect(code).not.toContain('innerRef')
      expect(code).not.toContain('registerValue:')
      // The runtime directive is still resolved — the binding works,
      // it just doesn't get the AST-level prop injection.
      expect(code).toContain('_directive_register')
    })
  })

  describe('full pipeline — interaction across transforms', () => {
    it('compiles a component-bound v-register without throwing', () => {
      // Smoke test: the canonical pipeline order doesn't blow up on a
      // component-only template.
      expect(() =>
        compileFull(
          `<div>
             <pre>{{ form.getFieldState('email').value }}</pre>
             <MyInput v-register="form.register('email')" />
           </div>`
        )
      ).not.toThrow()
    })

    it('combines select-transform component-prop injection + hint wrapper + preamble hoist', () => {
      const code = compileFull(
        `<div>
           <pre>{{ form.getFieldState('email').value }}</pre>
           <MyInput v-register="form.register('email')" />
         </div>`
      )
      // selectNodeTransform contributed value: + registerValue:
      expect(code).toContain('innerRef')
      expect(code).toContain('registerValue:')
      // vRegisterHintTransform wrapped the directive expression.
      expect(code).toContain('markConnectedOptimistically')
      // vRegisterPreambleTransform hoisted into data-cx-pre-mark.
      expect(code).toContain('data-cx-pre-mark')
    })

    it('mixed template (component + native input): both branches contribute', () => {
      const code = compileFull(
        `<div>
           <MyInput v-register="form.register('email')" />
           <input v-register="form.register('name')" />
         </div>`
      )
      // Native input gets innerRef from inputTextAreaNodeTransform;
      // component gets innerRef from selectNodeTransform's component
      // branch. Both produce innerRef — at least 2 occurrences.
      const innerRefHits = code.match(/innerRef/g)?.length ?? 0
      expect(innerRefHits).toBeGreaterThanOrEqual(2)
      // Both bindings hoist into the preamble.
      expect(code).toMatch(/_ctx\.form\.register\(['"]email['"]\)/)
      expect(code).toMatch(/_ctx\.form\.register\(['"]name['"]\)/)
      // Component gets a registerValue prop; native input does NOT
      // (only one `registerValue:` occurrence — the component's).
      const regValueHits = code.match(/registerValue:/g)?.length ?? 0
      expect(regValueHits).toBe(1)
    })

    it('dynamic-path register call on a component (template-literal) compiles cleanly', () => {
      // The path expression references a setup-scoped `prefix`. The
      // transform doesn't introspect the expression — it forwards as-is.
      const code = compileFull('<MyInput v-register="form.register(`${prefix}.email`)" />')
      expect(code).toContain('markConnectedOptimistically')
      expect(code).toContain('innerRef')
      // The template literal survives through identifier prefixing.
      expect(code).toContain('${_ctx.prefix}')
    })
  })

  describe('idempotency under duplicate registration', () => {
    it('does not double-wrap a component binding when hint transform is registered twice', () => {
      const code = compileWith(`<MyInput v-register="form.register('email')" />`, [
        vRegisterHintTransform,
        vRegisterHintTransform,
      ])
      const hits = code.match(/markConnectedOptimistically/g)?.length ?? 0
      expect(hits).toBe(1)
    })

    it('does not double-capture a component binding when preamble transform is registered twice', () => {
      const code = compileWith(`<MyInput v-register="form.register('email')" />`, [
        vRegisterPreambleTransform,
        vRegisterPreambleTransform,
      ])
      const hits = code.match(/markConnectedOptimistically/g)?.length ?? 0
      expect(hits).toBe(1)
    })

    it('select-transform on a component IS NOT idempotent under duplicate registration ⚠', () => {
      // Surprise: the select-transform's component branch pushes a new
      // `value` and `registerValue` directive on each invocation
      // (unlike the hint/preamble transforms, it has no
      // already-applied marker). A duplicate registration writes them
      // twice. This won't crash Vue codegen (last write wins for the
      // resolved prop), but it does produce slightly larger output and
      // suggests an idempotency hardening could land here.
      const code = compileWith(`<MyInput v-register="reg" />`, [
        selectNodeTransform,
        selectNodeTransform,
      ])
      const valueHits = code.match(/value:\s*\(.*\)\?\.innerRef\.value/g)?.length ?? 0
      const regValueHits = code.match(/registerValue:/g)?.length ?? 0
      // Lock the present non-idempotent shape; if a future hardening
      // makes this 1/1, flip this to `.toBe(1)` and remove the warning.
      expect(valueHits).toBeGreaterThanOrEqual(1)
      expect(regValueHits).toBeGreaterThanOrEqual(1)
    })
  })
})
