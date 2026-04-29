import {
  createCompoundExpression,
  NodeTypes,
  type CompoundExpressionNode,
  type ExpressionNode,
  type NodeTransform,
} from '@vue/compiler-core'

/**
 * `vRegisterHintTransform` — for every `<element v-register="<expr>">`,
 * rewrite the directive's binding expression to wrap `<expr>` in an
 * IIFE that calls `markConnectedOptimistically()` on the resulting
 * `RegisterValue` and returns the same object:
 *
 *   ((__cxRv) => (__cxRv?.markConnectedOptimistically?.(), __cxRv))(<expr>)
 *
 * Why this exists: Vue intentionally skips directive lifecycle hooks
 * during SSR (see `core/directive.ts`'s top comment). That means the
 * `v-register` directive's `created` hook — the one that flips
 * `isConnected: true` for the field — never fires server-side. Every
 * SSR'd FieldState therefore serialises `isConnected: false`, and on
 * hydration the directive runs and the flag flickers to `true`. Anyone
 * reading `getFieldState(path).isConnected` in a server-rendered
 * template sees the stale value baked into the static HTML.
 *
 * The wrapping IIFE captures the `RegisterValue` produced by `<expr>`,
 * fires the optimistic mark (which itself is guarded by `state.isSSR`,
 * so client-side it's a free no-op), and returns the same object so
 * the directive receives exactly what the author wrote.
 *
 * The transform is deliberately agnostic to the shape of `<expr>`:
 *
 *   - inline:   `v-register="form.register('email')"`
 *   - hoisted:  `v-register="emailReg"` (where `emailReg = form.register(...)`)
 *   - dynamic:  `v-register="form.register(`${prefix}.email`)"`
 *
 * All three produce a `RegisterValue` at runtime, and the wrapper
 * doesn't need to know the path string. Setup-time `register()` calls
 * that are NEVER bound to `v-register` get no wrapper, no optimistic
 * mark, and stay `isConnected: false` post-hydration — exactly the
 * desired negative case (those calls don't represent a rendered DOM
 * element).
 *
 * Idempotent: if the transform runs twice on the same AST (some
 * bundler configurations do this), the second pass detects the marker
 * and skips re-wrapping.
 */

const HINT_MARKER = '__cxRv'
const HINT_PREFIX = `((${HINT_MARKER}) => (${HINT_MARKER}?.markConnectedOptimistically?.(), ${HINT_MARKER}))(`
const HINT_SUFFIX = `)`

/**
 * Vue compiler node transform that wraps every `v-register`
 * expression in a small IIFE so the directive can flag a field as
 * connected during SSR. Eliminates the `false → true` flicker on
 * `getFieldState(path).isConnected` after hydration.
 *
 * Must run after `vRegisterPreambleTransform`. Wired automatically
 * by `@chemical-x/forms/vite` and `@chemical-x/forms/nuxt`.
 */
export const vRegisterHintTransform: NodeTransform = (node) => {
  try {
    if (node.type !== NodeTypes.ELEMENT) return
    for (const prop of node.props) {
      if (prop.type !== NodeTypes.DIRECTIVE) continue
      if (prop.name !== 'register') continue
      if (prop.exp === undefined) continue
      if (isAlreadyWrapped(prop.exp)) continue
      prop.exp = wrapWithOptimisticHint(prop.exp)
    }
  } catch (err) {
    // AST shape drift across @vue/compiler-core versions or a malformed
    // directive: skip this transform entirely. The runtime mark is
    // fail-safe — without the wrapper, we just get the existing
    // false→true flicker on first paint, never an incorrect render.
    console.error('[@chemical-x/forms] v-register hint transform failed, skipping:', err)
  }
}

function isAlreadyWrapped(exp: ExpressionNode): boolean {
  if (exp.type === NodeTypes.SIMPLE_EXPRESSION) {
    return exp.content.includes(HINT_MARKER)
  }
  // Compound expression: scan only the string children. Nested
  // SimpleExpressionNodes were copied verbatim from the user's
  // expression and won't contain our marker; the marker only ever
  // appears in the literal prefix/suffix strings we add.
  for (const child of exp.children) {
    if (typeof child === 'string' && child.includes(HINT_MARKER)) return true
  }
  return false
}

function wrapWithOptimisticHint(exp: ExpressionNode): CompoundExpressionNode {
  // For a SimpleExpression we keep the node intact as a child so any
  // later `processExpression` pass (identifier prefixing for setup
  // refs) still walks it. For a CompoundExpression we splice its
  // children in — prepending the prefix string and appending the
  // suffix preserves the post-prefix shape downstream transforms
  // expect.
  const innerChildren: CompoundExpressionNode['children'] =
    exp.type === NodeTypes.SIMPLE_EXPRESSION ? [exp] : [...exp.children]
  // Reuse the wrapped expression's source location — runtime errors
  // in the wrapped IIFE point at the v-register binding site rather
  // than line 0.
  return createCompoundExpression([HINT_PREFIX, ...innerChildren, HINT_SUFFIX], exp.loc)
}
