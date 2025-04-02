<script setup lang="ts">
  import { z } from 'zod'

  const schema = z.object({ fruit: z.string() })
  const { register } = useForm({ schema, key: 'example-form-1' })
  const registerValue = register('fruit')
</script>

<template>
  <div>
    <input v-register="registerValue" placeholder="really deep input" />
  </div>
  <AnotherDeeperThing v-register="registerValue" />
</template>
