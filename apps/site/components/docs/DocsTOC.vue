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

  // Active anchor for scrollspy. IntersectionObserver fires when a
  // heading enters the "active band" defined by rootMargin — top
  // -80px clears the sticky header (h-16 = 64px) plus a 16px gutter,
  // bottom -70% means a heading reads as "active" only when it's in
  // the upper third of the viewport, not as it leaves the bottom.
  // This matches the usual "heading I'm reading is near the top of
  // the screen" intuition.
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
      { rootMargin: '-80px 0px -70% 0px', threshold: 0 }
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
  <aside v-if="links && links.length" class="hidden shrink-0 xl:block xl:w-56">
    <nav class="sticky top-24 max-h-[calc(100vh-7rem)] overflow-y-auto pb-8 pl-6">
      <h3 class="mb-3 text-sm font-semibold text-fg">On this page</h3>
      <ul>
        <li v-for="link in links" :key="link.id">
          <a
            :href="`#${link.id}`"
            class="block border-l py-1 pl-3 text-sm transition-colors duration-(--duration-fast)"
            :class="
              isActive(link.id)
                ? 'border-accent font-medium text-accent'
                : 'border-border text-fg-muted hover:text-fg'
            "
          >
            {{ link.text }}
          </a>
          <ul v-if="link.children && link.children.length">
            <li v-for="sub in link.children" :key="sub.id">
              <a
                :href="`#${sub.id}`"
                class="block border-l py-1 pr-2 pl-6 text-sm transition-colors duration-(--duration-fast)"
                :class="
                  isActive(sub.id)
                    ? 'border-accent font-medium text-accent'
                    : 'border-border text-fg-subtle hover:text-fg'
                "
              >
                {{ sub.text }}
              </a>
            </li>
          </ul>
        </li>
      </ul>
    </nav>
  </aside>
</template>
