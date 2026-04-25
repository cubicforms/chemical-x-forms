import {
  createSimpleExpression,
  NodeTypes,
  type DirectiveNode,
  type ElementNode,
  type ExpressionNode,
  type NodeTransform,
  type RootNode,
  type SimpleExpressionNode,
  type SourceLocation,
} from '@vue/compiler-core'

/**
 * `vRegisterPreambleTransform` — closes the render-order edge that
 * `vRegisterHintTransform` alone leaves open.
 *
 * The hint transform wraps each `v-register` directive expression in an
 * IIFE that calls `markConnectedOptimistically()` when the element's
 * vnode is created. That works for any expression evaluated AT or AFTER
 * the input in render order. But Vue's SSR is single-pass top-to-bottom,
 * so a template like:
 *
 *   <pre>{{ form.getFieldState('password').value }}</pre>
 *   <input v-register="form.register('password')" />
 *
 * evaluates the `<pre>` first, BEFORE the v-register wrapper has had a
 * chance to fire. The serialized HTML carries `isConnected: false` for
 * password — and the post-hydration steady state shows `true`, leaving
 * a one-tick `false → true` flicker visible to the user.
 *
 * Fix: hoist the marks one level up. We walk the entire template AST,
 * collect every static `v-register` binding (skipping descendants of
 * `v-for`, since those reference loop locals not available at root
 * scope), and prepend a synthetic `:data-cx-pre-mark` directive on the
 * first root element. Vue evaluates element prop bindings before
 * recursing into children, so the IIFE inside `:data-cx-pre-mark` fires
 * every collected mark BEFORE any descendant template expression runs.
 *
 * The binding's expression resolves to `undefined`, which Vue's SSR
 * renderer drops (no `data-cx-pre-mark` attribute appears in the
 * rendered HTML). The side effect — flipping `isConnected: true` on
 * each field record — is the only output we want.
 *
 * Companion to `vRegisterHintTransform`: register both, with this one
 * BEFORE the hint transform. The pre-order pass here captures each
 * `v-register` expression's original (un-wrapped) text into a
 * per-template state map; the hint transform then wraps the in-place
 * directive expression. The exit hook on the first root element
 * builds the preamble using the captured originals — exit hooks on
 * an element fire before `transformElement`'s codegen exit, so the
 * injected prop lands in the rendered output.
 *
 * For `v-for` descendants the per-element wrapper from
 * `vRegisterHintTransform` is still load-bearing — those bindings can't
 * be hoisted because their path expressions reference loop-scoped
 * identifiers (e.g. `form.register(`item.${i}`)`).
 */

const dummyLoc: SourceLocation = {
  start: { column: 0, line: 0, offset: 0 },
  end: { column: 0, line: 0, offset: 0 },
  source: '',
}

/**
 * Per-root traversal state. Keyed by the RootNode object — stable for
 * the duration of one compile pass and GC-friendly across pipelines.
 *   - `captured`: collected pre-wrap expression strings, in template
 *     visit order.
 *   - `vForDepth`: nesting count for `v-for` ancestry, bumped on FOR
 *     entry / decremented on FOR exit, so element visits in between
 *     can skip captures cheaply.
 *   - `firstRootElementVisited`: ensures we only register the
 *     injection exit-hook on the very first root element (templates
 *     with multiple top-level elements still have one "first" — Vue
 *     wraps multi-root in a fragment, but the FIRST element's props
 *     evaluate before any sibling).
 */
type TraversalState = {
  readonly captured: string[]
  /**
   * Elements whose v-register binding has already been captured for
   * THIS root traversal. Guards against double-capture when the same
   * transform is registered twice in the `nodeTransforms` array (some
   * bundler chains do this) — without it, every binding's mark call
   * would be duplicated in the injected expression.
   */
  readonly capturedElements: WeakSet<ElementNode>
  vForDepth: number
  firstRootElementVisited: boolean
}
const stateByRoot: WeakMap<RootNode, TraversalState> = new WeakMap()

const PREAMBLE_ATTR = 'data-cx-pre-mark'

export const vRegisterPreambleTransform: NodeTransform = (node, context) => {
  try {
    if (node.type === NodeTypes.ROOT) {
      // If state already exists, a duplicate registration of this
      // transform is at work — keep the first run's state intact.
      // Otherwise its captures would get wiped by this re-init.
      if (stateByRoot.has(node)) return
      stateByRoot.set(node, {
        captured: [],
        capturedElements: new WeakSet<ElementNode>(),
        vForDepth: 0,
        firstRootElementVisited: false,
      })
      return () => {
        // Cleanup on root exit. The actual injection happened on the
        // first root element's exit (registered below) — by the time
        // we get here, that element's transformElement codegen has
        // already absorbed the injected prop.
        stateByRoot.delete(node)
      }
    }

    const state = stateByRoot.get(context.root)
    if (state === undefined) return

    if (node.type === NodeTypes.FOR) {
      // The structural `transformFor` (built into compiler-core, runs
      // before our transform) wraps any element carrying v-for in a
      // NodeTypes.FOR node. Bumping the depth on entry / decrementing
      // on exit gives us O(1) "am I inside a v-for ancestor?" checks
      // during the element visits below.
      state.vForDepth += 1
      return () => {
        state.vForDepth -= 1
      }
    }

    if (node.type !== NodeTypes.ELEMENT) return

    // Capture this element's v-register binding (if any) BEFORE
    // deciding about exit-hook registration — that way the very first
    // root element, which itself might carry v-register, contributes
    // its binding to the preamble it hosts.
    captureVRegisterIfStatic(node, state)

    // First root element — register the exit hook that injects the
    // preamble using the FINAL collected state. Exit hooks fire after
    // children are traversed, so by then every descendant capture has
    // landed in `state.captured`.
    if (!state.firstRootElementVisited && context.parent?.type === NodeTypes.ROOT) {
      state.firstRootElementVisited = true
      return () => {
        const finalState = stateByRoot.get(context.root)
        if (finalState === undefined || finalState.captured.length === 0) return
        injectPreamble(node, finalState.captured)
      }
    }
    return
  } catch (err) {
    // AST shape drift or a malformed directive: skip this transform
    // entirely. The per-element vRegisterHintTransform still covers
    // the common case (read at-or-after the input). Failure here only
    // affects the read-before-input edge.
    console.error('[@chemical-x/forms] v-register preamble transform failed, skipping:', err)
    return
  }
}

