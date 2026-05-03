import {
  createCompoundExpression,
  createSimpleExpression,
  ElementTypes,
  NodeTypes,
  processExpression,
  type AttributeNode,
  type CompoundExpressionNode,
  type DirectiveNode,
  type ExpressionNode,
  type NodeTransform,
  type RootNode,
  type SourceLocation,
  type TemplateChildNode,
} from '@vue/compiler-core'

type SummarizedProp = {
  key: string
  value: string | CompoundExpressionNode['children']
}

function getSummarizedProps(node: RootNode | TemplateChildNode) {
  if (!('props' in node)) return []
  const props = node.props

  const summarizedProps = props.reduce<SummarizedProp[]>((acc, currProp) => {
    if (currProp.type === NodeTypes.ATTRIBUTE) {
      const key = currProp.name
      const value = currProp.value?.content ?? ''
      return [...acc, { key, value: renderAsStatic(value, true) }]
    }

    if (currProp.exp === undefined) return acc
    const key = currProp.arg
      ? getSummarizedPropValue(currProp.arg)
      : renderAsStatic(currProp.name, true)
    if (typeof key !== 'string') return acc // key must always be a string
    const value = getSummarizedPropValue(currProp.exp)

    return [...acc, { key, value }]
  }, [])

  return summarizedProps
}

function renderAsStatic(val: string, isStatic: boolean) {
  return isStatic ? `"${val}"` : val
}

function getSummarizedPropValue(exp: ExpressionNode): SummarizedProp['value'] {
  if (exp.type === NodeTypes.SIMPLE_EXPRESSION) {
    return renderAsStatic(exp.content, exp.isStatic)
  }

  return exp.children
}

function generateEqualityExpression(
  selectValue: SummarizedProp['value'],
  optionValue: SummarizedProp['value'],
  previousOptionExpressions: CompoundExpressionNode['children'][]
) {
  function getExpressionNodeChildren(
    _selectValue: SummarizedProp['value'],
    _optionValue: SummarizedProp['value'],
    _previousOptionExpressions: CompoundExpressionNode['children'][]
  ): CompoundExpressionNode['children'] {
    const multipleExpression = _previousOptionExpressions?.[0] // this should always exist
    if (multipleExpression === undefined) {
      // this should NEVER happen
      throw new Error(
        'Programming error: `multiple` expression for `select` node not generated while transforming AST'
      )
    }

    const optExpressions = _previousOptionExpressions.slice(1)

    // for `multiple`="false", we ONLY execute latest expression if all past expressions were falsy
    const noMultipleOptExpressions = optExpressions.reduce<CompoundExpressionNode['children']>(
      (acc, curr, index) => {
        if (index === 0) {
          acc.push('(')
        }

        acc.push(...curr) // all expressions from last operation were grouped into an array
        if (index < optExpressions.length - 1) {
          acc.push(' || ')
        }

        if (index === optExpressions.length - 1) {
          acc.push(')')
        }

        return acc
      },
      []
    )

    const selectValueArr = Array.isArray(_selectValue) ? _selectValue : [_selectValue]
    const optionValueArr = Array.isArray(_optionValue) ? _optionValue : [_optionValue]

    function getImplicitTrueMultipleExpression(expression: CompoundExpressionNode['children']) {
      // Identify user passing in `multiple` as an implied truthy prop
      if (expression.length === 1 && expression[0] === '') return [`true`]
      return expression
    }

    // capture the current expression for the next round
    _previousOptionExpressions.push(['(', ...selectValueArr, ') === (', ...optionValueArr, ')'])
    // Single-select branch String-coerces both sides to mirror the
    // runtime directive's `looseEqual`-style match — a typed-numeric
    // model (`z.number()`) matches `<option value="1">` at SSR time.
    // The `typeof !== 'object'` guard preserves the pre-existing
    // "array model on a single-select doesn't match" behaviour: an
    // array stringifies to its joined elements, which would otherwise
    // false-positive against a single-element option.
    // The multi-select branch keeps `innerRef.value` because Array
    // / Set models need findIndex / membership iteration.
    if (!noMultipleOptExpressions.length) {
      return [
        '(',
        ...getImplicitTrueMultipleExpression(multipleExpression),
        `) ? ((`,
        ...selectValueArr,
        `)?.innerRef?.value?.findIndex?.(el => el === (`,
        ...optionValueArr,
        `)) > -1) : (typeof (`,
        ...selectValueArr,
        `)?.innerRef?.value !== 'object' && String((`,
        ...selectValueArr,
        `)?.innerRef?.value) === String((`,
        ...optionValueArr,
        `)))`,
      ]
    }

    return [
      '(',
      ...getImplicitTrueMultipleExpression(multipleExpression),
      `) ? ((`,
      ...selectValueArr,
      `)?.innerRef?.value?.findIndex?.(el => el === (`,
      ...optionValueArr,
      `)) > -1) : ((`,
      ...noMultipleOptExpressions, // if true, we already found the relevant option
      `) ? false : (typeof (`,
      ...selectValueArr,
      `)?.innerRef?.value !== 'object' && String((`,
      ...selectValueArr,
      `)?.innerRef?.value) === String((`,
      ...optionValueArr,
      `))))`,
    ]
  }

  return getExpressionNodeChildren(selectValue, optionValue, previousOptionExpressions)
}

