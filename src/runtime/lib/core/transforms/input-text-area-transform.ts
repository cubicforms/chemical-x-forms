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
} from "@vue/compiler-core"
import { createCompoundExpression, NodeTypes } from "@vue/compiler-core"

type SummarizedProp = {
  key: string
  value: string | CompoundExpressionNode["children"]
}

function getSummarizedProps(node: RootNode | TemplateChildNode) {
  if (!("props" in node)) return []
  const props = node.props

  const summarizedProps = props.reduce<SummarizedProp[]>((acc, currProp) => {
    if (currProp.type === NodeTypes.ATTRIBUTE) {
      const key = currProp.name
      const value = currProp.value?.content ?? ""
      return [...acc, { key, value: renderAsStatic(value, true) }]
    }

    if (currProp.exp === undefined) return acc
    const key = currProp.arg
      ? getSummarizedPropValue(currProp.arg)
      : renderAsStatic(currProp.name, true)
    if (typeof key !== "string") return acc // key must always be a string
    const value = getSummarizedPropValue(currProp.exp)

    return [...acc, { key, value }]
  }, [])

  return summarizedProps
}

function renderAsStatic(val: string, isStatic: boolean) {
  return isStatic ? `"${val}"` : val
}

function getSummarizedPropValue(exp: ExpressionNode): SummarizedProp["value"] {
  if (exp.type === NodeTypes.SIMPLE_EXPRESSION) {
    return renderAsStatic(exp.content, exp.isStatic)
  }

  return exp.children
}

function generateEqualityExpression(
  xmodelValue: SummarizedProp["value"],
  elementValue: SummarizedProp["value"]
): CompoundExpressionNode["children"] {
  const xmodelValueArr = Array.isArray(xmodelValue)
    ? xmodelValue
    : [xmodelValue]
  const elementValueArr = Array.isArray(elementValue)
    ? elementValue
    : [elementValue]

  // account for xmodel value being an array, set, or some other value
  return [
    "Array.isArray((",
    ...xmodelValueArr,
    ")?.innerRef?.value) ? ",
    "(",
    ...xmodelValueArr,
    ")?.innerRef?.value?.includes(",
    ...elementValueArr,
    ") : ",
    "(",
    ...xmodelValueArr,
    ")?.innerRef?.value instanceof Set ? (",
    ...xmodelValueArr,
    ")?.innerRef?.value?.has(",
    ...elementValueArr,
    ") : ",
    "((",
    ...xmodelValueArr,
    ")?.innerRef?.value === (",
    ...elementValueArr,
    "))",
  ]
}

function removePropsByName(
  props: (AttributeNode | DirectiveNode)[],
  propNames: string[]
) {
  const removePropIndices: number[] = []
  for (let index = 0; index < props.length; index++) {
    const prop = props[index]
    if (!prop) continue

    if (
      propNames.includes(prop.name)
      || ("arg" in prop
        && prop.arg
        && "content" in prop.arg
        && propNames.includes(prop.arg.content))
    ) {
      removePropIndices.push(index) // store index to remove later, don't mutate variable while looping through it
    }
  }

  for (const index of removePropIndices.sort((a, z) => z - a)) {
    props.splice(index, 1) // index runs from high to low, so this works
  }
}

export const inputTextAreaNodeTransform: NodeTransform = (node) => {
  if (node.type !== 1) return

  const isInput = node.type === 1 && node.tag === "input"
  const isTextArea = node.type === 1 && node.tag === "textarea"

  if (!isInput && !isTextArea) return

  const elementProps = getSummarizedProps(node)

  const xmodelIndex = elementProps.findIndex(p => p.key.includes("xmodel"))
  const xmodelSummarizedProp = elementProps[xmodelIndex]
  if (!xmodelSummarizedProp) return // no return early if we don't find an xmodel directive

  const valueIndex = elementProps.findIndex(p => p.key.includes("value"))
  const elementValueSummarizedProp = elementProps?.[valueIndex] ?? {
    key: "value",
    value: "''",
  }

  const inputTypeIndex = elementProps.findIndex(p => p.key.includes("type"))
  // if (inputTypeIndex < 0 || inputTypeIndex >= elementProps.length) return

  const defaultSummarizedTextProp = { key: "type", value: "'text'" }
  const inputTypeSummarizedProp: SummarizedProp
    = inputTypeIndex === -1
      ? defaultSummarizedTextProp
      : (elementProps[inputTypeIndex] ?? defaultSummarizedTextProp)
  const inputTypeExpressionArray
    = typeof inputTypeSummarizedProp.value === "string"
      ? [inputTypeSummarizedProp.value]
      : inputTypeSummarizedProp.value

  // this gets paired with `value` to get the [selectionLabel]=[label] prop for the given input
  // checkbox and radio are marked as selected via `checked`, others typically use `value`
  const elementSelectionLabelExpression = createCompoundExpression([
    "(",
    "(",
    ...inputTypeExpressionArray,
    ")",
    " === 'checkbox' || ",
    "(",
    ...inputTypeExpressionArray,
    ") === 'radio'",
    ") ? 'checked' : 'value'",
  ])

  function computeProps(
    _node: PlainElementNode | ComponentNode | SlotOutletNode | TemplateNode,
    xmodelSummarizedProp: SummarizedProp,
    elementValueSummarizedProp: SummarizedProp
  ) {
    const dummyLoc: SourceLocation = {
      start: { column: 0, line: 0, offset: 0 },
      end: { column: 0, line: 0, offset: 0 },
      source: "",
    }

    const props = _node.props
    removePropsByName(props, ["checked", "value"]) // (re)create the `value` prop further down
    const xmodelValueArr = Array.isArray(xmodelSummarizedProp.value)
      ? xmodelSummarizedProp.value
      : [xmodelSummarizedProp.value]
    const valueExpression = createCompoundExpression([
      "(",
      ...xmodelValueArr,
      ")?.innerRef?.value",
    ])
    const valueOrCheckedProp: DirectiveNode = {
      // reconstruct the `value` attribute based on the provided v-xmodel, now that the computation is complete
      arg: elementSelectionLabelExpression,
      exp: createCompoundExpression([
        "(",
        ...elementSelectionLabelExpression.children,
        ") === 'checked' ? (",
        // resolves to a boolean
        ...generateEqualityExpression(
          xmodelSummarizedProp.value,
          elementValueSummarizedProp.value
        ),
        ") : (",
        // resolves to the provided xmodel value
        ...valueExpression.children,
        ")",
      ]),
      name: "bind",
      modifiers: [],
      type: NodeTypes.DIRECTIVE,
      loc: dummyLoc,
    }

    props.push(valueOrCheckedProp)
  }

  computeProps(node, xmodelSummarizedProp, elementValueSummarizedProp)
}
