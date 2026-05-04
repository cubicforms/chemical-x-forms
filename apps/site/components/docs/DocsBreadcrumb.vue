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
      <NuxtLink
        v-if="segment.to"
        :to="segment.to"
        class="transition-colors duration-(--duration-fast) hover:text-fg"
      >
        {{ segment.label }}
      </NuxtLink>
      <span v-else :class="i === segments.length - 1 ? 'font-medium text-fg' : 'text-fg-muted'">
        {{ segment.label }}
      </span>
      <ChevronRight
        v-if="i < segments.length - 1"
        class="h-3.5 w-3.5 text-fg-subtle"
        :stroke-width="2"
        aria-hidden="true"
      />
    </template>
  </nav>
</template>
