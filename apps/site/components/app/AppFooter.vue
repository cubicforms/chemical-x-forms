<script setup lang="ts">
  import { Heart } from 'lucide-vue-next'

  const year = new Date().getFullYear()
  const { attaformVersion } = useRuntimeConfig().public

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
  <!-- The footer's top edge gets a hairline gradient instead of a flat
       border — it visually "hands off" the page rather than slamming
       into a hard line. The .footer-divider rule below paints it via
       a 1px-tall pseudo-element so we can fade in from both sides. -->
  <footer class="footer-divider relative mt-24">
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
            A type-safe, schema-driven form library for Vue 3 and Nuxt with first-class Zod support.
          </p>
          <!-- Version chip — warm-soft pair on a small inline pill so
               it ties to the hero release chip without competing with
               the brand block heading. The dot is the same warm hue
               (no animate-ping here — that's the hero's job). -->
          <a
            href="https://github.com/attaform/attaform/releases"
            target="_blank"
            rel="noopener noreferrer"
            class="mt-1 inline-flex items-center gap-2 self-start rounded-full bg-warm-soft px-2.5 py-1 text-xs font-medium text-warm-soft-fg transition-colors duration-(--duration-fast) hover:bg-warm-soft/80"
          >
            <span class="h-1 w-1 rounded-full bg-warm" aria-hidden="true" />
            v{{ attaformVersion }} · MIT
          </a>
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
        <p class="flex items-center gap-1.5 text-sm text-fg-subtle">
          <span>© {{ year }} Oswald Chisala · MIT License</span>
        </p>
        <p class="flex items-center gap-1.5 text-sm text-fg-subtle">
          <span class="heart-host inline-flex items-center gap-1.5">
            <span>Made with</span>
            <Heart
              class="heart-pulse h-3 w-3 text-accent"
              fill="currentColor"
              :stroke-width="0"
              aria-label="care"
            />
          </span>
          <span class="mx-1 hidden text-fg-subtle/50 sm:inline" aria-hidden="true">·</span>
          <span class="hidden sm:inline">Built with</span>
          <a
            href="https://vuejs.org"
            target="_blank"
            rel="noopener noreferrer"
            class="hidden font-medium text-fg-muted transition-colors hover:text-fg sm:inline"
            >Vue</a
          >
          <span class="hidden sm:inline">+</span>
          <a
            href="https://nuxt.com"
            target="_blank"
            rel="noopener noreferrer"
            class="hidden font-medium text-fg-muted transition-colors hover:text-fg sm:inline"
            >Nuxt</a
          >
        </p>
      </div>
    </UiContainer>
  </footer>
</template>

<style scoped>
  /* Stripe-style hairline at the top edge — fades in from both sides
     instead of running edge-to-edge. Pseudo-element rather than a
     `border-top` so the gradient mask works without `mask-border-*`
     gymnastics. */
  .footer-divider::before {
    content: '';
    position: absolute;
    inset-inline: 0;
    top: 0;
    height: 0.0625rem;
    background: linear-gradient(
      to right,
      transparent 0%,
      var(--color-border-strong) 50%,
      transparent 100%
    );
  }

  /* The heart picks up a one-time soft pulse on hover of its host span.
     Scoped so it only fires when the user is hovering specifically the
     "Made with ❤" cluster, not anywhere else in the footer row. */
  .heart-host:hover .heart-pulse {
    animation: heart-pulse 320ms var(--ease-spring) 1;
  }
  @keyframes heart-pulse {
    0% {
      transform: scale(1);
    }
    50% {
      transform: scale(1.25);
    }
    100% {
      transform: scale(1);
    }
  }
</style>
