/**
 * Type-level assertion helpers. `assertNever` is the load-bearing one — use
 * it as the default arm of discriminated-union switches to force the compiler
 * to verify exhaustiveness.
 */

export function assertNever(x: never, message?: string): never {
  throw new Error(message ?? `Unexpected value reached assertNever: ${JSON.stringify(x)}`)
}
