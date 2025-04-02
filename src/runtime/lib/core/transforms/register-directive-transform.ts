import {
  createCompoundExpression,
  createSimpleExpression,
  DirectiveTransform,
  ElementTypes,
  NodeTypes,
  Property,
} from '@vue/compiler-core'

import path from 'node:path'

import { baseParse } from '@vue/compiler-core'
import { parse as parseSFC } from '@vue/compiler-sfc'
import fs from 'fs'
import { Nuxt } from 'nuxt/schema'

export function getVueAstFactory(singleRootCache: SingleRootCache, nuxt: Nuxt) {
  return (filePath: string) => {
    try {
      const content = fs.readFileSync(filePath, 'utf8')
      const { descriptor } = parseSFC(content)

      // Derive a "component name" from the base file name
      const { localName, nuxtStyleName } = getComponentNames(filePath, nuxt.options.srcDir)
      const defaultEntry = { hasSingleRoot: false as const }

      // If there's no <template>, store "false" (or whatever logic you prefer).
      if (!descriptor.template) {
        singleRootCache[localName] = defaultEntry
        singleRootCache[nuxtStyleName] = defaultEntry
        return
      }

      // Parse the template
      const ast = baseParse(descriptor.template.content)
      return { ast, localName, nuxtStyleName, defaultEntry }
    } catch {
      return
    }
  }
}

/**
 * Given:
 *   filePath = "/abs/path/to/srcDir/components/foo/bar.vue"
 *   srcDir   = "/abs/path/to/srcDir"
 * returns "FooBar"
 */
export function getComponentNames(
  filePath: string,
  srcDir: string
): { nuxtStyleName: string; localName: string } {
  // 1) Get relative path, e.g. "components/foo/bar.vue"
  const relativePath = path.relative(srcDir, filePath)

  // 2) Drop the file extension => "components/foo/bar"
  const withoutExt = relativePath.replace(/\.\w+$/, '')

  // 3) Split on directory separators => ["components", "foo", "bar"]
  let segments = withoutExt.split(path.sep)

  // 4) If the first segment is "components", remove it (optional convention)
  if (segments[0] === 'components') {
    segments.shift()
  }

  // 5) Convert each segment from e.g. "foo-bar" => "FooBar"
  segments = segments.map((segment) => {
    // split by dash => ["foo", "bar"]
    // capitalize each => ["Foo", "Bar"], then join => "FooBar"
    return segment
      .split('-')
      .map((str) => str.charAt(0).toUpperCase() + str.slice(1))
      .join('')
  })

  // 6) Join => "FooBar"
  const nuxtStyleComponentName = segments.join('')

  // 7) Get the basic name
  const localName = path.parse(filePath).name

  const camelCasedLocalName = localName
    .split('-')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join('')

  return { nuxtStyleName: nuxtStyleComponentName, localName: camelCasedLocalName }
}

type SingleRootCache = Record<string, { hasSingleRoot: boolean; rootTag?: string }>

export const registerDirectiveTransformFactory: (
  singleRootCache: SingleRootCache
) => DirectiveTransform = (singleRootCache) => (dir, node) => {
  const isSelect = node.type === NodeTypes.ELEMENT && node.tag === 'select'
  const isInput = node.type === 1 && node.tag === 'input'
  const isTextArea = node.type === 1 && node.tag === 'textarea'

  const isCustomComponent =
    node.type === NodeTypes.ELEMENT && node.tagType === ElementTypes.COMPONENT

  //   console.log(
  //     { singleRootCache, match: singleRootCache[context.filename] ?? null },
  //     node.tag,
  //     context.filename
  //   )

  const nodeTag = isCustomComponent
    ? node.tag
        .split('-')
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join('')
    : node.tag

  const isInteractiveRoot = (root?: string) => ['input', 'textarea', 'select'].includes(root ?? '')
  const sfcCacheValue = singleRootCache[nodeTag]
  const isValidCustomComponent =
    isCustomComponent && !!sfcCacheValue?.hasSingleRoot && isInteractiveRoot(sfcCacheValue.rootTag)
  const shouldInjectValue = isSelect || isInput || isTextArea || isValidCustomComponent

  if (!shouldInjectValue) {
    return {
      props: [],
      needRuntime: true,
    }
  }

  // removePropsByName(node.props, ['value']) // make sure v-register takes over ':value' attribute

  const registerValuePropertyArray: Property[] = []
  if (isCustomComponent) {
    // fallback prop for valid custom elements
    registerValuePropertyArray.push({
      type: NodeTypes.JS_PROPERTY,
      key: createSimpleExpression('registerValue', true),
      loc: {
        start: { column: 0, line: 0, offset: 0 },
        end: { column: 0, line: 0, offset: 0 },
        source: '',
      },
      value: dir.exp ?? createSimpleExpression('undefined', true),
    })
  }

  // this is assumed to be a RegisterValue but processed cautiously
  const valueExp = createCompoundExpression([
    '(',
    dir.exp ?? createSimpleExpression('undefined', true),
    ')?.innerRef?.value',
  ])

  return {
    props: [
      {
        type: NodeTypes.JS_PROPERTY,
        key: createSimpleExpression('value', true),
        loc: {
          start: { column: 0, line: 0, offset: 0 },
          end: { column: 0, line: 0, offset: 0 },
          source: '',
        },
        value: valueExp,
      },
      ...registerValuePropertyArray,
    ],
    needRuntime: true,
  }
}
