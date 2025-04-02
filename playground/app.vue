<script setup lang="ts">
  import { z } from 'zod'

  const schema = z.object({ name: z.string().default('love') })
  const { register, getValue } = useForm({ schema })
  const value = getValue('name')
  const registerValue = register('name')
</script>

<template>
  <p>hello -- '{{ value }}'</p>
  <input v-register="registerValue" type="text" />
  <ChildComponent v-register="registerValue" />
</template>
