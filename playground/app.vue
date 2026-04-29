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
  })

  const { register, getFieldState, handleSubmit, getValue } = useForm({
    schema: login,
    persist: 'session',
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
        <input id="email" v-register="register('email', { persist: true })" />
        <div>{{ displayError }}</div>
      </div>
      <br />

      <div>
        <label for="password">Password</label>
        <Child id="password" />
      </div>

      <div>
        <label for="salary">Salary</label>
        <input id="salary" v-register="register('address.salary')" />
      </div>
      <button>Log in</button>
    </form>

    <pre>{{ getValue().value }}</pre>
    <pre>{{ JSON.stringify(field, null, 2) }}</pre>
  </div>
</template>
