<script setup lang="ts">
  const navLinks = [
    { label: 'Docs', to: '/docs' },
    { label: 'Playground', to: '/play' },
  ]

  // Header always carries the translucent fill + 1px hairline so it
  // reads as a sticky element from the first paint. The shadow only
  // appears once content has scrolled beneath — it's what registers
  // the "lifted" depth, and at scroll=0 there's nothing to lift over,
  // so a constant shadow there reads as a flat panel rather than a
  // sticky bar.
  const scrolled = ref(false)
  function onScroll() {
    scrolled.value = window.scrollY > 8
  }
  onMounted(() => {
    window.addEventListener('scroll', onScroll, { passive: true })
    onScroll()
  })
  onUnmounted(() => {
    window.removeEventListener('scroll', onScroll)
  })
</script>

<template>
  <header
    class="sticky top-0 z-40 border-b border-border bg-bg/85 backdrop-blur transition-shadow duration-(--duration-base) ease-(--ease-out-quart)"
    :class="scrolled ? 'shadow-xs' : 'shadow-none'"
  >
    <UiContainer size="xl">
      <div class="flex h-16 items-center justify-between gap-4">
        <NuxtLink
          to="/"
          class="flex items-center gap-2.5 font-semibold tracking-tight transition-opacity duration-(--duration-fast) hover:opacity-80"
        >
          <AppLogo class="h-7 w-7 text-accent" />
          <span class="text-base">Attaform</span>
        </NuxtLink>

        <div class="flex items-center gap-3">
          <DocsSearch />
          <nav class="flex items-center gap-1">
            <NuxtLink
              v-for="link in navLinks"
              :key="link.to"
              :to="link.to"
              active-class="text-fg bg-surface"
              class="rounded-md px-3 py-2 text-sm font-medium text-fg-muted transition-colors duration-(--duration-fast) ease-(--ease-out-quart) hover:bg-surface hover:text-fg"
            >
              {{ link.label }}
            </NuxtLink>
            <a
              href="https://github.com/attaform/attaform"
              target="_blank"
              rel="noopener noreferrer"
              class="rounded-md px-3 py-2 text-sm font-medium text-fg-muted transition-colors duration-(--duration-fast) ease-(--ease-out-quart) hover:bg-surface hover:text-fg"
            >
              GitHub
            </a>
            <span class="mx-1 h-5 w-px bg-border" aria-hidden="true" />
            <AppThemeToggle />
          </nav>
        </div>
      </div>
    </UiContainer>
  </header>
</template>
