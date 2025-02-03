import { isArrayOrRecord } from "./helpers"

const NO_KEY = "___USEFORM_INTERNAL_ERROR__NO_PATH_KEY_FOUND_FOR_FLATTEN___"
function safeFlatPath(path: string | undefined) {
  return path === undefined ? NO_KEY : path
}

export function flattenObjectWithBaseKey(obj: unknown, basePath?: string) {
  // This will end up containing flat keys pointing to primitive values
  const recordedPaths: Record<string, unknown> = {}
  function logic(currentValue: unknown, _basePath?: string) {
    if (!isArrayOrRecord(currentValue)) {
      recordedPaths[safeFlatPath(_basePath)] = currentValue
      return
    }

    for (const key of Object.keys(currentValue)) {
      const childValue = (currentValue as Record<string, unknown>)[key]
      const targetPath = _basePath ? `${_basePath}.${key}` : key

      if (!isArrayOrRecord(childValue)) {
        recordedPaths[safeFlatPath(targetPath)] = childValue
        continue
      }

      logic(childValue, targetPath)
    }
  }

  logic(obj, basePath)
  return recordedPaths
}
