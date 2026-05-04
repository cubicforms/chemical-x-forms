<script setup lang="ts">
  import { Copy, Check, ArrowRight } from 'lucide-vue-next'

  // Self-contained install card: title + manager picker + copy-
  // able command + quick-start link. Used on the homepage hero,
  // the /docs landing banner, and the bottom CTA — three consumers
  // that all want the same affordance, so it's a single component
  // rather than a primitive.
  //
  // The selected package manager persists across pages via
  // `useState` (SSR-safe Nuxt shared state) plus `localStorage`,
  // so a reader who picks "npm" on the hero sees "npm" on the
  // docs landing and the bottom CTA without re-selecting.
  const props = withDefaults(
    defineProps<{
      packages?: string
      showQuickStart?: boolean
    }>(),
    { packages: 'attaform zod', showQuickStart: true }
  )

  type Manager = 'pnpm' | 'npm' | 'yarn' | 'bun'
  const managers: Manager[] = ['pnpm', 'npm', 'yarn', 'bun']
  const verbs: Record<Manager, string> = {
    pnpm: 'add',
    npm: 'install',
    yarn: 'add',
    bun: 'add',
  }

  const manager = useState<Manager>('install-command-manager', () => 'pnpm')
  const STORAGE_KEY = 'attaform.install-command-manager'

  onMounted(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY) as Manager | null
      if (stored && managers.includes(stored)) manager.value = stored
    } catch {
      // localStorage can throw in private mode / sandboxed iframes;
      // fall back to the default ('pnpm').
    }
  })

  function pick(m: Manager) {
    manager.value = m
    if (import.meta.client) {
      try {
        localStorage.setItem(STORAGE_KEY, m)
      } catch {
        // ignore — same private-mode reasoning as above
      }
    }
  }

  const command = computed(() => `${manager.value} ${verbs[manager.value]} ${props.packages}`)

  // Preview holds its width across manager switches: every variant
  // renders as an invisible layout sizer in a stacked CSS grid
  // cell, and the live command is absolute-positioned over the
  // widest one. Switching pnpm → npm changes "pnpm add attaform
  // zod" (21 chars) → "npm install attaform zod" (24 chars); the
  // grid cell sizes off the longest, so the card never resizes.
  const allCommands = computed(() => managers.map((m) => `${m} ${verbs[m]} ${props.packages}`))

  const copied = ref(false)
  let resetTimer: ReturnType<typeof setTimeout> | null = null

  async function copy() {
    if (!import.meta.client) return
    try {
      await navigator.clipboard.writeText(command.value)
      copied.value = true
      if (resetTimer) clearTimeout(resetTimer)
      resetTimer = setTimeout(() => (copied.value = false), 1500)
    } catch {
      // Clipboard access can throw in private mode or insecure
      // contexts. Silently no-op — the user can select and copy
      // by hand.
    }
  }

  onBeforeUnmount(() => {
    if (resetTimer) clearTimeout(resetTimer)
  })
</script>

<template>
  <div
    class="flex w-full flex-col overflow-hidden rounded-xl border border-border bg-surface/60 shadow-xs"
  >
    <!-- Manager tabs -->
    <div
      class="flex items-stretch border-b border-border"
      role="tablist"
      aria-label="Package manager"
    >
      <button
        v-for="m in managers"
        :key="m"
        type="button"
        role="tab"
        :aria-selected="manager === m"
        class="relative cursor-pointer px-3.5 py-2 font-mono text-xs font-medium transition-colors duration-(--duration-fast) focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent-ring"
        :class="
          manager === m
            ? 'text-fg after:absolute after:inset-x-2 after:-bottom-px after:h-[2px] after:bg-accent'
            : 'text-fg-subtle hover:text-fg'
        "
        @click="pick(m)"
      >
        {{ m }}
      </button>
    </div>

    <!-- Command + copy. The sizer renders every variant invisibly
         to lock the row's width against manager switches. -->
    <div class="flex items-center gap-3 px-4 py-3 font-mono text-sm">
      <div class="command-sizer flex-1">
        <code v-for="cmd in allCommands" :key="cmd" aria-hidden="true" class="invisible-cmd">
          <span class="select-none">$ </span>{{ cmd }}
        </code>
        <code class="visible-cmd text-fg">
          <span class="text-fg-subtle select-none">$ </span>{{ command }}
        </code>
      </div>
      <button
        type="button"
        class="inline-flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-md text-fg-muted transition-[background-color,color] duration-(--duration-fast) hover:bg-surface-2 hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-ring"
        :aria-label="copied ? 'Copied' : 'Copy install command'"
        @click="copy"
      >
        <Check v-if="copied" class="h-4 w-4 text-success" :stroke-width="2.25" />
        <Copy v-else class="h-4 w-4" :stroke-width="2" />
      </button>
    </div>

    <!-- Quick-start link below — the "now what?" affordance for
         readers who copied the command and want the next step.
         Opt-out via `:show-quick-start="false"` on pages that
         already have their own quick-start CTA next to the card. -->
    <NuxtLink
      v-if="props.showQuickStart"
      to="/docs/quickstart"
      class="group flex items-center justify-between border-t border-border px-4 py-3 text-sm font-semibold text-accent transition-colors duration-(--duration-fast) hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent-ring"
    >
      <span>Quick start</span>
      <ArrowRight
        class="h-4 w-4 transition-transform duration-(--duration-fast) group-hover:translate-x-0.5"
        :stroke-width="2.25"
      />
    </NuxtLink>
  </div>
</template>

<style scoped>
  /* Stacked grid: every invisible variant claims row 1 / col 1
     so the cell auto-sizes to the widest. The visible command is
     absolutely positioned over the cell. Switching managers can
     never narrow or widen the row. */
  .command-sizer {
    display: grid;
    grid-template-columns: max-content;
    position: relative;
    min-width: 0;
  }
  .command-sizer > code {
    grid-row: 1;
    grid-column: 1;
    white-space: nowrap;
  }
  .command-sizer > .invisible-cmd {
    visibility: hidden;
  }
  .command-sizer > .visible-cmd {
    position: absolute;
    inset: 0;
  }
</style>
