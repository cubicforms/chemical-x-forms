<script setup lang="ts">
import { z } from "zod"
import { zodAdapter } from "../src/runtime/adapters/zod"

const schema = z.object({
  name: z.string().default("larry"),
  age: z.number(),
  address: z.object({ line1: z.string().default("123 main street") }),
})
const { register, getFieldState } = useAbstractForm({
  schema: zodAdapter(schema),
  key: "user-form",
})

const state = getFieldState("address.line1")
const mounted = ref(true)
</script>

<template>
  <div>
    <input
      v-if="mounted"
      v-xmodel="register('address.line1')"
    >
    <button @click="mounted = !mounted">
      {{ mounted ? "unmounted input" : "mounted input" }}
    </button>
    <pre>{{ JSON.stringify(state, null, 2) }}</pre>
  </div>
</template>
