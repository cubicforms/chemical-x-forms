<script setup lang="ts">
  import { useFormContext } from 'decant'

  const ctx = useFormContext()
  const value = ctx?.getValue()
</script>

<template>
  <div style="background-color: cadetblue">
    Some Surrounding UI
    <input
      v-register="ctx?.register('address.city')"
      type="text"
      style="background-color: yellow"
    />

    Child Component has access to the form:
    <pre>{{ JSON.stringify(value, null, 2) }}</pre>
  </div>
</template>
