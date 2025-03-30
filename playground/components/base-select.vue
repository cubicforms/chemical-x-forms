<script setup lang="ts">
  import type { RegisterValue } from '@chemical-x/forms/types'

  // const registerValue = defineRegisterValue()
  const { registerValue } = defineProps<{ registerValue: RegisterValue }>()
</script>

<template>
  <div>
    <p>We're looking at a fruit platter! -- '{{ registerValue.innerRef.value }}'}</p>
    <div :style="{ border: '1px solid red' }">
      Twins...
      <hr />
      <select v-register="registerValue">
        <option value="apple">Apple</option>
        <option value="banana">Banana</option>
        <option value="cherry">Cherry</option>
      </select>
      <hr />
      <select v-register="registerValue">
        <option value="apple">Apple</option>
        <option value="banana">Banana</option>
        <option value="cherry">Cherry</option>
      </select>
    </div>
  </div>
</template>
