<script setup lang="ts">
  import { computed, nextTick, ref } from 'vue'
  // Route through the public `attaform` entry — see the panel component
  // for the full rationale (published .vue can't reach the rollup-shared
  // chunks via relative path).
  import { REDACTED } from 'attaform'

  const props = defineProps<{
    value: unknown
    label?: string
    depth?: number
    /**
     * Path-from-root for this node. Used by edit-aware mounts so the
     * commit handler knows which leaf the user just touched. Default
     * `[]` for non-editable mounts; the panel passes the explicit path
     * when it wires up `onEdit`.
     */
    path?: ReadonlyArray<string | number>
    /**
     * Edit-mode toggle. When `true` and `onEdit` is wired, leaf cells
     * become click-to-edit. Sensitive (redacted) leaves stay read-only
     * regardless — overwriting with the literal `[redacted]` string
     * would destroy the real value.
     */
    editable?: boolean
    onEdit?: (path: ReadonlyArray<string | number>, next: unknown) => void
  }>()

  // Top-level expanded by default; deeper nodes collapsed past 2 levels
  // so a deeply-nested form doesn't paint a wall of text on first render.
  const depth = computed(() => props.depth ?? 0)
  const expanded = ref(depth.value < 2)
  const path = computed<ReadonlyArray<string | number>>(() => props.path ?? [])

  const type = computed<
    | 'null'
    | 'undefined'
    | 'array'
    | 'object'
    | 'string'
    | 'number'
    | 'boolean'
    | 'redacted'
    | 'other'
  >(() => {
    const v = props.value
    if (v === null) return 'null'
    if (v === undefined) return 'undefined'
    if (typeof v === 'string') return v === REDACTED ? 'redacted' : 'string'
    if (typeof v === 'number') return 'number'
    if (typeof v === 'boolean') return 'boolean'
    if (Array.isArray(v)) return 'array'
    if (typeof v === 'object') return 'object'
    return 'other'
  })

  const isLeaf = computed(() => type.value !== 'array' && type.value !== 'object')

  const entries = computed<ReadonlyArray<readonly [string, unknown]>>(() => {
    const v = props.value
    if (Array.isArray(v)) return v.map((item, i) => [String(i), item] as const)
    if (v !== null && typeof v === 'object') {
      return Object.entries(v as Record<string, unknown>)
    }
    return []
  })

  const formatted = computed(() => {
    const v = props.value
    if (v === null) return 'null'
    if (v === undefined) return 'undefined'
    if (type.value === 'redacted') return REDACTED
    if (typeof v === 'string') return `"${v}"`
    if (typeof v === 'boolean' || typeof v === 'number') return String(v)
    return String(v)
  })

  const summary = computed(() => {
    const v = props.value
    if (Array.isArray(v)) return `Array(${v.length})`
    if (v !== null && typeof v === 'object') {
      const keys = Object.keys(v as Record<string, unknown>)
      return `{${keys.length}}`
    }
    return ''
  })

  // Edit mode -----------------------------------------------------------

  const isEditableLeaf = computed(() => {
    if (!props.editable || props.onEdit === undefined) return false
    return type.value === 'string' || type.value === 'number' || type.value === 'boolean'
  })

  const editing = ref(false)
  const editValue = ref('')
  const editInput = ref<HTMLInputElement | null>(null)
  const editRejected = ref(false)

  function childPath(rawKey: string): ReadonlyArray<string | number> {
    // Array indices arrive as stringified numbers from `Object.entries` /
    // `array.map`. Coerce back to numbers when the parent is an array
    // so `canonicalizePath` on the consumer side gets a structured Path
    // with the right shape — `["users", 0, "name"]`, not
    // `["users", "0", "name"]`.
    if (type.value === 'array') return [...path.value, Number(rawKey)]
    return [...path.value, rawKey]
  }

  async function startEdit(): Promise<void> {
    if (!isEditableLeaf.value) return
    editValue.value =
      type.value === 'boolean' || type.value === 'number'
        ? String(props.value ?? '')
        : (props.value as string)
    editing.value = true
    editRejected.value = false
    await nextTick()
    editInput.value?.focus()
    editInput.value?.select?.()
  }

  function flashRejected(): void {
    editRejected.value = true
    setTimeout(() => {
      editRejected.value = false
    }, 600)
  }

  function commitEdit(): void {
    if (!editing.value || props.onEdit === undefined) return
    let next: unknown = editValue.value
    if (type.value === 'number') {
      const parsed = Number(editValue.value)
      if (!Number.isFinite(parsed)) {
        flashRejected()
        editing.value = false
        return
      }
      next = parsed
    } else if (type.value === 'boolean') {
      // Boolean leaves go through a checkbox commit path that calls the
      // emitter directly; this branch is defensive in case a text-mode
      // commit lands on a boolean leaf.
      next = editValue.value === 'true'
    }
    if (next !== props.value) props.onEdit(path.value, next)
    editing.value = false
  }

  function cancelEdit(): void {
    editing.value = false
    editRejected.value = false
  }

  function toggleBoolean(checked: boolean): void {
    if (!isEditableLeaf.value || props.onEdit === undefined) return
    props.onEdit(path.value, checked)
  }
