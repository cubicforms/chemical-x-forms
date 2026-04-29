import type {
  AttributeNode,
  CompoundExpressionNode,
  DirectiveNode,
  ExpressionNode,
  NodeTransform,
  PlainElementNode,
  RootNode,
  SourceLocation,
  TemplateChildNode,
} from '@vue/compiler-core'
import { createCompoundExpression, NodeTypes } from '@vue/compiler-core'

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
  registerValue: SummarizedProp['value'],
  optionValue: SummarizedProp['value'],
  scalarTarget: SummarizedProp['value']
): CompoundExpressionNode['children'] {
  const registerValueArr = Array.isArray(registerValue) ? registerValue : [registerValue]
  const optionValueArr = Array.isArray(optionValue) ? optionValue : [optionValue]
  const scalarTargetArr = Array.isArray(scalarTarget) ? scalarTarget : [scalarTarget]

  // Discriminator selection:
  //   - Array model     → membership of the option-value (e.g. value="apple")
  //   - Set model       → membership of the option-value
  //   - Scalar model    → equality with the scalar-equality target
  //
  // The scalar target differs from the option-value for two checkbox
  // shapes that the directive's runtime `setChecked` already handles
  // via `getCheckboxValue(el, true)`:
  //
  //   - boolean model + no `value=` → target is `true`
  //   - string model + `:true-value="'X'"` → target is `'X'`
  //
  // For radio inputs the model is always scalar and the discriminator
  // IS the option-value, so `optionValue === scalarTarget` there.
  return [
    'Array.isArray((',
    ...registerValueArr,
    ')?.innerRef?.value) ? ',
    '(',
    ...registerValueArr,
    ')?.innerRef?.value?.includes(',
    ...optionValueArr,
    ') : ',
    '(',
    ...registerValueArr,
    ')?.innerRef?.value instanceof Set ? (',
    ...registerValueArr,
    ')?.innerRef?.value?.has(',
    ...optionValueArr,
    ') : ',
    '((',
    ...registerValueArr,
    ')?.innerRef?.value === (',
    ...scalarTargetArr,
    '))',
  ]
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

// Exact prop-name match. Pre-rewrite used .includes('register') / .includes('value') /
// .includes('type') which false-positived on any user prop whose name contained those
// substrings (e.g. `data-register-id`, `valueFoo`, `prototype`, `:registerField`).
function isExactKey(summarizedKey: string, name: string): boolean {
  // Summarized keys come in three shapes depending on prop type:
  //   attribute       -> "name"          (from getSummarizedProps)
  //   v-bind:name="x" -> "\"name\""      (quoted via renderAsStatic)
  //   static v-prefix -> "\"name\""
  return summarizedKey === name || summarizedKey === `"${name}"`
}

/**
 * Returns true iff the type prop's value is the static-attribute literal
 * matching one of `names` (case-insensitive). Used to detect static
 * `type="checkbox"` / `type="radio"` shapes where the `value` attribute
 * is the option-value (a discriminator within the group), not display
 * state — so the transform must NOT strip it.
 *
 * Conservative on dynamic shapes — `:type="x"` returns false, falling
 * through to the text-input branch which strips `value`. Authors using
 * dynamic types between checkbox/radio and text are rare; if they hit
 * this they can add a static `type=` to lock the shape.
 */
function isStaticTypeOneOf(value: SummarizedProp['value'], names: readonly string[]): boolean {
  if (Array.isArray(value)) return false
  const trimmed = value.trim()
  const literalMatch = /^(["'`])(.*)\1$/.exec(trimmed)
  if (literalMatch === null) return false
  const inner = (literalMatch[2] as string).toLowerCase()
  return names.includes(inner)
}

/**
 * Returns true if the type prop's value MIGHT resolve to "file" at runtime.
 * Conservative — anything not provably non-"file" returns true so the caller
 * skips the transform.
 *
 * Concretely:
 *   - `type="text"`   → value is `'"text"'`         → false (static literal != "file")
 *   - `type="file"`   → value is `'"file"'`         → true  (static "file")
 *   - `:type="'text'"`→ value is `"'text'"`         → false
 *   - `:type="'file'"`→ value is `"'file'"`         → true
 *   - `:type="kind"`  → value is `'kind'`           → true  (dynamic identifier)
 *   - `:type="`a-${x}`"` → array or template lit    → true  (compound expression)
 */
function couldResolveToFileType(value: SummarizedProp['value']): boolean {
  if (Array.isArray(value)) return true
  const trimmed = value.trim()
  // Match a one-line JS string literal: '...', "...", or `...`. Doesn't
  // attempt to handle escaped quotes inside the literal — a `type` prop
  // containing escaped quotes is vanishingly rare and falling through to
  // "could be file" here is the safe direction anyway.
  const literalMatch = /^(["'`])(.*)\1$/.exec(trimmed)
  if (literalMatch === null) return true // dynamic expression — can't prove safe
  const quote = literalMatch[1] as string
  const inner = literalMatch[2] as string
  // Template literals with interpolations resolve at runtime.
  if (quote === '`' && inner.includes('${')) return true
  // The HTML spec matches `type` ASCII case-insensitively, so
  // `<input type="FILE">` behaves identically to `<input type="file">`.
  // Compare lower-cased so we catch both.
  return inner.toLowerCase() === 'file'
}

/**
 * Vue compiler node transform for `<input v-register>` and
 * `<textarea v-register>`. Injects the `:value` / `:checked`
 * bindings required for SSR-correct initial render.
 *
 * Wired automatically by `@chemical-x/forms/vite` and
 * `@chemical-x/forms/nuxt`. Use directly only when integrating with
 * a custom bundler.
 */
export const inputTextAreaNodeTransform: NodeTransform = (node) => {
  try {
    if (node.type !== NodeTypes.ELEMENT) return

    const isInput = node.tag === 'input'
    const isTextArea = node.tag === 'textarea'

    if (!isInput && !isTextArea) return

    const elementProps = getSummarizedProps(node)

    const registerIndex = elementProps.findIndex((p) => isExactKey(p.key, 'register'))
    const registerSummarizedProp = elementProps[registerIndex]
    if (!registerSummarizedProp) return // no v-register directive; nothing to transform

    // <input type="file" v-register="..."> silently skipped — at runtime the
    // directive routes to a no-op variant. Trying to set el.value on a file
    // input throws a DOMException for security reasons. We must skip not just
    // the static type="file" case but any dynamic binding (`:type="x"`,
    // template-literal expressions, etc.) that COULD resolve to "file" at
    // runtime — `couldResolveToFileType` errs on the conservative side.
    const typeIndex = elementProps.findIndex((p) => isExactKey(p.key, 'type'))
    const typeProp = elementProps[typeIndex]
    if (typeProp !== undefined && couldResolveToFileType(typeProp.value)) return

    const valueIndex = elementProps.findIndex((p) => isExactKey(p.key, 'value'))
    const elementValueSummarizedProp = elementProps?.[valueIndex] ?? {
      key: 'value',
      value: "''",
    }

    const inputTypeIndex = typeIndex

    const defaultSummarizedTextProp = { key: 'type', value: "'text'" }
    const inputTypeSummarizedProp: SummarizedProp =
      inputTypeIndex === -1
        ? defaultSummarizedTextProp
        : (elementProps[inputTypeIndex] ?? defaultSummarizedTextProp)
    const inputTypeExpressionArray =
      typeof inputTypeSummarizedProp.value === 'string'
        ? [inputTypeSummarizedProp.value]
        : inputTypeSummarizedProp.value

    // this gets paired with `value` to get the [selectionLabel]=[label] prop for the given input
    // checkbox and radio are marked as selected via `checked`, others typically use `value`
    //
    // The HTML spec matches `type` ASCII case-insensitively, so
    // `<input type="CHECKBOX">` and `<input type="Radio">` produce the
    // same runtime element as their lowercase counterparts. The
    // injected expression normalizes via `String(t).toLowerCase()`
    // before comparing — the compile-time `isStaticTypeOneOf` already
    // uses case-insensitive matching, so without the runtime
    // normalization a `type="CHECKBOX"` input would have its static
    // `value` preserved (per `keepStaticValue`) but still emit
    // `:value="..."` instead of `:checked="..."`, breaking SSR initial
    // checked state.
    const elementSelectionLabelExpression = createCompoundExpression([
      '(',
      'String((',
      ...inputTypeExpressionArray,
      ')).toLowerCase()',
      " === 'checkbox' || ",
      'String((',
      ...inputTypeExpressionArray,
      ")).toLowerCase() === 'radio'",
      ") ? 'checked' : 'value'",
    ])

    // Narrowed from `PlainElementNode | ComponentNode | SlotOutletNode |
    // TemplateNode` — `<input>` / `<textarea>` are always PlainElementNode
    // in Vue's AST. The previous wide union let a TemplateNode slip
    // through and crash on `_node.props`.
    function computeProps(
      _node: PlainElementNode,
      registerSummarizedProp: SummarizedProp,
      elementValueSummarizedProp: SummarizedProp
    ): void {
      // Reuse the originating element's source location for the
      // injected directive — runtime errors in the synthesized expression
      // get reported at the v-register binding site rather than line 0.
      const injectedLoc: SourceLocation = _node.loc

      const props = _node.props
      // For statically-typed checkbox / radio inputs, the `value=`
      // attribute is the OPTION-value (the discriminator the directive
      // matches against the model), not display state. The synthesized
      // binding below resolves to `:checked="..."` for those types, a
      // different attribute key — so the static `value` survives
      // alongside it without conflict. Stripping it (as we still do
      // for text/textarea, where the synthesized binding resolves to
      // `:value`) leaves the SSR HTML without the attribute, and on
      // hydration the directive can't tell which option this checkbox
      // represents.
      const isStaticCheckbox =
        typeProp !== undefined && isStaticTypeOneOf(typeProp.value, ['checkbox'])
      const isStaticRadio = typeProp !== undefined && isStaticTypeOneOf(typeProp.value, ['radio'])
      const keepStaticValue = isStaticCheckbox || isStaticRadio
      removePropsByName(props, keepStaticValue ? ['checked'] : ['checked', 'value'])
      const registerValueArr = Array.isArray(registerSummarizedProp.value)
        ? registerSummarizedProp.value
        : [registerSummarizedProp.value]
      // Read `displayValue.value` rather than `innerRef.value` so the
      // `:value` binding renders the transient-empty `''` when the
      // user clears a numeric field. `displayValue` returns
      // `String(storage)` for non-empty storage and `''` for both
      // null/undefined storage and paths in the form's
      // `transientEmptyPaths` set — a single read surface for the
      // injected expression. For checkbox / radio (the ternary's
      // truthy branch above), this leg is unreached, so behaviour
      // there is unchanged.
      const valueExpression = createCompoundExpression([
        '(',
        ...registerValueArr,
        ')?.displayValue?.value',
      ])

      // Scalar-equality target. Three cases (see the long-form comment
      // on `generateEqualityExpression`):
      //   - static checkbox + `:true-value="X"` → X (the explicit
      //     mapped string the model takes when checked)
      //   - static checkbox without `:true-value` → boolean `true`
      //     (matches the runtime's `getCheckboxValue(el, true)` default)
      //   - static radio → the option-value (since radio model is
      //     always scalar and the `value=` IS the discriminator)
      //   - dynamic type → fall back to the option-value (current
      //     behaviour); a dynamic-type element can't be statically
      //     classified into checkbox vs radio vs text.
      const trueValueIndex = elementProps.findIndex((p) => isExactKey(p.key, 'true-value'))
      const trueValueProp = elementProps[trueValueIndex]
      const scalarTarget: SummarizedProp['value'] = isStaticCheckbox
        ? trueValueProp !== undefined
          ? trueValueProp.value
          : 'true'
        : elementValueSummarizedProp.value

      const valueOrCheckedProp: DirectiveNode = {
        // reconstruct the `value` attribute based on the provided v-registerer, now that the computation is complete
        arg: elementSelectionLabelExpression,
        exp: createCompoundExpression([
          '(',
          ...elementSelectionLabelExpression.children,
          ") === 'checked' ? (",
          // resolves to a boolean
          ...generateEqualityExpression(
            registerSummarizedProp.value,
            elementValueSummarizedProp.value,
            scalarTarget
          ),
          ') : (',
          // resolves to the provided register value
          ...valueExpression.children,
          ')',
        ]),
        name: 'bind',
        modifiers: [],
        type: NodeTypes.DIRECTIVE,
        loc: injectedLoc,
      }

      props.push(valueOrCheckedProp)
    }

    // The outer guards (`node.type === NodeTypes.ELEMENT` + `node.tag
    // === 'input' | 'textarea'`) narrow `node` to a PlainElementNode
    // at runtime; the cast records that for the type system.
    computeProps(node as PlainElementNode, registerSummarizedProp, elementValueSummarizedProp)
  } catch (err) {
    // AST shapes can shift with minor Vue compiler updates. If we hit
    // anything unexpected, skip this transform — the runtime directive
    // alone handles value binding (via mounted/beforeUpdate), so the only
    // cost is a one-frame flash on SSR initial render.

    console.error('[@chemical-x/forms] input/textarea transform failed, skipping:', err)
  }
}
