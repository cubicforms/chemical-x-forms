<script setup lang="ts">
  import { ShieldCheck, Zap, Layers, Server, ArrowRight, Github } from 'lucide-vue-next'

  // Feature cards on the homepage. Same single-color icon-chip
  // discipline as the docs landing — every chip on this page uses
  // the brand-soft pair so the page reads as one product surface.
  // The icons map to the four-line value prop in the lede; a reader
  // who skims the heading + bullet titles should still get "what
  // does Attaform do" in 5 seconds.
  const features = [
    {
      icon: ShieldCheck,
      title: 'Schema-driven types',
      body: 'Every path, value, and error is inferred from your Zod schema. No `any`, no manual type plumbing.',
    },
    {
      icon: Zap,
      title: 'Live validation',
      body: 'Per-field validation on change, blur, or submit. Synchronous by default; async refinements await before submit dispatches.',
    },
    {
      icon: Layers,
      title: 'Field arrays + undo/redo',
      body: 'Typed `append` / `insert` / `remove` / `swap`, plus a bounded undo stack you can opt into per-form.',
    },
    {
      icon: Server,
      title: 'SSR + persistence',
      body: 'Nuxt round-trips payload automatically. Per-field opt-in drafts to localStorage / sessionStorage / IndexedDB.',
    },
  ]
</script>

