<script setup lang="ts">
  type Variant = 'primary' | 'secondary' | 'ghost' | 'link'
  type Size = 'sm' | 'md' | 'lg' | 'xl'

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

  // Untitled UI button anatomy. Each variant defines four states —
  // rest / hover / focus / disabled — explicitly rather than relying
  // on opacity-based fallbacks. Focus is a 4px tinted ring drawn via
  // box-shadow so it composes with the variant's surface shadow
  // instead of replacing it (the way `outline` would).
  //
  // Disabled states use surface-2 + fg-subtle rather than just
  // dimming the rest state — this reads as "inert affordance" rather
  // than "primary button at half power", which is what users expect
  // from this kind of system.
  const variantClasses: Record<Variant, string> = {
    primary: [
      'bg-accent text-accent-fg shadow-xs',
      'hover:bg-accent-hover',
      'disabled:bg-surface-2 disabled:text-fg-subtle disabled:shadow-none',
    ].join(' '),
    secondary: [
      'bg-bg text-fg border border-border-strong shadow-xs',
      'hover:bg-surface',
      'disabled:bg-surface-2 disabled:text-fg-subtle disabled:border-border disabled:shadow-none',
    ].join(' '),
    ghost: [
      'bg-transparent text-fg-muted',
      'hover:bg-surface hover:text-fg',
      'disabled:text-fg-subtle disabled:bg-transparent',
    ].join(' '),
    link: [
      'bg-transparent text-accent underline-offset-4 px-0! hover:underline',
      'hover:text-accent-hover',
      'disabled:text-fg-subtle disabled:no-underline',
    ].join(' '),
  }

  // Sizes follow Untitled UI's tier — sm=36, md=40 (default), lg=44,
  // xl=48 — so a button next to an input in the same row sits on the
  // same baseline. Typography pairs: sm/md use text-sm (14px) which
  // reads dense; lg/xl use text-base (16px) which reads as
  // attention-getting (hero CTAs). Gap scales with size so an icon
  // never crowds the label.
  const sizeClasses: Record<Size, string> = {
    sm: 'h-9 px-3 text-sm gap-1.5',
    md: 'h-10 px-3.5 text-sm gap-2',
    lg: 'h-11 px-4 text-base gap-2',
    xl: 'h-12 px-5 text-base gap-2.5',
  }

  const baseClasses = [
    // Layout — flex centers icon + label, whitespace-nowrap keeps
    // multi-word CTAs ("Read the docs") on one line under their h-*
    'inline-flex items-center justify-center font-semibold rounded-md whitespace-nowrap',
    // Motion — only animate the props that actually change between
    // states. Animating `all` would catch layout properties and
    // produce visible jank during hover.
    'transition-[background-color,color,box-shadow,border-color] duration-(--duration-fast) ease-(--ease-out-quart)',
    // Focus — the Untitled UI soft ring. `outline-none` kills the
    // browser default; the ring composes with the variant shadow.
    'focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-accent-ring',
    // Disabled — affordance off. `disabled` attribute on <button>
    // already blocks tab; this handles the visual + cursor for
    // anchors/NuxtLinks where `disabled` doesn't natively apply.
    'disabled:cursor-not-allowed disabled:pointer-events-none',
  ].join(' ')

  const classes = computed(() => [
    baseClasses,
    variantClasses[props.variant],
    sizeClasses[props.size],
  ])

  // External (http/https) hrefs auto-open in a new tab and pick up
  // the `noopener noreferrer` rel for security. Same-origin links
  // don't get target="_blank" because that's user-hostile for
  // internal navigation. Detection is a simple prefix check —
  // protocol-relative URLs (`//foo`) are uncommon and would slip
  // through; we accept that.
  const isExternal = computed(() => /^https?:\/\//.test(props.href ?? ''))
</script>

<template>
  <NuxtLink v-if="to" :to="to" :class="classes">
    <slot />
  </NuxtLink>
  <a
    v-else-if="href"
    :href="href"
    :target="isExternal ? '_blank' : undefined"
    :rel="isExternal ? 'noopener noreferrer' : undefined"
    :class="classes"
  >
    <slot />
  </a>
  <button v-else :type="type" :disabled="disabled" :class="classes">
    <slot />
  </button>
</template>
