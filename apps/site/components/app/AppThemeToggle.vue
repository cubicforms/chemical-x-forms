<script setup lang="ts">
  import { Sun, Moon, Monitor } from 'lucide-vue-next'

  type Pref = 'system' | 'light' | 'dark'
  const ORDER: readonly Pref[] = ['system', 'light', 'dark'] as const

  const colorMode = useColorMode()

  // Server doesn't know the user's stored preference, so render a
  // neutral default (system / Monitor) and swap to the real value
  // post-mount. Ships the button frame in SSR HTML; only icon and
  // label change on hydration. Avoids the hydration mismatch a naive
  // `colorMode.preference`-bound render would produce.
  const mounted = ref(false)
  onMounted(() => {
    mounted.value = true
  })

  const current = computed<Pref>(() => {
    if (!mounted.value) return 'system'
    return (colorMode.preference as Pref) ?? 'system'
  })

  function cycle() {
    const i = ORDER.indexOf(current.value)
    colorMode.preference = ORDER[(i + 1) % ORDER.length] ?? 'system'
  }

  const icon = computed(() => {
    if (current.value === 'light') return Sun
    if (current.value === 'dark') return Moon
    return Monitor
  })

  const label = computed(() => {
    if (!mounted.value) return 'Toggle theme'
    if (current.value === 'system') return 'Theme: system. Switch to light.'
    if (current.value === 'light') return 'Theme: light. Switch to dark.'
    return 'Theme: dark. Switch to system.'
  })
</script>

<template>
  <button
    type="button"
    :aria-label="label"
    :title="label"
    class="inline-flex h-9 w-9 items-center justify-center rounded-md text-(--color-fg-muted) transition-colors hover:bg-(--color-surface) hover:text-(--color-fg) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--color-accent)"
    @click="cycle"
  >
    <component :is="icon" class="h-4 w-4" aria-hidden="true" />
  </button>
</template>
