<script setup lang="ts">
  import { z } from 'zod'

  // -- Original demo: register + getValue across multiple inputs --
  const schema = z.object({ fruit: z.string() })
  const { register, getValue } = useForm({ schema, key: 'example-form' })
  const registerValue = register('fruit')

  // -- New error API demo --
  const signupSchema = z.object({
    email: z.string().email('Enter a valid email'),
    password: z.string().min(8, 'At least 8 characters'),
  })
  const {
    register: registerSignup,
    fieldErrors: signupErrors,
    handleSubmit: handleSignupSubmit,
    setFieldErrorsFromApi,
    clearFieldErrors,
    getFieldState,
  } = useForm({ schema: signupSchema, key: 'signup' })

  const emailReg = registerSignup('email')
  const passwordReg = registerSignup('password')

  // handleSubmit wraps the user callback: validation failure auto-populates
  // signupErrors, success clears it. The user's onSubmit can then call
  // setFieldErrorsFromApi(...) to layer server-side errors on top.
  const onSubmit = handleSignupSubmit(async (values) => {
    // simulate server returning a 422
    setFieldErrorsFromApi({
      error: { details: { email: ['Already taken'] } },
    })
    // eslint-disable-next-line no-console
    console.log('client-validated values:', values)
  })

  const emailFieldState = getFieldState('email')
</script>

<template>
  <div style="font-family: system-ui; max-width: 640px; margin: 2rem auto; padding: 0 1rem">
    <h1>chemical-x-forms playground</h1>

    <h2>Original API</h2>
    <p>current fruit: '{{ getValue('fruit').value }}'</p>
    <input v-register="registerValue" />
    <hr />
    <input v-register="registerValue" />
    <hr />
    <RootInput :fruit="registerValue" />

    <h2 style="margin-top: 2rem">Error API (new in 0.6)</h2>
    <form style="display: flex; flex-direction: column; gap: 1rem" @submit.prevent="onSubmit">
      <label style="display: flex; flex-direction: column; gap: 0.25rem">
        <span>Email</span>
        <input v-register="emailReg" type="email" />
        <small v-if="signupErrors.email?.[0]" style="color: #dc2626">
          {{ signupErrors.email[0].message }}
        </small>
      </label>

      <label style="display: flex; flex-direction: column; gap: 0.25rem">
        <span>Password</span>
        <input v-register="passwordReg" type="password" />
        <small v-if="signupErrors.password?.[0]" style="color: #dc2626">
          {{ signupErrors.password[0].message }}
        </small>
      </label>

      <div style="display: flex; gap: 0.5rem">
        <button type="submit">Submit</button>
        <button type="button" @click="clearFieldErrors()">Clear errors</button>
      </div>
    </form>

    <h3 style="margin-top: 1.5rem">Same data via getFieldState (FieldState.errors)</h3>
    <pre style="background: #f8fafc; padding: 0.75rem; border-radius: 6px">{{
      JSON.stringify(emailFieldState.errors, null, 2)
    }}</pre>
  </div>
</template>
