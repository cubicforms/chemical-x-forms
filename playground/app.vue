<script setup lang="ts">
  import { z } from 'zod'

  // Define your schema with a dash of magic
  const schema = z.object({ planet: z.string(), favoriteGame: z.string().default('chess') })

  // Create your form with a unique key
  const { getFieldState, register, key, setValue } = useForm({
    schema,
    key: 'planet-form-key',
  })

  // Get the state of the 'planet' field
  const planetState = getFieldState('planet')
  const gameState = getFieldState('favoriteGame')
  const hideInput = ref(false)

  // random operation to demonstrate updating the planet field programmatically
  function updateVal(testUpdate: boolean) {
    setValue('planet', (v) => {
      const [base, count] = v.split('.')
      const recoveredNum = Number(count ?? 0)
      const safeNum = Number.isNaN(recoveredNum) ? 0 : recoveredNum
      const BASE_DEFAULT = 'Jupiter'
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
    />

    <p>Favorite Planet field state:</p>
    <pre>{{ JSON.stringify(planetState, null, 2) }}</pre>

    <button @click="hideInput = !hideInput">
      {{ hideInput ? 'show input' : 'hide input' }}
    </button>

    <button @click="updateVal(true)">Update value programmatically</button>

    <select id="deselect-failed-matches-1" v-register="register('favoriteGame')">
      <option value="mario_kart" selected="true">Mario Kart</option>
      <option value="tekken" selected="true">Tekken</option>
      <option value="brain_game" selected="true">Brain Game</option>
    </select>

    Without register:
    <pre>{{ JSON.stringify(gameState, null, 2) }}</pre>

    <select
      id="select-where-all-options-are-without-selected-attributes"
      v-register="register('favoriteGame')"
    >
      <option value="mario_kart">Mario Kart</option>
      <option value="tekken">Tekken</option>
      <option value="brain_game">Brain Game</option>
    </select>
    <hr />
  </div>
</template>
