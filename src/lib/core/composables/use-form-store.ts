import { computed } from "vue"

import { getForm, getValueFactory } from "../utils/get-value"
import { getHandleSubmitFactory, getValidateFactory } from "../utils/process-form"
import { setValueFactory } from "../utils/set-value"
import type { FormKey, FormStore } from "../utils/types-api"
import type { GenericForm } from "../utils/types-core"

import { useState } from "#app"

export const useFormStore = <Form extends GenericForm>(formKey: FormKey) => {
  const formStore = useState<FormStore<Form>>("useform/store", () => new Map())

  function registerForm(form: Form) {
    if (formStore.value.has(formKey)) return

    formStore.value.set(formKey, form)
  }

  const form = computed(() => getForm(formStore, formKey))

  return {
    getHandleSubmitFactory,
    getValidateFactory,
    getValueFactory,
    setValueFactory,
    registerForm,
    formStore,
    form,
  }
}
