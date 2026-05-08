/**
 * Re-bind a parent's `v-register` onto an inner native element. Use
 * inside a component that wraps a single form field whose root is
 * NOT the input itself (e.g. a labelled-row that renders `<label>`
 * around the input).
 *
 * ```vue
 * <!-- Parent -->
 * <MyInput v-register="form.register('email')" />
 *
 * <!-- MyInput.vue -->
 * <script setup lang="ts">
 *   import { useRegister } from 'attaform'
 *   const rv = useRegister()
 *   // rv.path / rv.segments / rv.formKey / rv.formInstanceId / rv.innerRef
 *   // are all reachable directly — no `.value` unwrap.
 * </script>
 *
 * <template>
 *   <label class="field">
 *     <span>Email</span>
 *     <input v-register="rv" />
 *   </label>
 * </template>
 * ```
 *
 * Returns a hybrid Proxy: it answers `__v_isRef` / `.value` like a
 * Vue `Ref<RegisterValue | undefined>` (so templates auto-unwrap
 * correctly and `v-register="rv"` feeds the underlying RV to the
 * directive — preserving the directive's path-migration diff across
 * renders), AND every other property read pierces to the captured
 * RV's field (so `rv.path` works directly in script setup). Reads
 * inside reactive scopes (`computed` / `watchEffect`) track the
 * underlying `shallowRef`, so `rv.path` re-runs when the parent
 * rebinds to a different path.
 *
 * Unbound state: when the parent didn't pass `v-register`, every
 * piercing read returns `undefined` at runtime, and the return type
 * surfaces this honestly as `UseRegisterReturn<V> | undefined`.
 * Consumers defend with optional chaining (`rv?.formKey`,
 * `rv?.segments`); the directive accepts `undefined` peacefully (its
 * binding value type is already `RegisterValue<V> | undefined`), so
 * `v-register="rv"` works whether or not a parent has bound. The
 * composable's `onMounted` warn fires once per instance to surface
 * the misuse case at runtime.
 *
 * Diagnostic: in dev mode, a single `console.warn` fires per instance
 * at `onMounted` if the captured value is still `undefined` — by then
 * the parent has had its full mount lifecycle to bind, so a missing
 * binding is conclusive misuse. The warn does NOT fire on every read
 * of the proxy, and is intentionally silent under SSR
 * (`renderToString` skips `onMounted`); the CSR hydration pass
 * surfaces the same diagnostic without double-counting through Nuxt's
 * `dev:ssr-logs` channel.
 *
 * When the wrapper's root IS the input itself, Vue's attribute
 * fallthrough handles the binding and `useRegister` is unnecessary.
 * For wrappers that bind multiple fields (compound forms), use
 * `injectForm<Form>(key?)` and call `ctx.register(...)` directly.
 */
import {
  getCurrentInstance,
  onBeforeMount,
  onBeforeUpdate,
  onMounted,
  shallowRef,
  type Ref,
} from 'vue'
import { __DEV__ } from '../core/dev'
import { captureUserCallSite } from '../core/dev-stack-trace'
import { ensureAttaformInstalled } from '../core/plugin'
import type { RegisterValue } from '../types/types-api'

/**
 * Return type of `useRegister()`. Hybrid of `RegisterValue<V>` (so
 * `rv.path` / `rv.segments` / `rv.formKey` etc. work directly in
 * script setup) and `Ref<RegisterValue<V> | undefined>` (so Vue's
 * template auto-unwrap surfaces the underlying RV to `v-register`
 * and the directive's path-migration diff sees the real RV across
 * renders).
 *
 * The two surfaces don't clash at the type level: `RegisterValue`
 * doesn't carry a `value` field, and `Ref<T>`'s `value: T` becomes
 * the hybrid's only `.value`. Older code that read `rv.value?.path`
 * keeps working; new code can write `rv.path` directly.
 */
export type UseRegisterReturn<V = unknown> = RegisterValue<V> & Ref<RegisterValue<V> | undefined>

/**
 * Marker on the rendered root DOM element. Set by `useRegister`'s
 * `onMounted` hook; read by the directive's deferred warn check to
 * skip the "is a no-op" warn for components that handle binding via
 * an inner v-register.
 *
 * `Symbol.for(...)` so the marker round-trips across duplicate copies
 * of attaform — see `assignKey` in core/directive.ts for the same
 * reasoning. `useRegister` and the directive are typically loaded
 * from the same module copy, but a consumer importing from
 * `attaform/zod` (Vite-optimized bundle) and the Nuxt
 * plugin's relative-path import (live ESM) can land on different
 * copies; a global symbol means the marker check still works.
 */
export const REGISTER_OWNER_MARKER: unique symbol = Symbol.for('attaform:register-owner-marker')

const warnedNoParentRV: WeakSet<object> | null = __DEV__ ? new WeakSet<object>() : null
let warnedOutsideSetup = false

