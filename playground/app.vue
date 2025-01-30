<script setup lang="ts">
// eslint-disable-next-line @stylistic/semi
import { z } from "zod";

const likeSchema = z.object({ likes: z.number() })
const { getValue, setValue } = useForm({ schema: likeSchema })
function increaseLikes() {
  setValue("likes", c => ++c)
}
const likes = getValue()
</script>

<template>
  <div>
    <h1>Nuxt module playground!</h1>
    <hr>
    <span>Number of likes:</span>
    <hr>
    <pre>{{ JSON.stringify(likes, null, 2) }}</pre>
    <hr>
    <button @click="increaseLikes">
      Increase the number of likes
    </button>
  </div>
</template>

<style>
body {
  background-color: rgb(10, 0, 36);
  color: rgb(255, 255, 255);
  font-family: Arial, Helvetica, sans-serif;
}
</style>
