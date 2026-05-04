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
    <!-- Lightweight cross-fade between routes. The `page` transition
         classes live in `tailwind.css` (`.page-enter-active`,
         `.page-leave-active`, etc.) so the styling reads from the
         same motion vocabulary as the rest of the site. mode="out-in"
         means the leaving page completes its fade before the entering
         page starts — no overlap, no layout flash from absolutely-
         positioned siblings. Anything heavier than this (slides,
         scales) implies directionality the user didn't ask for and
         gets in the way of dense docs reading. -->
    <NuxtPage :transition="{ name: 'page', mode: 'out-in' }" />
  </NuxtLayout>
</template>
