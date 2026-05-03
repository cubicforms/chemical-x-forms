/**
 * Deterministic non-cryptographic string hash. Used to compact long
 * structural-fingerprint strings into bounded-size storage-key tokens
 * (`decant:formKey:<hash>` instead of
 * `decant:formKey:object{"a":string,"b":number,...}`).
 *
 * Output: 11-char base36 string with leading zeros padded —
 * stable size regardless of input. ~53 bits of entropy (base of the
 * cyrb53 algorithm); collision space is 2^53. For the storage-key
 * disambiguation use case (a single app's worth of form schemas, all
 * fingerprinted at runtime) this is overkill.
 *
 * Properties:
 *   - **Deterministic**: same input always produces the same output.
 *   - **Sync, no allocations beyond the result**: hot-path-friendly;
 *     no `crypto.subtle` (async) or `node:crypto` (server-only).
 *   - **Browser + Node compatible**: only `Math.imul` and `String`
 *     methods.
 *
 * NOT suitable for security-sensitive uses (auth tokens, integrity
 * checks). cyrb53 is non-cryptographic by design.
 *
 * Reference: bryc's collection of small JS hash functions
 * (https://github.com/bryc/code/blob/master/jshash/PRNGs.md).
 */
export function hashStableString(input: string, seed = 0): string {
  let h1 = 0xdeadbeef ^ seed
  let h2 = 0x41c6ce57 ^ seed
  for (let i = 0; i < input.length; i++) {
    const ch = input.charCodeAt(i)
    h1 = Math.imul(h1 ^ ch, 2654435761)
    h2 = Math.imul(h2 ^ ch, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  // Combine the two 32-bit halves into a 53-bit value, base36-encode.
  // `padStart(11, '0')` keeps the output a fixed length so storage
  // keys are visually aligned and easy to grep.
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36).padStart(11, '0')
}
