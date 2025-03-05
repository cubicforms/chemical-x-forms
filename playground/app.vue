<script lang="ts" setup>
import { z } from "zod"

const schema = z.object({ name: z.string().default("ozzy") })
const { register, getValue, setValue } = useForm({ schema, key: "test-form" })
const reg = register("name")
const inn = reg.innerRef

const mountTextArea = ref(true)
</script>

<template>
  form state:
  <pre>{{ JSON.stringify(getValue().value, null, 2) }}</pre>
  field state:
  <pre>{{ JSON.stringify(inn, null, 2) }}</pre>
  <button @click="() => { setValue('name', 'ayra') }">
    update name to ayra
  </button>
  <hr>
  <button @click="() => { reg.setValueWithInternalPath('yes') }">
    update innerRef to yes
  </button>
  <input
    v-xmodel="register('name')"
    type="text"
  >
  <hr>
  <button @click="mountTextArea = !mountTextArea">
    Toggle the textarea (currently {{ mountTextArea ? 'mounted' : 'not mounted' }} )
  </button>
  <hr>
  <textarea
    v-if="mountTextArea"
    v-xmodel="register('name')"
  />
</template>

<style>
body {
  background-color: rgb(0, 0, 54);
  color: white;
  font-family: Arial, Helvetica, sans-serif;
}
</style>
