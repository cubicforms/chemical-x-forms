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

/**
 * Sleep for `ms` real-time milliseconds. Thin wrapper over
 * `setTimeout` for ergonomic use inside `waitUntil`'s polling loop
 * and for the rare test that legitimately needs a wall-clock pause.
 *
 * Prefer `waitUntil(predicate)` over `wait(N)` followed by an
 * assertion — a fixed-time pump can blow past its budget on a
 * contended CI runner (dynamic-imported adapters, debounced writes,
 * async refinement chains), producing flakes that pass locally and
 * fail intermittently on CI.
 */
export async function wait(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Poll `predicate` until it returns a non-null / non-undefined value
 * or the timeout elapses. Returns the resolved value, or `null` if
 * the deadline passed.
 *
 * Use this for any wait-then-assert pattern that depends on async
 * I/O — debounced storage writes, dynamic-imported persistence
 * adapters, async Zod refinements. The classic alternative
 * (`await wait(40); expect(...)`) silently flakes when the chain
 * exceeds the fixed budget under CI contention.
 *
 * The default 1000 ms timeout covers in-process work, dynamic-imported
 * adapters, and short async-refinement chains. Raise it for tests
 * that wait on a debounce window plus an external mock with its own
 * latency budget.
 */
export async function waitUntil<T>(
  predicate: () => T | null | undefined,
  timeoutMs = 1000,
  intervalMs = 5
): Promise<T | null> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const v = predicate()
    if (v !== null && v !== undefined) return v
    if (Date.now() >= deadline) return null
    await wait(intervalMs)
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
