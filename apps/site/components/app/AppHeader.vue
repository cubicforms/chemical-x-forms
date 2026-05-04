<script setup lang="ts">
  const navLinks = [
    { label: 'Docs', to: '/docs' },
    { label: 'Playground', to: '/play' },
  ]
</script>

<template>
  <header
    class="sticky top-0 z-40 border-b border-(--color-border) bg-(--color-bg)/80 backdrop-blur"
  >
    <UiContainer size="xl">
      <div class="flex h-14 items-center justify-between">
        <NuxtLink to="/" class="flex items-center gap-2 font-semibold tracking-tight">
          <AppLogo class="h-6 w-6 text-(--color-accent)" />
          <span>Attaform</span>
        </NuxtLink>
        <nav class="flex items-center gap-6 text-sm">
          <NuxtLink
            v-for="link in navLinks"
            :key="link.to"
            :to="link.to"
            class="text-(--color-fg-muted) hover:text-(--color-fg) transition-colors"
          >
            {{ link.label }}
          </NuxtLink>
          <a
            href="https://github.com/attaform/attaform"
            target="_blank"
            rel="noopener noreferrer"
            class="text-(--color-fg-muted) hover:text-(--color-fg) transition-colors"
          >
            GitHub
          </a>
          <ClientOnly>
            <ThemeToggle />
            <template #fallback>
              <div class="h-9 w-9" aria-hidden="true" />
            </template>
          </ClientOnly>
        </nav>
      </div>
    </UiContainer>
  </header>
</template>