</script>

<template>
  <div class="tree-node">
    <template v-if="isLeaf">
      <div class="row" :class="{ 'edit-rejected': editRejected }">
        <span v-if="label" class="key">{{ label }}:</span>
        <template v-if="editing && (type === 'string' || type === 'number')">
          <input
            ref="editInput"
            v-model="editValue"
            class="leaf-input"
            :type="type === 'number' ? 'text' : 'text'"
            :inputmode="type === 'number' ? 'decimal' : 'text'"
            @keydown.enter.prevent="commitEdit"
            @keydown.escape.prevent="cancelEdit"
            @blur="commitEdit"
          />
        </template>
        <template v-else-if="isEditableLeaf && type === 'boolean'">
          <label class="leaf-bool">
            <input
              type="checkbox"
              :checked="value as boolean"
              @change="toggleBoolean(($event.target as HTMLInputElement).checked)"
            />
            <span class="leaf leaf-boolean">{{ formatted }}</span>
          </label>
        </template>
        <template v-else>
          <span
            class="leaf"
            :class="[`leaf-${type}`, { 'leaf-editable': isEditableLeaf }]"
            :title="isEditableLeaf ? 'Click to edit' : undefined"
            @click="isEditableLeaf ? startEdit() : null"
          >
            <span v-if="type === 'redacted'" class="lock" aria-hidden="true">🔒</span>
            {{ formatted }}
          </span>
        </template>
      </div>
    </template>
    <template v-else>
      <div class="row branch" @click="expanded = !expanded">
        <span class="caret" :class="{ open: expanded }">›</span>
        <span v-if="label" class="key">{{ label }}:</span>
        <span class="branch-summary">{{ summary }}</span>
      </div>
      <div v-if="expanded" class="children">
        <DevtoolsValueTree
          v-for="[k, v] in entries"
          :key="k"
          :value="v"
          :label="k"
          :depth="depth + 1"
          :path="childPath(k)"
          :editable="editable"
          :on-edit="onEdit"
        />
      </div>
    </template>
  </div>
</template>

<style scoped>
  .tree-node {
    font-family: ui-monospace, 'SF Mono', Menlo, Consolas, monospace;
    font-size: 12px;
    line-height: 1.6;
  }
  .row {
    display: flex;
    align-items: baseline;
    gap: 0.4em;
    padding: 1px 0;
  }
  .branch {
    cursor: pointer;
    user-select: none;
  }
  .branch:hover {
    background: var(--atf-row-hover, rgba(255, 255, 255, 0.04));
  }
  .caret {
    display: inline-block;
    width: 0.7em;
    transition: transform 120ms ease;
    color: var(--atf-muted, #64748b);
    transform: rotate(0deg);
  }
  .caret.open {
    transform: rotate(90deg);
  }
  .key {
    color: var(--atf-key, #93c5fd);
    flex-shrink: 0;
  }
  .leaf-string {
    color: var(--atf-string, #86efac);
  }
  .leaf-number {
    color: var(--atf-number, #fbbf24);
  }
  .leaf-boolean {
    color: var(--atf-boolean, #f472b6);
  }
  .leaf-null,
  .leaf-undefined {
    color: var(--atf-muted, #64748b);
    font-style: italic;
  }
  .leaf-redacted {
    color: var(--atf-redacted, #f87171);
    font-style: italic;
  }
  .lock {
    margin-right: 2px;
  }
  .branch-summary {
    color: var(--atf-muted, #64748b);
  }
  .children {
    padding-left: 1.4em;
    border-left: 1px dashed var(--atf-border, rgba(255, 255, 255, 0.08));
    margin-left: 0.3em;
  }

  .leaf-editable {
    cursor: text;
    border-bottom: 1px dotted transparent;
    transition: border-color 120ms ease;
  }
  .leaf-editable:hover {
    border-bottom-color: var(--atf-muted, #64748b);
  }
  .leaf-input {
    flex: 1;
    background: var(--atf-bg, #0f172a);
    border: 1px solid var(--atf-accent, #5b8def);
    color: var(--atf-fg, #e2e8f0);
    font: inherit;
    padding: 0.05em 0.4em;
    border-radius: 3px;
    outline: none;
    min-width: 8em;
  }
  .leaf-bool {
    display: inline-flex;
    align-items: center;
    gap: 0.4em;
    cursor: pointer;
  }
  .leaf-bool input {
    margin: 0;
    cursor: pointer;
  }
  .edit-rejected {
    animation: atf-shake 0.4s ease;
  }
  @keyframes atf-shake {
    0%,
    100% {
      transform: translateX(0);
    }
    20%,
    60% {
      transform: translateX(-3px);
    }
    40%,
    80% {
      transform: translateX(3px);
    }
  }
</style>
