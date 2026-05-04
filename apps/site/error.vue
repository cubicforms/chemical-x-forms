<script setup lang="ts">
  import { Compass, ArrowLeft, BookOpen } from 'lucide-vue-next'
  import type { NuxtError } from '#app'

  // Nuxt convention: this file handles every error the framework
  // throws at the page level — 404s primarily, but also 500s if any
  // SSR handler explodes. Distinguish the two so a missing page
  // reads as friendly ("wandered off") and a real failure doesn't
  // hide behind that copy. The error prop is provided by Nuxt and
  // typed via NuxtError.
  const props = defineProps<{ error: NuxtError }>()

  const isNotFound = computed(() => props.error?.statusCode === 404)
  const heading = computed(() => (isNotFound.value ? 'Page not found' : 'Something went wrong'))
  const lede = computed(() =>
    isNotFound.value
      ? 'This page wandered off. Check the URL, or jump back to somewhere familiar.'
      : 'An unexpected error broke this page. The site itself is fine — try the home page or refresh.'
  )

  const monogram = computed(() => String(props.error?.statusCode ?? 'oops'))

  // The GitHub issue link prefills enough context that a maintainer
  // can chase down the broken inbound link without prying for details.
  // It's only shown for genuine 404s — a 500 is our bug, not a docs
  // typo.
  const issueUrl = computed(() => {
    const title = encodeURIComponent('Broken docs link')
    const route = useRequestURL()
    const body = encodeURIComponent(
      `I hit a 404 while browsing attaform.com.\n\nURL: ${route.pathname}\nReferrer: (paste here if you came from a link)`
    )
    return `https://github.com/attaform/attaform/issues/new?title=${title}&body=${body}`
  })

  function clearAndGoHome() {
    clearError({ redirect: '/' })
  }

  useHead({ title: heading.value })
</script>

<template>
  <NuxtLayout>
    <section class="relative isolate overflow-hidden">
      <!-- Same dot-grid + glow stack as the homepage hero. The 404
           page is a moment, not a corridor — give it the same warmth
           treatment so it feels like part of the site, not an OS
           error dialog. -->
      <div
        class="absolute inset-0 -z-20 bg-dot-grid opacity-50 dark:opacity-30"
        style="
          background-size: 1.5rem 1.5rem;
          mask-image: radial-gradient(ellipse 70% 60% at 50% 30%, #000 30%, transparent 80%);
        "
        aria-hidden="true"
      />
      <div
        class="absolute inset-0 -z-10 bg-glow-warm opacity-80 dark:opacity-60"
        aria-hidden="true"
      />

      <UiContainer size="lg">
        <div class="flex flex-col items-center gap-8 py-24 text-center md:py-32">
          <!-- Compass: spins once on mount as a small punctuation mark.
               The keyframe lives here because it's only ever used by
               the error page; everything else stays in tailwind.css. -->
          <div
            class="flex h-16 w-16 items-center justify-center rounded-2xl bg-warm-soft text-warm-soft-fg shadow-md"
          >
            <Compass class="compass-spin h-8 w-8" :stroke-width="1.75" />
          </div>

          <!-- Layered monogram: accent-soft fill behind, accent stroke
               on top, slight overlap. Reads as a typographic moment
               rather than just a numeral. -->
          <div class="relative inline-flex" aria-hidden="true">
            <span
              class="text-display-2xl font-semibold tracking-tight text-accent-soft select-none"
              style="letter-spacing: -0.04em"
              >{{ monogram }}</span
            >
            <span
              class="absolute inset-0 text-display-2xl font-semibold tracking-tight text-accent select-none"
              style="
                letter-spacing: -0.04em;
                -webkit-text-stroke: 0.0625rem var(--color-accent);
                color: transparent;
                transform: translate(0.25rem, -0.25rem);
              "
              >{{ monogram }}</span
            >
          </div>

          <div class="flex max-w-2xl flex-col items-center gap-4">
            <h1 class="text-display-md font-semibold tracking-tight text-fg">
              {{ heading }}
            </h1>
            <p class="text-lg text-fg-muted">{{ lede }}</p>
          </div>

          <div class="flex flex-wrap justify-center gap-3">
            <UiButton size="xl" @click="clearAndGoHome">
              <ArrowLeft class="h-5 w-5" :stroke-width="2.25" />
              <span>Back home</span>
            </UiButton>
            <UiButton to="/docs" size="xl" variant="secondary">
              <BookOpen class="h-5 w-5" :stroke-width="2" />
              <span>Browse docs</span>
            </UiButton>
          </div>

          <p v-if="isNotFound" class="mt-2 text-sm text-fg-subtle">
            Came from a link?
            <a
              :href="issueUrl"
              target="_blank"
              rel="noopener noreferrer"
              class="font-medium text-fg-muted underline decoration-fg-subtle/40 underline-offset-4 transition-colors duration-(--duration-fast) hover:text-fg hover:decoration-accent"
            >
              Open an issue
            </a>
            so we can fix it.
          </p>
        </div>
      </UiContainer>
    </section>
  </NuxtLayout>
</template>

<style scoped>
  /* Single celebratory rotation on mount — the compass needle rights
     itself once. Looped rotation here would feel like a loading
     spinner; one turn reads as punctuation. */
  .compass-spin {
    animation: compass-spin 1.4s var(--ease-out-quart) both;
  }
  @keyframes compass-spin {
    from {
      transform: rotate(-90deg);
    }
    to {
      transform: rotate(0deg);
    }
  }
</style>
