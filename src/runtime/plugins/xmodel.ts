import { defineNuxtPlugin } from "nuxt/app"
import { vXModelDynamic } from "../../lib/core/directives/xmodel"

export default defineNuxtPlugin((nuxtApp) => {
  nuxtApp.vueApp.directive("xmodel", vXModelDynamic)
})
