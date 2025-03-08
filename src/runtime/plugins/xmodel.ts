import { defineNuxtPlugin } from "nuxt/app"
import { vXModelDynamic } from "../directives/xmodel"

export default defineNuxtPlugin((nuxtApp) => {
  nuxtApp.vueApp.directive("xmodel", vXModelDynamic)
})
