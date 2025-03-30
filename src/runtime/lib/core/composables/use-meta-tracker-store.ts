import { isEqual, merge } from 'lodash-es'
import { useState } from 'nuxt/app'
import { computed } from 'vue'
import type { FormKey, MetaTracker, MetaTrackerStore } from '../../../types/types-api'
import { flattenObjectWithBaseKey } from '../utils/flatten-object'

export function useMetaTrackerStore(formKey: FormKey) {
  const metaTrackerStore = useState<MetaTrackerStore>('useform/meta-tracker-store', () => {
    return new Map([[formKey, {}]])
  })

  const metaTracker = computed(() => {
    // we do this because useState is only called once to initialize the store (global state)
    // useMetaTrackerStore is called whenever useForm is called (potentially with various keys)
    // not doing this leads to a bug where metatracker is undefined if 2+ forms are declared
    if (!metaTrackerStore.value.has(formKey)) {
      metaTrackerStore.value.set(formKey, {})
    }

    return metaTrackerStore.value.get(formKey)!
  })

  return {
    metaTracker,
  }
}

type UpdateMetaTrackerConfig = {
  metaTracker: MetaTracker
  formKey: FormKey
  rawValue: unknown
  basePath: string | null
  isConnected?: boolean
  updateTime?: boolean
}

export function updateMetaTracker(config: UpdateMetaTrackerConfig) {
  const { formKey, metaTracker, rawValue, basePath, updateTime, isConnected } = config

  const lastKnownTime =
    typeof basePath === 'string' ? (metaTracker[basePath]?.updatedAt ?? null) : null

  const hasRawValueChanged =
    basePath === null ? true : !isEqual(metaTracker[basePath]?.rawValue, rawValue)
  const newTime = hasRawValueChanged ? new Date().toISOString() : lastKnownTime
  const updatedAt = (updateTime ?? true) ? newTime : lastKnownTime

  const flattenedObject = flattenObjectWithBaseKey(rawValue, basePath ?? undefined)
  const lastKnownIsConnectedValue =
    typeof basePath === 'string' ? (metaTracker[basePath]?.isConnected ?? false) : false

  const metaTrackerPatch = Object.entries(flattenedObject).reduce<MetaTracker>(
    (acc, [key, value]) => ({
      ...acc,
      [key]: {
        formKey,
        path: basePath,
        rawValue: value,
        updatedAt,
        isConnected: isConnected ?? lastKnownIsConnectedValue,
      },
    }),
    {}
  )

  return merge(metaTracker, metaTrackerPatch)
}
