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
      title ? `${title} · Attaform` : 'Attaform — Type-safe forms for Vue 3 and Nuxt',
    link: [
      // SVG favicon — modern evergreen browsers render it crisply at
      // every tab size and adapt to high-DPI without a fallback PNG.
      // Hardcoded accent fill (#6938ef) + white "A" strokes so the
      // mark reads cleanly on both light and dark browser chrome.
      { rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' },
      // Raster fallbacks. Bing's SERP favicon pipeline fetches
      // /favicon.ico directly and won't fall back to SVG, so we
      // ship a multi-size ICO (16/32/48) for search engines and
      // older browsers. The matching `apple-touch-icon.png` for
      // iOS home-screen bookmarks is auto-injected by
      // `nuxt-seo-utils` (via @nuxtjs/seo) when it scans
      // `public/` — no explicit <link> needed for that one.
      // All three rasters come from `favicon.svg` via
      // `scripts/generate-favicons.mjs`.
      { rel: 'icon', type: 'image/x-icon', href: '/favicon.ico', sizes: 'any' },
      { rel: 'icon', type: 'image/png', sizes: '32x32', href: '/favicon-32.png' },
    ],
    meta: [
      // Tints mobile-browser chrome (Safari status bar on iOS, the
      // Chrome address bar on Android) to the brand accent so the
      // app surface bleeds into the system surface.
      { name: 'theme-color', content: '#6938ef' },
    ],
  })

  useSeoMeta({
    description:
      'A type-safe, schema-driven form library for Vue 3 and Nuxt with first-class Zod support.',
    ogTitle: 'Attaform — Type-safe forms for Vue 3 and Nuxt',
    ogDescription:
      'A type-safe, schema-driven form library for Vue 3 and Nuxt with first-class Zod support.',
    ogType: 'website',
    ogSiteName: 'Attaform',
    twitterCard: 'summary_large_image',
    twitterTitle: 'Attaform — Type-safe forms for Vue 3 and Nuxt',
    twitterDescription:
      'A type-safe, schema-driven form library for Vue 3 and Nuxt with first-class Zod support.',
  })

  // Default OG card for every route. Pages override per-route by
  // calling `defineOgImageComponent` with their own props; pages
  // that say nothing inherit this baseline. nuxt-og-image hands the
  // component the page's resolved title + description from the head
  // store, so the per-page card automatically carries the right
  // text without each page having to wire it explicitly.
  defineOgImageComponent('Default')
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
