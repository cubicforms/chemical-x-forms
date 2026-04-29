<script setup lang="ts">
  import { useForm } from '@chemical-x/forms/zod'
  import z from 'zod'
  import Child from './components/Child.vue'

  const login = z.object({
    email: z.email(),
    password: z.string(),
    address: z.object({
      city: z.string(),
    }),
    salary: z.number(),
    // Checkbox demos:
    //   - boolean → single checkbox (true/false)
    //   - array → checkbox group (membership add/remove)
    //   - enum + :true-value/:false-value → single checkbox mapped
    //     to one of two strings
    agreedToTerms: z.boolean(),
    favoriteFruits: z.array(z.string()),
    newsletter: z.enum(['subscribe', 'unsubscribe']),
    // Radio group — one register binding shared across multiple
    // <input type="radio">, each with a distinct value=. Model is
    // the option-value of the currently-checked radio.
    subscriptionTier: z.enum(['free', 'pro', 'enterprise']),
  })

  const { register, getFieldState, handleSubmit, getValue } = useForm({
    schema: login,
    // Explicit key required for `persist:` to round-trip reliably —
    // anon keys drift across mounts (HMR / refresh / SSR↔CSR) and the
    // persistence layer would orphan entries on every reload.
    key: 'login',
    persist: 'session',
    defaultValues: {
      favoriteFruits: ['banana'],
    },
  })
  const field = getFieldState('salary')

  const displayError = computed(() => {
    if (!field.value.touched) return ''
    const msg = field.value.errors?.[0]?.message ?? ''
    return msg
  })

  const onSubmit = handleSubmit(
    (values) => {
      // eslint-disable-next-line no-console
      console.log('Success!', values)
    },
    (errors) => {
      // eslint-disable-next-line no-console
      console.log('Nope!', errors)
    }
  )
</script>

<template>
  <div>
    <NuxtRouteAnnouncer />
    <form @submit="onSubmit">
      <div>
        <label for="email">Email</label>
        <input id="email" v-register.trim="register('email', { persist: true })" />
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

    <pre>{{ getValue().value }}</pre>
    <pre>{{ JSON.stringify(field, null, 2) }}</pre>
  </div>
</template>
