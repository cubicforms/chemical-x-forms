import { afterEach, beforeEach } from 'vitest'
import { resetInsecureContextWarnDedup } from '../src/runtime/core/insecure-context-warn'

/**
 * Global vitest setup. Loaded by `setupFiles` in vitest.config.ts.
 *
 * Tasks:
 *  1. Stub `window.isSecureContext = true` so multi-tab sync AND
 *     built-in persistence storage adapters (`'local'` / `'session'`)
 *     activate during tests. jsdom defaults this to `false`; without
 *     the stub, every persistence-dependent suite would noop and
 *     hydration tests would fail.
 *  2. Reset the one-shot dev-warning dedup after each test so probes
 *     that assert "warning fires exactly once" don't share state with
 *     prior tests. The `warnOnceInsecureContext` registry is
 *     module-scoped; without per-test reset, a probe expecting the
 *     warning would see it suppressed by an earlier mount.
 *
 * Tests that need to assert the OPPOSITE (e.g. `isSecureContext ===
 * false` to verify the noop path) override the stub locally via
 * `Object.defineProperty(window, 'isSecureContext', { value: false })`
 * and restore in their own `afterEach`.
 */

if (typeof window !== 'undefined') {
  try {
    Object.defineProperty(window, 'isSecureContext', {
      configurable: true,
      writable: true,
      value: true,
    })
  } catch {
    // jsdom may already have defined it as non-configurable. Best-
    // effort — tests that depend on the truthy value can re-stub
    // locally.
  }
}

afterEach(() => {
  resetInsecureContextWarnDedup()
})

// Reset `window.location` to the jsdom default before each test so
// stepper history tests can't leak `?step=<key>` into the next test's
// initial-seed read. The default `http://localhost:3000/` matches
// jsdom's origin so `history.replaceState` won't trip a SecurityError.
beforeEach(() => {
  if (typeof window !== 'undefined') {
    try {
      window.history.replaceState(null, '', 'http://localhost:3000/')
    } catch {
      // jsdom origin policy may reject in unusual configs; the local
      // beforeEach in stepper tests handles their cases explicitly.
    }
  }
})
