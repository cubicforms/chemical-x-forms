<script setup lang="ts">
  import { parseApiErrors } from '@chemical-x/forms'
  import { useForm } from '@chemical-x/forms/zod'
  import z from 'zod'
  import Child from './components/Child.vue'

  // -- Original demo: register + form.values across multiple inputs --
  const schema = z.object({ fruit: z.string() })
  const fruitForm = useForm({ schema, key: 'example-form' })
  const registerValue = fruitForm.register('fruit')

  // -- Error API demo --
  const signupSchema = z.object({
    email: z.string().email('Enter a valid email'),
    password: z.string().min(8, 'At least 8 characters'),
  })
  const signupForm = useForm({ schema: signupSchema, key: 'signup' })

  const emailReg = signupForm.register('email')
  const passwordReg = signupForm.register('password')

  // handleSubmit wraps the user callback: validation failure auto-populates
  // signupForm.errors, success clears it. The user's onSubmit can then parse
  // a server response via parseApiErrors() and write the result with
  // setFieldErrors(...) to layer server-side errors on top.
  const onSubmit = signupForm.handleSubmit(async (values) => {
    // simulate server returning a 422
    const apiResult = parseApiErrors(
      { error: { details: { email: ['Already taken'] } } },
      { formKey: signupForm.key }
    )
    if (apiResult.ok) signupForm.setFieldErrors(apiResult.errors)
    // eslint-disable-next-line no-console
    console.log('client-validated values:', values)
  })
</script>

<template>
  <div style="font-family: system-ui; max-width: 640px; margin: 2rem auto; padding: 0 1rem">
    <h1>chemical-x-forms playground</h1>

    <h2>Pinia-style read API</h2>
    <p>current fruit: '{{ fruitForm.values.fruit }}'</p>
    <input v-register="registerValue" />
    <hr />
    <input v-register="registerValue" />
    <hr />
    <RootInput :fruit="registerValue" />

    <h2 style="margin-top: 2rem">Error API</h2>
    <form style="display: flex; flex-direction: column; gap: 1rem" @submit.prevent="onSubmit">
      <label style="display: flex; flex-direction: column; gap: 0.25rem">
        <span>Email</span>
        <input v-register="emailReg" type="email" />
        <small v-if="signupForm.errors.email?.[0]" style="color: #dc2626">
          {{ signupForm.errors.email[0].message }}
        </small>
      </label>

      <label style="display: flex; flex-direction: column; gap: 0.25rem">
        <span>Password</span>
        <input v-register="passwordReg" type="password" />
        <small v-if="signupForm.errors.password?.[0]" style="color: #dc2626">
          {{ signupForm.errors.password[0].message }}
        </small>
      </label>

      <div style="display: flex; gap: 0.5rem">
        <button type="submit">Submit</button>
        <button type="button" @click="signupForm.clearFieldErrors()">Clear errors</button>
      </div>
      <br />

      <div>
        <label for="password">Password</label>
        <Child id="password" />
      </div>

      <div>
        <label for="salary">Salary</label>
        <input id="salary" v-register.number="register('salary')" />
        <div>{{ displayError }}</div>
      </div>

      <hr />
      <h3>Checkboxes</h3>

      <div>
        <label>
          <input v-register="register('agreedToTerms')" type="checkbox" />
          I agree to the terms (single boolean)
        </label>
      </div>

      <fieldset>
        <legend>Favorite fruits (array group — share one register binding)</legend>
        <label>
          <input v-register="register('favoriteFruits')" type="checkbox" value="apple" />
          Apple
        </label>
        <label>
          <input v-register="register('favoriteFruits')" type="checkbox" value="banana" />
          Banana
        </label>
        <label>
          <input v-register="register('favoriteFruits')" type="checkbox" value="cherry" />
          Cherry
        </label>
      </fieldset>

      <div>
        <label>
          <input
            v-register="register('newsletter')"
            type="checkbox"
            :true-value="'subscribe'"
            :false-value="'unsubscribe'"
          />
          Newsletter (single checkbox mapped to a string via :true-value / :false-value)
        </label>
      </div>

      <hr />
      <h3>Radio group</h3>
      <fieldset>
        <legend>Subscription tier (one register binding, distinct value= per radio)</legend>
        <label>
          <input v-register="register('subscriptionTier')" type="radio" value="free" />
          Free
        </label>
        <label>
          <input v-register="register('subscriptionTier')" type="radio" value="pro" />
          Pro
        </label>
        <label>
          <input v-register="register('subscriptionTier')" type="radio" value="enterprise" />
          Enterprise
        </label>
      </fieldset>

      <button>Log in</button>
    </form>

    <h3 style="margin-top: 1.5rem">Same data via fieldState (FieldState.errors)</h3>
    <pre style="background: #f8fafc; padding: 0.75rem; border-radius: 6px">{{
      JSON.stringify(signupForm.fieldState.email.errors, null, 2)
    }}</pre>
  </div>
</template>