<template>
  <div>
    <!-- ─── Hero ─────────────────────────────────────────────────
         A "hairline-tinted" hero — soft accent gradient bleeding
         from the top, the page bg taking over by midway down. The
         translucent version chip + display heading + lede + CTA
         row + trust strip is Untitled UI's canonical hero stack.
         The whole region animates in via a single CSS keyframe on
         mount; reduced-motion users see it pop instantly. -->
    <section class="relative overflow-hidden border-b border-border">
      <div
        class="absolute inset-0 -z-10 bg-gradient-to-b from-accent-soft/50 via-accent-soft/10 to-transparent"
        aria-hidden="true"
      />

      <UiContainer size="xl">
        <div class="hero-enter flex max-w-4xl flex-col items-start gap-8 py-24 md:py-32">
          <a
            href="https://github.com/attaform/attaform/releases"
            target="_blank"
            rel="noopener noreferrer"
            class="group inline-flex items-center gap-2 rounded-full border border-border bg-bg/80 py-1 pr-2 pl-3 text-sm font-medium text-fg-muted shadow-xs backdrop-blur transition-[color,border-color,background-color] duration-(--duration-fast) hover:border-accent/40 hover:text-fg"
          >
            <span class="relative inline-flex h-1.5 w-1.5">
              <span
                class="absolute inline-flex h-full w-full animate-ping rounded-full bg-success opacity-50"
              />
              <span class="relative inline-flex h-1.5 w-1.5 rounded-full bg-success" />
            </span>
            <span>v0.14.0-rc.0 — what's new</span>
            <ArrowRight
              class="h-4 w-4 text-fg-subtle transition-transform duration-(--duration-fast) group-hover:translate-x-0.5"
              :stroke-width="2.25"
            />
          </a>

          <h1 class="text-display-lg font-semibold tracking-tight text-fg md:text-display-xl">
            Type-safe forms for Vue&nbsp;3, <span class="text-accent">schema-first.</span>
          </h1>

          <p class="max-w-2xl text-xl text-fg-muted">
            Attaform turns your Zod schema into a fully reactive form surface — values, errors,
            validation, persistence, undo/redo — all inferred from a single source of truth.
          </p>

          <div class="flex flex-wrap gap-3">
            <UiButton to="/docs" size="xl">
              <span>Read the docs</span>
              <ArrowRight class="h-5 w-5" :stroke-width="2.25" />
            </UiButton>
            <UiButton to="/play" size="xl" variant="secondary">Try it live</UiButton>
            <UiButton href="https://github.com/attaform/attaform" size="xl" variant="ghost">
              <Github class="h-5 w-5" :stroke-width="2" />
              <span>GitHub</span>
            </UiButton>
          </div>

          <!-- Trust strip — small dot-separated facts about runtime
               surface. Shows breadth ("works with multiple Vues, Zods,
               and bundlers") without paragraphs of marketing prose. -->
          <ul
            class="mt-2 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-fg-subtle"
            aria-label="Project facts"
          >
            <li>MIT licensed</li>
            <li class="h-1 w-1 rounded-full bg-fg-subtle" aria-hidden="true" />
            <li>Vue 3 · Nuxt 3 / 4</li>
            <li class="h-1 w-1 rounded-full bg-fg-subtle" aria-hidden="true" />
            <li>Zod 3 / 4</li>
            <li class="h-1 w-1 rounded-full bg-fg-subtle" aria-hidden="true" />
            <li>Tree-shakable ESM</li>
          </ul>
        </div>
      </UiContainer>
    </section>

    <!-- ─── Features ─────────────────────────────────────────────
         Eyebrow + display + lede composition (matches docs landing
         and /play), then a 2-column feature grid. Each row is icon
         chip + title + body — denser than the homepage's prior flat
         paragraph list, and the icon chips give the eye anchors as
         it scrolls. -->
    <section class="border-b border-border py-24">
      <UiContainer size="xl">
        <div class="max-w-2xl">
          <p class="text-sm font-semibold tracking-wide text-accent uppercase">Why Attaform</p>
          <h2 class="mt-3 text-display-md font-semibold tracking-tight text-fg">
            Forms shouldn't fight you.
          </h2>
          <p class="mt-4 text-lg text-fg-muted">
            One schema. Inferred types end-to-end. Validation that runs where you want it.
            Persistence built in. Undo/redo when you need it. Everything else, out of your way.
          </p>
        </div>

        <div class="mt-16 grid gap-x-12 gap-y-10 md:grid-cols-2">
          <div v-for="feature in features" :key="feature.title" class="flex gap-4">
            <div
              class="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent-soft-fg"
            >
              <component :is="feature.icon" class="h-6 w-6" :stroke-width="2" />
            </div>
            <div>
              <h3 class="text-lg font-semibold text-fg">{{ feature.title }}</h3>
              <p class="mt-1.5 text-base text-fg-muted">{{ feature.body }}</p>
            </div>
          </div>
        </div>
      </UiContainer>
    </section>

    <!-- ─── Live demo ────────────────────────────────────────────
         The interactive REPL embed. Same eyebrow/display/lede
         pattern + a "see full playground" link button on the right
         of the heading row that's an obvious affordance to escape
         the embedded view. -->
    <section class="py-24">
      <UiContainer size="xl">
        <div class="mb-10 flex flex-wrap items-end justify-between gap-6">
          <div class="max-w-2xl">
            <p class="text-sm font-semibold tracking-wide text-accent uppercase">Live editor</p>
            <h2 class="mt-3 text-display-md font-semibold tracking-tight text-fg">
              A schema is the form.
            </h2>
            <p class="mt-4 text-lg text-fg-muted">
              Edit the schema, edit the template, watch it run. No backend, no build step — every
              change re-renders live.
            </p>
          </div>
          <UiButton to="/play" variant="link">
            <span>Open full playground</span>
            <ArrowRight class="h-4 w-4" :stroke-width="2.25" />
          </UiButton>
        </div>
        <DemoRepl height="37.5rem" />
      </UiContainer>
    </section>

    <!-- ─── Bottom CTA ───────────────────────────────────────────
         Centered close — gives the page a definite "end" rather
         than dribbling into the footer. Repeats the primary CTA so
         a reader who scrolled the whole page doesn't have to scroll
         back to the hero to act on it. -->
    <section class="border-t border-border bg-surface/50 py-24">
      <UiContainer size="lg">
        <div class="flex flex-col items-center gap-6 text-center">
          <h2 class="max-w-2xl text-display-md font-semibold tracking-tight text-fg">
            Get started in 30 seconds.
          </h2>
          <p class="max-w-xl text-lg text-fg-muted">
            One install, one schema, one composable. Read the docs or jump straight into the
            playground.
          </p>
          <div class="flex flex-wrap justify-center gap-3">
            <UiButton to="/docs" size="xl">
              <span>Read the docs</span>
              <ArrowRight class="h-5 w-5" :stroke-width="2.25" />
            </UiButton>
            <UiButton to="/play" size="xl" variant="secondary">Try it live</UiButton>
          </div>
        </div>
      </UiContainer>
    </section>
  </div>
</template>

<style scoped>
  /* Hero entrance — single fade-up on mount. The reduced-motion media
     query in tailwind.css collapses the duration to 0.01ms so users
     who opt out of motion see the final state immediately rather
     than getting stuck at opacity:0 (animation-fill-mode: both
     handles both "before" and "after" states). */
  .hero-enter {
    animation: hero-enter 700ms var(--ease-out-quart) both;
  }
  @keyframes hero-enter {
    from {
      opacity: 0;
      transform: translateY(0.75rem);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }
</style>
