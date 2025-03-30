import { defineNuxtConfig, type DefineNuxtConfig } from 'nuxt/config'
import MyModule from '../../../src/module'

export default defineNuxtConfig({
  modules: [MyModule],
  alias: {
    '@runtime': '../../../src/runtime',
  },
}) as DefineNuxtConfig
