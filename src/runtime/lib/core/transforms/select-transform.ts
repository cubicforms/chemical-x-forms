import {
  createCompoundExpression,
  createSimpleExpression,
  NodeTypes,
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
    if (!noMultipleOptExpressions.length) {
      return [
        '(',
        ...getImplicitTrueMultipleExpression(multipleExpression),
        `) ? ((`,
        ...selectValueArr,
        `)?.innerRef?.value?.findIndex?.(el => el === (`,
        ...optionValueArr,
        `)) > -1) : ((`,
        ...selectValueArr,
        `)?.innerRef?.value === (`,
        ...optionValueArr,
        `))`,
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
      `) ? false : ((`,
      ...selectValueArr,
      `)?.innerRef?.value === (`,
      ...optionValueArr,
      `)))`,
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

export const selectNodeTransform: NodeTransform = (node) => {
  const isSelect = node.type === NodeTypes.ELEMENT && node.tag === 'select'
  if (!isSelect) return

  const selectSummarizedProps = getSummarizedProps(node)

  const registerIndex = selectSummarizedProps.findIndex((p) => p.key.includes('register'))
  if (
    selectSummarizedProps.length === 0 ||
    registerIndex < 0 ||
    registerIndex >= selectSummarizedProps.length
  )
    return

  const registerSummarizedProp = selectSummarizedProps[registerIndex]

  const dummyLoc: SourceLocation = {
    start: { column: 0, line: 0, offset: 0 },
    end: { column: 0, line: 0, offset: 0 },
    source: '',
  }

  function traverseSelectNode(
    _node: RootNode | TemplateChildNode,
    previousOptionExpressions: CompoundExpressionNode['children'][]
  ) {
    const isOption = _node.type === 1 && _node.tag === 'option'
    if (!isOption) {
      // search for node children
      const hasChildren = 'children' in _node

      if (hasChildren) {
        for (const child of _node.children) {
          // ignore all child types except TemplateChildNode
          const stopSearch =
            typeof child === 'symbol' ||
            typeof child === 'string' ||
            child.type === NodeTypes.SIMPLE_EXPRESSION
          if (stopSearch) continue
          traverseSelectNode(child, previousOptionExpressions)
        }
      }

      return
    }

    const optionProps = getSummarizedProps(_node)
    const valueIndex = optionProps.findIndex((p) => p.key.includes('value'))
    if (optionProps.length === 0 || valueIndex < 0 || valueIndex >= optionProps.length) return

    const optionValueSummarizedProp = optionProps[valueIndex]

    const props = _node.props
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
      loc: dummyLoc,
    }
    props.push(newProp)
  }

  const multipleExpression = extractMultipleFromSelectSummarizedProps(selectSummarizedProps)

  const previousOptionExpressions: CompoundExpressionNode['children'][] =
    typeof multipleExpression === 'string' ? [[multipleExpression]] : [multipleExpression]

  for (const child of node.children) {
    traverseSelectNode(child, previousOptionExpressions) // start searching for options in dfs manner
  }
}
