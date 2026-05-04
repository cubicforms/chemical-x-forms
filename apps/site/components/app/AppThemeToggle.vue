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
    class="relative inline-flex h-9 w-9 items-center justify-center overflow-hidden rounded-md text-fg-muted transition-colors duration-(--duration-fast) ease-(--ease-out-quart) hover:bg-surface hover:text-fg focus-visible:ring-4 focus-visible:ring-accent-ring focus-visible:outline-none"
    @click="cycle"
  >
    <!-- Vue's <Transition> with mode="out-in" runs the leaver fully
         before the enterer starts. The `theme-spin` keyframes (in
         tailwind.css) rotate the leaving icon 90° clockwise off-stage
         while the entering icon arrives from -90°, meeting the eye
         at 0°. Result: the cycle reads as a single wheel turn rather
         than a swap. `:key="current"` forces Vue to swap component
         instances on each cycle so the transition fires; without it,
         Vue would just patch the icon's `is` and skip the choreography. -->
    <Transition name="theme-spin" mode="out-in">
      <component :is="icon" :key="current" class="h-4 w-4" aria-hidden="true" />
    </Transition>
  </button>
</template>
