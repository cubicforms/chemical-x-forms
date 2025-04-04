import { addImports, addPlugin, addTypeTemplate, createResolver, defineNuxtModule } from '@nuxt/kit'
import { inputTextAreaNodeTransform } from './runtime/lib/core/transforms/input-text-area-transform'
import { selectNodeTransform } from './runtime/lib/core/transforms/select-transform'

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
    nuxt.options.vue.compilerOptions.nodeTransforms ||= []
    nuxt.options.vue.compilerOptions.nodeTransforms.push(
      selectNodeTransform,
      inputTextAreaNodeTransform
    )

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
