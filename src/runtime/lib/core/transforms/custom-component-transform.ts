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

export const customComponentTransform: NodeTransform = (node, context) => {
  const isCustomComponent =
    node.type === NodeTypes.ELEMENT && node.tagType === ElementTypes.COMPONENT

  if (!isCustomComponent) return

  const customComponentProps = getSummarizedProps(node)

  const registerIndex = customComponentProps.findIndex((p) => p.key.includes('register'))
  if (
    customComponentProps.length === 0 ||
    registerIndex < 0 ||
    registerIndex >= customComponentProps.length
  )
    return

  const registerSummarizedProp = customComponentProps[registerIndex]

  const dummyLoc: SourceLocation = {
    start: { column: 0, line: 0, offset: 0 },
    end: { column: 0, line: 0, offset: 0 },
    source: '',
  }
  // construct `:value` dynamic prop based on the existing `v-register` directive
  removePropsByName(node.props, ['value']) // actively prevent an attribute collision
  const valuePropExpArray = Array.isArray(registerSummarizedProp?.value)
    ? registerSummarizedProp.value
    : [registerSummarizedProp?.value ?? 'undefined']
  const initExpression = createCompoundExpression(['(', ...valuePropExpArray, ')?.innerRef.value'])

  const simpleExpression = createSimpleExpression(flattenCompoundExpression(initExpression), false)
  const outputExp = processExpression(simpleExpression, { ...context, prefixIdentifiers: false })

  const valueProp: DirectiveNode = {
    rawName: ':value',
    arg: createSimpleExpression('value', true),
    exp: outputExp,
    name: 'bind',
    modifiers: [],
    type: NodeTypes.DIRECTIVE,
    loc: dummyLoc,
  }

  node.props.push(valueProp)

  const registerProps = node.props.filter((x) => x.type === 7 && x.name === 'register')
  const registerProp = registerProps[0]

  if (!registerProp) return

  const customElementProp: DirectiveNode = {
    arg: createSimpleExpression('registerValue', true),
    exp: 'exp' in registerProp ? registerProp.exp : createSimpleExpression('undefined', false),
    name: 'bind',
    modifiers: [],
    type: NodeTypes.DIRECTIVE,
    loc: dummyLoc,
  }

  node.props.push(customElementProp)
}
