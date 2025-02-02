<script setup lang="ts">
// eslint-disable-next-line @stylistic/semi
import { z } from "zod";

const schema = z.object({ count: z.number() })
const { getValue, setValue } = useForm({ schema })
const value = getValue()
</script>

<template>
  <div>
    <h1>Nuxt module playground!</h1>
    <hr>
    <h2>Value:</h2>
    <pre>{{ JSON.stringify(value, null, 2) }}</pre>
    <label for="count">Write the count</label>
    <input
      id="count"
      type="text"
      @input="(e) => setValue('count', (e.target as any)?.value)"
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
