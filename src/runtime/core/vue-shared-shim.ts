/**
 * Inlined copies of the handful of utilities we use from @vue/shared.
 *
 * @vue/shared is technically an internal Vue package. Treating it as stable
 * API for a runtime-only form library is a fragility we don't need — these
 * implementations are six functions + ~40 lines, and keeping them in-tree
 * insulates us from future renames or semantic drift.
 *
 * Source (MIT © Vue.js contributors):
 * https://github.com/vuejs/core/blob/main/packages/shared/src/general.ts
 * https://github.com/vuejs/core/blob/main/packages/shared/src/looseEqual.ts
 * https://github.com/vuejs/core/blob/main/packages/shared/src/toDisplayString.ts
 *
 * Behavior preserved byte-for-byte where possible; minor cosmetic changes for
 * our stricter ESLint rules (strict-boolean-expressions, prefer-nullish-
 * coalescing). Any divergence from @vue/shared is a bug in this file.
 */

export const isArray = Array.isArray

export function isFunction(value: unknown): value is (...args: unknown[]) => unknown {
  return typeof value === 'function'
}

function toTypeString(value: unknown): string {
  return Object.prototype.toString.call(value)
}

export function isSet(value: unknown): value is Set<unknown> {
  return toTypeString(value) === '[object Set]'
}

export function isMap(value: unknown): value is Map<unknown, unknown> {
  return toTypeString(value) === '[object Map]'
}

export function isDate(value: unknown): value is Date {
  return toTypeString(value) === '[object Date]'
}

export function isSymbol(value: unknown): value is symbol {
  return typeof value === 'symbol'
}

export function isObject(value: unknown): value is Record<string | symbol, unknown> {
  return value !== null && typeof value === 'object'
}

export function looseToNumber<T>(val: T): T | number {
  const n = parseFloat(val as unknown as string)
  return isNaN(n) ? val : n
}

function looseCompareArrays(a: unknown[], b: unknown[]): boolean {
  if (a.length !== b.length) return false
  let equal = true
  for (let i = 0; equal && i < a.length; i++) {
    equal = looseEqual(a[i], b[i])
  }
  return equal
}

export function looseEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  const aValidType = isDate(a)
  const bValidType = isDate(b)
  if (aValidType || bValidType) {
    return aValidType && bValidType ? a.getTime() === b.getTime() : false
  }
  const aSymbol = isSymbol(a)
  const bSymbol = isSymbol(b)
  if (aSymbol || bSymbol) return a === b
  const aIsArray = isArray(a)
  const bIsArray = isArray(b)
  if (aIsArray || bIsArray) {
    return aIsArray && bIsArray ? looseCompareArrays(a, b) : false
  }
  if (isObject(a) && isObject(b)) {
    const keysA = Object.keys(a)
    if (keysA.length !== Object.keys(b).length) return false
    for (const key of keysA) {
      const hasA = Object.prototype.hasOwnProperty.call(a, key)
      const hasB = Object.prototype.hasOwnProperty.call(b, key)
      if (!hasA || !hasB || !looseEqual(a[key], b[key])) return false
    }
    return true
  }
  return String(a) === String(b)
}

export function looseIndexOf(arr: readonly unknown[], val: unknown): number {
  return arr.findIndex((item) => looseEqual(item, val))
}

export function invokeArrayFns(fns: ((...args: unknown[]) => unknown)[], ...args: unknown[]): void {
  for (let i = 0; i < fns.length; i++) {
    const fn = fns[i]
    if (fn) fn(...args)
  }
}
