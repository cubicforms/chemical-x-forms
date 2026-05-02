import { computed, ref, type Ref } from 'vue'
import type {
  RegisterOptions,
  RegisterTransform,
  RegisterValue,
  WriteMeta,
} from '../types/types-api'
import type { GenericForm } from '../types/types-core'
import type { FormStore } from './create-form-store'
import { captureUserCallSite } from './dev-stack-trace'
import { AnonPersistError } from './errors'
import { extractSchemaFields } from './extract-schema-fields'
import { canonicalizePath, type Path, type PathKey } from './paths'
import { PERSISTENCE_MODULE_KEY } from './persistence'
import { buildCoerceFn, buildElementCoerceFn } from './schema-coerce'

// Module-level frozen empty array — re-used as the transforms default
// across every register() call that doesn't opt in. Avoids a per-call
// allocation on the 99% of fields that don't declare normalization,
// while keeping the directive's `for (const t of rv.transforms)`
// iteration uniform (no null-check needed).
const EMPTY_TRANSFORMS: ReadonlyArray<RegisterTransform> = Object.freeze([])

/**
 * Register API factory. Given a FormStore, returns a `register(path)` that
 * produces a RegisterValue suitable for the v-register directive.
 *
 * Design points:
 *
 * - Focus/blur listeners are attached per-element-registration and stored
 *   on the element itself via a symbol, then removed on deregistration.
 *   No registration-time helper cache.
 * - `innerRef` reads `form.value` directly via `getValueAtPath`; there's
 *   no separate raw-vs-form tracking. The synchronous diff-apply writer
 *   keeps the two values in lock-step.
 * - Cross-form isolation is by construction: every call to `buildRegister`
 *   closes over a FormStore<F> unique to one form.
 */

const INTERACTIVE_TAG_NAMES = new Set(['INPUT', 'SELECT', 'TEXTAREA'])

// `Symbol.for(...)` so duplicate copies of chemical-x agree on the
// element-property key for stashed focus/blur handlers — see
// `assignKey` in core/directive.ts for the same reasoning.
const cxListenersSymbol: unique symbol = Symbol.for('chemical-x-forms:focus-listeners')

type ElementWithListeners = HTMLElement & {
  [cxListenersSymbol]?: {
    handleFocus: (event: FocusEvent) => void
    handleBlur: (event: FocusEvent) => void
  }
}

function attachFocusListeners<F extends GenericForm>(
  state: FormStore<F>,
  segments: Path,
  element: HTMLElement
): void {
  const target = element as ElementWithListeners
  if (target[cxListenersSymbol] !== undefined) return
  const handleFocus = (): void => state.markFocused(segments, true)
  const handleBlur = (): void => state.markFocused(segments, false)
  element.addEventListener('focus', handleFocus)
  element.addEventListener('blur', handleBlur)
  target[cxListenersSymbol] = { handleFocus, handleBlur }
}

function detachFocusListeners(element: HTMLElement): void {
  const target = element as ElementWithListeners
  const listeners = target[cxListenersSymbol]
  if (listeners === undefined) return
  element.removeEventListener('focus', listeners.handleFocus)
  element.removeEventListener('blur', listeners.handleBlur)
  delete target[cxListenersSymbol]
}