/**
 * Build the hybrid Proxy. The `__v_isRef` field makes Vue's `unref`
 * / template auto-unwrap treat the proxy as a `Ref<RegisterValue |
 * undefined>` and surface `value` (the captured RV) to consumers
 * that go through that path — including `v-register="rv"` in a
 * template, which is what feeds the directive its `binding.value`.
 *
 * Every other property read pierces to `capturedRegisterValue.value`,
 * so `rv.path` / `rv.segments` / `rv.formKey` work in script setup.
 *
 * Methods don't need `this` rebinding: every method on a real
 * `RegisterValue` is an arrow-function closure built in
 * `register-api.ts`, capturing `state` / `segments` lexically. So
 * `rv.registerElement(el)` works through the proxy without a
 * `bind` pass. The `has` / `ownKeys` traps cooperate with
 * `'innerRef' in rv` / `Object.keys(rv)` — including the
 * `isRegisterValue` type guard the directive uses.
 */
function makeRegisterValueProxy<V>(
  capturedRegisterValue: Ref<RegisterValue<V> | undefined>
): UseRegisterReturn<V> {
  return new Proxy({} as object, {
    get(_target, prop) {
      if (prop === '__v_isRef') return true
      if (prop === 'value') return capturedRegisterValue.value
      const v = capturedRegisterValue.value
      if (v === undefined) return undefined
      return Reflect.get(v as object, prop)
    },
    has(_target, prop) {
      if (prop === '__v_isRef' || prop === 'value') return true
      const v = capturedRegisterValue.value
      if (v === undefined) return false
      return Reflect.has(v as object, prop)
    },
    ownKeys(_target) {
      const v = capturedRegisterValue.value
      if (v === undefined) return []
      return Reflect.ownKeys(v as object)
    },
    getOwnPropertyDescriptor(_target, prop) {
      const v = capturedRegisterValue.value
      if (v === undefined) return undefined
      const desc = Reflect.getOwnPropertyDescriptor(v as object, prop)
      if (desc !== undefined) {
        // Proxy invariant: any property reported via ownKeys must be
        // configurable on the target OR match a non-configurable
        // descriptor on the target. Empty target has no own props,
        // so we MUST return descriptors with `configurable: true`.
        desc.configurable = true
      }
      return desc
    },
  }) as unknown as UseRegisterReturn<V>
}

export function useRegister<V = unknown>(): UseRegisterReturn<V> | undefined {
  const instance = getCurrentInstance()
  if (instance === null) {
    warnOutsideSetup()
    return makeRegisterValueProxy<V>(shallowRef<RegisterValue<V> | undefined>(undefined))
  }

  // Lazy-install: even though `useRegister` doesn't read the registry
  // directly, it's a public setup-context entry point and its template
  // typically renders `<input v-register="rv" />` — the directive must
  // be registered on the app at render time. Without auto-install, a
  // wrapper component used in isolation (no `useForm` ancestor, no
  // `createAttaform()`) hits Vue's "Failed to resolve directive"
  // warning. Idempotent — explicit installs win when they ran first.
  ensureAttaformInstalled(instance.appContext.app)

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
  // We don't read from `useAttrs()` proxy because the proxy reads
  // off the same target we're mutating — after the strip, the proxy
  // returns undefined for the bridge keys. The captured ref is the
  // source of truth instead, refreshed in lockstep with attrs.
  //
  // `shallowRef` (not `ref`) — `ref` calls `reactive()` on object
  // values, which would wrap the parent's RV in a reactive proxy and
  // break referential equality. The directive hooks downstream rely
  // on the rv being the same reference the parent holds, so we keep
  // it raw.
  const capturedRegisterValue = shallowRef<RegisterValue<V> | undefined>(undefined)

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
      capturedRegisterValue.value = rawAttrs['registerValue'] as RegisterValue<V> | undefined
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
  // misuse. The proxy stays pure: reads don't trigger diagnostics, so
  // a consumer that conditionally consumes the value (or reads it many
  // times) gets exactly the right behaviour. SSR is intentionally
  // silent — `onMounted` doesn't fire on the server, and the CSR
  // hydration pass surfaces the diagnostic on the only surface a
  // developer can act on without double-counting through the Nuxt
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

  return makeRegisterValueProxy(capturedRegisterValue)
}

function warnOutsideSetup(): void {
  if (!__DEV__) return
  if (warnedOutsideSetup) return
  warnedOutsideSetup = true
  const frame = captureUserCallSite()
  console.warn(
    `[attaform] useRegister() called outside a component setup; returning an unbound RegisterValue proxy. ` +
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
    `[attaform] useRegister: no parent registerValue prop; RegisterValue fields will read as undefined. ` +
      `Pass v-register on the parent: \`<YourComponent v-register="form.register('field')" />\`.` +
      (frame !== undefined ? ` ${frame}` : '')
  )
}
