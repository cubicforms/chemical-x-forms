<script setup lang="ts">
import { z } from "zod"

const schema = z.object({ name: z.string().default("chemical X!") })
const { register, getState } = useForm({ schema, key: "user-form" })

const mounted = ref(true)
</script>

<template>
  <div>
    <textarea
      v-if="mounted"
      v-xmodel="register('name')"
      type="text"
    />
    <button @click="mounted = !mounted">
      {{ mounted ? 'unmounted input' : 'mounted input' }}
    </button>
    <pre>{{ JSON.stringify(getState("name").value, null, 2) }}</pre>
  </div>
</template>
