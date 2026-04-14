<script setup lang="ts">
  import { useForm } from '@runtime/composables/use-form'
  import { z } from 'zod'

  const schema = z.object({
    favoriteGame: z.string().default('chess'),
    chessInArray: z.array(z.string()).default(['chess']),
  })
  const { register } = useForm({ schema })

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
    </section>
  </div>
</template>
