// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { createApp } from 'vue'
import { createFormStore } from '../../src/runtime/core/create-form-store'
import { createChemicalXForms } from '../../src/runtime/core/plugin'
import { getRegistryFromApp } from '../../src/runtime/core/registry'
import { hydrateChemicalXState, renderChemicalXState } from '../../src/runtime/core/serialize'
import { fakeSchema } from '../utils/fake-schema'

type Signup = { email: string; password: string }

function seedServerApp(formKey: string, initialEmail: string) {
  const app = createApp({ render: () => null })
  app.use(createChemicalXForms({ override: true }))
  const registry = getRegistryFromApp(app)
  const state = createFormStore<Signup>({
    formKey,
    schema: fakeSchema<Signup>({ email: initialEmail, password: '' }),
  })
  registry.forms.set(formKey, state)
  return { app, state }
}

describe('renderChemicalXState', () => {
  it('extracts form data and source-segregated errors for every registered form', () => {
    const { app, state } = seedServerApp('signup', 'a@a')
    // Schema validation populates the schema-error store directly via
    // setSchemaErrorsForPath. setFieldErrors-style API calls would
    // populate userErrors; here we test both round-trip independently.
    state.setSchemaErrorsForPath(
      ['email'],
      [{ message: 'taken', path: ['email'], formKey: 'signup' }]
    )
    state.setAllUserErrors([{ message: 'banned-domain', path: ['email'], formKey: 'signup' }])
    const payload = renderChemicalXState(app)
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
    const payload = renderChemicalXState(app)
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
    const payload = renderChemicalXState(app)
    const serialised = JSON.stringify(payload)
    const restored = JSON.parse(serialised) as ReturnType<typeof renderChemicalXState>
    expect(restored.forms).toHaveLength(1)
    const entry = restored.forms[0]
    expect(entry).toBeDefined()
    if (entry === undefined) return
    const [key, data] = entry
    expect(key).toBe('rt')
    expect(data.form).toEqual({ email: 'z@z', password: '' })
  })
})

describe('hydrateChemicalXState', () => {
  it('stages entries into pendingHydration for later consumption', () => {
    const { app } = seedServerApp('stage', 'a@a')
    const payload = renderChemicalXState(app)

    // Simulate the client: fresh app, same plugin, then hydrate.
    const clientApp = createApp({ render: () => null })
    clientApp.use(createChemicalXForms())
    hydrateChemicalXState(clientApp, payload)
    const registry = getRegistryFromApp(clientApp)
    expect(registry.pendingHydration.has('stage')).toBe(true)
  })

  it('reconstructs an equivalent FormStore when the client creates a form with hydration', () => {
    const { app, state } = seedServerApp('rt2', 'server@x')
    state.setValueAtPath(['email'], 'server-edited@x')
    const payload = renderChemicalXState(app)

    const clientApp = createApp({ render: () => null })
    clientApp.use(createChemicalXForms())
    hydrateChemicalXState(clientApp, payload)
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
