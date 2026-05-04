<script setup lang="ts">
  import { ChevronRight } from 'lucide-vue-next'

  // Segments come from `useDocsBreadcrumb()` (auto-imported); each
  // entry has a label and optional `to`. Segments without `to` are
  // rendered as plain spans — section headings and the current page
  // shouldn't be navigation targets.
  const segments = useDocsBreadcrumb()
</script>

<template>
  <nav
    aria-label="Breadcrumb"
    class="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-sm text-fg-subtle"
  >
    <template v-for="(segment, i) in segments" :key="i">
      <!-- The crumb wrapper carries the stagger animation. Each segment
           consumes a per-index delay so the trail reads left-to-right
           like a path being traced rather than a row appearing all at
           once. The outer `<span>` is needed because applying both the
           animation class and the `font-medium` modifier directly on
           the link / non-link span would double-bind classes. -->
      <span class="crumb-step inline-flex items-center" :style="`--crumb-step-delay: ${i * 50}ms`">
        <NuxtLink
          v-if="segment.to"
          :to="segment.to"
          class="crumb-link transition-colors duration-(--duration-fast) hover:text-fg"
        >
          {{ segment.label }}
        </NuxtLink>
        <span v-else :class="i === segments.length - 1 ? 'font-medium text-fg' : 'text-fg-muted'">
          {{ segment.label }}
        </span>
      </span>
      <!-- Chevron sits at half-opacity by default; brightens when the
           previous segment is hovered so the path reads as connected
           rather than a string of independent glyphs. The `:has(...)`
           selector handles "previous segment hover lights this
           chevron"; on browsers without :has the chevrons stay at
           50% opacity, which is fine. -->
      <ChevronRight
        v-if="i < segments.length - 1"
        class="crumb-chevron h-3.5 w-3.5 text-fg-subtle"
        :stroke-width="2"
        aria-hidden="true"
      />
    </template>
  </nav>
</template>

<style scoped>
  /* Stagger entrance — each crumb fades up with a 50ms offset from its
     index. Total trail of 4 crumbs lands in ~200ms + the keyframe's
     duration, which sits below the threshold where the eye starts
     reading it as "loading." */
  .crumb-step {
    animation: reveal-fade-up var(--duration-base) var(--ease-out-quart) both;
    animation-delay: var(--crumb-step-delay, 0ms);
  }
  .crumb-chevron {
    opacity: 0.6;
    transition: opacity var(--duration-fast) var(--ease-out-quart);
  }
  /* Brighten the chevron after a hovered crumb so the connecting line
     reads as continuous on hover. :has support is universal as of
     2024 in evergreen browsers. */
  nav:has(.crumb-step:hover) .crumb-step:hover + .crumb-chevron {
    opacity: 1;
  }
</style>
