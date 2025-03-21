<script setup lang="ts">
import { z } from "zod"

// Define your schema with a dash of magic
const schema = z.object({ planet: z.string() })

// Create your form with a unique key
const { getFieldState, register, key } = useForm({
  schema,
  key: "planet-form-key",
})

// Get the state of the 'planet' field
const planetState = getFieldState("planet")
const hideInput = ref(false)
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
    <hr>
  </div>
</template>
