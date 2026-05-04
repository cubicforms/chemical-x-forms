<script setup lang="ts">
  // Site-wide head defaults. `titleTemplate` runs the page-supplied
  // title (if any) through "page · Attaform"; pages that set no
  // title fall through to the homepage tagline. seoMeta fills in
  // the Open Graph + Twitter card defaults that link previews
  // (Slack, Twitter, Discord, iMessage) read at unfurl time —
  // individual pages override the description on a case-by-case
  // basis via their own useSeoMeta call.
  useHead({
    htmlAttrs: { lang: 'en' },
    titleTemplate: (title) =>
      title ? `${title} · Attaform` : 'Attaform — Type-safe forms for Vue 3',
  })

  useSeoMeta({
    description:
      'Schema-driven, type-safe forms for Vue 3 — values, errors, validation, persistence, undo/redo, all inferred from a Zod schema.',
    ogTitle: 'Attaform — Type-safe forms for Vue 3',
    ogDescription:
      'Schema-driven, type-safe forms for Vue 3 — values, errors, validation, persistence, undo/redo, all inferred from a Zod schema.',
    ogType: 'website',
    ogSiteName: 'Attaform',
    twitterCard: 'summary_large_image',
    twitterTitle: 'Attaform — Type-safe forms for Vue 3',
    twitterDescription:
      'Schema-driven, type-safe forms for Vue 3 — values, errors, validation, persistence, undo/redo, all inferred from a Zod schema.',
  })
</script>

<template>
  <NuxtLayout>
    <NuxtPage />
  </NuxtLayout>
</template>
