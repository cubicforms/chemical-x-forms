/**
 * `useRegister()` — for component authors wrapping a single form
 * field. Read the parent's `v-register` binding inside the component
 * and re-bind it onto an inner native element so the wrapper still
 * participates in the form lifecycle.
 *
 * Usage in the parent:
 *
 * ```vue
 * <MyInput v-register="form.register('email')" />
 * ```
 *
 * Inside the wrapper component:
 *
 * ```vue
 * <script setup lang="ts">
 * import { useRegister } from '@chemical-x/forms'
 * const register = useRegister()
 * </script>
 *
 * <template>
 *   <div class="wrapper">
 *     <input v-register="register" />
 *   </div>
 * </template>
 * ```
 *
 * Returns a `ComputedRef<RegisterValue | undefined>`. The value is
 * `undefined` when the component is rendered without a parent
 * `v-register` (a dev-mode warning surfaces). Always pass the result
 * to `v-register` directly; the directive handles the undefined case
 * gracefully.
 *
 * For wrappers that need to bind multiple fields (compound forms),
 * use `useFormContext<Form>(key?)` instead and call `ctx.register(...)`
 * directly.
 */
import {
  computed,
  getCurrentInstance,
  onBeforeMount,
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
  // Defer the initial capture to `onBeforeMount` rather than running it
  // synchronously in setup. Setup-time reads of `instance.attrs` race
  // Vue's prop-patch lifecycle: under SSR (and on first CSR hydration
  // for some patterns) the parent's `:registerValue` binding hasn't
  // been propagated to attrs by the time setup runs, and the captured
  // value lands as `undefined` — fingering the consumer with the
  // "no parent registerValue prop" warn even though the parent passed
  // v-register correctly. By onBeforeMount the prop has been wired,
  // and the returned computed is read lazily by templates after
  // mount-pass setup completes. Mirrors the radio directive's
  // `created` → `mounted` fix (commit b0720c4).
  onBeforeMount(refreshAndStripBridgeAttrs)
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
    `[@chemical-x/forms] useRegister() called outside a component setup; returning ComputedRef<undefined>. ` +
      `Fix: call it inside <script setup> or a setup() function — not from an event handler ` +
      `or async callback.` +
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
