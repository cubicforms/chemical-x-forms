<script setup lang="ts">
  import { Menu, X } from 'lucide-vue-next'

  // Below lg, the desktop sidebar is hidden — without this drawer,
  // mobile readers have no way to jump between docs pages once
  // they've left the /docs index. Click the trigger → drawer slides
  // in from the left with the same docsNavigation the desktop
  // sidebar uses, so the mental model is identical at both sizes.

  const open = ref(false)
  const route = useRoute()

  // Close when route changes — the drawer's whole job is to be a
  // route picker, so once a link is clicked we want the drawer
  // dismissed immediately instead of needing a second tap.
  watch(
    () => route.path,
    () => {
      open.value = false
    }
  )

  function onKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape' && open.value) open.value = false
  }

  // Lock body scroll while the drawer is open so the page beneath
  // doesn't scroll when the drawer overlay receives wheel events.
  // Restored in onUnmounted as a safety net in case `open` is true
  // when the component tears down.
  watch(open, (next) => {
    if (typeof document === 'undefined') return
    document.body.style.overflow = next ? 'hidden' : ''
  })

  onMounted(() => {
    window.addEventListener('keydown', onKeydown)
  })
  onUnmounted(() => {
    window.removeEventListener('keydown', onKeydown)
    if (typeof document !== 'undefined') document.body.style.overflow = ''
  })
</script>

<template>
  <div class="lg:hidden">
    <!-- Trigger — uses the same `secondary` button language as the
         marketing CTAs (border + bg + shadow-xs) so it reads as a
         deliberate affordance rather than a plain link. -->
    <button
      type="button"
      aria-label="Open documentation menu"
      class="inline-flex h-10 items-center gap-2 rounded-md border bg-bg px-3 text-sm font-semibold text-fg shadow-xs transition-colors duration-(--duration-fast) ease-(--ease-out-quart) hover:bg-surface focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-accent-ring"
      @click="open = true"
    >
      <Menu class="h-4 w-4" :stroke-width="2.25" />
      <span>Documentation menu</span>
    </button>

    <!-- Drawer + scrim. Teleport to body so the fixed-positioning
         doesn't get trapped by an ancestor with `transform` /
         `filter` (those create stacking contexts that break fixed
         positioning). Two transitions: scrim fades, drawer slides
         from -translate-x-full → 0. -->
    <Teleport to="body">
      <Transition
        enter-from-class="opacity-0"
        enter-active-class="transition-opacity duration-(--duration-base) ease-(--ease-out-quart)"
        enter-to-class="opacity-100"
        leave-from-class="opacity-100"
        leave-active-class="transition-opacity duration-(--duration-fast) ease-(--ease-out-quart)"
        leave-to-class="opacity-0"
      >
        <div
          v-if="open"
          class="fixed inset-0 z-50 bg-fg/40 backdrop-blur-sm"
          aria-hidden="true"
          @click="open = false"
        />
      </Transition>
      <Transition
        enter-from-class="-translate-x-full"
        enter-active-class="transition-transform duration-(--duration-slow) ease-(--ease-out-quart)"
        enter-to-class="translate-x-0"
        leave-from-class="translate-x-0"
        leave-active-class="transition-transform duration-(--duration-base) ease-(--ease-out-quart)"
        leave-to-class="-translate-x-full"
      >
        <aside
          v-if="open"
          role="dialog"
          aria-modal="true"
          aria-label="Documentation"
          class="fixed top-0 left-0 z-50 flex h-full w-80 max-w-[85vw] flex-col border-r border-border bg-bg shadow-2xl"
        >
          <div class="flex h-16 items-center justify-between border-b border-border px-4">
            <span class="font-semibold tracking-tight">Documentation</span>
            <button
              type="button"
              aria-label="Close menu"
              class="inline-flex h-9 w-9 items-center justify-center rounded-md text-fg-muted transition-colors duration-(--duration-fast) hover:bg-surface hover:text-fg focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-accent-ring"
              @click="open = false"
            >
              <X class="h-5 w-5" :stroke-width="2" />
            </button>
          </div>
          <nav class="flex-1 overflow-y-auto px-4 py-6">
            <div v-for="section in docsNavigation" :key="section.heading" class="mb-7 last:mb-0">
              <h3 class="mb-3 text-sm font-semibold text-fg">{{ section.heading }}</h3>
              <ul>
                <li v-for="link in section.links" :key="link.to">
                  <NuxtLink
                    :to="link.to"
                    exact-active-class="border-accent font-medium text-accent"
                    class="block border-l border-border py-1.5 pr-2 pl-4 text-sm text-fg-muted transition-colors duration-(--duration-fast) hover:border-fg-subtle hover:text-fg"
                  >
                    {{ link.title }}
                  </NuxtLink>
                </li>
              </ul>
            </div>
          </nav>
        </aside>
      </Transition>
    </Teleport>
  </div>
</template>
