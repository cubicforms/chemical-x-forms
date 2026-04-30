import type { AbstractSchema } from '../types/types-api'
import type { GenericForm } from '../types/types-core'

/**
 * Best-effort top-level field hint for diagnostic error messages.
 * Walks the schema's slim default at the root and returns its keys
 * — sufficient for object-rooted schemas (the overwhelming majority).
 * Non-object roots return `[]`; the message degrades by omitting the
 * fields clause rather than throwing.
 *
 * No adapter contract change: every adapter already implements
 * `getDefaultAtPath([])` for the structural-fill pipeline, so this
 * helper is free.
 */
export function extractSchemaFields(
  schema: AbstractSchema<GenericForm, GenericForm>
): readonly string[] {
  try {
    const root = schema.getDefaultAtPath([])
    if (root !== null && typeof root === 'object' && !Array.isArray(root)) {
      return Object.keys(root as object)
    }
  } catch {
    // Adapter threw — degrade gracefully so the diagnostic still fires.
  }
  return []
}
