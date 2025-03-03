import { defineNuxtPlugin } from "nuxt/app"
import { vModelDynamic } from "../directives/xmodel"

export default defineNuxtPlugin((nuxtApp) => {
  nuxtApp.vueApp.directive("xmodel", vModelDynamic)
})
