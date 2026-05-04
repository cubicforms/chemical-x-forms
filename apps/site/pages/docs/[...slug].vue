<script setup lang="ts">
  import { PencilLine, ArrowUpRight } from 'lucide-vue-next'

  definePageMeta({ layout: 'docs' })

  const route = useRoute()

  // Maps `/docs/recipes/transforms` → repo path `docs/recipes/transforms.md`
  // → GitHub edit URL on `main`. The /edit/main/ link drops the
  // visitor straight into the in-browser editor with the right file
  // open (anonymous viewers see a "fork to edit" prompt; signed-in
  // contributors get the editor immediately).
  const editUrl = computed(
    () => `https://github.com/attaform/attaform/edit/main${route.path.replace('/docs', '/docs')}.md`
  )

  const { data: page } = await useAsyncData(`content-${route.path}`, () =>
    queryCollection('docs').path(route.path).first()
  )

  if (!page.value) {
    throw createError({ statusCode: 404, statusMessage: 'Page not found', fatal: true })
  }

  // Title is the bare page name; the site-wide titleTemplate in
  // app.vue appends " · Attaform". Description gets handled
  // separately because useSeoMeta accepts it as a top-level key
  // and it propagates to og:description / twitter:description for
  // free.
  useHead(() => ({ title: page.value?.title ?? 'Documentation' }))
  useSeoMeta({
    description: () => page.value?.description ?? '',
  })
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

      <!-- Edit link sits between prose and pager — same visual weight
           as a footer note (text-sm, fg-muted) so it doesn't compete
           with the article body but stays discoverable for someone
           who'd file a PR. -->
      <div class="mt-12 flex justify-end border-t border-border pt-6">
        <a
          :href="editUrl"
          target="_blank"
          rel="noopener noreferrer"
          class="inline-flex items-center gap-1.5 text-sm text-fg-muted transition-colors duration-(--duration-fast) hover:text-fg"
        >
          <PencilLine class="h-3.5 w-3.5" :stroke-width="2" />
          <span>Edit this page on GitHub</span>
          <ArrowUpRight class="h-3.5 w-3.5" :stroke-width="2" />
        </a>
      </div>

      <DocsPager class="mt-10" />
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
    /* Code-block bg + base color flip with theme. Light mode uses
       gray-50 (matches github-light's #F9FAFB) so the block sits as
       a subtle plate against the page; dark mode uses gray-950 so it
       blends into the page bg with just the border-strong outline
       defining its edge. The actual token colors come from Shiki's
       per-span CSS classes (which @nuxt/content emits with both
       light + dark theme values), so the pre-code base only matters
       for the rare case where Shiki misses a token. */
    --tw-prose-pre-bg: var(--color-gray-50);
    --tw-prose-pre-code: var(--color-fg);
    --tw-prose-th-borders: var(--color-border);
    --tw-prose-td-borders: var(--color-border);

    /* Drop body text from the typography plugin's 16px default to
       15px — one notch above the 14px sidebar / nav scale, so the
       hierarchy reads "controls (14) → content (15) → headings
       (display)" rather than "controls (14) → wall of 16". The
       typography plugin sizes most prose elements (headings, lists,
       code, blockquotes) in `em`, so they all scale proportionally
       from this base. h1's `text-display-md` override is in `rem`,
       so it stays at 36px regardless. */
    font-size: 0.9375rem;
    line-height: 1.65;
  }
  .dark .docs-prose {
    --tw-prose-pre-bg: var(--color-gray-950);
    --tw-prose-pre-code: var(--color-gray-50);
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

  /* Heading permalinks. Nuxt Content already wraps each heading's
     content in an `<a href="#slug">` (you can see it in the rendered
     HTML), so we don't have to inject a separate link node — we just
     style the existing anchor's ::after with a hash glyph that fades
     in on heading hover. The whole heading is clickable; the hash is
     the visible affordance signaling "you can grab a deep link
     here". h1 omitted because it's the article title — the URL
     already addresses it. */
  .docs-prose :where(h2, h3, h4) > a[href^='#'] {
    color: inherit;
    text-decoration: none;
  }
  .docs-prose :where(h2, h3, h4) > a[href^='#']::after {
    content: '#';
    display: inline-block;
    margin-left: 0.5rem;
    color: var(--color-fg-subtle);
    font-weight: 400;
    opacity: 0;
    transition:
      opacity var(--duration-fast) var(--ease-out-quart),
      color var(--duration-fast) var(--ease-out-quart);
  }
  .docs-prose :where(h2, h3, h4):hover > a[href^='#']::after,
  .docs-prose :where(h2, h3, h4) > a[href^='#']:focus-visible::after {
    opacity: 1;
  }
  .docs-prose :where(h2, h3, h4) > a[href^='#']:hover::after {
    color: var(--color-accent);
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
    border-radius: 0.25rem;
    border: 0.0625rem solid var(--color-border);
    font-weight: 500;
  }
  /* Strip the typography plugin's default backtick quotes around
     inline code — they're added via ::before / ::after pseudo-element
     content so the rule has to explicitly clear it everywhere code
     can appear, not just in the chip-styled p/li/td/th contexts.
     Without the heading branch (h1–h6), every inline-code span inside
     a heading rendered with literal `` quotes around it. */
  .docs-prose :where(p, li, td, th, h1, h2, h3, h4, h5, h6) code::before,
  .docs-prose :where(p, li, td, th, h1, h2, h3, h4, h5, h6) code::after {
    content: '';
  }

  /* Code block — the typography plugin's default has a subtle dark
     pre with light syntax. Bumping the radius to xl (12px) to match
     our card chrome and adding a 1px border helps it sit on the
     page rather than floating.
     `overflow-x: auto` belongs to the typography plugin defaults, but
     repeating it here defends against future overrides; `min-width: 0`
     ensures the pre never demands more horizontal space than the
     article column gives it (without this, a long unbroken code line
     could push past max-w-3xl and create a page-level scrollbar). */
  .docs-prose pre {
    border-radius: 0.75rem;
    border: 0.0625rem solid var(--color-border-strong);
    padding: 1.25rem 1.5rem;
    font-size: 0.875rem;
    line-height: 1.6;
    overflow-x: auto;
    min-width: 0;
    max-width: 100%;
  }

  /* Blockquotes as Untitled UI callouts — accent border-left + the
     accent-soft tint pair. Strips the default italic font-style;
     callouts read as "this is important", not "this is a quote". */
  .docs-prose blockquote {
    border-left: 0.1875rem solid var(--color-accent);
    background: var(--color-accent-soft);
    padding: 1rem 1.25rem;
    margin: 1.5rem 0;
    border-radius: 0 0.5rem 0.5rem 0;
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
     pick up the dark-mode flip automatically.
     `display: block` + `overflow-x: auto` makes the table itself a
     horizontally scrollable region when its content's wider than
     the article column. The default `width: 100%` + `table-layout:
     auto` lets columns expand to fit content; without overflow
     handling on the table, a wide column pushes the article past
     max-w-3xl and creates a page-level scrollbar. The cells inside
     keep their `display: table-*` rendering so column alignment
     still works. */
  .docs-prose table {
    display: block;
    overflow-x: auto;
    max-width: 100%;
    font-size: 0.9375rem;
  }
  .docs-prose table thead {
    background: var(--color-surface);
  }
  .docs-prose table th {
    font-weight: 600;
    color: var(--color-fg);
  }

  /* Long unbreakable identifiers in inline code — function signatures
     like `parseApiErrors(payload, options): ParseApiErrorsResult` or
     long type names — would otherwise force the heading / paragraph
     to be at least as wide as the longest identifier. `overflow-wrap:
     anywhere` lets the browser break inside identifiers as a last
     resort, so the article column controls the layout instead of
     the longest function name in the doc. */
  .docs-prose :where(h1, h2, h3, h4, h5, h6, p, li, td, th) code {
    overflow-wrap: anywhere;
    word-break: break-word;
  }

  /* Headings can themselves be over-wide on narrow viewports because
     hX elements have an intrinsic min-content equal to the longest
     unbreakable token inside them. Same fallback as inline code:
     allow break-anywhere so the heading respects column width. */
  .docs-prose :where(h1, h2, h3, h4) {
    overflow-wrap: anywhere;
  }
</style>
