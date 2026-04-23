import type {
  AttributeNode,
  ComponentNode,
  CompoundExpressionNode,
  DirectiveNode,
  ExpressionNode,
  NodeTransform,
  PlainElementNode,
  RootNode,
  SlotOutletNode,
  SourceLocation,
  TemplateChildNode,
  TemplateNode,
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
  elementValue: SummarizedProp['value']
): CompoundExpressionNode['children'] {
  const registerValueArr = Array.isArray(registerValue) ? registerValue : [registerValue]
  const elementValueArr = Array.isArray(elementValue) ? elementValue : [elementValue]

  // account for register value being an array, set, or some other value
  return [
    'Array.isArray((',
    ...registerValueArr,
    ')?.innerRef?.value) ? ',
    '(',
    ...registerValueArr,
    ')?.innerRef?.value?.includes(',
    ...elementValueArr,
    ') : ',
    '(',
    ...registerValueArr,
    ')?.innerRef?.value instanceof Set ? (',
    ...registerValueArr,
    ')?.innerRef?.value?.has(',
    ...elementValueArr,
    ') : ',
    '((',
    ...registerValueArr,
    ')?.innerRef?.value === (',
    ...elementValueArr,
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
    // input throws a DOMException for security reasons.
    const typeIndex = elementProps.findIndex((p) => isExactKey(p.key, 'type'))
    const typeProp = elementProps[typeIndex]
    if (typeProp !== undefined && typeProp.value === '"file"') return

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
    const elementSelectionLabelExpression = createCompoundExpression([
      '(',
      '(',
      ...inputTypeExpressionArray,
      ')',
      " === 'checkbox' || ",
      '(',
      ...inputTypeExpressionArray,
      ") === 'radio'",
      ") ? 'checked' : 'value'",
    ])

    function computeProps(
      _node: PlainElementNode | ComponentNode | SlotOutletNode | TemplateNode,
      registerSummarizedProp: SummarizedProp,
      elementValueSummarizedProp: SummarizedProp
    ): void {
      const dummyLoc: SourceLocation = {
        start: { column: 0, line: 0, offset: 0 },
        end: { column: 0, line: 0, offset: 0 },
        source: '',
      }

      const props = _node.props
      removePropsByName(props, ['checked', 'value']) // (re)create the `value` prop further down
      const registerValueArr = Array.isArray(registerSummarizedProp.value)
        ? registerSummarizedProp.value
        : [registerSummarizedProp.value]
      const valueExpression = createCompoundExpression([
        '(',
        ...registerValueArr,
        ')?.innerRef?.value',
      ])
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
            elementValueSummarizedProp.value
          ),
          ') : (',
          // resolves to the provided register value
          ...valueExpression.children,
          ')',
        ]),
        name: 'bind',
        modifiers: [],
        type: NodeTypes.DIRECTIVE,
        loc: dummyLoc,
      }

      props.push(valueOrCheckedProp)
    }

    computeProps(node, registerSummarizedProp, elementValueSummarizedProp)
  } catch (err) {
    // AST shapes can shift with minor Vue compiler updates. If we hit
    // anything unexpected, skip this transform — the runtime directive
    // alone handles value binding (via mounted/beforeUpdate), so the only
    // cost is a one-frame flash on SSR initial render.

    console.error('[@chemical-x/forms] input/textarea transform failed, skipping:', err)
  }
}
