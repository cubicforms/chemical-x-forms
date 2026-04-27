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
import {
  computed,
  getCurrentInstance,
  onBeforeUpdate,
  onMounted,
  shallowRef,
  type ComputedRef,
} from 'vue'
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

  // Capture the bridge `registerValue` from instance.attrs into a
  // local ref, then STRIP the bridge keys (`registerValue` + `value`)
  // from the attrs object. This prevents fallthrough to the rendered
  // root: without the strip, Vue would merge attrs onto the root's
  // vnode and the wrapper would render with stringified DOM attrs
  // (`<label registerValue="[object Object]">`). Class/style/aria/data
  // fallthrough is unaffected — only the bridge keys are removed, so
  // the consumer doesn't have to set `defineOptions({ inheritAttrs:
  // false })` and lose those legitimate fallthroughs.
  //
  // Vue's `setFullProps` repopulates attrs on every parent re-render
  // (it iterates rawProps and re-assigns each key into attrs). So the
  // capture+strip has to run on every update, not just at setup. The
  // `onBeforeUpdate` hook fires after `updateComponentPreRender`
  // (which calls setFullProps) and before `renderComponentRoot`
  // (which reads attrs for fallthrough), giving us a clean window.
  //
  // We don't read from `useAttrs()` proxy in the computed because
  // the proxy reads off the same target we're mutating — after the
  // strip, the proxy returns undefined for the bridge keys. The
  // captured ref is the source of truth instead, refreshed in lockstep
  // with attrs.
  //
  // `shallowRef` (not `ref`) — `ref` calls `reactive()` on object
  // values, which would wrap the parent's RV in a reactive proxy and
  // break referential equality. The directive hooks downstream rely
  // on the rv being the same reference the parent holds, so we keep
  // it raw.
  const capturedRegisterValue = shallowRef<RegisterValue | undefined>(undefined)

  const refreshAndStripBridgeAttrs = (): void => {
    const rawAttrs = instance.attrs as Record<string, unknown>
    capturedRegisterValue.value = rawAttrs['registerValue'] as RegisterValue | undefined
    if ('registerValue' in rawAttrs) delete rawAttrs['registerValue']
    if ('value' in rawAttrs) delete rawAttrs['value']
  }
  refreshAndStripBridgeAttrs()
  onBeforeUpdate(refreshAndStripBridgeAttrs)

  return computed(() => {
    const rv = capturedRegisterValue.value
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
