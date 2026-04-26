<script setup lang="ts">
  import { useForm } from '@runtime/composables/use-form'
  // The SSR fixture exercises the zod v3 adapter via useForm auto-import.
  // Installed side-by-side with zod v4 via pnpm alias.
  import { z } from 'zod-v3'

  const schema = z.object({
    favoriteGame: z.string().default('chess'),
    chessInArray: z.array(z.string()).default(['chess']),
  })
  const { register } = useForm({ schema, key: 'ssr-select-fixture' })

  // -- Error API SSR fixtures --
  // Destructured at setup level so the refs become top-level template
  // bindings (Vue auto-unwraps top-level refs but not refs nested in plain
  // objects, so `directErrorForm.fieldErrors.value` would not unwrap reliably).

  // Direct setFieldErrors on the server, rendered into HTML so the SSR test
  // can prove the reactive error store survives serialisation/hydration.
  const directErrorSchema = z.object({
    email: z.string().email(),
    password: z.string().min(8),
  })
  const {
    fieldErrors: directErrors,
    setFieldErrors: setDirectErrors,
    getFieldState: getDirectFieldState,
  } = useForm({
    schema: directErrorSchema,
    key: 'errors-direct',
    // Pin lax: this fixture proves user-injected errors render across
    // the SSR boundary. Strict-mode default would also seed schema
    // errors from the empty defaults, displacing the user-injected
    // entries at fieldErrors[0] (schema-first ordering).
    validationMode: 'lax',
  })
  setDirectErrors([
    { message: 'Email already in use', path: ['email'], formKey: 'errors-direct' },
    {
      message: 'Password must be at least 8 characters',
      path: ['password'],
      formKey: 'errors-direct',
    },
  ])
  const directEmailState = getDirectFieldState('email')

  // Hydration helper applied during setup, simulating a 422 from the server
  // being mapped onto fields before the page renders.
  const { fieldErrors: apiErrors, setFieldErrorsFromApi: setApiErrors } = useForm({
    schema: z.object({ username: z.string() }),
    key: 'errors-from-api',
  })
  setApiErrors({
    error: {
      code: 'VALIDATION_ERROR',
      message: 'Invalid input',
      details: { username: ['Username taken', 'Reserved word'] },
    },
  })

  // -- handleSubmit return-shape fixture --
  // Proves handleSubmit(cb) returns a function (not a Promise) so it can be
  // bound directly to a form's @submit handler without a wrapper.
  const submitForm = useForm({
    schema: z.object({ name: z.string().min(1) }),
    key: 'submit-shape',
  })
  const submitHandler = submitForm.handleSubmit(() => {})
  const submitHandlerType = typeof submitHandler

  // -- Hydration round-trip fixture --
  // Server writes a value into form state during setup; the value must
  // appear in the rendered HTML *and* serialise into the `__NUXT__` payload
  // so the client-side registry reconstructs the state. Phase 7.9 test.
  const hydrationForm = useForm({
    schema: z.object({ hydratedField: z.string() }),
    key: 'hydration-check',
  })
  hydrationForm.setValue('hydratedField', 'server-written-value')
  const hydratedFieldValue = hydrationForm.getValue('hydratedField')
</script>

<template>
  <div>
    <h1>SSR Tests</h1>

    <section>
      <h2>Select matching logic</h2>

      <select id="matching-logic-select-1" v-register="register('favoriteGame')">
        <option value="monopoly">Monopoly</option>
        <option value="chess">chess Top</option>
        <option value="chess">Chess Middle</option>
        <option value="chess">Chess Bottom</option>
        <option value="blackjack">Blackjack</option>
      </select>

      <select id="matching-logic-select-2" v-register="register('favoriteGame')">
        <option value="chess" selected="false">Chess</option>
      </select>

      <select id="random-nested-select-1" v-register="register('favoriteGame')">
        <div>
          <optgroup>
            <p>
              <span>
                <option value="chess">Chess Option Nested</option>
              </span>
            </p>
          </optgroup>
        </div>
      </select>

      <select id="select-with-no-matching-options-1" v-register="register('favoriteGame')">
        <option value="mario_kart">Mario Kart</option>
        <option value="tekken">Tekken</option>
        <option value="brain_game">Brain Game</option>
      </select>

      <select id="select-without-options-1" v-register="register('favoriteGame')"></select>

      <select
        id="select-with-invalid-element-matching-value-1"
        v-register="register('favoriteGame')"
      >
        <input value="chess" />
      </select>

      <select
        id="select-multiple-false-default-success-case-1"
        v-register="register('favoriteGame')"
      >
        <option value="chess">Chess</option>
      </select>

      <select
        id="select-multiple-false-default-failure-case-1"
        v-register="register('chessInArray')"
      >
        <option value="chess">Chess</option>
      </select>
    </section>

    <section>
      <h2>Error API</h2>

      <!-- Direct setFieldErrors -->
      <div id="errors-direct">
        <span id="errors-direct-fielderrors-email">{{
          directErrors.email?.[0]?.message ?? ''
        }}</span>
        <span id="errors-direct-fielderrors-password">{{
          directErrors.password?.[0]?.message ?? ''
        }}</span>
        <span id="errors-direct-fieldstate-email">{{
          directEmailState.errors[0]?.message ?? ''
        }}</span>
        <span id="errors-direct-count">{{ Object.keys(directErrors).length }}</span>
      </div>

      <!-- setFieldErrorsFromApi -->
      <div id="errors-from-api">
        <span id="errors-from-api-first">{{ apiErrors.username?.[0]?.message ?? '' }}</span>
        <span id="errors-from-api-second">{{ apiErrors.username?.[1]?.message ?? '' }}</span>
        <span id="errors-from-api-count">{{ apiErrors.username?.length ?? 0 }}</span>
      </div>

      <!-- handleSubmit return shape -->
      <div id="handle-submit-shape">
        <span id="handle-submit-typeof">{{ submitHandlerType }}</span>
      </div>

      <!-- Hydration round-trip -->
      <div id="hydration-check">
        <!-- Vue templates auto-unwrap top-level refs; the `.value` goes on
             the <script setup> side, not here. -->
        <span id="hydration-check-value">{{ hydratedFieldValue }}</span>
      </div>
    </section>
  </div>
</template>
