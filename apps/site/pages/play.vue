<script setup lang="ts">
  useHead({
    title: 'Playground · Attaform',
    meta: [
      {
        name: 'description',
        content:
          'Edit a real Attaform form in your browser — values, errors, validation, all live.',
      },
    ],
  })
</script>

<template>
  <UiContainer size="xl">
    <div class="py-12">
      <div class="mb-8 max-w-3xl">
        <p class="text-sm font-semibold tracking-wide text-accent uppercase">Live editor</p>
        <h1 class="mt-3 text-display-md font-semibold text-fg">Playground</h1>
        <p class="mt-4 text-lg text-fg-muted">
          A real Attaform form, running on the live
          <code class="rounded bg-surface px-1.5 py-0.5 font-mono text-base">attaform</code>
          source. Edit the schema, watch the form re-render. Errors update synchronously by default.
        </p>
      </div>
      <DemoRepl height="calc(100vh - 320px)" />
    </div>
  </UiContainer>
</template>
