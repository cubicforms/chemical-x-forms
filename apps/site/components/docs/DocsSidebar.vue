<script setup lang="ts">
  // The nav structure is hand-curated in `composables/useDocsNavigation.ts`
  // so the sidebar, pager, and breadcrumb all walk the same source.
  // Auto-imported by Nuxt; no explicit import here.
</script>

<template>
  <aside class="hidden shrink-0 lg:block lg:w-64">
    <!-- Sticky positioning so the sidebar follows the reader. The
         top offset (top-24 = 96px) clears the sticky page header
         (h-16 = 64px) plus a 32px gutter. max-h + overflow-y-auto
         lets long sections scroll independently of the page when
         the docs nav is taller than the viewport. -->
    <nav class="sticky top-24 max-h-[calc(100vh-7rem)] overflow-y-auto pr-3 pb-8">
      <div v-for="section in docsNavigation" :key="section.heading" class="mb-7 last:mb-0">
        <h3 class="mb-3 text-sm font-semibold text-fg">{{ section.heading }}</h3>
        <ul>
          <li v-for="link in section.links" :key="link.to">
            <!-- exact-active-class so /docs's "Documentation home"
                 entry only highlights when *exactly* on /docs, not
                 on every /docs/* descendant. The accent border-left
                 reads as the section indicator; the inactive border
                 carries the same width so links don't shift 1px when
                 their state flips. -->
            <NuxtLink
              :to="link.to"
              exact-active-class="border-accent text-accent font-medium"
              class="block border-l border-border py-1.5 pr-2 pl-4 text-sm text-fg-muted transition-colors duration-(--duration-fast) hover:border-fg-subtle hover:text-fg"
            >
              {{ link.title }}
            </NuxtLink>
          </li>
        </ul>
      </div>
    </nav>
  </aside>
</template>