function extractMultipleFromSelectSummarizedProps(
  props: SummarizedProp[]
): SummarizedProp['value'] {
  const multipleDirectiveIndex = props.findIndex(
    (prop) => prop.key.replace(/"/g, `'`) === "'multiple'"
  )
  const multipleAttributeIndex = props.findIndex((prop) => prop.key === 'multiple')

  if (multipleDirectiveIndex === -1 && multipleAttributeIndex === -1) {
    return 'false'
  }
  const priorityIndex =
    multipleDirectiveIndex >= 0 ? multipleDirectiveIndex : multipleAttributeIndex
  const value = props[priorityIndex]?.value

  // attempt to convert expression within string into boolean
  // if undefined, make value `true` because of `<input multiple />` usage
  return typeof value === 'string' ? value.replace(/'|"/g, '') : (value ?? 'true')
}

function removePropsByName(props: (AttributeNode | DirectiveNode)[], propNames: string[]) {
  const removePropIndices: number[] = []
  for (let index = 0; index < props.length; index++) {
    const prop = props[index]
    if (!prop) continue

    if (
      propNames.includes(prop.name) ||
      ('arg' in prop && prop.arg && 'content' in prop.arg && propNames.includes(prop.arg.content))
    ) {
      removePropIndices.push(index) // store index to remove later, don't mutate variable while looping through it
    }
  }

  for (const index of removePropIndices.sort((a, z) => z - a)) {
    props.splice(index, 1) // index runs from high to low, so this works
  }
}

function flattenCompoundExpression(node: CompoundExpressionNode): string {
  let result = ''

  for (const child of node.children) {
    if (typeof child === 'string') {
      result += child
    } else if (typeof child === 'symbol') {
      continue
    } else if (child.type === NodeTypes.SIMPLE_EXPRESSION) {
      result += child.content
    } else if (child.type === NodeTypes.COMPOUND_EXPRESSION) {
      result += flattenCompoundExpression(child)
    }
  }

  return result
}

// Exact prop-name match. Pre-rewrite used .includes('register') / .includes('value')
// which false-positived on user props with those substrings in their names.
function isExactKey(summarizedKey: string, name: string): boolean {
  return summarizedKey === name || summarizedKey === `"${name}"`
}

// Whitelist of node types that contain iterable child nodes. Used by
// traverseSelectNode so we don't recurse into interpolation / comment / text
// nodes (which have no `children` in the traversal sense) and don't crash on
// future Vue node-type additions.
const RECURSABLE_NODE_TYPES: ReadonlySet<number> = new Set<number>([
  NodeTypes.ELEMENT,
  NodeTypes.FOR,
  NodeTypes.IF,
  NodeTypes.IF_BRANCH,
])

// Native form-shell tags excluded from the kebab-case extension. The
// hyphen check on `node.tag` already excludes most native HTML tags
// (which have no hyphen), but listing the form-shell ones explicitly
// documents the conservative stance: even if a future native tag like
// `<my-form-something>` lands, it won't accidentally collide with a
// custom-element transform branch. `<input>`, `<select>`, `<textarea>`
// already have dedicated branches via inputTextAreaNodeTransform and
// the isSelect path above; the others (form, fieldset, label, button,
// option) carry no meaningful v-register binding and shouldn't be
// rewritten with component-style props.
const NATIVE_FORM_TAGS: ReadonlySet<string> = new Set<string>([
  'input',
  'textarea',
  'select',
  'option',
  'form',
  'fieldset',
  'label',
  'button',
])

/**
 * Synthesise a static value for `<option>foo</option>` (no `value=`
 * attr). Returns the text content as a single-quoted JS string literal
 * so the equality check rendered into the AST treats it as a string.
 *
 * Returns:
 *   - quoted-string `"'apple'"` for a single static text child,
 *   - `null` for mixed / dynamic / empty children — caller skips the
 *     binding rather than synthesise a guess.
 *
 * The HTML spec says an option's value defaults to its descendant
 * text. We restrict to "single static text node" to keep the
 * code-path safe: handling interpolation correctly would need a
 * wrapped runtime expression, which we can't emit at compile time
 * without leaking runtime references that may not exist in the
 * template's binding scope.
 */
function inferOptionValueFromChildren(node: TemplateChildNode | RootNode): string | null {
  if (!('children' in node)) return null
  const children = node.children
  if (children.length !== 1) return null
  const only = children[0]
  if (only === undefined) return null
  if (typeof only === 'string' || typeof only === 'symbol') return null
  if (only.type !== NodeTypes.TEXT) return null
  // Mirror Vue's option-value semantic: trim leading/trailing whitespace
  // so `<option> apple </option>` matches a model value of `'apple'`.
  const text = only.content.trim()
  // Emit a fully escaped JS string literal — `JSON.stringify` covers
  // backslashes, quotes, and line terminators (`\n`, `\r`, U+2028,
  // U+2029) so the synthesized literal stays single-line and valid.
  return JSON.stringify(text)
}

/**
 * Vue compiler node transform for `<select v-register>` and any
 * component that wraps a select. Injects the `:value` /
 * `:registerValue` bridge bindings the runtime directive needs to
 * pre-mark selected options at SSR time.
 *
 * Wired automatically by `attaform/vite` and
 * `attaform/nuxt`. Use directly only when integrating with
 * a custom bundler.
 */
export const selectNodeTransform: NodeTransform = (node, context) => {
  // Snapshot every prop array we're about to mutate so a throw
  // mid-traversal rewinds to the pre-transform state. Without this,
  // a partial transform leaves the template with some `<option
  // :selected>` bindings rewritten and others not — worse than
  // skipping the transform entirely, since the runtime directive
  // would then miscompute initial state against a shape it doesn't
  // recognise. `snapshotProps` is idempotent per target; calling
  // twice records one snapshot.
  type NodeProps = (AttributeNode | DirectiveNode)[]
  const snapshots: Array<{ target: NodeProps; snapshot: NodeProps }> = []
  const snapshotProps = (target: NodeProps): void => {
    if (snapshots.some((entry) => entry.target === target)) return
    snapshots.push({ target, snapshot: [...target] })
  }
  try {
    const isSelect = node.type === NodeTypes.ELEMENT && node.tag === 'select'
    const isCustomComponent =
      node.type === NodeTypes.ELEMENT && node.tagType === ElementTypes.COMPONENT
    // Kebab-case tags (those with a hyphen, like `<my-input>`) compile
    // as `tagType === ElementTypes.ELEMENT` — Vue's compiler can't tell
    // statically whether the tag will resolve to an `app.component`
    // registration or to a user-supplied `compilerOptions.isCustomElement`
    // predicate, so it emits an element creation that the runtime
    // disambiguates. The transform fires the bridge prop injection on
    // these tags too: a kebab-case Vue component sees `useRegister`
    // work in its setup; a real Web Component sees `:value` /
    // `:registerValue` as DOM attributes (the documented `assignKey`
    // escape hatch handles that interop).
    //
    // NATIVE_FORM_TAGS keeps the conservative stance: only inject on
    // tags Vue would NEVER treat as a component. The hyphen check
    // already excludes most native HTML tags (which have no hyphen);
    // the explicit list documents the contract and guards against
    // hypothetical future native form tags with hyphens.
    const isKebabCustomElement =
      node.type === NodeTypes.ELEMENT &&
      node.tagType === ElementTypes.ELEMENT &&
      node.tag.includes('-') &&
      !NATIVE_FORM_TAGS.has(node.tag)

    if (!(isSelect || isCustomComponent || isKebabCustomElement)) return

    const selectSummarizedProps = getSummarizedProps(node)

    const registerIndex = selectSummarizedProps.findIndex((p) => isExactKey(p.key, 'register'))
    if (
      selectSummarizedProps.length === 0 ||
      registerIndex < 0 ||
      registerIndex >= selectSummarizedProps.length
    )
      return

    const registerSummarizedProp = selectSummarizedProps[registerIndex]

    // Inject location matches the originating element so source maps
    // for runtime errors in the synthesized expressions point at the
    // user's <select v-register=...> rather than line 0.
    const selectLoc: SourceLocation = node.loc

    function traverseSelectNode(
      _node: RootNode | TemplateChildNode,
      previousOptionExpressions: CompoundExpressionNode['children'][]
    ): void {
      const isOption = _node.type === NodeTypes.ELEMENT && _node.tag === 'option'
      if (!isOption) {
        // Only recurse into node types that genuinely hold iterable children.
        // Text / interpolation / comment nodes are skipped; future Vue node
        // types that we don't know about are also skipped rather than
        // crashing on a shape we didn't expect.
        if (!RECURSABLE_NODE_TYPES.has(_node.type)) return
        const hasChildren = 'children' in _node
        if (!hasChildren) return
        for (const child of _node.children) {
          if (typeof child === 'symbol' || typeof child === 'string') continue
          if (child.type === NodeTypes.SIMPLE_EXPRESSION) continue
          traverseSelectNode(child, previousOptionExpressions)
        }
        return
      }

      const optionProps = getSummarizedProps(_node)
      const valueIndex = optionProps.findIndex((p) => isExactKey(p.key, 'value'))

      // D3: HTML lets `<option>apple</option>` use text content as the
      // value. The original transform required an explicit `value=`
      // attr and silently dropped value-less options — they'd render
      // unselectable through `register('fruit')` because the AST
      // emitted no `:selected` binding.
      //
      // Fallback: if no `value=`, look at the option's children. A
      // single static TextNode → use it as the static value. Anything
      // else (interpolation, mixed children, no children) → skip with
      // a dev-warn rather than guess.
      let optionValueSummarizedProp: SummarizedProp | undefined
      if (valueIndex >= 0 && valueIndex < optionProps.length) {
        optionValueSummarizedProp = optionProps[valueIndex]
      } else {
        const fallback = inferOptionValueFromChildren(_node)
        if (fallback === null) {
          // Dynamic / mixed children — can't synthesize a static
          // equality expression. Bail without binding so the option
          // simply isn't reactive (matches pre-D3 behaviour for the
          // genuinely-dynamic cases). Producing a wrong binding would
          // be worse than no binding.
          return
        }
        optionValueSummarizedProp = { key: 'value', value: fallback }
      }

      const props = _node.props
      snapshotProps(props)
      removePropsByName(props, ['selected'])

      const newProp: DirectiveNode = {
        arg: createSimpleExpression('selected', true),
        exp: createCompoundExpression(
          generateEqualityExpression(
            registerSummarizedProp?.value ?? 'undefined',
            optionValueSummarizedProp?.value ?? 'undefined',
            previousOptionExpressions
          )
        ),
        name: 'bind',
        modifiers: [],
        type: NodeTypes.DIRECTIVE,
        loc: _node.loc,
      }
      props.push(newProp)
    }

    const multipleExpression = extractMultipleFromSelectSummarizedProps(selectSummarizedProps)

    const previousOptionExpressions: CompoundExpressionNode['children'][] =
      typeof multipleExpression === 'string' ? [[multipleExpression]] : [multipleExpression]

    // Multi-select hydration trap. Setting `select.value = X` on a
    // `<select multiple>` runs the spec's value-setter loop: for each
    // option, set selectedness to (option.value === X). For an array
    // model, `displayValue.value` resolves to `String(arr)` —
    // `"red,blue"` — which matches NO option's value, so the patch
    // DESELECTS every option (including the SSR-selected ones the
    // per-option `:selected` injection just placed). At runtime the
    // directive's `setSelected` re-syncs from the model, but the value
    // patch + the directive's identity-skip path can leave the DOM
    // stuck deselected if the model hasn't moved since the last apply.
    //
    // Per-option `:selected` bindings are the canonical mechanism for
    // multi-select initial state — the runtime directive's setSelected
    // mirrors exactly the same logic on the client. The select-level
    // `:value` adds nothing for multi: it's only useful as Vue's
    // single-select `value` patch shorthand, which is benign there
    // (`select.value = "1"` selects the matching option, a no-op when
    // it's already selected via `<option selected>`).
    //
    // Conservative gate: skip `:value` whenever `multiple` isn't
    // statically false. Static `<select>` and static `<select
    // multiple="false">` keep the injection (`extractMultipleFromSelect…`
    // returns the literal string `'false'` for both). Anything else —
    // static `multiple`, `multiple="true"`, or a dynamic `:multiple`
    // expression we can't evaluate at compile time — skips. The
    // dynamic case is rare; trading SSR `value=` on the select for
    // hydration correctness is the right call.
    const isStaticallyNonMultiple = multipleExpression === 'false'

    const selectProps = node.props
    snapshotProps(selectProps)
    removePropsByName(selectProps, ['value']) // actively prevent an attribute collision

    if (isStaticallyNonMultiple) {
      // construct `:value` dynamic prop based on the existing `v-register` directive
      const valuePropExpArray = Array.isArray(registerSummarizedProp?.value)
        ? registerSummarizedProp.value
        : [registerSummarizedProp?.value ?? 'undefined']
      // Read `displayValue.value` rather than `innerRef.value` so
      // selects share the same single read surface as text inputs.
      // The directive never marks select paths blank (no
      // DOM "empty" state), so in normal flow `displayValue` is just
      // `String(storage)` — identical to today. The edge case where a
      // consumer programmatically calls `setValue(numericPath, unset)`
      // bound to a `<select>` is documented in the docs (browser falls
      // back to first option; meta.blank surfaces the intent).
      const initExpression = createCompoundExpression([
        '(',
        ...valuePropExpArray,
        ')?.displayValue.value',
      ])

      const simpleExpression = createSimpleExpression(
        flattenCompoundExpression(initExpression),
        false
      )
      // `processExpression` can throw on malformed identifiers or
      // exotic expression shapes. Pre-fix, the throw bubbled to the
      // outer try/catch, which then ran the snapshot-restore path AND
      // skipped both the select's `:value` injection AND every option's
      // `:selected` binding — turning a single-expression problem into
      // a whole-template fallback. Isolate here so a parser failure on
      // this one expression keeps the other injections.
      let outputExp: ExpressionNode
      try {
        outputExp = processExpression(simpleExpression, { ...context, prefixIdentifiers: false })
      } catch (err) {
        console.error(
          '[attaform] select transform: processExpression failed; falling back to the unprocessed expression.',
          err
        )
        outputExp = simpleExpression
      }

      const valueProp: DirectiveNode = {
        rawName: ':value',
        arg: createSimpleExpression('value', true),
        exp: outputExp,
        name: 'bind',
        modifiers: [],
        type: NodeTypes.DIRECTIVE,
        loc: selectLoc,
      }

      node.props.push(valueProp)
    }

    if (isSelect) {
      for (const child of node.children) {
        traverseSelectNode(child, previousOptionExpressions) // start searching for options in dfs manner
      }
      return
    }

    const registerProps = node.props.filter(
      (x) => x.type === NodeTypes.DIRECTIVE && x.name === 'register'
    )
    const registerProp = registerProps[0]

    if (!registerProp) return

    // Idempotency marker. The hint and preamble transforms record
    // their own per-node markers; this one detects an already-injected
    // `:registerValue` directive on the props array and skips
    // re-pushing. Without the check, a doubly-registered transform
    // pipeline (rare in production, common in test combinatorics)
    // would emit two `registerValue:` keys in the generated render —
    // the last wins for prop resolution, but the output is bloated and
    // confusing under codegen inspection.
    const alreadyInjected = node.props.some(
      (p) =>
        p.type === NodeTypes.DIRECTIVE &&
        p.name === 'bind' &&
        p.arg !== undefined &&
        'content' in p.arg &&
        p.arg.content === 'registerValue'
    )
    if (alreadyInjected) return

    const customElementProp: DirectiveNode = {
      arg: createSimpleExpression('registerValue', true),
      exp: 'exp' in registerProp ? registerProp.exp : createSimpleExpression('undefined', false),
      name: 'bind',
      modifiers: [],
      type: NodeTypes.DIRECTIVE,
      loc: selectLoc,
    }

    node.props.push(customElementProp)
  } catch (err) {
    // AST shape drift or malformed template: rewind every prop array
    // we mutated so the template falls back cleanly to the runtime
    // directive. Reverse order mirrors the push order so later
    // snapshots restore against the state their earlier siblings
    // saw. Runtime directive alone still handles value binding; only
    // SSR initial-render correctness is affected.
    for (const { target, snapshot } of snapshots.slice().reverse()) {
      target.splice(0, target.length, ...snapshot)
    }

    console.error('[attaform] select transform failed, skipping:', err)
  }
}
