// import { useState } from "#app"
// import { useState } from "nuxt/app"
import { merge } from "lodash-es"
import { useState } from "nuxt/app"
import { computed } from "vue"
import type { FormKey, MetaTracker, MetaTrackerStore } from "../../../types/types-api"
import { flattenObjectWithBaseKey } from "../utils/flatten-object"

export function useMetaTrackerStore(
  formKey: FormKey
) {
  const metaTrackerStore = useState<MetaTrackerStore>("useform/meta-tracker-store", () => {
    return new Map([[formKey, {}]])
  })

  const metaTracker = computed(() => metaTrackerStore.value.get(formKey)!)

  return {
    metaTracker,
  }
}

type UpdateMetaTrackerConfig = {
  metaTracker: MetaTracker
  rawValue: unknown
  basePath: string | undefined
  isConnected?: boolean
  updateTime?: boolean
}

export function updateMetaTracker(config: UpdateMetaTrackerConfig) {
  const { metaTracker, rawValue, basePath, updateTime, isConnected } = config
  const lastKnownTime
    = typeof basePath === "string"
      ? metaTracker[basePath]?.updatedAt ?? null
      : null
  const updatedAt
    = updateTime ?? true ? new Date().toISOString() : lastKnownTime

  const flattenedObject = flattenObjectWithBaseKey(rawValue, basePath)
  const lastKnownIsConnectedValue = typeof basePath === "string" ? (metaTracker[basePath]?.isConnected ?? false) : false

  const metaTrackerPatch = Object.entries(flattenedObject).reduce<MetaTracker>(
    (acc, [key, value]) => ({
      ...acc,
      [key]: { updatedAt, rawValue: value, isConnected: isConnected ?? lastKnownIsConnectedValue },
    }),
    {}
  )

  return merge(metaTracker, metaTrackerPatch)
}
