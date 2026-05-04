<script setup lang="ts">
  import { Menu, X, Github, BookOpen, FlaskConical } from 'lucide-vue-next'

  const navLinks = [
    { label: 'Docs', to: '/docs', icon: BookOpen },
    { label: 'Playground', to: '/play', icon: FlaskConical },
  ]

  // Header always carries the translucent fill + 1px hairline so it
  // reads as a sticky element from the first paint. The shadow only
  // appears once content has scrolled beneath — it's what registers
  // the "lifted" depth, and at scroll=0 there's nothing to lift over,
  // so a constant shadow there reads as a flat panel rather than a
  // sticky bar.
  const scrolled = ref(false)
  function onScroll() {
    scrolled.value = window.scrollY > 8
  }
  onMounted(() => {
    window.addEventListener('scroll', onScroll, { passive: true })
    onScroll()
  })
  onUnmounted(() => {
    window.removeEventListener('scroll', onScroll)
  })

  // Mobile sheet — translucent backdrop + solid right-side drawer.
  // Closes via Esc, the X button inside the drawer, link tap (route
  // watcher catches both NuxtLink internal nav and we close the
  // external GitHub link manually), or backdrop click. Body scroll
  // is locked while the sheet is open so the page beneath doesn't
  // skid around under taps.
  const mobileNavOpen = ref(false)
  const route = useRoute()

  watch(
    () => route.fullPath,
    () => {
      mobileNavOpen.value = false
    }
  )

  function onKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape' && mobileNavOpen.value) {
      mobileNavOpen.value = false
    }
  }

  watch(mobileNavOpen, (open) => {
    if (typeof document === 'undefined') return
    document.body.style.overflow = open ? 'hidden' : ''
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
  <header
    class="sticky top-0 z-40 border-b border-border bg-bg/85 backdrop-blur transition-shadow duration-(--duration-base) ease-(--ease-out-quart)"
    :class="scrolled ? 'shadow-xs' : 'shadow-none'"
  >
    <UiContainer size="xl">
      <div class="flex h-16 items-center justify-between gap-4">
        <NuxtLink
          to="/"
          class="flex items-center gap-2.5 font-semibold tracking-tight transition-opacity duration-(--duration-fast) hover:opacity-80"
        >
          <AppLogo class="h-7 w-7 text-accent" />
          <span class="text-base">Attaform</span>
        </NuxtLink>

        <div class="flex items-center gap-2 md:gap-3">
          <DocsSearch />

          <!-- Desktop / tablet nav. Hidden below md (768px) where the
               hamburger takes over; otherwise the full row of links +
               GitHub + theme toggle would overflow on a phone-sized
               viewport. -->
          <nav class="hidden items-center gap-1 md:flex">
            <NuxtLink
              v-for="link in navLinks"
              :key="link.to"
              :to="link.to"
              active-class="text-fg bg-surface"
              class="rounded-md px-3 py-2 text-sm font-medium text-fg-muted transition-colors duration-(--duration-fast) ease-(--ease-out-quart) hover:bg-surface hover:text-fg"
            >
              {{ link.label }}
            </NuxtLink>
            <a
              href="https://github.com/attaform/attaform"
              target="_blank"
              rel="noopener noreferrer"
              class="rounded-md px-3 py-2 text-sm font-medium text-fg-muted transition-colors duration-(--duration-fast) ease-(--ease-out-quart) hover:bg-surface hover:text-fg"
            >
              GitHub
            </a>
            <span class="mx-1 h-5 w-px bg-border" aria-hidden="true" />
            <AppThemeToggle />
          </nav>

          <!-- Mobile theme toggle stays visible at every breakpoint —
               it's a single icon, doesn't crowd, and users who set a
               preference once shouldn't have to open the hamburger
               to change it again. -->
          <div class="md:hidden">
            <AppThemeToggle />
          </div>

          <!-- Hamburger — md:hidden so it only appears on phone-class
               viewports. Doesn't toggle to X here because the X lives
               inside the drawer (the drawer occludes this button). -->
          <button
            type="button"
            class="inline-flex h-9 w-9 cursor-pointer items-center justify-center rounded-md text-fg-muted transition-colors duration-(--duration-fast) ease-(--ease-out-quart) hover:bg-surface hover:text-fg focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-accent-ring md:hidden"
            aria-label="Open menu"
            :aria-expanded="mobileNavOpen"
            aria-controls="mobile-nav-sheet"
            @click="mobileNavOpen = true"
          >
            <Menu class="h-5 w-5" :stroke-width="2" />
          </button>
        </div>
      </div>
    </UiContainer>
  </header>

  <!-- Mobile sheet — Teleported to body so it composites above every
       sticky / transformed ancestor without z-index gymnastics. The
       backdrop is translucent (bg-fg/40 + backdrop-blur), the drawer
       itself is opaque (bg-bg) so menu items always read clearly
       against a theme-appropriate solid surface. -->
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
        v-if="mobileNavOpen"
        class="fixed inset-0 z-50 bg-fg/30 backdrop-blur-[3px] md:hidden"
        aria-hidden="true"
        @click="mobileNavOpen = false"
      />
    </Transition>

    <Transition
      enter-from-class="translate-x-full"
      enter-active-class="transition-transform duration-(--duration-base) ease-(--ease-out-quart)"
      enter-to-class="translate-x-0"
      leave-from-class="translate-x-0"
      leave-active-class="transition-transform duration-(--duration-fast) ease-(--ease-out-quart)"
      leave-to-class="translate-x-full"
    >
      <aside
        v-if="mobileNavOpen"
        id="mobile-nav-sheet"
        role="dialog"
        aria-modal="true"
        aria-label="Navigation"
        class="fixed top-0 right-0 z-50 flex h-dvh w-[min(85vw,20rem)] flex-col border-l border-border bg-bg shadow-2xl md:hidden"
      >
        <!-- Drawer header — mirrors the site header's height so the
             X button lines up visually with the hamburger that
             triggered it. The logo is dropped (the user knows what
             site they're on) leaving a clean title row. -->
        <div class="flex h-16 items-center justify-between gap-3 border-b border-border px-5">
          <span class="text-sm font-semibold tracking-wide text-fg-subtle uppercase">Menu</span>
          <button
            type="button"
            class="inline-flex h-9 w-9 cursor-pointer items-center justify-center rounded-md text-fg-muted transition-colors duration-(--duration-fast) ease-(--ease-out-quart) hover:bg-surface hover:text-fg focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-accent-ring"
            aria-label="Close menu"
            @click="mobileNavOpen = false"
          >
            <X class="h-5 w-5" :stroke-width="2" />
          </button>
        </div>

        <!-- @click on every link closes the sheet immediately. The
             route watcher catches navigations to a different page,
             but tapping the link for the page you're already on
             doesn't fire it — without an explicit close, the sheet
             would just sit there and read as a broken control. -->
        <nav class="flex flex-1 flex-col gap-1 overflow-y-auto p-4">
          <NuxtLink
            v-for="link in navLinks"
            :key="link.to"
            :to="link.to"
            active-class="mobile-nav-active"
            class="group relative inline-flex items-center gap-2 rounded-md px-3 py-3 text-base font-medium text-fg-muted transition-colors duration-(--duration-fast) ease-(--ease-out-quart) hover:bg-surface hover:text-fg"
            @click="mobileNavOpen = false"
          >
            <!-- Left accent bar — only renders on the active link
                 (driven by the .mobile-nav-active rule below). -->
            <span class="active-bar" aria-hidden="true" />
            <component :is="link.icon" class="h-4 w-4" :stroke-width="2" />
            <span>{{ link.label }}</span>
          </NuxtLink>
          <a
            href="https://github.com/attaform/attaform"
            target="_blank"
            rel="noopener noreferrer"
            class="inline-flex items-center gap-2 rounded-md px-3 py-3 text-base font-medium text-fg-muted transition-colors duration-(--duration-fast) ease-(--ease-out-quart) hover:bg-surface hover:text-fg"
            @click="mobileNavOpen = false"
          >
            <Github class="h-4 w-4" :stroke-width="2" />
            <span>GitHub</span>
          </a>
        </nav>
      </aside>
    </Transition>
  </Teleport>
</template>

<style scoped>
  /* Active mobile-nav link. Three layered cues — a left accent bar,
     accent-soft surface tint, and accent-tinted text — so the
     current page reads as "selected" at a glance, distinct from
     hover. The bar is rendered as a sibling <span> inside the
     link so it can position absolutely against the link's relative
     box without disturbing the icon + label flexbox. */
  :deep(.mobile-nav-active) {
    color: var(--color-accent-soft-fg);
    background: var(--color-accent-soft);
    font-weight: 600;
  }
  :deep(.mobile-nav-active) .active-bar {
    position: absolute;
    inset-block: 0.5rem;
    left: 0;
    width: 0.1875rem;
    border-radius: 0 0.125rem 0.125rem 0;
    background: var(--color-accent);
  }
  /* Default (non-active) state hides the bar entirely. */
  .active-bar {
    display: none;
  }
  :deep(.mobile-nav-active) .active-bar {
    display: block;
  }
</style>
