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
    // Capture only when the bridge key is present. The strip below
    // removes `registerValue` from attrs, so a second invocation of
    // this function (e.g. `onBeforeMount` after the synchronous setup
    // call) would otherwise overwrite the captured rv with `undefined`.
    // Vue's `setFullProps` re-populates attrs on every parent render,
    // so the `onBeforeUpdate` invocation correctly sees the key again
    // and re-captures.
    if ('registerValue' in rawAttrs) {
      capturedRegisterValue.value = rawAttrs['registerValue'] as RegisterValue | undefined
      delete rawAttrs['registerValue']
    }
    if ('value' in rawAttrs) delete rawAttrs['value']
  }
  // Capture+strip three times: synchronously in setup, then on
  // beforeMount, then on every beforeUpdate. The synchronous call is
  // load-bearing for SSR — Vue skips lifecycle hooks during
  // `renderToString`, so an `onBeforeMount`-only capture leaves
  // `capturedRegisterValue` at `undefined` and the directive's first
  // server-side template read would otherwise misrender. Vue's
  // `setupComponent` runs `initProps` (which populates
  // `instance.attrs.registerValue` from the parent's `:registerValue`
  // binding injected by `selectNodeTransform`) before `setup()` runs,
  // so the sync read sees the correct value on both server and client.
  // The `onBeforeMount` hook stays as defence in depth against any
  // re-population that could happen after setup (e.g. from a parent's
  // directive re-running) — idempotent, safe to duplicate. The
  // `onBeforeUpdate` hook handles parent re-renders, where Vue's
  // `setFullProps` runs again and re-puts the bridge keys.
  refreshAndStripBridgeAttrs()
  onBeforeMount(refreshAndStripBridgeAttrs)
  onBeforeUpdate(refreshAndStripBridgeAttrs)

  // Single post-mount hook does two jobs: (1) marks the rendered root
  // DOM element with `REGISTER_OWNER_MARKER` so the parent directive's
  // deferred warn check skips the "is a no-op" warn for components that
  // handle binding via an inner v-register, and (2) emits the
  // no-parent-RV diagnostic exactly once per instance if the captured
  // value is still `undefined` by mount time — by then the parent has
  // had its full lifecycle to bind, so still-undefined is conclusive
  // misuse. The computed factory below stays pure: reads don't trigger
  // diagnostics, so a consumer that conditionally consumes the value
  // (or reads it many times) gets exactly the right behaviour. SSR is
  // intentionally silent — `onMounted` doesn't fire on the server, and
  // the CSR hydration pass surfaces the diagnostic on the only surface
  // a developer can act on without double-counting through the Nuxt
  // `dev:ssr-logs` channel.
  onMounted(() => {
    const el = instance.vnode.el
    if (el !== null && el !== undefined && typeof el === 'object') {
      ;(el as unknown as { [k: symbol]: unknown })[REGISTER_OWNER_MARKER] = true
    }
    if (capturedRegisterValue.value === undefined) {
      warnNoParentRV(instance as unknown as object)
    }
  })

  return computed(() => capturedRegisterValue.value)
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
