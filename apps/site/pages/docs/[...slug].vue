<script setup lang="ts">
  const route = useRoute()

  const { data: page } = await useAsyncData(`content-${route.path}`, () =>
    queryCollection('docs').path(route.path).first()
  )

  if (!page.value) {
    throw createError({ statusCode: 404, statusMessage: 'Page not found', fatal: true })
  }
</script>

<template>
  <UiContainer size="md">
    <article class="prose prose-neutral dark:prose-invert max-w-none py-12">
      <ContentRenderer v-if="page" :value="page" />
    </article>
  </UiContainer>
</template>
