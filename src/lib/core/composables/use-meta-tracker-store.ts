import { useState } from "#app"
import merge from "lodash-es/merge"
import { ref } from "vue"
import type { FormKey, MetaTracker, MetaTrackerStore } from "../../../types/types-api"
import type { DeepPartial, GenericForm } from "../../../types/types-core"
import { flattenObjectWithBaseKey } from "../utils/flatten-object"

export function useMetaTrackerStore<Form extends GenericForm>(formKey: FormKey, initialState: DeepPartial<Form>) {
  const formmetaTrackerStore = useState<MetaTrackerStore>("useform/inputstore", () => new Map())

  function registermetaTracker() {
    if (formmetaTrackerStore.value.has(formKey)) return

    const metaTracker = updateMetaTracker({
      rawValue: initialState,
      metaTracker: {},
      basePath: undefined,
      updateTime: false,
    })
    formmetaTrackerStore.value.set(formKey, metaTracker)
  }

  registermetaTracker()

  function getMetaTracker() {
    const metaTracker = formmetaTrackerStore.value.get(formKey)
    if (!metaTracker) {
      throw new Error(`Could not find a meta tracker with form key '${formKey}'. Was it registered?`)
    }

    return ref(metaTracker)
  }

  return {
    getMetaTracker,
  }
}

type UpdateMetaTrackerConfig = {
  metaTracker: MetaTracker
  rawValue: unknown
  basePath: string | undefined
  updateTime?: boolean
}

export function updateMetaTracker(config: UpdateMetaTrackerConfig) {
  const { metaTracker, rawValue, basePath, updateTime } = config
  const updatedAt = (updateTime ?? true) ? (new Date()).toISOString() : null

  const flattenedObject = flattenObjectWithBaseKey(rawValue, basePath)
  const metaTrackerPatch = Object.entries(flattenedObject).reduce<MetaTracker>((acc, [key, value]) => ({ ...acc, [key]: { updatedAt, rawValue: value } }), {})

  console.log("internal metatracker", metaTracker, metaTrackerPatch)
  return merge(metaTracker, metaTrackerPatch)
}