export function buildRegister<F extends GenericForm>(state: FormStore<F>, formInstanceId: string) {
  // Path-keyed cache of typed-form refs. Lifted out of the per-call
  // closure so multiple `register(path)` invocations for the same
  // path — e.g. two `<input v-register>` bindings to `'numberText'`,
  // or repeated calls inside a render function — share the same ref.
  // Without sharing, the directive's keystroke listener writes to
  // RegisterValue A's `lastTypedForm` while RegisterValue B's
  // `displayValue` reads its own (always-null) ref, and Vue patches
  // B's DOM to the canonical `String(storage)` mid-typing — yanking
  // the user's caret on a sibling input.
  const lastTypedFormByPath = new Map<PathKey, Ref<string | null>>()

  return function register(
    pathInput: string | Path,
    options?: RegisterOptions
  ): RegisterValue<unknown> {
    const { segments, key: pathKey } = canonicalizePath(pathInput)

    const innerRef = computed(() => state.getValueAtPath(segments)) as Readonly<Ref<unknown>>

    // The user's currently-typed string form for numeric fields,
    // populated by the directive on every keystroke and cleared on
    // blur. Lets `displayValue` surface the typed form (e.g. `'1e2'`)
    // mid-typing instead of the canonical `String(storage)` (`'100'`),
    // which Vue would otherwise patch into the DOM and yank the
    // cursor away from the user's caret. After blur the typed form
    // is cleared so `displayValue` falls back to the honest canonical
    // form — what the user sees matches what's in storage. Shared
    // across all RegisterValues for the same path so paired inputs
    // stay in sync mid-typing.
    let lastTypedForm = lastTypedFormByPath.get(pathKey)
    if (lastTypedForm === undefined) {
      lastTypedForm = ref<string | null>(null)
      lastTypedFormByPath.set(pathKey, lastTypedForm)
    }

    // String-form view of the path's storage value, with `''` returned
    // for blank membership and for null/undefined storage.
    // The blank branch is what lets a user clear a numeric
    // field: even though storage holds 0, the `:value` binding reads
    // displayValue and writes `''` to el.value, so Vue's next render
    // doesn't undo the user's clear.
    //
    // Typed-form preference (numeric only): when `lastTypedForm` is
    // set AND `parseFloat(lastTypedForm)` equals the current numeric
    // storage, return the typed form. Storage commits live (typing
    // `1e2` writes 100 to storage immediately), but the DOM keeps
    // showing `1e2` until blur — at which point the directive clears
    // `lastTypedForm` and Vue patches the DOM to `String(100)` =
    // `'100'`. The check naturally invalidates on programmatic
    // setValue / hydration / reset (different storage value → fall
    // back to `String(...)`).
    const displayValue = computed(() => {
      if (state.blankPaths.has(pathKey)) return ''
      const raw = state.getValueAtPath(segments)
      if (raw === null || raw === undefined) return ''
      const typed = lastTypedForm.value
      if (typed !== null && typeof raw === 'number' && parseFloat(typed) === raw) {
        return typed
      }
      return String(raw)
    }) as Readonly<Ref<string>>

    // Slim default precomputed at register-time. The schema is fixed
    // for the form's lifetime, so this is safe to cache; downstream
    // `markBlank` calls reuse it without re-walking the
    // schema tree.
    const slimDefault = state.schema.getDefaultAtPath(segments)

    const persist = options?.persist === true
    const acknowledgeSensitive = options?.acknowledgeSensitive === true
    const transforms = options?.transforms ?? EMPTY_TRANSFORMS

    // Schema-driven coerce closure. Captures the path's slim accept set
    // and the form's resolved coercion index so the per-event hot path
    // is a single function call. Identity when the form has coercion
    // disabled (`useForm({ coerce: false })`) or the path admits no
    // coercion target. Cached on RegisterValue so the directive doesn't
    // re-walk the schema per keystroke.
    const coerce = buildCoerceFn(
      state.schema as Parameters<typeof buildCoerceFn>[0],
      segments,
      state.coerceIndex
    )
    const coerceElement = buildElementCoerceFn(
      state.schema as Parameters<typeof buildElementCoerceFn>[0],
      segments,
      state.coerceIndex
    )

    // Eager throw: opt-in declared but the form has no persistence wired.
    // Without the throw the directive silently records the opt-in, no
    // writes ever land, and the dev concludes "persistence is broken"
    // when the actual issue is a missing `persist:` option on useForm().
    // Throws in dev and prod — contradictions are bugs, not rate-limited
    // drift. The error body carries the schema's top-level fields and a
    // captured call-site frame so the offending form is identifiable
    // from the message alone (script-setup stacks collapse misleadingly).
    //
    // Skipped during SSR: `wirePersistence` is intentionally not run on
    // the server (persistence is a client-only concern), so
    // `state.modules.has(PERSISTENCE_MODULE_KEY)` is always false during
    // SSR — even for forms that DID configure `persist:`. Without this
    // gate the throw would falsely fire on every server-rendered
    // `register({ persist: true })`. The client-side hydration pass
    // re-checks against a freshly-wired module and throws correctly if
    // the misuse is real.
    if (persist && !state.isSSR && !state.modules.has(PERSISTENCE_MODULE_KEY)) {
      throw new AnonPersistError({
        cause: 'register-without-config',
        schemaFields: extractSchemaFields(state.schema),
        callSite: captureUserCallSite(),
      })
    }

    return {
      innerRef,
      displayValue,
      lastTypedForm,

      markBlank: (): boolean => {
        // Mirror the binding's persist meta so the blank
        // mark rides the same persistence channel as user-typed
        // writes — without this, refresh after a clear silently loses
        // the empty state. The slim default keeps storage well-typed
        // (the schema's getDefaultAtPath returns 0 for z.number(), ''
        // for z.string(), false for z.boolean(), etc.).
        return state.setValueAtPath(segments, slimDefault, {
          blank: true,
          persist,
        })
      },

      registerElement: (element: HTMLElement): void => {
        // Skip non-form elements. Prevents accidental registration of
        // component wrapper divs when fallthrough attributes carry the
        // directive past the intended `<input>` / `<select>` / `<textarea>`.
        if (!INTERACTIVE_TAG_NAMES.has(element.tagName)) return
        const added = state.registerElement(segments, element, formInstanceId)
        if (added) attachFocusListeners(state, segments, element)
      },

      deregisterElement: (element: HTMLElement): void => {
        detachFocusListeners(element)
        state.deregisterElement(segments, element)
      },

      setValueWithInternalPath: (value: unknown, meta?: WriteMeta): boolean => {
        return state.setValueAtPath(segments, value, meta)
      },

      // Called by the `vRegisterHint` compile-time transform's wrapping
      // IIFE on every server-side render of `<element v-register="…">`.
      // Without it, every SSR'd FieldState serialises `isConnected: false`
      // (because Vue skips directive lifecycle during SSR) and the client
      // briefly shows that stale flag until hydration runs the directive's
      // `created` hook. The mark only takes effect when `state.isSSR` is
      // true; on the client this is a no-op so the directive lifecycle
      // remains the source of truth.
      markConnectedOptimistically: (): void => {
        state.markConnectedOptimistically(segments)
      },

      // --- Persistence opt-in (internal; the directive is the only
      // legitimate consumer) ---
      path: pathKey,
      persist,
      acknowledgeSensitive,
      persistOptIns: state.persistOptIns,
      transforms,
      coerce,
      ...(coerceElement !== undefined ? { coerceElement } : {}),
    }
  }
}
