import { addImports, addPlugin, addTypeTemplate, createResolver, defineNuxtModule } from '@nuxt/kit'
import { NodeTypes } from '@vue/compiler-core'
import { inputTextAreaNodeTransform } from './runtime/lib/core/transforms/input-text-area-transform'
import { selectNodeTransform } from './runtime/lib/core/transforms/select-transform'

import { parse as parseSFC } from '@vue/compiler-sfc'
import fs from 'fs'
import { sync as globSync } from 'glob'
import {
  getVueAstFactory,
  registerDirectiveTransformFactory,
} from './runtime/lib/core/transforms/register-directive-transform'

// Module options TypeScript interface definition
export interface CXModuleOptions {
  useZod?: boolean
}

export default defineNuxtModule<CXModuleOptions>({
  meta: {
    name: 'chemical-x-forms',
    configKey: 'chemicalX',
    compatibility: {
      nuxt: '^3.0.0',
    },
  },
  defaults: {
    useZod: true,
  },
  setup(options, nuxt) {
    const singleRootCache: Record<string, { hasSingleRoot: boolean; rootTag?: string }> = {}

    // Pre-build (and dev) hook: scan all .vue files once
    nuxt.hook('build:before', async () => {
      // const resolver = createResolver(nuxt.options.srcDir)
      const pattern = '**/*.vue'
      const vueFiles = globSync(pattern, {
        cwd: nuxt.options.srcDir,
        absolute: true,
      })

      const getVueAst = getVueAstFactory(singleRootCache, nuxt)
      for (const filePath of vueFiles) {
        const resp = getVueAst(filePath)
        if (!resp) continue

        const { ast, localName, nuxtStyleName, defaultEntry } = resp
        // Filter out whitespace-only text nodes
        const roots = ast.children.filter(
          (node) => !(node.type === NodeTypes.TEXT && !node.content.trim())
        )

        // If there's exactly 1 element root, store `hasSingleRoot = true` and the root tag
        if (roots.length === 1 && roots[0]?.type === NodeTypes.ELEMENT) {
          singleRootCache[localName] = {
            hasSingleRoot: true,
            rootTag: roots[0].tag,
          }
          singleRootCache[nuxtStyleName] = {
            hasSingleRoot: true,
            rootTag: roots[0].tag,
          }
        } else {
          // Multiple roots or no element root
          singleRootCache[localName] = defaultEntry
          singleRootCache[nuxtStyleName] = defaultEntry
        }
      }

      // For debugging
      console.warn('singleRootCache:', singleRootCache)
    })

    nuxt.options.vue.compilerOptions.nodeTransforms ||= []
    nuxt.options.vue.compilerOptions.nodeTransforms.push(
      selectNodeTransform,
      inputTextAreaNodeTransform
    )
    // nuxt.options.vue.compilerOptions.directiveTransforms ||= {}
    // nuxt.options.vue.compilerOptions.directiveTransforms['register'] = (dir, node, context) => {
    //   console.log('register directive node:', node)
    //   return {
    //     props: [],
    //   }
    // }

    nuxt.options.vue.compilerOptions.directiveTransforms = {
      ...(nuxt.options.vue.compilerOptions.directiveTransforms || {}),
      register: registerDirectiveTransformFactory(singleRootCache),
      // register: () => ({ props: [], needRuntime: true }),
    }

    nuxt.hook('vite:extendConfig', (viteConfig, { isServer }) => {
      // Only do this once (often you'd do it for the client build)
      if (isServer) return

      viteConfig.plugins = viteConfig.plugins || []
      viteConfig.plugins.push({
        name: 'chemical-x-hmr',
        enforce: 'pre',
        async handleHotUpdate(ctx) {
          // If it's not a .vue file, ignore
          if (!ctx.file.endsWith('.vue')) return

          const filePath = ctx.file
          // Re-read + re-parse the changed file
          try {
            const content = fs.readFileSync(filePath, 'utf8')
            const { descriptor } = parseSFC(content)
            const getVueAst = getVueAstFactory(singleRootCache, nuxt)
            const resp = getVueAst(filePath)
            if (!resp) return

            // update the singleRootCache as needed
            if (!descriptor.template) {
              // TODO: update cache
              singleRootCache[resp.localName] = resp.defaultEntry
              singleRootCache[resp.nuxtStyleName] = resp.defaultEntry
            } else {
              // TODO: update cache
              const roots = resp.ast.children.filter(
                (node) => !(node.type === NodeTypes.TEXT && !node.content.trim())
              )
              const isRoot = roots.length === 1 && roots[0]?.type === NodeTypes.ELEMENT
              const result = {
                hasSingleRoot: isRoot,
                rootTag:
                  roots.length === 1 && roots[0]?.type === NodeTypes.ELEMENT ? roots[0]?.tag : '',
              }
              singleRootCache[resp.localName] = result
              singleRootCache[resp.nuxtStyleName] = result
            }
            // Let Vite handle the normal .vue HMR after this
          } catch (err) {
            console.error('Error re-parsing:', filePath, err)
          }
        },
      })
    })

    const resolver = createResolver(import.meta.url)
    const useFormComposable = options.useZod ? 'use-form' : 'use-abstract-form'
    addImports([
      {
        name: 'useForm',
        from: resolver.resolve(`./runtime/composables/${useFormComposable}`),
      },
    ])

    addPlugin({
      src: resolver.resolve('./runtime/plugins/register'),
      mode: 'client',
    })

    addPlugin({
      src: resolver.resolve('./runtime/plugins/register-stub'),
      mode: 'server',
    })

    // v-register directive type
    addTypeTemplate({
      filename: 'types/v-register.d.ts',
      getContents: () => `// Generated by @chemical-x/forms
import type { ObjectDirective } from "vue"
import type { RegisterDirective } from "@chemical-x/forms/types"

declare module "vue" {
  interface GlobalDirectives { 
    vRegister: RegisterDirective
  }
}

export { }`,
    })
  },
})
