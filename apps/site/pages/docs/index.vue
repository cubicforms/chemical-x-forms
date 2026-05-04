<script setup lang="ts">
  import { Rocket, Code, BookOpen, Wrench, GitBranch, Zap, ArrowRight } from 'lucide-vue-next'

  // Each section gets a lucide icon plus a tinted-chip color via the
  // brand-soft pair. Sticking to the brand palette (rather than
  // varying per-section) keeps the index reading as one product
  // surface rather than six unrelated tiles.
  const sections = [
    {
      title: 'Getting started',
      body: 'Install, schema, render, submit. The shortest path to a typed form.',
      to: '/docs/api',
      icon: Rocket,
    },
    {
      title: 'API reference',
      body: 'Every public export with signatures and return shapes.',
      to: '/docs/api',
      icon: Code,
    },
    {
      title: 'Recipes',
      body: 'Task-oriented walkthroughs: persistence, transforms, async validation, focus-on-error.',
      to: '/docs/recipes/transforms',
      icon: BookOpen,
    },
    {
      title: 'Troubleshooting',
      body: 'Common gotchas, hydration mismatches, slim-primitive write errors.',
      to: '/docs/troubleshooting',
      icon: Wrench,
    },
    {
      title: 'Migration guides',
      body: 'Per-release upgrade notes. Latest: 0.13 → 0.14.',
      to: '/docs/migration/13-to-0.14',
      icon: GitBranch,
    },
    {
      title: 'Performance',
      body: 'How Attaform scales. When to worry. Microbenchmarks.',
      to: '/docs/perf',
      icon: Zap,
    },
  ]
</script>

<template>
  <UiContainer size="lg">
    <div class="py-20">
      <!-- Eyebrow + heading + lede. Eyebrow gives the section context
           without needing an anchor; heading uses the Untitled UI
           display-md scale; lede sits at text-lg with fg-muted for
           the second-tier emphasis. -->
      <p class="text-sm font-semibold tracking-wide text-accent uppercase">Documentation</p>
      <h1 class="mt-3 text-display-md font-semibold text-fg">
        Everything you need to use Attaform.
      </h1>
      <p class="mt-4 max-w-2xl text-lg text-fg-muted">
        Type-safe, schema-driven forms for Vue 3 — values, errors, validation, persistence,
        undo/redo, all from one source of truth.
      </p>

      <!-- Card grid. Each card lifts on hover (1px translate + shadow
           bump from xs → md), the title color shifts to accent, and
           the "Read more" arrow slides 2px right. The interaction is
           a low-stakes signal that the whole card is clickable —
           not just the title. -->
      <div class="mt-14 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
        <NuxtLink
          v-for="section in sections"
          :key="section.to"
          :to="section.to"
          class="group flex flex-col gap-4 rounded-xl border bg-bg p-6 shadow-xs transition-[border-color,box-shadow,transform] duration-(--duration-base) ease-(--ease-out-quart) hover:-translate-y-0.5 hover:border-accent/60 hover:shadow-md focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-accent-ring"
        >
          <div
            class="flex h-10 w-10 items-center justify-center rounded-lg bg-accent-soft text-accent-soft-fg"
          >
            <component :is="section.icon" class="h-5 w-5" :stroke-width="2" />
          </div>
          <div class="flex-1">
            <h3
              class="text-lg font-semibold text-fg transition-colors duration-(--duration-fast) group-hover:text-accent"
            >
              {{ section.title }}
            </h3>
            <p class="mt-1.5 text-sm text-fg-muted">{{ section.body }}</p>
          </div>
          <div class="flex items-center gap-1.5 text-sm font-semibold text-accent">
            <span>Read more</span>
            <ArrowRight
              class="h-4 w-4 transition-transform duration-(--duration-fast) ease-(--ease-out-quart) group-hover:translate-x-0.5"
              :stroke-width="2.25"
            />
          </div>
        </NuxtLink>
      </div>
    </div>
  </UiContainer>
</template>
