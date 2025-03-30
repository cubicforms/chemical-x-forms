<script setup lang="ts">
  import { z } from 'zod'

  const schema = z.object({ fruit: z.string() })
  const { register, getValue } = useForm({ schema, key: 'example-form' })
  const registerValue = register('fruit')
</script>

<template>
  <div>
    current fruit: '{{ getValue('fruit').value }}'
    <hr />
    <input v-register="registerValue" />
    <hr />
    <input v-register="registerValue" />
    <hr />
    <RootInput :fruit="registerValue" />
  </div>
</template>
