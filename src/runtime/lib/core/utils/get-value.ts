import { toRef, type ComputedRef, type Ref } from "vue"
import type { CurrentValueContext, CurrentValueWithContext, FormKey, FormStore, MetaTracker } from "../../../types/types-api"
import type { FlatPath, GenericForm, NestedType } from "../../../types/types-core"
import { PATH_SEPARATOR } from "./constants"
import { reconstructFlattenedObjectAtKey } from "./flatten-object"
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
>(form: ComputedRef<Form>, metaTrackerRef: Readonly<Ref<MetaTracker>>) {
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

  function getValue(): Readonly<Ref<GetValueFormType>>
  function getValue<Path extends FlatPath<Form>>(
    path: Path,
  ): Readonly<Ref<NestedType<GetValueFormType, Path>>>
  function getValue<WithMeta extends boolean>(context: CurrentValueContext<WithMeta>): WithMeta extends true ? CurrentValueWithContext<GetValueFormType> : Readonly<Ref<GetValueFormType>>
  function getValue<Path extends FlatPath<Form>, WithMeta extends boolean>(
    path: Path,
    context: CurrentValueContext<WithMeta>,
  ): WithMeta extends true ? CurrentValueWithContext<NestedType<GetValueFormType, Path>> : Readonly<Ref<NestedType<GetValueFormType, Path>>>
  function getValue<Path extends FlatPath<Form>>(pathOrContext?: Path | CurrentValueContext, context?: CurrentValueContext) {
    if (pathOrContext === undefined) return form as unknown as Ref<GetValueFormType>

    if (typeof pathOrContext === "object") {
      const withMeta = pathOrContext.withMeta ?? false
      if (!withMeta) return form as unknown as Ref<GetValueFormType>

      const reconstructedMetaGraph = toRef(() => reconstructFlattenedObjectAtKey(metaTrackerRef.value, undefined))

      return {
        currentValue: form,
        meta: reconstructedMetaGraph,
      } as unknown as CurrentValueWithContext<GetValueFormType>
    }

    const withMeta = context?.withMeta ?? false
    if (!withMeta) return _getValueInternalLogic(pathOrContext)

    const reconstructedMetaGraph = toRef(() => reconstructFlattenedObjectAtKey(metaTrackerRef.value, pathOrContext))
    return {
      currentValue: _getValueInternalLogic(pathOrContext),
      meta: reconstructedMetaGraph,
    } as unknown as CurrentValueWithContext<NestedType<GetValueFormType, Path>>
  }

  return getValue
}
