<script setup lang="ts">
import { z } from "zod"

const schema = z.object({ address: z.object({ line1: z.string(), line2: z.string() }), count: z.number(), optional: z.record(z.string()) })
const { getValue, setValue } = useForm({ schema: zodAdapter(schema), key: "test", initialState: { count: 4 } })
const { currentValue, meta } = getValue("address", { withMeta: true })
</script>

<template>
  <div>
    <h1>Nuxt module playground!</h1>
    <hr>
    <pre>{{ currentValue }}</pre>
    <pre>{{ meta }}</pre>
    <label for="line1">Line1</label>
    <input
      type="text"
      placeholder="Enter line 1"
      @input="(e) => setValue('address.line1', e.target.value)"
    >
    <label for="line2">Line2</label>
    <input
      type="text"
      placeholder="Enter line 2"
      @input="(e) => setValue('address.line2', e.target.value)"
    >
  </div>
</template>

<style>
body {
  background-color: rgb(10, 0, 36);
  color: rgb(255, 255, 255);
  font-family: Arial, Helvetica, sans-serif;
}
</style>