function captureVRegisterIfStatic(node: ElementNode, state: TraversalState): void {
  if (state.vForDepth > 0) return
  // An element that itself carries v-for hasn't been wrapped yet by
  // transformFor at the moment user transforms see it (transform
  // ordering varies by bundler), so check the directive directly.
  if (hasVForDirective(node)) return
  // Idempotency: only one capture per element per root traversal.
  // Without this, registering the transform twice in the
  // `nodeTransforms` array would double every binding's mark call
  // inside the injected expression.
  if (state.capturedElements.has(node)) return

  const exp = findVRegisterExpression(node)
  if (exp === null) return
  state.capturedElements.add(node)
  // Pre-wrap capture. This transform is registered BEFORE
  // vRegisterHintTransform, so prop.exp is still the original
  // expression here; the hint's wrap happens after our pre-order
  // returns from the same node.
  state.captured.push(flattenExpression(exp))
}

function findVRegisterExpression(node: ElementNode): ExpressionNode | null {
  for (const prop of node.props) {
    if (prop.type !== NodeTypes.DIRECTIVE) continue
    if (prop.name !== 'register') continue
    if (prop.exp === undefined) continue
    return prop.exp
  }
  return null
}

function hasVForDirective(node: ElementNode): boolean {
  for (const prop of node.props) {
    if (prop.type === NodeTypes.DIRECTIVE && prop.name === 'for') return true
  }
  return false
}

/**
 * Flatten an ExpressionNode to its source text. The compiler-core AST
 * stores expressions either as a SimpleExpressionNode (one piece of
 * text) or a CompoundExpressionNode (a list of strings + nested
 * SimpleExpressionNodes interleaved, which is what `processExpression`
 * produces when prefixing identifiers). We can serialise either back
 * to source by concatenating the textual content.
 */
function flattenExpression(exp: ExpressionNode): string {
  if (exp.type === NodeTypes.SIMPLE_EXPRESSION) return exp.content
  let out = ''
  for (const child of exp.children) {
    if (typeof child === 'string') {
      out += child
      continue
    }
    if (typeof child === 'symbol') continue
    if ('content' in child) {
      out += child.content
      continue
    }
    out += flattenExpression(child as ExpressionNode)
  }
  return out
}

/**
 * Build and prepend the `:data-cx-pre-mark` directive to the element's
 * props. The expression is a comma-chain of
 * `(<expr>)?.markConnectedOptimistically?.()` calls, ending in
 * `undefined` so the attribute resolves to `undefined` and Vue's SSR
 * renderer omits it entirely. Side effects (the marks) happen during
 * evaluation; no observable HTML attribute appears.
 *
 * The exp is a SimpleExpressionNode with `isStatic: false` — when
 * `transformElement`'s exit codegen processes it, identifiers like
 * `form` get prefixed (`_ctx.form`) the same way every other dynamic
 * binding does. This works because our exit hook runs BEFORE
 * `transformElement`'s exit (we're registered later in the
 * `nodeTransforms` array, so our exit fires earlier in the reverse
 * pass).
 */
function injectPreamble(element: ElementNode, captured: readonly string[]): void {
  if (hasPreamble(element)) return

  const callList = captured
    .map((source) => `(${source})?.markConnectedOptimistically?.()`)
    .join(', ')
  const expressionText = `(${callList}, undefined)`
  const exp: SimpleExpressionNode = createSimpleExpression(expressionText, false /* not static */)

  const directive: DirectiveNode = {
    type: NodeTypes.DIRECTIVE,
    name: 'bind',
    arg: createSimpleExpression(PREAMBLE_ATTR, true /* static arg */),
    exp,
    modifiers: [],
    loc: dummyLoc,
  }
  element.props.unshift(directive)
}

function hasPreamble(element: ElementNode): boolean {
  for (const prop of element.props) {
    if (prop.type !== NodeTypes.DIRECTIVE) continue
    if (prop.name !== 'bind') continue
    if (prop.arg === undefined) continue
    if (prop.arg.type !== NodeTypes.SIMPLE_EXPRESSION) continue
    if (prop.arg.content === PREAMBLE_ATTR) return true
  }
  return false
}
