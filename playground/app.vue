<script lang="ts" setup>
const innerRef = ref("Two")
const elementRef = ref(null)

const picked = {
  innerRef,
  elementRef,
}

function handleSwitchSelectedRadioInput() {
  innerRef.value = innerRef.value === "One" ? "Two" : "One"
}
</script>

<template>
  <div>Picked: <pre>{{ JSON.stringify(innerRef) }}</pre></div>

  <input
    id="one"
    v-xmodel="picked"
    type="radio"
    value="One"
  >
  <label for="one">One</label>

  <input
    id="two"
    v-xmodel="picked"
    type="radio"
    value="Two"
  >
  <label for="two">Two</label>
  <hr>

  <button @click="handleSwitchSelectedRadioInput">
    switch selected radio button
  </button>
</template>
