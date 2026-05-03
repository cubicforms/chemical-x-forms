<script setup lang="ts">
  import type { RegisterValue } from 'decant/types'

  const { selectValue } = defineProps<{ selectValue: RegisterValue }>()
</script>

<template>
  <div>
    <select v-register="selectValue">
      <option value="apple">Apple</option>
      <option value="banana">Banana</option>
      <option value="cherry">Cherry</option>
    </select>
  </div>
</template>
