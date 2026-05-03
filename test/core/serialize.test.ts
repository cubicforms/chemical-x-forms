// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp } from 'vue'
import { createFormStore } from '../../src/runtime/core/create-form-store'
import { canonicalizePath } from '../../src/runtime/core/paths'
import { createDecant } from '../../src/runtime/core/plugin'
import { getRegistryFromApp, type SerializedFormData } from '../../src/runtime/core/registry'
import { hydrateDecantState, renderDecantState } from '../../src/runtime/core/serialize'
import { fakeSchema } from '../utils/fake-schema'

type Signup = { email: string; password: string }

function seedServerApp(formKey: string, initialEmail: string) {
  const app = createApp({ render: () => null })
  app.use(createDecant({ override: true }))
  const registry = getRegistryFromApp(app)
  const state = createFormStore<Signup>({
    formKey,
    schema: fakeSchema<Signup>({ email: initialEmail, password: '' }),
  })
  registry.forms.set(formKey, state)
  return { app, state }
}

describe('renderDecantState', () => {
  it('extracts form data and source-segregated errors for every registered form', () => {
    const { app, state } = seedServerApp('signup', 'a@a')
    // Schema validation populates the schema-error store directly via
    // setSchemaErrorsForPath. setFieldErrors-style API calls would
    // populate userErrors; here we test both round-trip independently.
    state.setSchemaErrorsForPath(
      ['email'],
      [{ message: 'taken', path: ['email'], formKey: 'signup', code: 'cx:test-fixture' }]
    )
    state.setAllUserErrors([
      { message: 'banned-domain', path: ['email'], formKey: 'signup', code: 'api:validation' },
    ])
    const payload = renderDecantState(app)
    expect(payload.forms).toHaveLength(1)
    const entry = payload.forms[0]
    expect(entry).toBeDefined()
    if (entry === undefined) return
    const [key, data] = entry
    expect(key).toBe('signup')
    expect(data.form).toEqual({ email: 'a@a', password: '' })
    expect(data.schemaErrors).toHaveLength(1)
    expect(data.userErrors).toHaveLength(1)
  })

  it('does not include originals or elements in the payload', () => {
    const { app } = seedServerApp('x', 'y')
    const payload = renderDecantState(app)
    const firstEntry = payload.forms[0]
    expect(firstEntry).toBeDefined()
    if (firstEntry === undefined) return
    const data = firstEntry[1]
    // Originals are derivable client-side from schema + defaultValues; elements
    // are DOM references that can't serialise. Serialisation omits both to
    // keep the wire format small and referentially clean.
    expect(data).not.toHaveProperty('originals')
    expect(data).not.toHaveProperty('elements')
  })

  it('is round-trippable through JSON.stringify', () => {
    const { app } = seedServerApp('rt', 'z@z')
    const payload = renderDecantState(app)
    const serialised = JSON.stringify(payload)
    const restored = JSON.parse(serialised) as ReturnType<typeof renderDecantState>
    expect(restored.forms).toHaveLength(1)
    const entry = restored.forms[0]
    expect(entry).toBeDefined()
    if (entry === undefined) return
    const [key, data] = entry
    expect(key).toBe('rt')
    expect(data.form).toEqual({ email: 'z@z', password: '' })
  })
})

describe('hydrateDecantState', () => {
  it('stages entries into pendingHydration for later consumption', () => {
    const { app } = seedServerApp('stage', 'a@a')
    const payload = renderDecantState(app)

    // Simulate the client: fresh app, same plugin, then hydrate.
    const clientApp = createApp({ render: () => null })
    clientApp.use(createDecant())
    hydrateDecantState(clientApp, payload)
    const registry = getRegistryFromApp(clientApp)
    expect(registry.pendingHydration.has('stage')).toBe(true)
  })

  it('reconstructs an equivalent FormStore when the client creates a form with hydration', () => {
    const { app, state } = seedServerApp('rt2', 'server@x')
    state.setValueAtPath(['email'], 'server-edited@x')
    const payload = renderDecantState(app)

    const clientApp = createApp({ render: () => null })
    clientApp.use(createDecant())
    hydrateDecantState(clientApp, payload)
    const clientRegistry = getRegistryFromApp(clientApp)

    const pending = clientRegistry.pendingHydration.get('rt2')
    expect(pending).toBeDefined()
    if (pending === undefined) return

    const rehydratedState = createFormStore<Signup>({
      formKey: 'rt2',
      schema: fakeSchema<Signup>({ email: '', password: '' }),
      hydration: pending,
    })
    // Client form value matches what the server wrote.
    expect(rehydratedState.form.value.email).toBe('server-edited@x')
    // Originals still derive from the schema — so pristine/dirty works client-side.
    expect(rehydratedState.getOriginalAtPath(['email'])).toBe('')
    expect(rehydratedState.isPristineAtPath(['email'])).toBe(false)
  })
})

