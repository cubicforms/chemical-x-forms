<script setup lang="ts">
  // The nav structure is hand-curated in `composables/useDocsNavigation.ts`
  // so the sidebar, pager, and breadcrumb all walk the same source.
  // Auto-imported by Nuxt — re-aliased onto a script-local const so
  // vue-tsc resolves it from the component instance type when checking
  // the template (it doesn't see Nuxt's global auto-import declarations
  // through the template compiler at type time).
  const sections = docsNavigation
</script>

<template>
  <aside class="hidden shrink-0 lg:block lg:w-64">
    <!-- Sticky positioning so the sidebar follows the reader. The
         top offset (top-24 = 96px) clears the sticky page header
         (h-16 = 64px) plus a 32px gutter. max-h + overflow-y-auto
         lets long sections scroll independently of the page when
         the docs nav is taller than the viewport. -->
    <nav class="sticky top-24 max-h-[calc(100vh-7rem)] overflow-y-auto pr-3 pb-8">
      <div v-for="section in sections" :key="section.heading" class="mb-7 last:mb-0">
        <h3 class="mb-3 text-sm font-semibold text-fg">{{ section.heading }}</h3>
        <ul>
          <li v-for="link in section.links" :key="link.to">
            <!-- exact-active-class flips the link to the active state.
                 The `.docs-nav-item` styles below replace the simple
                 `border-l` with a pseudo-element that scales in from
                 the center on activate — state changes feel intentional
                 rather than instant. Inactive width is preserved (0.0625rem)
                 so the link doesn't reflow when the indicator appears. -->
            <NuxtLink
              :to="link.to"
              exact-active-class="docs-nav-item--active"
              class="docs-nav-item relative block py-1.5 pr-2 pl-4 text-sm text-fg-muted transition-colors duration-(--duration-fast) hover:text-fg"
            >
              {{ link.title }}
            </NuxtLink>
          </li>
        </ul>
      </div>
    </nav>
  </aside>
</template>

<style scoped>
  /* Pseudo-element border so we can transform it independently of the
     link's hit-area. `transform-origin: center` means the bar grows
     out of its midpoint when activating, which feels more deliberate
     than growing from top-down or bottom-up. */
  .docs-nav-item::before {
    content: '';
    position: absolute;
    top: 0;
    bottom: 0;
    left: 0;
    width: 0.0625rem;
    background: var(--color-border);
    transform: scaleY(1);
    transform-origin: center;
    transition:
      background-color var(--duration-fast) var(--ease-out-quart),
      transform var(--duration-base) var(--ease-out-expo);
  }
  .docs-nav-item:hover::before {
    background: var(--color-fg-subtle);
  }
  .docs-nav-item--active {
    color: var(--color-accent);
    font-weight: 500;
  }
  .docs-nav-item--active::before {
    background: var(--color-accent);
    /* The transform makes the bar visibly "bloom" out of center on
       activate. ScaleY 1.001 (effectively 1) so the bar matches the
       link height exactly while still triggering the transform-based
       transition. The transform-origin keeps the growth centered. */
    animation: indicator-grow var(--duration-base) var(--ease-out-expo) both;
  }
</style>
