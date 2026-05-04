<script setup lang="ts">
  const sections = [
    {
      title: 'Getting started',
      body: 'Install, schema, render, submit. The shortest path to a typed form.',
      to: '/docs/api',
    },
    {
      title: 'API reference',
      body: 'Every public export with signatures and return shapes.',
      to: '/docs/api',
    },
    {
      title: 'Recipes',
      body: 'Task-oriented walkthroughs: persistence, transforms, async validation, focus-on-error.',
      to: '/docs/recipes/transforms',
    },
    {
      title: 'Troubleshooting',
      body: 'Common gotchas, hydration mismatches, slim-primitive write errors.',
      to: '/docs/troubleshooting',
    },
    {
      title: 'Migration guides',
      body: 'Per-release upgrade notes. Latest: 0.13 → 0.14.',
      to: '/docs/migration/0.13-to-0.14',
    },
    {
      title: 'Performance',
      body: 'How attaform scales. When to worry. Microbenchmarks.',
      to: '/docs/perf',
    },
  ]
</script>

<template>
  <UiContainer size="lg">
    <div class="py-16">
      <h1 class="text-4xl font-semibold tracking-tight">Documentation</h1>
      <p class="mt-3 max-w-2xl text-(--color-fg-muted)">
        Everything you need to use Attaform end-to-end.
      </p>
      <div class="mt-12 grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        <NuxtLink
          v-for="section in sections"
          :key="section.to"
          :to="section.to"
          class="group rounded-lg border border-(--color-border) bg-(--color-surface) p-5 transition-colors hover:border-(--color-accent)"
        >
          <h3 class="font-semibold group-hover:text-(--color-accent)">{{ section.title }}</h3>
          <p class="mt-2 text-sm text-(--color-fg-muted)">{{ section.body }}</p>
        </NuxtLink>
      </div>
    </div>
  </UiContainer>
</template>
