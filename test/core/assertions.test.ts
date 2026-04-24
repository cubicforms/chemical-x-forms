import { describe, expect, it } from 'vitest'
import { assertNever } from '../../src/runtime/core/assertions'

describe('assertNever', () => {
  it('throws with a stringified representation of the value by default', () => {
    // Intentionally violate the `never` contract to test the runtime guard.
    expect(() => assertNever('unexpected' as never)).toThrow(/unexpected/)
  })

  it('accepts a custom message', () => {
    expect(() => assertNever('x' as never, 'custom message')).toThrow('custom message')
  })

  it('enforces exhaustiveness at the type level', () => {
    type Tag = 'a' | 'b' | 'c'
    function handle(tag: Tag): string {
      switch (tag) {
        case 'a':
          return 'A'
        case 'b':
          return 'B'
        case 'c':
          return 'C'
        default:
          return assertNever(tag)
      }
    }
    expect(handle('a')).toBe('A')
    expect(handle('b')).toBe('B')
    expect(handle('c')).toBe('C')
  })
})
