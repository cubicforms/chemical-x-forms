<script setup lang="ts">
import { z } from "zod"

// Define your schema with a dash of magic
const schema = z.object({ planet: z.string() })

// Create your form with a unique key
const { getFieldState, register, key, setValue } = useForm({
  schema,
  key: "planet-form-key",
})

// Get the state of the 'planet' field
const planetState = getFieldState("planet")
const hideInput = ref(false)

// random operation to demonstrate updating the planet field programmatically
function updateVal(testUpdate: boolean) {
  setValue("planet", (v) => {
    const [base, count] = v.split(".")
    const recoveredNum = Number(count ?? 0)
    const safeNum = Number.isNaN(recoveredNum) ? 0 : recoveredNum
    const BASE_DEFAULT = "Jupiter"
    return testUpdate ? `${base || BASE_DEFAULT}.${safeNum + 1}` : v
  })
}
</script>

<template>
  <div>
    <h1>Fancy Form "{{ key }}"</h1>

    <input
      v-if="!hideInput"
      v-register="register('planet')"
      placeholder="Enter your favorite planet"
    >

    <p>Favorite Planet field state:</p>
    <pre>{{ JSON.stringify(planetState, null, 2) }}</pre>

    <button @click="hideInput = !hideInput">
      {{ hideInput ? 'show input' : 'hide input' }}
    </button>

    <button @click="updateVal(true)">
      Update value programmatically
    </button>
    <hr>
  </div>
</template>
