<script setup lang="ts">
  import { ArrowLeft, ArrowRight } from 'lucide-vue-next'

  // `useDocsPagination()` walks the canonical reading order in
  // `docsLinksFlat` and returns the prev/next entries adjacent to
  // the current path. Both can be null at the start / end of the
  // list — the template branches on that.
  const pagination = useDocsPagination()
</script>

<template>
  <nav
    v-if="pagination.prev || pagination.next"
    aria-label="Page navigation"
    class="grid grid-cols-1 gap-3 border-t border-border pt-10 sm:grid-cols-2 sm:gap-4"
  >
    <NuxtLink
      v-if="pagination.prev"
      :to="pagination.prev.to"
      class="group flex flex-col items-start gap-1 rounded-xl border bg-bg p-4 shadow-xs transition-[border-color,box-shadow,transform] duration-(--duration-base) ease-(--ease-out-quart) hover:-translate-y-0.5 hover:border-accent/40 hover:shadow-md focus-visible:ring-4 focus-visible:ring-accent-ring focus-visible:outline-none sm:col-start-1"
    >
      <span
        class="flex items-center gap-1.5 text-xs font-semibold tracking-wide text-fg-subtle uppercase"
      >
        <ArrowLeft
          class="h-3.5 w-3.5 transition-transform duration-(--duration-fast) ease-(--ease-out-quart) group-hover:-translate-x-0.5 group-hover:scale-110"
          :stroke-width="2.25"
        />
        Previous
      </span>
      <span
        class="text-base font-semibold text-fg transition-colors duration-(--duration-fast) group-hover:text-accent"
      >
        {{ pagination.prev.title }}
      </span>
    </NuxtLink>
    <!-- spacer ensures the next pager hugs the right column even
         when no previous entry exists (start of the list) -->
    <div v-else class="hidden sm:block" />

    <NuxtLink
      v-if="pagination.next"
      :to="pagination.next.to"
      class="group flex flex-col items-end gap-1 rounded-xl border bg-bg p-4 shadow-xs transition-[border-color,box-shadow,transform] duration-(--duration-base) ease-(--ease-out-quart) hover:-translate-y-0.5 hover:border-accent/40 hover:shadow-md focus-visible:ring-4 focus-visible:ring-accent-ring focus-visible:outline-none sm:col-start-2"
    >
      <span
        class="flex items-center gap-1.5 text-xs font-semibold tracking-wide text-fg-subtle uppercase"
      >
        Next
        <ArrowRight
          class="h-3.5 w-3.5 transition-transform duration-(--duration-fast) ease-(--ease-out-quart) group-hover:translate-x-0.5 group-hover:scale-110"
          :stroke-width="2.25"
        />
      </span>
      <span
        class="text-right text-base font-semibold text-fg transition-colors duration-(--duration-fast) group-hover:text-accent"
      >
        {{ pagination.next.title }}
      </span>
    </NuxtLink>
  </nav>
</template>
