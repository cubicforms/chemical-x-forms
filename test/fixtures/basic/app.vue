<template>
  <div>basic</div>
</template>

<script setup lang="ts">
  import { useForm } from '@runtime/composables/use-form'
  import { z } from 'zod'

  const schema = z.object({ name: z.string() })
  useForm({ schema })
</script>
