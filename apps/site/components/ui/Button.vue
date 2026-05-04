<script setup lang="ts">
  type Variant = 'primary' | 'secondary' | 'ghost' | 'link'
  type Size = 'sm' | 'md' | 'lg'

  const props = withDefaults(
    defineProps<{
      variant?: Variant
      size?: Size
      to?: string
      href?: string
      type?: 'button' | 'submit' | 'reset'
      disabled?: boolean
    }>(),
    { variant: 'primary', size: 'md', type: 'button' }
  )

  const variantClasses: Record<Variant, string> = {
    primary: 'bg-(--color-accent) text-(--color-accent-fg) hover:opacity-90',
    secondary:
      'bg-(--color-surface) text-(--color-fg) border border-(--color-border) hover:bg-(--color-surface-2)',
    ghost: 'bg-transparent text-(--color-fg) hover:bg-(--color-surface)',
    link: 'bg-transparent text-(--color-accent) hover:underline underline-offset-4 px-0',
  }

  const sizeClasses: Record<Size, string> = {
    sm: 'h-8 px-3 text-sm',
    md: 'h-10 px-4 text-sm',
    lg: 'h-12 px-6 text-base',
  }

  const baseClasses =
    'inline-flex items-center justify-center gap-2 rounded-md font-medium transition-colors disabled:opacity-50 disabled:pointer-events-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--color-accent)'

  const classes = computed(() => [
    baseClasses,
    variantClasses[props.variant],
    sizeClasses[props.size],
  ])
</script>

<template>
  <NuxtLink v-if="to" :to="to" :class="classes">
    <slot />
  </NuxtLink>
  <a v-else-if="href" :href="href" :class="classes" rel="noopener noreferrer">
    <slot />
  </a>
  <button v-else :type="type" :disabled="disabled" :class="classes">
    <slot />
  </button>
</template>
