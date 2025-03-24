export const isRecord = (input: unknown): input is typeof input => {
  if (input !== null && typeof input === 'object') return true
  return false
}

export const isArray = (input: unknown): input is typeof input => {
  return Array.isArray(input)
}

export const isArrayOrRecord = (
  input: unknown
): input is Array<unknown> | Record<string, unknown> => {
  return isRecord(input) || isArray(input)
}

export function isPrimitive(input: unknown): boolean {
  if (typeof input === 'bigint') return true
  if (typeof input === 'boolean') return true
  if (typeof input === 'number') return true
  if (typeof input === 'string') return true
  if (typeof input === 'undefined') return true
  if (input === null) return true
  return false
}
