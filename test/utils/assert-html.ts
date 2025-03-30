type BinaryData = NodeJS.ArrayBufferView

/**
 * Asserts that `value` is a string, Buffer, typed array (binary data), or undefined.
 * Throws a TypeError otherwise.
 */
export function assertHTML(
  value: unknown
): asserts value is string | Buffer<ArrayBufferLike> | BinaryData | undefined {
  // 1) Check for string or undefined
  if (typeof value === 'string' || value === undefined) {
    return
  }

  // 2) Check for Node Buffer
  if (typeof Buffer !== 'undefined' && Buffer.isBuffer(value)) {
    return
  }

  // 3) Check if it's a typed array / ArrayBufferView (our "BinaryData" definition)
  if (
    typeof ArrayBuffer !== 'undefined' &&
    value instanceof Uint8Array
    // You might add more typed array checks if needed, e.g. Int16Array, etc.
  ) {
    return
  }

  // 4) Otherwise, throw
  throw new TypeError(
    `assertHTML: expected "string | Buffer | BinaryData | undefined", got "${typeof value}"`
  )
}
