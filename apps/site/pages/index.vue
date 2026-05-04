<script setup lang="ts">
  const features = [
    {
      title: 'Schema-driven types',
      body: 'Every path, value, and error is inferred from your Zod schema. No `any`, no manual type plumbing.',
    },
    {
      title: 'Live validation',
      body: 'Per-field validation on change, blur, or submit. Synchronous by default; async refinements await before submit dispatches.',
    },
    {
      title: 'Field arrays + undo/redo',
      body: 'Typed `append` / `insert` / `remove` / `swap`, plus a bounded undo stack you can opt into per-form.',
    },
    {
      title: 'SSR + persistence',
      body: 'Nuxt round-trips payload automatically. Per-field opt-in drafts to localStorage / sessionStorage / IndexedDB.',
    },
  ]
</script>

<template>
  <div>
    <section class="border-b border-(--color-border) py-24">
      <UiContainer size="lg">
        <h1 class="max-w-3xl text-5xl font-semibold tracking-tight md:text-6xl md:leading-[1.05]">
          Type-safe forms for Vue&nbsp;3, schema-first.
        </h1>
        <p class="mt-6 max-w-2xl text-lg text-(--color-fg-muted)">
          Attaform turns your Zod schema into a fully reactive form surface — values, errors,
          validation, persistence, undo/redo — all inferred from a single source of truth.
        </p>
        <div class="mt-8 flex flex-wrap gap-3">
          <UiButton to="/docs" size="lg">Read the docs</UiButton>
          <UiButton to="/play" size="lg" variant="secondary">Try it live</UiButton>
          <UiButton href="https://github.com/attaform/attaform" size="lg" variant="ghost">
            GitHub
          </UiButton>
        </div>
      </UiContainer>
    </section>

    <section class="py-20">
      <UiContainer size="lg">
        <div class="grid gap-x-8 gap-y-10 md:grid-cols-2">
          <div v-for="feature in features" :key="feature.title">
            <h3 class="text-base font-semibold">{{ feature.title }}</h3>
            <p class="mt-2 text-(--color-fg-muted)">{{ feature.body }}</p>
          </div>
        </div>
      </UiContainer>
    </section>

    <section class="py-20">
      <UiContainer size="xl">
        <div class="mb-6 flex items-end justify-between gap-6">
          <div>
            <h2 class="text-3xl font-semibold tracking-tight">A schema is the form.</h2>
            <p class="mt-2 max-w-2xl text-(--color-fg-muted)">
              Edit the schema, edit the template, watch it run. No backend, no build step — every
              change re-renders live.
            </p>
          </div>
          <UiButton to="/play" variant="link">Open full playground →</UiButton>
        </div>
        <DemoRepl height="540px" />
      </UiContainer>
    </section>
  </div>
</template>
