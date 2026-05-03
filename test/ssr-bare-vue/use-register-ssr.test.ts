import { baseCompile } from '@vue/compiler-core'
import { renderToString } from '@vue/server-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as Vue from 'vue'
import { createSSRApp, defineComponent } from 'vue'
import { useForm, useRegister } from '../../src'
import { createAttaform } from '../../src/runtime/core/plugin'
import { selectNodeTransform } from '../../src/runtime/lib/core/transforms/select-transform'
import { vRegisterHintTransform } from '../../src/runtime/lib/core/transforms/v-register-hint-transform'
import { vRegisterPreambleTransform } from '../../src/runtime/lib/core/transforms/v-register-preamble-transform'
import { fakeSchema } from '../utils/fake-schema'

/**
 * SSR coverage for `useRegister()` — closes the gap left by
 * `use-register.test.ts`, which mounts via `createApp(...).mount(root)`
 * under jsdom (jsdom's prop-patch + lifecycle order matches CSR closely
 * enough that the SSR-specific failure mode never surfaced). Reproduces
 * the attaform regression where a child component calling
 * `useRegister()` warned `"no parent registerValue prop"` during
 * `renderToString` despite the parent template binding `v-register`.
 *
 * Root cause: Vue intentionally skips lifecycle hooks during SSR (the
 * directive lifecycle docstring at `directive.ts:10` is the formal
 * statement), so an `onBeforeMount`-only capture of
 * `instance.attrs.registerValue` leaves the captured value at
 * `undefined`. The first server-side template read of the returned
 * `ComputedRef<RegisterValue | undefined>` then fires the
 * no-parent-RV warn — a confusing diagnostic for the consumer who
 * passed `v-register` correctly. Fix: capture synchronously in setup
 * (when `initProps` has already populated `instance.attrs`), retain
 * `onBeforeMount` + `onBeforeUpdate` as defence-in-depth.
 */

type Form = { email: string; password: string; color: string }

function compileWithTransforms(template: string): (this: unknown, ctx: unknown) => unknown {
  // Full transform stack — `selectNodeTransform` is what injects
  // `:registerValue` on a `<MyChild v-register="...">` component vnode,
  // and that's the binding `useRegister` reads back via
  // `instance.attrs.registerValue`. Without it the parent's directive
  // never reaches the child as a prop.
  const result = baseCompile(template, {
    nodeTransforms: [selectNodeTransform, vRegisterPreambleTransform, vRegisterHintTransform],
    mode: 'function',
    prefixIdentifiers: true,
    hoistStatic: false,
  })
  const fn = new Function('Vue', `${result.code}\nreturn render`)
  return fn(Vue) as (this: unknown, ctx: unknown) => unknown
}

function makeChildWithUseRegister() {
  return defineComponent({
    name: 'RegisterChild',
    inheritAttrs: false,
    setup() {
      // Match the attaform `SpikeStyledInput` shape: child reads
      // the parent's binding via `useRegister` and re-binds onto an
      // inner native input. Reading `register.value` directly in
      // render mirrors the template auto-unwrap path
      // (`<input v-register="register">` desugars to a setup-state
      // access that calls `unref(register)`, which invokes the
      // computed factory). That's the read that fires the
      // no-parent-RV warn when `capturedRegisterValue` is `undefined`.
      const register = useRegister()
      return () => {
        const rv = register.value
        return Vue.h('label', null, [
          Vue.h('span', null, 'inner-label'),
          Vue.h('input', {
            type: 'text',
            'data-atta-rv-bound': rv !== undefined ? '1' : '0',
          }),
        ])
      }
    },
  })
}

function makeAppWithParentChildTemplate(parentTemplate: string) {
  const Child = makeChildWithUseRegister()
  const Parent = defineComponent({
    name: 'RegisterParent',
    components: { RegisterChild: Child },
    setup() {
      const form = useForm<Form>({
        schema: fakeSchema<Form>({ email: '', password: '', color: 'green' }),
        key: 'use-register-ssr',
      })
      return { form }
    },
    render: compileWithTransforms(parentTemplate),
  })
  const app = createSSRApp(Parent)
  app.use(createAttaform({ override: true /* SSR */ }))
  return app
}

