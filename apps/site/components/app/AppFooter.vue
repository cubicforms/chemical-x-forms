<script setup lang="ts">
  const year = new Date().getFullYear()

  // Three categorical link groups + the brand block. Each link
  // declares either `to` (internal — NuxtLink, no target swap) or
  // `href` (external — `<a>` with target/rel set automatically).
  // The split is the same convention Button uses; consumers below
  // don't have to think about it.
  type FooterLink = { label: string; to?: string; href?: string }
  const groups: { heading: string; links: FooterLink[] }[] = [
    {
      heading: 'Resources',
      links: [
        { label: 'Documentation', to: '/docs' },
        { label: 'Playground', to: '/play' },
        { label: 'API reference', to: '/docs/api' },
      ],
    },
    {
      heading: 'Community',
      links: [
        { label: 'GitHub', href: 'https://github.com/attaform/attaform' },
        { label: 'npm', href: 'https://npmjs.com/package/attaform' },
        { label: 'Issues', href: 'https://github.com/attaform/attaform/issues' },
      ],
    },
    {
      heading: 'Project',
      links: [
        {
          label: 'Changelog',
          href: 'https://github.com/attaform/attaform/blob/main/CHANGELOG.md',
        },
        {
          label: 'Releases',
          href: 'https://github.com/attaform/attaform/releases',
        },
        {
          label: 'License',
          href: 'https://github.com/attaform/attaform/blob/main/LICENSE',
        },
      ],
    },
  ]
</script>

<template>
  <footer class="mt-24 border-t border-border">
    <UiContainer size="xl">
      <!-- Top region: brand block + three link groups. Brand block
           takes 2fr so its tagline can breathe; each link group is
           1fr. On small screens the grid collapses into a single
           column so the brand block leads, link groups stack below. -->
      <div class="grid gap-12 py-16 md:grid-cols-[2fr_1fr_1fr_1fr]">
        <div class="flex max-w-xs flex-col gap-3">
          <NuxtLink to="/" class="flex items-center gap-2.5 font-semibold tracking-tight">
            <AppLogo class="h-6 w-6 text-accent" />
            <span>Attaform</span>
          </NuxtLink>
          <p class="text-sm text-fg-muted">
            Type-safe, schema-driven forms for Vue 3 — values, errors, validation, persistence,
            undo/redo, all from one source of truth.
          </p>
        </div>
        <div v-for="group in groups" :key="group.heading">
          <h2 class="text-sm font-semibold text-fg">{{ group.heading }}</h2>
          <ul class="mt-4 flex flex-col gap-3">
            <li v-for="link in group.links" :key="link.label">
              <NuxtLink
                v-if="link.to"
                :to="link.to"
                class="text-sm text-fg-muted transition-colors duration-(--duration-fast) hover:text-fg"
              >
                {{ link.label }}
              </NuxtLink>
              <a
                v-else
                :href="link.href"
                target="_blank"
                rel="noopener noreferrer"
                class="text-sm text-fg-muted transition-colors duration-(--duration-fast) hover:text-fg"
              >
                {{ link.label }}
              </a>
            </li>
          </ul>
        </div>
      </div>

      <!-- Bottom region: copyright + "built with" credit. Separated
           from the link groups by a 1px divider — same pattern as
           Untitled UI's compact footer. -->
      <div
        class="flex flex-col items-center justify-between gap-3 border-t border-border py-6 sm:flex-row"
      >
        <p class="text-sm text-fg-subtle">© {{ year }} Oswald Chisala · MIT License</p>
        <p class="text-sm text-fg-subtle">
          Built with
          <a
            href="https://vuejs.org"
            target="_blank"
            rel="noopener noreferrer"
            class="font-medium text-fg-muted transition-colors hover:text-fg"
            >Vue</a
          >
          +
          <a
            href="https://nuxt.com"
            target="_blank"
            rel="noopener noreferrer"
            class="font-medium text-fg-muted transition-colors hover:text-fg"
            >Nuxt</a
          >
        </p>
      </div>
    </UiContainer>
  </footer>
</template>
