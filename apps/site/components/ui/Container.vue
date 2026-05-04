<script setup lang="ts">
  type Size = 'sm' | 'md' | 'lg' | 'xl'

  withDefaults(defineProps<{ size?: Size }>(), { size: 'lg' })

  const sizeClasses: Record<Size, string> = {
    sm: 'max-w-2xl',
    md: 'max-w-4xl',
    lg: 'max-w-6xl',
    xl: 'max-w-7xl',
  }
</script>

<template>
  <div class="mx-auto px-6 w-full" :class="[sizeClasses[size]]">
    <slot />
  </div>
</template>
