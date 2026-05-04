<template>
  <!-- The mark itself transitions on hover via the `app-logo` class —
       opacity already happens at the parent NuxtLink level (header,
       footer); this layer adds a tiny spring-scaled pop so the mark
       feels tactile under the cursor. The transform composes with
       parent opacity rather than replacing it. -->
  <svg
    class="app-logo"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <rect x="3" y="3" width="18" height="18" rx="4" />
    <path d="M8 16 L12 8 L16 16" />
    <path d="M9.5 13 L14.5 13" />
  </svg>
</template>

<style scoped>
  /* The transition lives on the SVG itself (not the parent link) so
     the scale pop is visible even when the parent's hover state only
     moves opacity. Spring easing overshoots gently — at 80ms it reads
     as a press, not a bounce. */
  .app-logo {
    transition: transform var(--duration-snappy) var(--ease-spring);
    transform-origin: center;
  }
  /* Trigger from any hovered ancestor (NuxtLink wraps the logo in both
     the header and footer). `:hover svg` would only fire on the SVG
     itself, missing pointer events that hit the surrounding text. */
  :where(a:hover, button:hover) > .app-logo,
  .app-logo:hover {
    transform: scale(1.06);
  }
</style>
