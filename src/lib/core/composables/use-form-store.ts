import { computed } from "vue"

import { getForm, getValueFactory } from "../utils/get-value"
import { getHandleSubmitFactory, getValidateFactory } from "../utils/process-form"
import { setValueFactory } from "../utils/set-value"

import { useState } from "#app"
import type { FormKey, FormStore } from "../../../types/types-api"
import type { GenericForm } from "../../../types/types-core"

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
