import { defineNuxtPlugin } from "nuxt/app"
import { vSuperModel } from "../directives/v-supermodel"

export default defineNuxtPlugin((nuxtApp) => {
  nuxtApp.vueApp.directive("supermodel", vSuperModel)
  nuxtApp.vueApp.directive("super-model", vSuperModel) // alias
})
