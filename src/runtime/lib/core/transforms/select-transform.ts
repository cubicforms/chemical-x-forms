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

    if (!(isSelect || isCustomComponent)) return

    const selectSummarizedProps = getSummarizedProps(node)

    const registerIndex = selectSummarizedProps.findIndex((p) => isExactKey(p.key, 'register'))
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
      if (optionProps.length === 0 || valueIndex < 0 || valueIndex >= optionProps.length) return

      const optionValueSummarizedProp = optionProps[valueIndex]

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
        loc: dummyLoc,
      }
      props.push(newProp)
    }

    const multipleExpression = extractMultipleFromSelectSummarizedProps(selectSummarizedProps)

    const previousOptionExpressions: CompoundExpressionNode['children'][] =
      typeof multipleExpression === 'string' ? [[multipleExpression]] : [multipleExpression]

    // construct `:value` dynamic prop based on the existing `v-register` directive
    const selectProps = node.props

    snapshotProps(selectProps)
    removePropsByName(selectProps, ['value']) // actively prevent an attribute collision
    const valuePropExpArray = Array.isArray(registerSummarizedProp?.value)
      ? registerSummarizedProp.value
      : [registerSummarizedProp?.value ?? 'undefined']
    const initExpression = createCompoundExpression([
      '(',
      ...valuePropExpArray,
      ')?.innerRef.value',
    ])

    const simpleExpression = createSimpleExpression(
      flattenCompoundExpression(initExpression),
      false
    )
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

    const customElementProp: DirectiveNode = {
      arg: createSimpleExpression('registerValue', true),
      exp: 'exp' in registerProp ? registerProp.exp : createSimpleExpression('undefined', false),
      name: 'bind',
      modifiers: [],
      type: NodeTypes.DIRECTIVE,
      loc: dummyLoc,
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

    console.error('[@chemical-x/forms] select transform failed, skipping:', err)
  }
}
