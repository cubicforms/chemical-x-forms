<script setup lang="ts">
  import type { RegisterValue } from '@chemical-x/forms/types'

  const { fruit: fruitRegisterValue } = defineProps<{ fruit: RegisterValue }>()
</script>

<template>
  <div :style="{ background: 'gold' }">
    <h1>some random h1</h1>
    <hr />
    <input v-register="fruitRegisterValue" />
    hr
    <span>some random span</span>
    <hr />
    <input placeholder="an unrelated input" />
    <DeeperSfc />
  </div>
</template>
