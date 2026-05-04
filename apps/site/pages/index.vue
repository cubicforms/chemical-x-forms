<script setup lang="ts">
  import { ShieldCheck, Zap, Layers, Server, ArrowRight, Github } from 'lucide-vue-next'

  // Feature cards on the homepage. Same single-color icon-chip
  // discipline as the docs landing — every chip on this page uses
  // the brand-soft pair so the page reads as one product surface.
  // The icons map to the four-line value prop in the lede; a reader
  // who skims the heading + bullet titles should still get "what
  // does Attaform do" in 5 seconds.
  const { attaformVersion } = useRuntimeConfig().public

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
         Three layered backgrounds: the dot-grid (faintest), then the
         accent-soft glow that bleeds from the top, then the page
         content. Each layer is masked at the edges so they fade out
         instead of running into the next section. The whole region
         enters via a four-step stagger (eyebrow → heading → lede →
         CTAs); reduced-motion users see it pop instantly. -->
    <section class="relative isolate overflow-hidden border-b border-border">
      <!-- Dot-grid layer — sits beneath the glow. We paint the
           gradient inline (rather than the `bg-dot-grid` utility)
           so the dots use `--color-border-strong` (gray-300, one
           step darker than the utility's `--color-border`); against
           the page bg the default is too pale to read as
           texture. The mask centers the pattern under the heading
           and fades it out at ~80% so it never reaches the CTA row
           or the section seam. -->
      <div
        class="absolute inset-0 -z-20"
        style="
          background-image: radial-gradient(
            circle at 0.0625rem 0.0625rem,
            var(--color-border-strong) 0.0625rem,
            transparent 0
          );
          background-size: 1.5rem 1.5rem;
          mask-image: radial-gradient(ellipse 75% 70% at 50% 30%, #000 30%, transparent 80%);
        "
        aria-hidden="true"
      />
      <!-- Accent-soft glow — top-anchored radial fade. Lighter in dark
           mode where the tint risks reading as muddy. -->
      <div
        class="absolute inset-0 -z-10 bg-glow-hero opacity-90 dark:opacity-70"
        aria-hidden="true"
      />

      <UiContainer size="xl">
        <div class="flex max-w-4xl flex-col items-start gap-8 py-24 md:py-32">
          <a
            href="https://github.com/attaform/attaform/releases"
            target="_blank"
            rel="noopener noreferrer"
            class="reveal-step group inline-flex items-center gap-2 rounded-full border border-warm/30 bg-bg/80 py-1 pr-2 pl-3 text-sm font-medium text-fg-muted shadow-xs backdrop-blur transition-[color,border-color,background-color] duration-(--duration-fast) hover:border-accent/40 hover:text-fg"
            style="--reveal-step-delay: 0ms"
          >
            <span class="relative inline-flex h-1.5 w-1.5">
              <span
                class="absolute inline-flex h-full w-full animate-ping rounded-full bg-warm opacity-50 group-hover:bg-success"
              />
              <span
                class="relative inline-flex h-1.5 w-1.5 rounded-full bg-warm group-hover:bg-success"
              />
            </span>
            <span>v{{ attaformVersion }} — what's new</span>
            <ArrowRight
              class="h-4 w-4 text-fg-subtle transition-transform duration-(--duration-fast) group-hover:translate-x-0.5"
              :stroke-width="2.25"
            />
          </a>

          <h1
            class="reveal-step text-display-lg font-semibold tracking-tight text-fg md:text-display-xl"
            style="--reveal-step-delay: 60ms"
          >
            Type-safe forms for Vue&nbsp;3, <span class="text-accent">schema-first.</span>
          </h1>

          <p class="reveal-step max-w-2xl text-xl text-fg-muted" style="--reveal-step-delay: 120ms">
            Attaform turns your Zod schema into a fully reactive form surface — values, errors,
            validation, persistence, undo/redo — all inferred from a single source of truth.
          </p>

          <div class="reveal-step flex flex-wrap gap-3" style="--reveal-step-delay: 180ms">
            <UiButton to="/docs/quickstart" size="xl">
              <span>Quick start</span>
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
            class="reveal-step mt-2 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-fg-subtle"
            style="--reveal-step-delay: 240ms"
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
         it scrolls. No on-scroll reveal here: the section renders
         in its final state on first paint. -->
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
         the embedded view. The frame around the embed elevates it
         from "floating widget" to "real artifact" — a hairline
         accent-soft strip across the top, a 2xl shadow, and a
         strong border. -->
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
        <div
          class="relative overflow-hidden rounded-2xl border border-border-strong bg-bg shadow-2xl"
        >
          <!-- Hairline accent strip at the top edge — same depth cue
               as a real card but more "this is the marquee piece" than
               the standard border. -->
          <div
            class="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-accent to-transparent"
            aria-hidden="true"
          />
          <DemoRepl height="37.5rem" />
        </div>
      </UiContainer>
    </section>

    <!-- ─── Bottom CTA ───────────────────────────────────────────
         Centered close — gives the page a definite "end" rather
         than dribbling into the footer. Leads with the install
         command itself so a reader who scrolled the whole page can
         act in one click without scrolling back to find a docs
         link. -->
    <section class="border-t border-border bg-surface/50 py-24">
      <UiContainer size="lg">
        <div class="flex flex-col items-center gap-6 text-center">
          <h2 class="max-w-2xl text-display-md font-semibold tracking-tight text-fg">
            Get started in 30 seconds.
          </h2>
          <p class="max-w-xl text-lg text-fg-muted">
            One install, one schema, one composable. Read the quick start or jump straight into the
            playground.
          </p>
          <div class="flex flex-wrap justify-center gap-3">
            <UiButton to="/docs/quickstart" size="xl">
              <span>Quick start</span>
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
  /* Hero stagger — every `.reveal-step` runs the same fade-up keyframe
     (defined in `tailwind.css`) and consumes a per-element delay set
     inline as `--reveal-step-delay`. Single curve, four offsets means
     every line eases into the same shape — the cascade reads as
     deliberate composition, not animation-soup. */
  .reveal-step {
    animation: reveal-fade-up var(--duration-deliberate) var(--ease-out-quart) both;
    animation-delay: var(--reveal-step-delay, 0ms);
  }
</style>
