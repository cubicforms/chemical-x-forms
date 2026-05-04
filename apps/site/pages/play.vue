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
    <div class="py-10">
      <div class="mb-6">
        <h1 class="text-3xl font-semibold tracking-tight">Playground</h1>
        <p class="mt-2 text-(--color-fg-muted)">
          A real Attaform form, running on the live `attaform` source. Edit the schema, watch the
          form re-render. Errors update synchronously by default.
        </p>
      </div>
      <DemoRepl height="calc(100vh - 280px)" />
    </div>
  </UiContainer>
</template>
