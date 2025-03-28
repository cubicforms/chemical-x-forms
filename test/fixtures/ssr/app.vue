<script setup lang="ts">
  import { useForm } from '@runtime/composables/use-form'
  import { z } from 'zod'

  const schema = z.object({
    favoriteGame: z.string().default('chess'),
    chessInArray: z.array(z.string()).default(['chess']),
  })
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

      <select id="matching-logic-select-2" v-register="register('favoriteGame')">
        <option value="chess" selected="false">Chess</option>
      </select>

      <select id="random-nested-select-1" v-register="register('favoriteGame')">
        <div>
          <optgroup>
            <p>
              <span>
                <option value="chess">Chess Option Nested</option>
              </span>
            </p>
          </optgroup>
        </div>
      </select>

      <select id="select-with-no-matching-options-1" v-register="register('favoriteGame')">
        <option value="mario_kart">Mario Kart</option>
        <option value="tekken">Tekken</option>
        <option value="brain_game">Brain Game</option>
      </select>

      <select id="select-without-options-1" v-register="register('favoriteGame')"></select>

      <select
        id="select-with-invalid-element-matching-value-1"
        v-register="register('favoriteGame')"
      >
        <input value="chess" />
      </select>

      <select
        id="select-multiple-false-default-success-case-1"
        v-register="register('favoriteGame')"
      >
        <option value="chess">Chess</option>
      </select>

      <select
        id="select-multiple-false-default-failure-case-1"
        v-register="register('chessInArray')"
      >
        <option value="chess">Chess</option>
      </select>
    </section>
  </div>
</template>
