/**
 * `useRegister()` — ambient bridge for component authors who wrap a
 * single field with custom presentation. The parent passes a
 * RegisterValue to the component:
 *
 *   <MyInput v-register="form.register('email', { persist: true })" />
 *
 * The select-transform's component branch turns that into two
 * AST-level prop injections — `:value="reg.innerRef.value"` and
 * `:registerValue="reg"`. `useRegister()` reads the latter from
 * `attrs` and returns a `ComputedRef<RegisterValue | undefined>` the
 * child applies to its inner native element:
 *
 *   <script setup lang="ts">
 *   import { useRegister } from '@chemical-x/forms'
 *   const register = useRegister()
 *   </script>
 *
 *   <template>
 *     <div class="wrapper">
 *       <input v-register="register" />
 *     </div>
 *   </template>
 *
 * Side effect: registers `getCurrentInstance()` in `registerOwners`
 * so the parent's directive (`vRegisterDynamic.created`) can detect
 * "this child handles binding internally" — and skip both the
 * unsupported-element warn and the listener attachment on the parent's
 * (non-form) root. Without the sentinel, the directive falls back to
 * text-input semantics on a div / span / custom-element root and reads
 * `el.value` off something with no useful `value` slot, which clobbers
 * the form on every keystroke.
 *
 * Three resolution modes:
 *
 *   1. Inside child setup, parent passed `registerValue` →
 *      `ComputedRef<RegisterValue>`.
 *   2. Inside child setup, NO parent `registerValue` (component
 *      rendered standalone) → `ComputedRef<undefined>` + one-shot
 *      dev-warn pointing at the call site.
 *   3. Outside any setup scope → `ComputedRef<undefined>` + one-shot
 *      dev-warn. NEVER throws (matches the recent useFormContext
 *      shift toward warn-and-degrade, PR #149).
 *
 * For compound components reaching multiple fields (or for any path-
 * addressed register call), use `useFormContext<Form>(key?)` and call
 * `ctx.register('a.b.c')` directly — that composable already handles
 * typed sub-paths, structured paths, getFieldState, etc. `useRegister`
 * stays a single-purpose ambient hook for the "wrap one field" case.
 */
import { computed, getCurrentInstance, useAttrs, type ComputedRef } from 'vue'
import { __DEV__ } from '../core/dev'
import { captureUserCallSite } from '../core/dev-stack-trace'
import type { RegisterValue } from '../types/types-api'

/**
 * WeakSet keyed by component instance. The directive's
 * `vRegisterDynamic.created` looks up `vnode.component` here to
 * detect "this child handles binding via useRegister, don't warn or
 * attach listeners on the parent's root".
 *
 * Entries auto-collect when the instance is GC'd; the directive does
 * NOT clear the entry on `beforeUnmount`. `<KeepAlive>` keeps the
 * same instance alive across deactivation/reactivation cycles, and
 * setup runs only once — clearing on unmount would re-fire the
 * unsupported-element warn on reactivation.
 *
 * Lives in production too, not just dev: the listener-attachment
 * decision matters in prod (the bubbled-write bug fires regardless of
 * NODE_ENV). Only the warn surface is dev-gated.
 */
export const registerOwners: WeakSet<object> = new WeakSet<object>()

const warnedNoParentRV: WeakSet<object> | null = __DEV__ ? new WeakSet<object>() : null
let warnedOutsideSetup = false

export function useRegister(): ComputedRef<RegisterValue | undefined> {
  const instance = getCurrentInstance()
  if (instance === null) {
    warnOutsideSetup()
    return computed(() => undefined)
  }

  registerOwners.add(instance as unknown as object)

  // `useAttrs()` returns the reactive setup-context proxy that tracks
  // reads — `instance.attrs` is the raw object, so reads off it
  // don't trigger reactive recomputation when the parent passes a
  // fresh registerValue. The proxy is what the parent's render-effect
  // ties into.
  const attrs = useAttrs()

  return computed(() => {
    const rv = attrs['registerValue'] as RegisterValue | undefined
    if (rv === undefined) {
      warnNoParentRV(instance as unknown as object)
    }
    return rv
  })
}

function warnOutsideSetup(): void {
  if (!__DEV__) return
  if (warnedOutsideSetup) return
  warnedOutsideSetup = true
  const frame = captureUserCallSite()
  console.warn(
    `[@chemical-x/forms] useRegister called outside of a component setup; returning ComputedRef<undefined>.` +
      (frame !== undefined ? ` ${frame}` : '')
  )
}

function warnNoParentRV(instance: object): void {
  if (!__DEV__ || warnedNoParentRV === null) return
  if (warnedNoParentRV.has(instance)) return
  warnedNoParentRV.add(instance)
  const frame = captureUserCallSite()
  console.warn(
    `[@chemical-x/forms] useRegister: no parent registerValue prop; returning ComputedRef<undefined>. ` +
      `Pass v-register on the parent: \`<YourComponent v-register="form.register('field')" />\`.` +
      (frame !== undefined ? ` ${frame}` : '')
  )
}
