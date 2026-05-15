<script setup lang="ts">
  import { computed, onUnmounted, ref, watch } from 'vue'
  // Imports route through the public `attaform` entry so the published
  // `.vue` file (shipped via mkdist under `dist/runtime/components/`)
  // can resolve through the consumer's node_modules → `dist/index.mjs`,
  // rather than through brittle relative paths into the rollup-bundled
  // shared chunks (which mkdist doesn't co-locate). Type-only imports of
  // internal types stay relative — they're erased at compile time and
  // don't need to resolve at the consumer's runtime.
  import {
    type AttaformDevtoolsBridge,
    canonicalizePath,
    redactSensitiveLeaves,
    type Segment,
  } from 'attaform'
  import type { FormStore } from '../core/create-form-store'
  import type { GenericForm } from '../types/types-core'
  import type { FormKey } from '../types/types-api'
  import DevtoolsValueTree from './DevtoolsValueTree.vue'

  const props = defineProps<{
    bridge: AttaformDevtoolsBridge
  }>()

  const registry = computed(() => props.bridge.registry)
  const formEntries = computed(() => Array.from(registry.value.forms.entries()))

  // Explicit selection. `null` means "auto-pick first available form".
  const selectedFormKey = ref<FormKey | null>(null)

  const activeKey = computed<FormKey | null>(() => {
    if (selectedFormKey.value !== null && registry.value.forms.has(selectedFormKey.value)) {
      return selectedFormKey.value
    }
    return formEntries.value[0]?.[0] ?? null
  })

  const activeForm = computed(() => {
    const key = activeKey.value
    return key !== null ? (registry.value.forms.get(key) ?? null) : null
  })

  const redactedFormValue = computed(() => {
    const form = activeForm.value
    if (form === null) return null
    return redactSensitiveLeaves(form.form.value, form.segmentMatchesSensitive)
  })

  const schemaErrorRows = computed(() => {
    const form = activeForm.value
    if (form === null) return []
    return Array.from(form.schemaErrors.entries())
  })

  const userErrorRows = computed(() => {
    const form = activeForm.value
    if (form === null) return []
    return Array.from(form.userErrors.entries())
  })

  const aggregates = computed(() => {
    const form = activeForm.value
    if (form === null) return null
    return {
      submitting: form.submitting.value,
      submitCount: form.submitCount.value,
      submitError: form.submitError.value,
      activeValidations: form.activeValidations.value,
    }
  })

  function selectForm(key: FormKey): void {
    selectedFormKey.value = key
  }

  /**
   * Convert a canonical PathKey (e.g. `'["users",0,"name"]'`) back to a
   * readable dotted form (`users.0.name`) for the error table. Falls
   * back to the raw key if it's not a JSON-array shape.
   */
  function humanizePathKey(key: string): string {
    try {
      const parsed = JSON.parse(key) as unknown[]
      if (Array.isArray(parsed)) {
        return parsed.map((seg) => (typeof seg === 'number' ? String(seg) : String(seg))).join('.')
      }
    } catch {
      // not JSON, render as-is
    }
    return key
  }

  function formatSubmitError(err: unknown): string {
    if (err === null || err === undefined) return '—'
    if (err instanceof Error) return `${err.name}: ${err.message}`
    if (typeof err === 'string') return err
    try {
      return JSON.stringify(err)
    } catch {
      return String(err)
    }
  }

  /**
   * Commit a leaf edit from the value tree. Mirrors the exact flow the
   * Vue DevTools `editInspectorState` handler uses in
   * `src/runtime/core/devtools.ts` so both surfaces have identical
   * semantics:
   *   1. canonicalize the structured path
   *   2. refuse sensitive-name paths (the tree already gates the UI,
   *      but a defensive check here keeps the contract honest)
   *   3. derive the persist flag from the path's element opt-ins
   *   4. call setValueAtPath with the same write-meta the bound input
   *      would have produced
   */
  function handleEdit(rawPath: ReadonlyArray<string | number>, next: unknown): void {
    const form = activeForm.value
    if (form === null) return
    const { segments: canonicalPath, key: canonicalKey } = canonicalizePath(
      rawPath as readonly Segment[]
    )
    if (form.isSensitivePath([...canonicalPath])) return
    form.setValueAtPath(canonicalPath, next, {
      persist: form.persistOptIns.hasAnyOptInForPath(canonicalKey),
    })
  }

  // Timeline log ----------------------------------------------------------

  type TimelineEventType = 'form.change' | 'submit.success' | 'reset'

  interface TimelineEvent {
    id: number
    type: TimelineEventType
    formKey: FormKey
    time: number
    value: unknown
  }

  /**
   * Hard cap on the in-memory event log. Sized for a debugging session,
   * not an audit log — older events fall off the back when capacity
   * fills. Tunable later if real consumers ask for more.
   */
  const MAX_TIMELINE_EVENTS = 200
  const events = ref<TimelineEvent[]>([])
  const expandedEventId = ref<number | null>(null)
  let eventIdCounter = 0

  function pushEvent(seed: Omit<TimelineEvent, 'id'>): void {
    const entry: TimelineEvent = { id: ++eventIdCounter, ...seed }
    const next = [entry, ...events.value]
    if (next.length > MAX_TIMELINE_EVENTS) next.length = MAX_TIMELINE_EVENTS
    events.value = next
  }

  function clearTimeline(): void {
    events.value = []
    expandedEventId.value = null
  }

  function toggleEvent(id: number): void {
    expandedEventId.value = expandedEventId.value === id ? null : id
  }

  function formatTime(time: number): string {
    const d = new Date(time)
    const hh = String(d.getHours()).padStart(2, '0')
    const mm = String(d.getMinutes()).padStart(2, '0')
    const ss = String(d.getSeconds()).padStart(2, '0')
    const ms = String(d.getMilliseconds()).padStart(3, '0')
    return `${hh}:${mm}:${ss}.${ms}`
  }

  // Per-form subscriber bookkeeping. Re-scoped whenever the registry's
  // form set changes so newly-registered forms wire up automatically and
  // evicted forms drop their subscribers (no leaks across HMR reloads).
  const subscribers = new Map<FormKey, () => void>()

  function subscribeForm(key: FormKey, form: FormStore<GenericForm>): void {
    if (subscribers.has(key)) return
    const captureValue = (): unknown =>
      redactSensitiveLeaves(form.form.value, form.segmentMatchesSensitive)
    const unsubChange = form.onFormChange(() => {
      pushEvent({ type: 'form.change', formKey: key, time: Date.now(), value: captureValue() })
    })
    const unsubSubmit = form.onSubmitSuccess(() => {
      pushEvent({ type: 'submit.success', formKey: key, time: Date.now(), value: captureValue() })
    })
    const unsubReset = form.onReset(() => {
      pushEvent({ type: 'reset', formKey: key, time: Date.now(), value: captureValue() })
    })
    subscribers.set(key, () => {
      unsubChange()
      unsubSubmit()
      unsubReset()
    })
  }

  watch(
    formEntries,
    (entries) => {
      const liveKeys = new Set(entries.map(([k]) => k))
      for (const [key, form] of entries) {
        if (!subscribers.has(key)) subscribeForm(key, form as FormStore<GenericForm>)
      }
      for (const [key, unsub] of subscribers) {
        if (!liveKeys.has(key)) {
          unsub()
          subscribers.delete(key)
        }
      }
    },
    { immediate: true }
  )

  onUnmounted(() => {
    for (const unsub of subscribers.values()) unsub()
    subscribers.clear()
  })
