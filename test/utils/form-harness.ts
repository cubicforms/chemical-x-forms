/**
 * Shared mount harness for tests that exercise the runtime form
 * pipeline (directive, store, persistence). Centralises the
 * `createApp + useForm + plugin install + mount` boilerplate so
 * test files don't reimplement it.
 *
 * Parameterised on `useFormFn` so v3 and v4 callers can pass their
 * own typed import without the harness coupling to either zod major.
 */
import { createApp, defineComponent, h, nextTick, type App } from 'vue'
import { createAttaform } from '../../src/runtime/core/plugin'

/**
 * Drain microtasks + Vue's queue four times. Four is empirical —
 * enough for the directive's optimistic-connect IIFE, the field's
 * validate-on-init effect, and any `nextTick`-deferred dev warns to
 * settle. Three was occasionally too few; five was wasteful.
 */
export async function flush(): Promise<void> {
  for (let i = 0; i < 4; i++) {
    await Promise.resolve()
    await nextTick()
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyUseForm = (opts: any) => any

/**
 * Returns a thunk that mounts a fresh Vue app with `useFormFn(opts)`
 * called inside the root component's setup. Each invocation produces
 * an isolated app + form key (random suffix) so tests in the same
 * file don't collide.
 *
 * Defaults `strict: false` because the property tests focus
 * on write-gate semantics, not refinement-time validation. Override
 * via `options` for tests that need strict mode.
 */
export function makeMounter<S>(
  useFormFn: AnyUseForm,
  schema: S,
  options: Record<string, unknown> = {}
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): () => { api: any; app: App } {
  return function mount() {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const captured: { api?: any } = {}
    const App = defineComponent({
      setup() {
        captured.api = useFormFn({
          schema,
          key: `slim-${Math.random().toString(36).slice(2)}`,
          strict: false,
          ...options,
        })
        return () => h('div')
      },
    })
    const app = createApp(App).use(createAttaform())
    const root = document.createElement('div')
    document.body.appendChild(root)
    app.mount(root)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return { api: captured.api as any, app }
  }
}
