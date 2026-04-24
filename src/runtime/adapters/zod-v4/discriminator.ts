import type { z } from 'zod'
import { getDiscriminatedOptions, kindOf, unwrapInner, unwrapPipe } from './introspect'

/**
 * Peel optional/nullable/default/pipe wrappers off a schema, returning the
 * innermost discriminated union — or `undefined` if none is found. Used by
 * the initial-state walker so that e.g.
 *
 *   z.discriminatedUnion('status', [...]).optional().default({...})
 *
 * still reaches the DU for first-option-fallback construction.
 */
export function unwrapToDiscriminatedUnion(schema: z.ZodType): z.ZodType | undefined {
  let current: z.ZodType = schema
  // Bounded descent — any well-formed Zod schema tree terminates quickly.
  for (let i = 0; i < 64; i++) {
    const kind = kindOf(current)
    if (kind === 'discriminated-union') return current
    let next: z.ZodType | undefined
    if (kind === 'optional' || kind === 'nullable' || kind === 'default' || kind === 'readonly') {
      next = unwrapInner(current)
    } else if (kind === 'pipe') {
      next = unwrapPipe(current)
    }
    if (next === undefined) return undefined
    current = next
  }
  return undefined
}

/**
 * First option of a discriminated union — used as the default when no
 * discriminator value is known at initial-state construction time.
 */
export function getDiscriminatedUnionFirstOption(schema: z.ZodType): z.ZodObject | undefined {
  const options = getDiscriminatedOptions(schema)
  return options[0]
}
