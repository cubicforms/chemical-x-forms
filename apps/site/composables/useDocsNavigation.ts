// Hand-curated docs nav. The order here is the canonical reading
// order: Getting started → Recipes → Operations → Migration. The
// sidebar renders these in this order; the pager (prev/next) walks
// the flattened list in this order; the breadcrumb derives "Docs /
// Section / Page" from this structure.
//
// Hand-curating is intentional. A query-driven nav would order by
// filename or frontmatter, but the right reading order is editorial
// — recipes are small task-oriented pages best shown in the sequence
// a user is likely to need them, not alphabetically. When new docs
// land, add an entry here.

export type DocsLink = { title: string; to: string }
export type DocsSection = { heading: string; links: DocsLink[] }

export const docsNavigation: DocsSection[] = [
  {
    heading: 'Getting started',
    links: [
      { title: 'Documentation home', to: '/docs' },
      { title: 'API reference', to: '/docs/api' },
    ],
  },
  {
    heading: 'Recipes',
    links: [
      { title: 'App-level defaults', to: '/docs/recipes/app-defaults' },
      { title: 'Async validation', to: '/docs/recipes/async-validation' },
      { title: 'Coercion', to: '/docs/recipes/coerce' },
      { title: 'Custom adapters', to: '/docs/recipes/custom-adapter' },
      { title: 'Devtools', to: '/docs/recipes/devtools' },
      { title: 'Discriminated unions', to: '/docs/recipes/discriminated-unions' },
      { title: 'Dynamic field arrays', to: '/docs/recipes/dynamic-field-arrays' },
      { title: 'Field-level validation', to: '/docs/recipes/field-level-validation' },
      { title: 'Focus on error', to: '/docs/recipes/focus-on-error' },
      { title: 'Form context', to: '/docs/recipes/form-context' },
      { title: 'Persistence', to: '/docs/recipes/persistence' },
      { title: 'Server errors', to: '/docs/recipes/server-errors' },
      { title: 'SSR hydration', to: '/docs/recipes/ssr-hydration' },
      { title: 'Transforms', to: '/docs/recipes/transforms' },
      { title: 'Undo / redo', to: '/docs/recipes/undo-redo' },
    ],
  },
  {
    heading: 'Operations',
    links: [
      { title: 'Troubleshooting', to: '/docs/troubleshooting' },
      { title: 'Performance', to: '/docs/perf' },
    ],
  },
  {
    heading: 'Migration',
    // Newest-first reading order — most users coming to migration
    // are upgrading from the most recent prior version.
    links: [
      { title: '0.13 → 0.14', to: '/docs/migration/0.13-to-0.14' },
      { title: '0.12 → 0.13', to: '/docs/migration/0.12-to-0.13' },
      { title: '0.11 → 0.12', to: '/docs/migration/0.11-to-0.12' },
      { title: '0.10 → 0.11', to: '/docs/migration/0.10-to-0.11' },
      { title: '0.7 → 0.8', to: '/docs/migration/0.7-to-0.8' },
      { title: '0.6 → 0.7', to: '/docs/migration/0.6-to-0.7' },
    ],
  },
]

// All links in canonical reading order. Used by the pager (prev/next)
// and any consumer that needs to walk the nav linearly without
// thinking about section grouping.
export const docsLinksFlat: ReadonlyArray<DocsLink> = docsNavigation.flatMap(
  (section) => section.links
)

// Returns the prev/next link for the current route. Composables that
// rely on `useRoute` only work inside Nuxt's reactivity scope — so
// pager components import and call this directly. Returns nulls at
// the start and end of the list.
export function useDocsPagination() {
  const route = useRoute()
  return computed(() => {
    const idx = docsLinksFlat.findIndex((l) => l.to === route.path)
    return {
      prev: idx > 0 ? docsLinksFlat[idx - 1] : null,
      next: idx >= 0 && idx < docsLinksFlat.length - 1 ? docsLinksFlat[idx + 1] : null,
    }
  })
}

// Derives the breadcrumb trail from the current path + the nav
// structure. Always opens with a clickable "Docs" home, then the
// section heading (text only — sections aren't pages), then the
// current page title (text only — we're already there).
export function useDocsBreadcrumb() {
  const route = useRoute()
  return computed(() => {
    const segments: Array<{ label: string; to?: string }> = [{ label: 'Docs', to: '/docs' }]
    for (const section of docsNavigation) {
      const link = section.links.find((l) => l.to === route.path)
      if (link) {
        segments.push({ label: section.heading })
        segments.push({ label: link.title })
        return segments
      }
    }
    return segments
  })
}