describe('hydration shape guard', () => {
  // Defends against rolling deploys / stale cache: SSR running an older
  // bundle version embeds a payload whose FieldRecord shape predates the
  // current code. The cast `record as FieldRecord` would lie and downstream
  // reads of `.touched` / `.focused` would crash. Each malformed entry
  // gets dropped silently in prod; one-shot dev-warns name the offending
  // key so the rolling-deploy diagnosis is obvious.

  let warnSpy: ReturnType<typeof vi.spyOn>
  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  })
  afterEach(() => {
    warnSpy.mockRestore()
  })

  // The shape-guard tests pass schema-shaped tuple lists by design, but the
  // SerializedFormData type is structurally readonly. The cast keeps the
  // test's "I know I'm passing junk" intent at the boundary.
  function buildPayload(overrides: {
    fields?: ReadonlyArray<readonly [string, unknown]>
    schemaErrors?: ReadonlyArray<readonly [string, unknown]>
    userErrors?: ReadonlyArray<readonly [string, unknown]>
  }): SerializedFormData {
    return {
      form: { email: 'good@x', password: '' },
      fields: overrides.fields ?? [],
      schemaErrors: overrides.schemaErrors ?? [],
      userErrors: overrides.userErrors ?? [],
    }
  }

  it('skips FieldRecord entries that fail the shape check', () => {
    const emailKey = canonicalizePath('email').key
    const validRecord = {
      path: ['email'],
      updatedAt: '2025-01-01T00:00:00.000Z',
      isConnected: true,
      focused: null,
      blurred: null,
      touched: null,
    }
    const hydration = buildPayload({
      fields: [
        [emailKey, validRecord], // valid
        ['malformed-null', null],
        ['malformed-string', 'not an object'],
        ['malformed-empty-obj', {}],
        ['malformed-wrong-types', { path: 'not-array', isConnected: 'true' }],
        ['malformed-missing-flags', { path: ['x'], updatedAt: null, isConnected: true }],
      ],
    })

    const state = createFormStore<Signup>({
      formKey: 'malformed-fields',
      schema: fakeSchema<Signup>({ email: '', password: '' }),
      hydration,
    })

    expect(state.fields.has(emailKey)).toBe(true)
    expect(state.fields.get(emailKey)?.isConnected).toBe(true)
    // Only the valid entry survived; five malformed entries were skipped.
    expect(state.fields.size).toBe(1)
  })

  it('skips malformed schemaErrors / userErrors entries', () => {
    const emailKey = canonicalizePath('email').key
    const validErr = {
      message: 'taken',
      path: ['email'],
      formKey: 'malformed-errors',
      code: 'cx:test',
    }
    const hydration = buildPayload({
      schemaErrors: [
        [emailKey, [validErr]],
        ['bad-array', 'not-an-array'],
        ['array-with-junk', [{ message: 'ok', path: ['x'], formKey: 'k', code: 'c' }, null, 42]],
        ['missing-fields', [{ message: 'ok' }]],
      ],
      userErrors: [
        [emailKey, [validErr]],
        ['null-value', null],
      ],
    })

    const state = createFormStore<Signup>({
      formKey: 'malformed-errors',
      schema: fakeSchema<Signup>({ email: '', password: '' }),
      hydration,
    })

    // Only the valid 'email' entry made it into each error map.
    expect(state.schemaErrors.size).toBe(1)
    expect(state.schemaErrors.get(emailKey)?.[0]?.message).toBe('taken')
    expect(state.userErrors.size).toBe(1)
    expect(state.userErrors.get(emailKey)?.[0]?.message).toBe('taken')
  })

  it('warns once per malformed entry in dev mode', () => {
    const hydration = buildPayload({
      fields: [['oops', null]],
      schemaErrors: [['oops', 'not-array']],
    })

    createFormStore<Signup>({
      formKey: 'warn-once',
      schema: fakeSchema<Signup>({ email: '', password: '' }),
      hydration,
    })

    const messages = warnSpy.mock.calls.map((call: unknown[]) => String(call[0]))
    expect(messages.some((m: string) => m.includes('hydration') && m.includes('oops'))).toBe(true)
  })
})
