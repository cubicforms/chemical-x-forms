<script setup lang="ts">
  const year = new Date().getFullYear()
</script>

<template>
  <footer class="mt-24 border-t border-(--color-border) py-8">
    <UiContainer size="xl">
      <div
        class="flex flex-col items-center justify-between gap-4 text-sm text-(--color-fg-muted) md:flex-row"
      >
        <p>© {{ year }} Oswald Chisala · MIT</p>
        <nav class="flex items-center gap-6">
          <a
            href="https://github.com/attaform/attaform"
            target="_blank"
            rel="noopener noreferrer"
            class="hover:text-(--color-fg) transition-colors"
          >
            GitHub
          </a>
          <a
            href="https://npmjs.com/package/attaform"
            target="_blank"
            rel="noopener noreferrer"
            class="hover:text-(--color-fg) transition-colors"
          >
            npm
          </a>
          <NuxtLink to="/docs" class="hover:text-(--color-fg) transition-colors"> Docs </NuxtLink>
        </nav>
      </div>
    </UiContainer>
  </footer>
</template>
