<!--
  Renders a body string with backtick-wrapped tokens converted to
  `<UiInlineCode>` chips. Use it where the prose lives as data
  (feature-card `body` strings, etc.) rather than as template
  markup, so the chip styling stays delegated to `<UiInlineCode>`
  instead of duplicating its classes.

  Composes via the SFC template's fragment-friendly `<template
  v-for>`; no wrapper DOM node is added, so the consumer's `<p>`
  flow stays intact.
-->
<script setup lang="ts">
  import { computed } from 'vue'

  type Part = { readonly kind: 'code' | 'text'; readonly value: string }

  const props = defineProps<{ text: string }>()

  const parts = computed<Part[]>(() => {
    // Splitting on a capturing group yields alternating prose/capture
    // entries, which is cheaper and clearer than a stateful regex
    // loop while preserving every separator's content.
    const segments = props.text.split(/`([^`]+)`/g)
    const out: Part[] = []
    for (let i = 0; i < segments.length; i++) {
      const value = segments[i] ?? ''
      if (value === '') continue
      out.push({ kind: i % 2 === 1 ? 'code' : 'text', value })
    }
    return out
  })
</script>

<template>
  <template v-for="(part, i) in parts" :key="i">
    <UiInlineCode v-if="part.kind === 'code'">{{ part.value }}</UiInlineCode>
    <template v-else>{{ part.value }}</template>
  </template>
</template>
