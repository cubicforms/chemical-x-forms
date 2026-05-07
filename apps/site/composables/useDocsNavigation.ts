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
      { title: 'Why Attaform', to: '/docs/why' },
      { title: 'Quick start', to: '/docs/quickstart' },
    ],
  },
  {
    heading: 'API reference',
    links: [
      { title: 'Overview', to: '/docs/api' },
      { title: 'attaform', to: '/docs/api/core' },
      { title: 'useForm return value', to: '/docs/api/use-form-return' },
      { title: 'attaform/zod', to: '/docs/api/zod' },
      { title: 'attaform/zod-v3', to: '/docs/api/zod-v3' },
      { title: 'attaform/nuxt', to: '/docs/api/nuxt' },
      { title: 'attaform/vite', to: '/docs/api/vite' },
      { title: 'attaform/transforms', to: '/docs/api/transforms' },
      { title: 'Shared types', to: '/docs/api/shared-types' },
    ],
  },
  {
    heading: 'Recipes',
    links: [
      { title: 'App-level defaults', to: '/docs/recipes/app-defaults' },
      { title: 'Async validation', to: '/docs/recipes/async-validation' },
      { title: 'Blank inputs', to: '/docs/recipes/blank-inputs' },
      { title: 'Coercion', to: '/docs/recipes/coerce' },
      { title: 'Custom adapters', to: '/docs/recipes/custom-adapter' },
      { title: 'Devtools', to: '/docs/recipes/devtools' },
      { title: 'Discriminated unions', to: '/docs/recipes/discriminated-unions' },
      { title: 'Dynamic field arrays', to: '/docs/recipes/dynamic-field-arrays' },
      { title: 'Field-level validation', to: '/docs/recipes/field-level-validation' },
      { title: 'Focus on error', to: '/docs/recipes/focus-on-error' },
      { title: 'Form context', to: '/docs/recipes/form-context' },
      { title: 'Persistence', to: '/docs/recipes/persistence' },
      { title: 'Persistence: policy', to: '/docs/recipes/persistence-policy' },
      { title: 'Persistence: backends', to: '/docs/recipes/persistence-backends' },
      { title: 'Persistence: edge cases', to: '/docs/recipes/persistence-edge-cases' },
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
