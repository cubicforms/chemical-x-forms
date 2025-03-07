<script lang="ts" setup>
import { z } from "zod"

const schema = z.object({ name: z.string().default("ozzy"), age: z.number().default(3) })
const { register, getValue, setValue, getState } = useForm({ schema, key: "test-form", initialState: { name: "jack" } })
const reg = register("name")
const inn = reg.innerRef

const mountTextArea = ref(true)
const x = getState("name")
const y = getState("age")

const simple = ref(true)
</script>

<template>
  form state:
  <pre>{{ JSON.stringify(getValue().value, null, 2) }}</pre>
  field state:
  <pre>{{ JSON.stringify(inn, null, 2) }}</pre>
  total element state (name):
  <pre>{{ JSON.stringify(x, null, 2) }}</pre>
  total element state (age):
  <pre>{{ JSON.stringify(y, null, 2) }}</pre>
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
    v-if="simple"
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
  />
  <hr>
  <button @click="simple = !simple">
    {{ simple ? 'remove' : 'bring back' }} simple text input
  </button>
</template>

<style>
body {
  background-color: rgb(0, 0, 54);
  color: white;
  font-family: Arial, Helvetica, sans-serif;
}
</style>
