<script setup lang="ts">
  // OG card template — Vue → Satori → 1200×630 PNG, generated at
  // build time by nuxt-og-image. Every prerendered route gets a
  // unique card with the page's title + description, dropped at
  // /__og-image__/<route>/og.png and threaded into <meta
  // property="og:image"> by the SEO module.
  //
  // Satori has strict CSS constraints: flexbox only (no grid, no
  // float, no inline-block); every element with children must set
  // `display: flex`; no text-shadow / decoration / line-height
  // tricks beyond plain numerics. The styles below stay inside that
  // envelope on purpose — anything fancier would render at build but
  // misalign or drop at parse time when Satori's parser hits a
  // declaration it doesn't recognize.
  //
  // The mark is reproduced inline as an inline SVG (matching
  // public/favicon.svg) so the card carries the same brand shape
  // everywhere; we don't rely on file references inside the OG
  // pipeline because Satori's image loader has limited cross-origin
  // / cache behavior in static prerender contexts.
  withDefaults(
    defineProps<{
      title?: string
      description?: string
      siteName?: string
    }>(),
    {
      title: 'Type-safe forms for Vue 3 and Nuxt',
      description: '',
      siteName: 'Attaform',
    }
  )
</script>

<template>
  <div
    style="
      width: 100%;
      height: 100%;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      padding: 80px;
      background-color: #fafafa;
      background-image: linear-gradient(135deg, #ffffff 0%, #f5f3ff 100%);
      font-family: 'Inter', sans-serif;
      color: #18181b;
    "
  >
    <!-- Brand row — wordmark with the same accent square as the
         favicon, so the OG card carries Attaform's mark wherever it
         lands. The accent block is built with HTML rather than the
         SVG path because Satori's SVG support is partial; a div with
         a background colour and a centered "A" reads identically to
         the favicon at 1200px scale. -->
    <div style="display: flex; align-items: center; gap: 20px">
      <div
        style="
          width: 80px;
          height: 80px;
          border-radius: 18px;
          background-color: #6938ef;
          color: #ffffff;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 56px;
          font-weight: 700;
          letter-spacing: -0.04em;
        "
      >
        A
      </div>
      <span style="font-size: 36px; font-weight: 600; letter-spacing: -0.01em">
        {{ siteName }}
      </span>
    </div>

    <!-- Title + description block. Title gets the visual weight of a
         display heading; description plays the role of a subhead and
         caps at three lines visually (Satori doesn't honour
         line-clamp, so we leave it to the description's own length —
         our content schema bounds it at 200 chars which fits two-to-
         three lines at this size). -->
    <div style="display: flex; flex-direction: column; gap: 28px; max-width: 1040px">
      <span
        style="
          font-size: 72px;
          font-weight: 700;
          line-height: 1.05;
          letter-spacing: -0.025em;
          color: #18181b;
          display: flex;
        "
      >
        {{ title }}
      </span>
      <span
        v-if="description"
        style="font-size: 30px; line-height: 1.4; color: #52525b; font-weight: 400; display: flex"
      >
        {{ description }}
      </span>
    </div>

    <!-- Footer row — the canonical host on the left so a screenshot
         shared without context still says where it came from, and a
         keyword-loaded chip on the right so the card carries
         taxonomy past the headline. -->
    <div
      style="
        display: flex;
        align-items: center;
        justify-content: space-between;
        font-size: 24px;
        color: #71717a;
      "
    >
      <span style="display: flex">www.attaform.com</span>
      <span
        style="
          padding: 10px 22px;
          background-color: #ede9fe;
          color: #6938ef;
          border-radius: 999px;
          font-weight: 600;
          font-size: 22px;
          display: flex;
        "
      >
        Vue 3 · Nuxt 4 · Zod
      </span>
    </div>
  </div>
</template>
