<script setup lang="ts">
  // SSR-safe shell for the homepage + /play interactive REPL.
  //
  // Two responsibilities:
  //
  //   1. Reserve the editor's footprint at SSR time. The wrapper
  //      ships server-side at the consumer-supplied `height`, with
  //      an editor-shaped skeleton inside. The page lays out at the
  //      final dimensions before any client JS runs — no shift on
  //      hydration, no shift when the heavy editor swaps in.
  //
  //   2. Defer-mount + route-leave-guard the actual `<DemoReplEditor>`
  //      (the `.client.vue` half holding @vue/repl + Monaco). Both
  //      ends of the editor's lifecycle are fragile: @vue/repl's
  //      `Sandbox.createSandbox` runs from a `mounted` hook AND a
  //      `watch(getImportMap, ...)`, and under <Suspense> +
  //      <Transition mode="out-in"> those two can fire against a
  //      stale containerRef. Two ticks of nextTick after this
  //      component mounts gives the parent transition's leave queue
  //      time to drain before the editor renders; a global
  //      `router.beforeEach` tears the editor back down before the
  //      next leave starts. Documented at length on the original
  //      DemoRepl.client.vue commits.
  const props = withDefaults(
    defineProps<{
      height?: string
    }>(),
    { height: '37.5rem' }
  )

  const showEditor = ref(false)
  onMounted(async () => {
    await nextTick()
    await nextTick()
    showEditor.value = true
  })

  const router = useRouter()
  const removeGuard = router.beforeEach(async () => {
    if (showEditor.value) {
      showEditor.value = false
      await nextTick()
    }
  })
  onBeforeUnmount(removeGuard)
</script>

<template>
  <div
    class="demo-repl relative overflow-hidden rounded-xl border bg-bg shadow-sm"
    :style="{ height: props.height }"
  >
    <!-- Skeleton: SSR-rendered, mirrors the editor's geometry so the
         page lays out identically before and after the swap.
         File-tab strip on top (35px = @vue/repl's `--header-height`),
         then a 50/50 horizontal split: code pane on the left (with
         code-line-shaped bones), preview pane on the right (with its
         own header strip + body). Hidden once the real editor lands;
         until then it pulses gently to signal "loading" rather than
         "broken." -->
    <div
      v-if="!showEditor"
      class="absolute inset-0 flex flex-col"
      aria-hidden="true"
      data-testid="demo-repl-skeleton"
    >
      <!-- File-tab strip -->
      <div class="flex h-[2.1875rem] items-center gap-3 border-b border-border bg-surface/40 px-3">
        <div class="h-3 w-16 rounded-sm bg-fg-subtle/15"></div>
      </div>
      <!-- Body: code on left, preview on right, 50/50 -->
      <div class="flex flex-1 min-h-0">
        <div class="flex flex-1 flex-col gap-2 border-r border-border bg-surface/20 p-4">
          <div class="h-3 w-3/5 rounded-sm bg-fg-subtle/15 motion-safe:animate-pulse"></div>
          <div class="h-3 w-2/5 rounded-sm bg-fg-subtle/15 motion-safe:animate-pulse"></div>
          <div class="h-3 w-3/4 rounded-sm bg-fg-subtle/15 motion-safe:animate-pulse"></div>
          <div class="h-3 w-1/3 rounded-sm bg-fg-subtle/15 motion-safe:animate-pulse"></div>
          <div class="h-3 w-1/2 rounded-sm bg-fg-subtle/15 motion-safe:animate-pulse"></div>
          <div class="h-3 w-2/3 rounded-sm bg-fg-subtle/15 motion-safe:animate-pulse"></div>
          <div class="h-3 w-1/4 rounded-sm bg-fg-subtle/15 motion-safe:animate-pulse"></div>
          <div class="h-3 w-3/5 rounded-sm bg-fg-subtle/15 motion-safe:animate-pulse"></div>
          <div class="h-3 w-2/5 rounded-sm bg-fg-subtle/15 motion-safe:animate-pulse"></div>
          <div class="h-3 w-1/2 rounded-sm bg-fg-subtle/15 motion-safe:animate-pulse"></div>
        </div>
        <div class="flex flex-1 flex-col">
          <!-- Preview-side header strip (mirrors the renamed "Preview" tab) -->
          <div
            class="flex h-[2.1875rem] items-center gap-3 border-b border-border bg-surface/40 px-3"
          >
            <div class="h-3 w-12 rounded-sm bg-fg-subtle/15"></div>
          </div>
          <div class="flex-1 bg-surface/10"></div>
        </div>
      </div>
    </div>

    <!-- The real editor. `.client.vue` so it never appears in SSR
         markup; `v-if` defers its mount until two ticks past
         hydration, so its Sandbox iframe installs into a settled DOM. -->
    <DemoReplEditor v-if="showEditor" />
  </div>
</template>

<style>
  /* @vue/repl's default compile-error overlay (.msg.err) is alarm-red
     and instant — every keystroke that lands on incomplete TS flashes
     a giant red panel across the bottom of the iframe. For a demo on a
     marketing page that's hostile UX. Two changes:

     1. Defer fade-in to ~600ms so transient mid-keystroke errors don't
        get a chance to flash before the next character makes it valid
        again. Genuine "I left it broken" errors still surface, just
        without the strobe effect.
     2. Tone the palette down — a small bottom strip with a left
        accent bar instead of the full-width alarmscape, so when it
        does show it reads as feedback rather than failure. */
  .demo-repl .msg.err {
    --color: var(--color-fg-muted);
    --bg-color: color-mix(in oklch, var(--color-surface), transparent 10%);
    border-width: 0 0 0 0.1875rem;
    border-radius: 0.25rem;
    backdrop-filter: blur(0.375rem);
    font-size: 0.8125rem;
    max-height: 6rem;
    overflow: auto;
  }
  .demo-repl .msg.err pre {
    padding: 0.5rem 0.75rem;
  }
  .demo-repl .fade-enter-active {
    transition-delay: 600ms;
  }
  .demo-repl .fade-leave-active {
    transition-delay: 0ms;
  }

  /* Hide the file-add "+" button. The :show-import-map / :show-tsconfig
     props already drop those two right-aligned tabs, but @vue/repl
     renders the "+" button unconditionally — there's no prop for it.
     Keeping the demo single-file makes the example self-contained:
     a visitor can't accidentally land in an empty Comp.vue tab and
     get confused about whether the demo is broken. */
  .demo-repl .file-selector .add {
    display: none;
  }

  /* @vue/repl renders the lone "preview" tab as <span>preview</span>
     and uppercases it via `text-transform: uppercase`. Overriding to
     `capitalize` rerenders "preview" as "Preview" without touching
     the layout — keeps the active-tab underline (a `border-bottom`
     on the button, sized off the span's content width) intact. */
  .demo-repl .tab-buttons button > span {
    text-transform: capitalize;
  }
</style>
