<script setup lang="ts">
  // Nuxt Content emits the TOC tree under `page.body.toc.links`. Each
  // link is an h2 by default; nested h3s land under `children`. We
  // render two depths (h2 + h3) and ignore h4+ — the latter are
  // usually internal anchors that don't deserve sidebar real estate.
  type TocLink = {
    id: string
    depth: number
    text: string
    children?: TocLink[]
  }

  const props = defineProps<{ links?: TocLink[] }>()

  // The TOC's job is navigation, not signature documentation. Heading
  // text on API pages reads as `useForm<Form>({ schema, key, ... })` —
  // useful as the page heading itself, but enough nested punctuation
  // to render the sidebar unscannable. Strip the parameter
  // parentheses (iteratively, so nested groups collapse cleanly) and
  // the return-type annotation; the page heading below still shows
  // the full signature for readers who landed via the link.
  type TocDisplay = { readonly text: string; readonly isCode: boolean }

  function tocDisplay(raw: string): TocDisplay {
    let out = raw.replace(/\s*→.*$/, '')
    let prev: string
    do {
      prev = out
      out = out.replace(/\s*\([^()]*\)/g, '')
    } while (out !== prev)
    // Strip generic-parameter brackets too — `injectForm<Form>` reads
    // as `injectForm` in the sidebar. Iterative for nested generics
    // like `Foo<Bar<Baz>>`. The page heading still carries the
    // generic for readers who landed via the link.
    do {
      prev = out
      out = out.replace(/<[^<>]*>/g, '')
    } while (out !== prev)
    out = out.trim()
    // Bare identifiers (post-strip names like `createAttaform`,
    // `useForm`, `vRegister`) render in mono so the sidebar visually
    // separates API references from section headings
    // (`Wrapper-component primitives`, `Error codes`).
    return { text: out, isCode: /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(out) }
  }

  type DecoratedTocLink = TocLink & {
    readonly display: TocDisplay
    readonly children?: DecoratedTocLink[]
  }

  function decorate(list: TocLink[] | undefined): DecoratedTocLink[] {
    return (list ?? []).map((l) => ({
      ...l,
      display: tocDisplay(l.text),
      children: l.children ? decorate(l.children) : undefined,
    }))
  }

  const decoratedLinks = computed<DecoratedTocLink[]>(() => decorate(props.links))

  // Active anchor for scrollspy. IntersectionObserver fires when a
  // heading enters the "active band" defined by rootMargin — top
  // offset clears the sticky header (h-16 = 4rem) + a 1rem gutter,
  // bottom -70% means a heading reads as "active" only when it's in
  // the upper third of the viewport, not as it leaves the bottom.
  // This matches the usual "heading I'm reading is near the top of
  // the screen" intuition.
  //
  // The IntersectionObserver API only accepts `px` and `%` for
  // rootMargin (no `rem` / no CSS values), so we compute the px
  // equivalent from the document root font-size at observer setup.
  // That keeps the active band proportional to the user's root size
  // even though the value handed to the API is a px literal.
  const activeId = ref('')
  let observer: IntersectionObserver | undefined

  function flatten(list: TocLink[]): TocLink[] {
    return list.flatMap((l) => [l, ...flatten(l.children ?? [])])
  }

  function setupObserver() {
    observer?.disconnect()
    const all = flatten(props.links ?? [])
    if (all.length === 0) return

    const elements = all
      .map((l) => document.getElementById(l.id))
      .filter((el): el is HTMLElement => el !== null)
    if (elements.length === 0) return

    const rootFontPx = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16
    const topOffsetPx = Math.round(5 * rootFontPx)

    observer = new IntersectionObserver(
      (entries) => {
        // Pick the topmost currently-intersecting heading. Without
        // this sort we'd flicker between headings that briefly
        // overlap during fast scrolls.
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort(
            (a, b) => a.target.getBoundingClientRect().top - b.target.getBoundingClientRect().top
          )
        if (visible[0]) {
          activeId.value = visible[0].target.id
        }
      },
      { rootMargin: `-${topOffsetPx}px 0px -70% 0px`, threshold: 0 }
    )
    elements.forEach((el) => observer!.observe(el))
  }

  onMounted(setupObserver)
  onUnmounted(() => observer?.disconnect())
  // Re-setup on links change — e.g., user navigates between docs
  // pages, the TOC instance is reused, props.links updates with the
  // new headings. nextTick lets the new article DOM mount before we
  // try to find heading IDs.
  watch(
    () => props.links,
    () => {
      if (import.meta.client) {
        nextTick(setupObserver)
      }
    }
  )

  function isActive(id: string) {
    return activeId.value === id
  }
</script>

<template>
  <aside v-if="decoratedLinks.length" class="hidden shrink-0 xl:block xl:w-56">
    <nav class="sticky top-24 max-h-[calc(100vh-7rem)] overflow-y-auto pb-8 pl-6">
      <h3 class="mb-3 text-sm font-semibold text-fg">On this page</h3>
      <ul>
        <li v-for="link in decoratedLinks" :key="link.id">
          <a
            :href="`#${link.id}`"
            class="toc-item relative block py-1 pl-3 text-sm transition-[color,padding-left] duration-(--duration-fast) ease-(--ease-out-quart)"
            :class="
              isActive(link.id)
                ? 'toc-item--active font-medium text-accent'
                : 'text-fg-muted hover:text-fg'
            "
          >
            <code v-if="link.display.isCode" class="font-mono">{{ link.display.text }}</code>
            <template v-else>{{ link.display.text }}</template>
          </a>
          <ul v-if="link.children && link.children.length">
            <li v-for="sub in link.children" :key="sub.id">
              <a
                :href="`#${sub.id}`"
                class="toc-item relative block py-1 pr-2 pl-6 text-sm transition-[color,padding-left] duration-(--duration-fast) ease-(--ease-out-quart)"
                :class="
                  isActive(sub.id)
                    ? 'toc-item--active font-medium text-accent'
                    : 'text-fg-subtle hover:text-fg'
                "
              >
                <code v-if="sub.display.isCode" class="font-mono">{{ sub.display.text }}</code>
                <template v-else>{{ sub.display.text }}</template>
              </a>
            </li>
          </ul>
        </li>
      </ul>
    </nav>
  </aside>
</template>

<style scoped>
  /* Same animated indicator pattern as the sidebar — a pseudo-element
     bar that scales in from center on activate. The TOC also nudges
     active links 0.125rem to the right so the scrollspy firing reads
     as a small visual cue (the link "steps forward" as the heading
     reaches the top of the viewport). */
  .toc-item::before {
    content: '';
    position: absolute;
    top: 0;
    bottom: 0;
    left: 0;
    width: 0.0625rem;
    background: var(--color-border);
    transform: scaleY(1);
    transform-origin: center;
    transition:
      background-color var(--duration-fast) var(--ease-out-quart),
      transform var(--duration-base) var(--ease-out-expo);
  }
  .toc-item--active {
    padding-left: calc(0.75rem + 0.125rem);
  }
  /* The h3-depth (nested) link uses pl-6 in the template; preserve the
     +0.125rem step for the nested form too. The selector targets the
     nested rule because Vue scopes both class hashes together. */
  ul ul .toc-item--active {
    padding-left: calc(1.5rem + 0.125rem);
  }
  .toc-item--active::before {
    background: var(--color-accent);
    animation: indicator-grow var(--duration-base) var(--ease-out-expo) both;
  }
</style>
