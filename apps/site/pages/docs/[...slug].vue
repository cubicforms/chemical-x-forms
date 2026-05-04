<script setup lang="ts">
  definePageMeta({ layout: 'docs' })

  const route = useRoute()

  const { data: page } = await useAsyncData(`content-${route.path}`, () =>
    queryCollection('docs').path(route.path).first()
  )

  if (!page.value) {
    throw createError({ statusCode: 404, statusMessage: 'Page not found', fatal: true })
  }

  useHead(() => ({
    title: page.value?.title ? `${page.value.title} · Attaform` : 'Documentation · Attaform',
    meta: page.value?.description ? [{ name: 'description', content: page.value.description }] : [],
  }))
</script>

<template>
  <div class="flex gap-12">
    <!-- Article — capped at max-w-3xl (768px) for comfortable reading
         line length. min-w-0 prevents overflow from wide code blocks
         pushing the TOC off-screen. flex-1 lets it grow into available
         space when the TOC is hidden (lg-xl viewports). -->
    <article class="min-w-0 max-w-3xl flex-1">
      <DocsBreadcrumb class="mb-8" />
      <div class="docs-prose prose prose-neutral max-w-none dark:prose-invert">
        <ContentRenderer v-if="page" :value="page" />
      </div>
      <DocsPager class="mt-16" />
    </article>
    <DocsTOC :links="page?.body?.toc?.links" />
  </div>
</template>

<!-- Prose styling overrides — non-scoped because Nuxt Content's
     ContentRenderer emits markup outside Vue's component scope so
     scoped styles wouldn't reach it. The `.docs-prose` class scopes
     these rules instead. -->
<style>
  .docs-prose {
    /* Tailwind Typography plugin's color tokens, repointed at our
       design tokens so prose flips light/dark with the rest of the
       site. Without these the plugin uses its own gray ramp which
       drifts away from our gray ramp. */
    --tw-prose-body: var(--color-fg);
    --tw-prose-headings: var(--color-fg);
    --tw-prose-lead: var(--color-fg-muted);
    --tw-prose-links: var(--color-accent);
    --tw-prose-bold: var(--color-fg);
    --tw-prose-counters: var(--color-fg-subtle);
    --tw-prose-bullets: var(--color-border-strong);
    --tw-prose-hr: var(--color-border);
    --tw-prose-quotes: var(--color-fg);
    --tw-prose-quote-borders: var(--color-accent);
    --tw-prose-captions: var(--color-fg-subtle);
    --tw-prose-code: var(--color-fg);
    --tw-prose-pre-code: var(--color-gray-50);
    --tw-prose-pre-bg: var(--color-gray-950);
    --tw-prose-th-borders: var(--color-border);
    --tw-prose-td-borders: var(--color-border);
  }

  /* Anchor jumps need a top offset to clear the sticky header
     (h-16 = 64px) plus a bit of breathing room. Browsers honor
     scroll-margin-top on the *target* element of an anchor jump. */
  .docs-prose :is(h1, h2, h3, h4) {
    scroll-margin-top: 6rem;
    letter-spacing: -0.012em;
  }

  /* h1 picks up the design system's display-md size so the article
     opening reads at the same scale as the docs index hero. */
  .docs-prose h1 {
    font-size: var(--text-display-md);
    line-height: var(--text-display-md--line-height);
    letter-spacing: var(--text-display-md--letter-spacing);
    font-weight: 600;
    margin-bottom: 1rem;
  }

  /* Inline code chip — the typography plugin's default leans muted
     gray-on-gray, which doesn't read as "code" to the eye when
     surrounded by prose. Tinted bg + monospace + thin border makes
     it scan as a code reference at a glance. */
  .docs-prose :where(p, li, td, th) > code {
    font-family: var(--font-mono);
    font-size: 0.875em;
    background: var(--color-surface);
    padding: 0.1em 0.4em;
    border-radius: 4px;
    border: 1px solid var(--color-border);
    font-weight: 500;
  }
  /* Strip the typography plugin's default backtick quotes around
     inline code — we already chip-style the code, the quotes are
     redundant noise. */
  .docs-prose :where(p, li, td, th) > code::before,
  .docs-prose :where(p, li, td, th) > code::after {
    content: '';
  }

  /* Code block — the typography plugin's default has a subtle dark
     pre with light syntax. Bumping the radius to xl (12px) to match
     our card chrome and adding a 1px border helps it sit on the
     page rather than floating. */
  .docs-prose pre {
    border-radius: 12px;
    border: 1px solid var(--color-border-strong);
    padding: 1.25rem 1.5rem;
    font-size: 0.875rem;
    line-height: 1.6;
  }

  /* Blockquotes as Untitled UI callouts — accent border-left + the
     accent-soft tint pair. Strips the default italic font-style;
     callouts read as "this is important", not "this is a quote". */
  .docs-prose blockquote {
    border-left: 3px solid var(--color-accent);
    background: var(--color-accent-soft);
    padding: 1rem 1.25rem;
    margin: 1.5rem 0;
    border-radius: 0 8px 8px 0;
    font-style: normal;
    quotes: none;
  }
  .docs-prose blockquote :where(p) {
    margin: 0;
    color: var(--color-accent-soft-fg);
  }
  .docs-prose blockquote :where(p)::before,
  .docs-prose blockquote :where(p)::after {
    content: '';
  }

  /* Tables — Untitled UI compact striping pattern. Header row gets
     a subtle surface tint; row borders use our border token so they
     pick up the dark-mode flip automatically. */
  .docs-prose table {
    font-size: 0.9375rem;
  }
  .docs-prose table thead {
    background: var(--color-surface);
  }
  .docs-prose table th {
    font-weight: 600;
    color: var(--color-fg);
  }
</style>
