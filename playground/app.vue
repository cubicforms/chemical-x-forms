<script lang="ts" setup>
import { z } from "zod"

const schema = z.object({ name: z.string().default("ozzy"), age: z.number() })
const { register, getValue, setValue, getElementState } = useForm({ schema, key: "test-form" })
const reg = register("name")
const inn = reg.innerRef

const mountTextArea = ref(true)
const x = getElementState("name")
</script>

<template>
  form state:
  <pre>{{ JSON.stringify(getValue().value, null, 2) }}</pre>
  field state:
  <pre>{{ JSON.stringify(inn, null, 2) }}</pre>
  total element state:
  <pre>{{ JSON.stringify(x, null, 2) }}</pre>
  <button @click="() => { setValue('name', 'ayra') }">
    update name to ayra
  </button>
  <hr>
  <button @click="() => { reg.setValueWithInternalPath('yes') }">
    update innerRef to yes
  </button>
  <input
    v-xmodel.number="register('age')"
    type="number"
  >
  <hr>
  <input
    v-xmodel.number="register('name')"
  >
  <hr>
  <button @click="mountTextArea = !mountTextArea">
    Toggle the textarea (currently {{ mountTextArea ? 'mounted' : 'not mounted' }})
  </button>
  <hr>
  <textarea
    v-if="mountTextArea"
    v-xmodel="register('name')"
    autofocus
  />
</template>

<style>
body {
  background-color: rgb(0, 0, 54);
  color: white;
  font-family: Arial, Helvetica, sans-serif;
}
</style>