describe('useRegister — SSR (renderToString)', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>
  let warnings: string[]

  beforeEach(() => {
    warnings = []
    warnSpy = vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
      warnings.push(args.map((a) => String(a)).join(' '))
    })
  })

  afterEach(() => {
    warnSpy.mockRestore()
  })

  it('does NOT emit the no-parent-RV warn during renderToString when the parent passes v-register', async () => {
    // The exact regression: attaform surfaced 5 of these warnings
    // per page render, one per child component using `useRegister()`,
    // each false-positive because `onBeforeMount` doesn't fire on the
    // server.
    const app = makeAppWithParentChildTemplate(
      `<div>
         <RegisterChild v-register="form.register('email')" />
       </div>`
    )
    const html = await renderToString(app)

    const noParentRvWarns = warnings.filter((w) =>
      w.includes('useRegister: no parent registerValue prop')
    )
    expect(noParentRvWarns).toEqual([])
    // Positive proof: the child saw the parent's RV during SSR render.
    expect(html).toContain('data-atta-rv-bound="1"')
  })

  it('strips bridge keys (`registerValue`, `value`) so the child root does not leak them as DOM attrs', async () => {
    // The strip is the second job of `refreshAndStripBridgeAttrs`. If
    // sync-stripping regresses, the child's `<label>` root would render
    // as `<label registerValue="[object Object]" value="">` server-side
    // — ugly DOM, hydration mismatch on every paint.
    const app = makeAppWithParentChildTemplate(
      `<div>
         <RegisterChild v-register="form.register('email')" />
       </div>`
    )
    const html = await renderToString(app)
    expect(html).not.toContain('registerValue')
    // The `value=""` attribute would only appear on the OUTER label
    // (the child's root) — the inner `<input>` has no value binding in
    // this fixture. So any `value=` in the rendered HTML is the leak.
    expect(html).not.toMatch(/<label[^>]*\svalue=/)
  })

  it('multiple children with v-register render without false-positive warns', async () => {
    // Attaform reproduced 5+ warns in one page; this asserts the
    // single-child case generalises so a regression on instance-keyed
    // dedup doesn't mask a real failure.
    const app = makeAppWithParentChildTemplate(
      `<div>
         <RegisterChild v-register="form.register('email')" />
         <RegisterChild v-register="form.register('password')" />
         <RegisterChild v-register="form.register('color')" />
       </div>`
    )
    await renderToString(app)

    const noParentRvWarns = warnings.filter((w) =>
      w.includes('useRegister: no parent registerValue prop')
    )
    expect(noParentRvWarns).toEqual([])
  })

  it('genuinely standalone child (no parent v-register) is SILENT during SSR — diagnostic deferred to onMounted (CSR-only)', async () => {
    // Design choice: the no-parent-RV warn fires once at `onMounted`,
    // which Vue intentionally skips during `renderToString`. Pinning
    // this so SSR never double-counts a diagnostic the CSR hydration
    // pass will surface anyway. The CSR-side warn is covered by
    // `test/composables/use-register.test.ts` ("with NO parent
    // registerValue → returns ComputedRef<undefined> + one-shot warn").
    const Child = makeChildWithUseRegister()
    const Parent = defineComponent({
      components: { RegisterChild: Child },
      setup() {
        useForm<Form>({
          schema: fakeSchema<Form>({ email: '', password: '', color: '' }),
          key: 'use-register-ssr-standalone',
        })
        return () => Vue.h(Child) // no v-register on the child
      },
    })
    const app = createSSRApp(Parent)
    app.use(createAttaform({ override: true }))
    await renderToString(app)

    const noParentRvWarns = warnings.filter((w) =>
      w.includes('useRegister: no parent registerValue prop')
    )
    expect(noParentRvWarns).toEqual([])
  })
})