</script>

<template>
  <div class="atf-panel">
    <header class="atf-header">
      <div class="atf-brand">
        <span class="atf-logo" aria-hidden="true">A</span>
        <span class="atf-title">Attaform</span>
        <span class="atf-version">v{{ bridge.version }}</span>
      </div>
    </header>

    <div class="atf-body">
      <aside class="atf-sidebar">
        <div class="atf-sidebar-title">
          Forms <span class="atf-count">{{ formEntries.length }}</span>
        </div>
        <ul v-if="formEntries.length === 0" class="atf-empty">
          <li>
            No registered forms yet.
            <small>Call <code>useForm()</code> on a page to see it here.</small>
          </li>
        </ul>
        <ul v-else class="atf-form-list">
          <li
            v-for="[key] in formEntries"
            :key="key"
            class="atf-form-item"
            :class="{ active: key === activeKey }"
            @click="selectForm(key)"
          >
            {{ key }}
          </li>
        </ul>
      </aside>

      <main class="atf-detail">
        <div v-if="activeForm === null" class="atf-empty-detail">Select a form on the left.</div>
        <template v-else>
          <section class="atf-section">
            <h2 class="atf-section-title">Form value</h2>
            <div class="atf-section-body atf-tree">
              <DevtoolsValueTree
                :value="redactedFormValue"
                :editable="true"
                :on-edit="handleEdit"
              />
            </div>
          </section>

          <section class="atf-section">
            <h2 class="atf-section-title">
              Schema Errors
              <span v-if="schemaErrorRows.length" class="atf-badge atf-badge-error">
                {{ schemaErrorRows.length }}
              </span>
            </h2>
            <div class="atf-section-body">
              <p v-if="schemaErrorRows.length === 0" class="atf-empty-list"> No schema errors. </p>
              <ul v-else class="atf-error-list">
                <li v-for="[path, errs] in schemaErrorRows" :key="path">
                  <code class="atf-path">{{ humanizePathKey(path) }}</code>
                  <ul class="atf-error-messages">
                    <li v-for="(e, i) in errs" :key="i">{{ e.message }}</li>
                  </ul>
                </li>
              </ul>
            </div>
          </section>

          <section class="atf-section">
            <h2 class="atf-section-title">
              User Errors
              <span v-if="userErrorRows.length" class="atf-badge atf-badge-warn">
                {{ userErrorRows.length }}
              </span>
            </h2>
            <div class="atf-section-body">
              <p v-if="userErrorRows.length === 0" class="atf-empty-list">
                No user-injected errors.
              </p>
              <ul v-else class="atf-error-list">
                <li v-for="[path, errs] in userErrorRows" :key="path">
                  <code class="atf-path">{{ humanizePathKey(path) }}</code>
                  <ul class="atf-error-messages">
                    <li v-for="(e, i) in errs" :key="i">{{ e.message }}</li>
                  </ul>
                </li>
              </ul>
            </div>
          </section>

          <section v-if="aggregates" class="atf-section">
            <h2 class="atf-section-title">Aggregates</h2>
            <div class="atf-section-body">
              <dl class="atf-aggregates">
                <dt>submitting</dt>
                <dd>{{ aggregates.submitting }}</dd>
                <dt>submitCount</dt>
                <dd>{{ aggregates.submitCount }}</dd>
                <dt>submitError</dt>
                <dd>{{ formatSubmitError(aggregates.submitError) }}</dd>
                <dt>activeValidations</dt>
                <dd>{{ aggregates.activeValidations }}</dd>
              </dl>
            </div>
          </section>

          <section class="atf-section">
            <h2 class="atf-section-title">
              Timeline
              <span v-if="events.length" class="atf-badge atf-badge-neutral">
                {{ events.length }}{{ events.length === MAX_TIMELINE_EVENTS ? '+' : '' }}
              </span>
              <button
                v-if="events.length"
                type="button"
                class="atf-clear-btn"
                @click="clearTimeline"
              >
                clear
              </button>
            </h2>
            <div class="atf-section-body">
              <p v-if="events.length === 0" class="atf-empty-list">
                No events yet. Type into an input, submit, or call <code>reset()</code> to see
                entries appear here.
              </p>
              <ul v-else class="atf-timeline">
                <li
                  v-for="event in events"
                  :key="event.id"
                  class="atf-timeline-entry"
                  :class="[
                    `atf-timeline-${event.type.split('.')[0]}`,
                    { expanded: expandedEventId === event.id },
                  ]"
                >
                  <div class="atf-timeline-row" @click="toggleEvent(event.id)">
                    <span class="atf-timeline-time">{{ formatTime(event.time) }}</span>
                    <span class="atf-timeline-type">{{ event.type }}</span>
                    <span class="atf-timeline-form">{{ event.formKey }}</span>
                    <span class="atf-timeline-caret">
                      {{ expandedEventId === event.id ? '−' : '+' }}
                    </span>
                  </div>
                  <div v-if="expandedEventId === event.id" class="atf-timeline-detail">
                    <DevtoolsValueTree :value="event.value" />
                  </div>
                </li>
              </ul>
            </div>
          </section>
        </template>
      </main>
    </div>
  </div>
