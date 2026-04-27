import { computed, type ComputedRef } from 'vue'
import type { RegisterValue } from '../types/types-api'

/**
 * STUB. Real implementation lands with the directive sentinel +
 * select-transform idempotency in the green commit. This stub is the
 * minimum surface needed for the red-test commit to compile cleanly:
 * tests fail on assertions, not on imports.
 */
export function useRegister(): ComputedRef<RegisterValue | undefined> {
  return computed(() => undefined)
}
