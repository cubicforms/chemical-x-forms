import type { ComputedRef, Ref } from "vue"
import { toRef } from "vue"

import type { FormKey, FormStore } from "../../../types/types-api"
import type { FlatPath, GenericForm, NestedType } from "../../../types/types-core"
import { PATH_SEPARATOR } from "./constants"
import { isArrayOrRecord } from "./helpers"

export function getForm<Form extends GenericForm>(
  formStore: Ref<FormStore<Form>>,
  formKey: FormKey,
) {
  const form = formStore.value.get(formKey)

  if (!form) {
    throw new Error(`Form with key '${formKey}' not registered`)
  }

  return form
}

export function getValueFactory<
  Form extends GenericForm,
  GetValueFormType extends GenericForm = Form,
>(form: ComputedRef<Form>) {
  function _getValueInternalLogic<Path extends FlatPath<Form>>(path: Path) {
    const valueAsRef = toRef(() => {
      const keys = path.split(PATH_SEPARATOR).map(k => k.trim())

      let foundValue: unknown = form.value

      for (let index = 0; index < keys.length; index++) {
        const key = keys[index]
        if (!isArrayOrRecord(foundValue)) return undefined
        if (!(key in foundValue)) return undefined

        const _newFoundValue = (foundValue as Record<string, unknown>)?.[key]
        if (index < keys.length - 1 && !_newFoundValue) {
          return undefined
        }

        foundValue = _newFoundValue
      }

      return foundValue
    })

    return valueAsRef as Ref<NestedType<GetValueFormType, Path>>
  }

  function getValue(): ComputedRef<GetValueFormType>
  function getValue<Path extends FlatPath<Form>>(
    path: Path,
  ): Readonly<Ref<NestedType<GetValueFormType, Path>>>
  function getValue<Path extends FlatPath<Form>>(path?: Path) {
    if (path === undefined) return form as unknown as Ref<GetValueFormType>

    return _getValueInternalLogic(path)
  }

  return getValue
}
