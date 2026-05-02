<script setup lang="ts">
  import { parseApiErrors } from '@chemical-x/forms'
  import { useForm } from '@chemical-x/forms/zod'
  import z from 'zod'

  // 1. Basic register + form.values across multiple inputs binding to the same path.
  const fruitSchema = z.object({ fruit: z.string() })
  const fruitForm = useForm({ schema: fruitSchema, key: 'example-form' })
  const fruitReg = fruitForm.register('fruit')

  // 2. Error API. Default debounceMs is 0 — errors track every keystroke
  //    synchronously. Set debounceMs to a positive number to coalesce
  //    rapid bursts.
  const signupSchema = z.object({
    email: z.string().email('Enter a valid email'),
    password: z.string().min(8, 'At least 8 characters'),
  })
  const signupForm = useForm({
    schema: signupSchema,
    key: 'signup',
    updateOn: 'change',
  })
  const emailReg = signupForm.register('email')
  const passwordReg = signupForm.register('password')

  const onSubmit = signupForm.handleSubmit(async (values) => {
    // Simulate a server returning a 422 with field-level errors.
    const apiResult = parseApiErrors(
      { error: { details: { email: ['Already taken'] } } },
      { formKey: signupForm.key }
    )
    if (apiResult.ok) signupForm.setFieldErrors(apiResult.errors)
    // eslint-disable-next-line no-console
    console.log('client-validated values:', values)
  })

  // 3. Checkbox + radio + numeric input — one form, multiple inputs.
  const prefsSchema = z.object({
    agreedToTerms: z.boolean(),
    favoriteFruits: z.array(z.enum(['apple', 'banana', 'cherry'])),
    newsletter: z.enum(['subscribe', 'unsubscribe']),
    subscriptionTier: z.enum(['free', 'pro', 'enterprise']),
    salary: z.number().min(0, 'Must be non-negative'),
  })
  const prefsForm = useForm({
    schema: prefsSchema,
    key: 'prefs',
    defaultValues: {
      agreedToTerms: false,
      favoriteFruits: [],
      newsletter: 'unsubscribe',
      subscriptionTier: 'free',
      salary: 0,
    },
  })

  // 4. Debounce comparison — slow (250 ms) vs off (0 ms, the new default).
  //    Type the same characters into each and feel the difference.
  const debounceSchema = z.object({ email: z.string().email('Bad email') })
  const slowForm = useForm({
    schema: debounceSchema,
    key: 'demo-slow',
    defaultValues: { email: 'good@example.com' },
    updateOn: 'change',
    debounceMs: 250,
  })
  const offForm = useForm({
    schema: debounceSchema,
    key: 'demo-off',
    defaultValues: { email: 'good@example.com' },
    updateOn: 'change',
    debounceMs: 0,
  })
</script>

<template>
  <div style="font-family: system-ui; max-width: 720px; margin: 2rem auto; padding: 0 1rem">
    <h1>chemical-x-forms playground</h1>

    <h2>1. Multiple inputs, one path</h2>
    <p>current fruit: '{{ fruitForm.values.fruit }}'</p>
    <input v-register="fruitReg" placeholder="type fruit…" />
    <input v-register="fruitReg" placeholder="…or here" style="margin-top: 0.5rem" />

    <h2 style="margin-top: 2rem">2. Error API (signup)</h2>
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
    </form>

    <h3 style="margin-top: 1.5rem">Same data via fieldState</h3>
    <pre style="background: #f8fafc; padding: 0.75rem; border-radius: 6px">{{
      JSON.stringify(signupForm.fieldState.email.errors, null, 2)
    }}</pre>

    <h2 style="margin-top: 2rem">3. Checkboxes, radios, numeric</h2>
    <div style="display: flex; flex-direction: column; gap: 1rem">
      <label>
        <input v-register="prefsForm.register('agreedToTerms')" type="checkbox" />
        I agree to the terms (single boolean)
      </label>

      <fieldset>
        <legend>Favorite fruits (array — share one register binding)</legend>
        <label>
          <input v-register="prefsForm.register('favoriteFruits')" type="checkbox" value="apple" />
          Apple
        </label>
        <label>
          <input v-register="prefsForm.register('favoriteFruits')" type="checkbox" value="banana" />
          Banana
        </label>
        <label>
          <input v-register="prefsForm.register('favoriteFruits')" type="checkbox" value="cherry" />
          Cherry
        </label>
      </fieldset>

      <label>
        <input
          v-register="prefsForm.register('newsletter')"
          type="checkbox"
          :true-value="'subscribe'"
          :false-value="'unsubscribe'"
        />
        Newsletter (single checkbox via :true-value / :false-value)
      </label>

      <fieldset>
        <legend>Subscription tier (radio group, distinct value= per option)</legend>
        <label>
          <input v-register="prefsForm.register('subscriptionTier')" type="radio" value="free" />
          Free
        </label>
        <label>
          <input v-register="prefsForm.register('subscriptionTier')" type="radio" value="pro" />
          Pro
        </label>
        <label>
          <input
            v-register="prefsForm.register('subscriptionTier')"
            type="radio"
            value="enterprise"
          />
          Enterprise
        </label>
      </fieldset>

      <label style="display: flex; flex-direction: column; gap: 0.25rem">
        <span>Salary</span>
        <input v-register="prefsForm.register('salary')" type="number" />
        <small v-if="prefsForm.errors.salary?.[0]" style="color: #dc2626">
          {{ prefsForm.errors.salary[0].message }}
        </small>
      </label>
    </div>

    <pre style="margin-top: 1rem; background: #f8fafc; padding: 0.75rem; border-radius: 6px">{{
      JSON.stringify(prefsForm.values, null, 2)
    }}</pre>

    <h2 style="margin-top: 2rem">4. Debounce off-switch</h2>
    <p style="font-size: 0.875rem; color: #475569">
      Two forms, identical schemas. The slow form lags 250 ms behind your keystrokes; the off form
      (the new library default) snaps every change synchronously. Type the same characters into both
      and compare.
    </p>
    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; margin-top: 0.5rem">
      <div style="border: 1px solid #cbd5e1; border-radius: 6px; padding: 0.75rem">
        <strong>Slow — debounceMs: 250</strong>
        <input
          v-register="slowForm.register('email')"
          type="email"
          style="display: block; margin-top: 0.5rem; width: 100%"
        />
        <small v-if="slowForm.errors.email?.[0]" style="color: #dc2626">
          {{ slowForm.errors.email[0].message }}
        </small>
      </div>
      <div style="border: 1px solid #cbd5e1; border-radius: 6px; padding: 0.75rem">
        <strong>Off — debounceMs: 0 (default)</strong>
        <input
          v-register="offForm.register('email')"
          type="email"
          style="display: block; margin-top: 0.5rem; width: 100%"
        />
        <small v-if="offForm.errors.email?.[0]" style="color: #dc2626">
          {{ offForm.errors.email[0].message }}
        </small>
      </div>
    </div>
  </div>
</template>
