<script setup lang="ts">
  import { useForm } from '@runtime/composables/use-form'
  import { z } from 'zod'

  const schema = z.object({ favoriteGame: z.string().default('chess') })
  const { register } = useForm({ schema })
</script>

<template>
  <div>
    <h1>SSR Tests</h1>

    <section>
      <h2>Select matching logic</h2>

      <select id="matching-logic-select-1" v-register="register('favoriteGame')">
        <option value="monopoly">Monopoly</option>
        <option value="chess">chess Top</option>
        <option value="chess">Chess Middle</option>
        <option value="chess">Chess Bottom</option>
        <option value="blackjack">Blackjack</option>
      </select>
    </section>
  </div>
</template>
