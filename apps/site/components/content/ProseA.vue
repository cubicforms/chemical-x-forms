<script setup lang="ts">
  // Override Nuxt Content's default <a> rendering inside markdown.
  //
  // External http(s) links open in a new tab — the docs corpus
  // legitimately points at github.com (repo source, issues, releases),
  // npm, MDN, etc., and pulling readers off the docs page on those
  // links is rude. In-site routes (Nuxt Content's normalised paths)
  // pass through to NuxtLink for client-side navigation; relative /
  // anchor links render as plain <a>.

  const props = defineProps<{
    href?: string
    title?: string
  }>()

  const isExternal = computed(() => /^https?:\/\//i.test(props.href ?? ''))
  const isAnchor = computed(() => (props.href ?? '').startsWith('#'))
  const isProtocolOther = computed(() => {
    const h = props.href ?? ''
    return /^[a-z][a-z0-9+.-]*:/i.test(h) && !isExternal.value
  })
  const isInternalRoute = computed(
    () => !isExternal.value && !isAnchor.value && !isProtocolOther.value && Boolean(props.href)
  )
</script>

<template>
  <a v-if="isExternal" :href="href" :title="title" target="_blank" rel="noopener noreferrer">
    <slot />
  </a>
  <NuxtLink v-else-if="isInternalRoute" :to="href!" :title="title">
    <slot />
  </NuxtLink>
  <a v-else :href="href" :title="title">
    <slot />
  </a>
</template>
