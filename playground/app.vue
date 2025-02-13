<script lang="ts" setup>
const element = ref(null)
const innerValue = ref("b")
const supermodel = {
  innerValue,
  element,
}
</script>

<template>
  <select
    v-supermodel="supermodel"
  >
    <option value="a">
      first option
    </option>
    <option value="b">
      second option
    </option>
    <option value="c">
      third option
    </option>
  </select>
</template>
