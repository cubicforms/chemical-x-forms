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
 * Side effect: stamps a unique-symbol marker on the rendered root
 * DOM element via `onMounted`. The parent's directive's deferred
 * warn check (in `vRegisterDynamic.created` → nextTick) reads the
 * marker to suppress the "is a no-op" warn — without it, components
 * deeply nested in a parent's render tree would always warn (the
 * directive can't reach the child's instance via `binding.instance`,
 * since that's the page/parent component, whose `subTree` is the
 * outer element tree, not the child component vnode directly).
 *
 * The marker on `el` is enough because the warn-suppression decision
 * runs after `onMounted` (Vue's nextTick fires after post-render
 * effects), by which point the marker is set if useRegister was
 * called during the child's setup.
 *
 * The actual bug-fix (don't clobber form state via bubbled events
 * reading `el.value` off a non-form root) is handled in the
 * directive's listener bodies — they bail when the rendered root
 * isn't a supported tag and the assigner is the default. See
 * `directive.ts > shouldBailListener` for that contract.
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
import { computed, getCurrentInstance, onMounted, useAttrs, type ComputedRef } from 'vue'
import { __DEV__ } from '../core/dev'
import { captureUserCallSite } from '../core/dev-stack-trace'
import type { RegisterValue } from '../types/types-api'

/**
 * Marker on the rendered root DOM element. Set by `useRegister`'s
 * `onMounted` hook; read by the directive's deferred warn check to
 * skip the "is a no-op" warn for components that handle binding via
 * an inner v-register.
 */
export const REGISTER_OWNER_MARKER: unique symbol = Symbol('cxUseRegisterChild')

const warnedNoParentRV: WeakSet<object> | null = __DEV__ ? new WeakSet<object>() : null
let warnedOutsideSetup = false

export function useRegister(): ComputedRef<RegisterValue | undefined> {
  const instance = getCurrentInstance()
  if (instance === null) {
    warnOutsideSetup()
    return computed(() => undefined)
  }

  // Mark the rendered root DOM element after mount. `instance.vnode.el`
  // is set during the patch of the child's subtree; reading it here
  // (post-mount) gets the actual rendered element. The marker is what
  // the parent's directive's deferred warn check reads.
  onMounted(() => {
    const el = instance.vnode.el
    if (el !== null && el !== undefined && typeof el === 'object') {
      ;(el as unknown as { [k: symbol]: unknown })[REGISTER_OWNER_MARKER] = true
    }
  })

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