</template>

<style scoped>
  /*
   * Self-contained styling. The panel runs in an iframe inside the Nuxt
   * DevTools overlay — CSS custom properties from the host don't cross
   * the iframe boundary, so we ship our own palette here. Dark by
   * default, light via prefers-color-scheme so the panel adapts to the
   * user's OS theme without further wiring.
   */
  .atf-panel {
    --atf-bg: #0f172a;
    --atf-bg-elev: #111c33;
    --atf-fg: #e2e8f0;
    --atf-fg-muted: #94a3b8;
    --atf-border: rgba(148, 163, 184, 0.12);
    --atf-border-strong: rgba(148, 163, 184, 0.2);
    --atf-accent: #5b8def;
    --atf-key: #93c5fd;
    --atf-string: #86efac;
    --atf-number: #fbbf24;
    --atf-boolean: #f472b6;
    --atf-redacted: #f87171;
    --atf-muted: #64748b;
    --atf-row-hover: rgba(255, 255, 255, 0.04);
    --atf-error-bg: rgba(248, 113, 113, 0.1);
    --atf-warn-bg: rgba(251, 191, 36, 0.1);

    height: 100vh;
    background: var(--atf-bg);
    color: var(--atf-fg);
    display: flex;
    flex-direction: column;
    font-family:
      system-ui,
      -apple-system,
      'Segoe UI',
      sans-serif;
    font-size: 13px;
    line-height: 1.5;
  }

  @media (prefers-color-scheme: light) {
    .atf-panel {
      --atf-bg: #ffffff;
      --atf-bg-elev: #f8fafc;
      --atf-fg: #0f172a;
      --atf-fg-muted: #64748b;
      --atf-border: rgba(15, 23, 42, 0.08);
      --atf-border-strong: rgba(15, 23, 42, 0.16);
      --atf-key: #2563eb;
      --atf-string: #16a34a;
      --atf-number: #d97706;
      --atf-boolean: #db2777;
      --atf-redacted: #dc2626;
      --atf-muted: #94a3b8;
      --atf-row-hover: rgba(15, 23, 42, 0.04);
      --atf-error-bg: rgba(220, 38, 38, 0.08);
      --atf-warn-bg: rgba(217, 119, 6, 0.08);
    }
  }

  /* Header */
  .atf-header {
    flex: 0 0 auto;
    padding: 0.75rem 1rem;
    border-bottom: 1px solid var(--atf-border);
    background: var(--atf-bg-elev);
  }
  .atf-brand {
    display: flex;
    align-items: baseline;
    gap: 0.5rem;
  }
  .atf-logo {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
    background: var(--atf-accent);
    color: white;
    font-weight: 700;
    border-radius: 4px;
    font-size: 12px;
  }
  .atf-title {
    font-weight: 600;
    font-size: 14px;
  }
  .atf-version {
    color: var(--atf-fg-muted);
    font-size: 11px;
    font-family: ui-monospace, monospace;
  }

  /* Body layout */
  .atf-body {
    flex: 1 1 auto;
    display: grid;
    grid-template-columns: 200px 1fr;
    min-height: 0;
  }

  /* Sidebar */
  .atf-sidebar {
    border-right: 1px solid var(--atf-border);
    overflow-y: auto;
    padding: 0.75rem 0;
  }
  .atf-sidebar-title {
    padding: 0 1rem 0.5rem;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--atf-fg-muted);
    display: flex;
    align-items: center;
    gap: 0.4em;
  }
  .atf-count {
    background: var(--atf-border-strong);
    color: var(--atf-fg);
    padding: 0 0.4em;
    border-radius: 999px;
    font-size: 10px;
  }
  .atf-empty {
    list-style: none;
    padding: 0 1rem;
    margin: 0;
    color: var(--atf-fg-muted);
  }
  .atf-empty small {
    display: block;
    margin-top: 0.4rem;
    font-size: 11px;
  }
  .atf-empty code {
    background: var(--atf-border);
    padding: 0.05em 0.35em;
    border-radius: 3px;
    font-size: 11px;
  }
  .atf-form-list {
    list-style: none;
    padding: 0;
    margin: 0;
  }
  .atf-form-item {
    padding: 0.4rem 1rem;
    cursor: pointer;
    user-select: none;
    font-family: ui-monospace, monospace;
    font-size: 12px;
  }
  .atf-form-item:hover {
    background: var(--atf-row-hover);
  }
  .atf-form-item.active {
    background: rgba(91, 141, 239, 0.12);
    border-left: 2px solid var(--atf-accent);
    padding-left: calc(1rem - 2px);
    color: var(--atf-key);
  }

  /* Detail */
  .atf-detail {
    overflow-y: auto;
    padding: 1rem 1.25rem;
  }
  .atf-empty-detail {
    color: var(--atf-fg-muted);
    text-align: center;
    padding: 3rem 0;
  }
  .atf-section {
    margin-bottom: 1.25rem;
  }
  .atf-section-title {
    margin: 0 0 0.5rem;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--atf-fg-muted);
    display: flex;
    align-items: center;
    gap: 0.5em;
    font-weight: 600;
  }
  .atf-section-body {
    background: var(--atf-bg-elev);
    border: 1px solid var(--atf-border);
    border-radius: 6px;
    padding: 0.6rem 0.8rem;
  }
  .atf-badge {
    padding: 0 0.45em;
    border-radius: 999px;
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.04em;
  }
  .atf-badge-error {
    background: var(--atf-error-bg);
    color: var(--atf-redacted);
  }
  .atf-badge-warn {
    background: var(--atf-warn-bg);
    color: var(--atf-number);
  }
  .atf-empty-list {
    margin: 0;
    color: var(--atf-fg-muted);
    font-size: 12px;
  }
  .atf-error-list {
    list-style: none;
    padding: 0;
    margin: 0;
  }
  .atf-error-list > li + li {
    margin-top: 0.6rem;
    border-top: 1px solid var(--atf-border);
    padding-top: 0.6rem;
  }
  .atf-path {
    font-family: ui-monospace, monospace;
    font-size: 12px;
    color: var(--atf-key);
    display: block;
    margin-bottom: 0.25rem;
  }
  .atf-error-messages {
    list-style: none;
    padding: 0;
    margin: 0;
    color: var(--atf-redacted);
    font-size: 12px;
  }
  .atf-error-messages > li + li {
    margin-top: 0.2rem;
  }
  .atf-aggregates {
    display: grid;
    grid-template-columns: max-content 1fr;
    gap: 0.35rem 0.75rem;
    margin: 0;
    font-size: 12px;
    font-family: ui-monospace, monospace;
  }
  .atf-aggregates dt {
    color: var(--atf-key);
  }
  .atf-aggregates dd {
    margin: 0;
    color: var(--atf-fg);
  }

  /* Timeline */
  .atf-badge-neutral {
    background: var(--atf-border-strong);
    color: var(--atf-fg);
  }
  .atf-clear-btn {
    margin-left: auto;
    background: transparent;
    border: 1px solid var(--atf-border);
    color: var(--atf-fg-muted);
    font: inherit;
    font-size: 11px;
    padding: 0.1rem 0.5rem;
    border-radius: 4px;
    cursor: pointer;
  }
  .atf-clear-btn:hover {
    border-color: var(--atf-border-strong);
    color: var(--atf-fg);
  }
  .atf-timeline {
    list-style: none;
    padding: 0;
    margin: 0;
    max-height: 18rem;
    overflow-y: auto;
  }
  .atf-timeline-entry {
    border-top: 1px solid var(--atf-border);
  }
  .atf-timeline-entry:first-child {
    border-top: 0;
  }
  .atf-timeline-row {
    display: grid;
    grid-template-columns: 7.5rem 8rem 1fr auto;
    gap: 0.6rem;
    align-items: baseline;
    padding: 0.4rem 0;
    cursor: pointer;
    font-family: ui-monospace, monospace;
    font-size: 11px;
  }
  .atf-timeline-row:hover {
    background: var(--atf-row-hover);
  }
  .atf-timeline-time {
    color: var(--atf-fg-muted);
  }
  .atf-timeline-type {
    color: var(--atf-key);
    font-weight: 600;
  }
  .atf-timeline-form {
    color: var(--atf-fg);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .atf-timeline-caret {
    color: var(--atf-fg-muted);
    width: 1em;
    text-align: center;
  }
  .atf-timeline-entry.atf-timeline-submit .atf-timeline-type {
    color: var(--atf-string);
  }
  .atf-timeline-entry.atf-timeline-reset .atf-timeline-type {
    color: var(--atf-redacted);
  }
  .atf-timeline-detail {
    padding: 0.4rem 0 0.6rem 7.5rem;
    border-top: 1px dashed var(--atf-border);
    margin-top: -1px;
  }
</style>
