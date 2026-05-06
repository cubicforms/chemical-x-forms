<script setup lang="ts">
  import { Repl, useStore } from '@vue/repl'
  import MonacoEditor from '@vue/repl/monaco-editor'
  import '@vue/repl/style.css'

  // Sizing + lifecycle (SSR skeleton, deferred mount, route-leave
  // guard) live on the parent `<DemoRepl>` shell. This component is
  // pure editor: it expects to be mounted only when the host wrapper
  // is in the DOM and the page transition has settled, so the
  // Sandbox-iframe race documented at the top of `<DemoRepl>` can't
  // fire here.

  // Worker URL override — runs once at module load on the client.
  //
  // The Monaco preset bundles its workers and spawns them via
  // `new Worker(new URL("assets/<chunk>.js", import.meta.url), { type: 'module' })`.
  // In dev, Vite injects its `@vite/client` HMR bootstrap into those
  // worker files — and @vite/client's module-level WebSocket setup
  // fails to handshake from a worker context, killing every worker
  // at startup. The `bundle-repl-deps.mjs` script copies clean
  // copies of those worker chunks to `/lib/repl-workers/`, served
  // by Nitro as static files (no Vite injection).
  //
  // We can't replace `MonacoEnvironment.getWorker` directly: the
  // @vue/repl bundle's getWorker does a non-trivial init handshake
  // for the Vue worker (postMessage of resourceLinks, tsVersion,
  // etc.) that our override would have to reimplement against the
  // store. Instead, monkey-patch the `Worker` constructor itself —
  // intercept only the `assets/(editor|vue).worker-*.js` URLs and
  // rewrite them to the static copies, leaving every other Worker
  // construction alone. The init handshake then runs unchanged
  // because @vue/repl doesn't care which URL the worker came from.
  if (import.meta.client && !('__attaformReplWorkerPatched' in self)) {
    Object.defineProperty(self, '__attaformReplWorkerPatched', { value: true })
    const Original = self.Worker
    const REPL_WORKER_RE = /assets\/(editor|vue)\.worker-[^/]+\.js(?:[?#]|$)/
    self.Worker = new Proxy(Original, {
      construct(target, args: ConstructorParameters<typeof Worker>) {
        const [src, options] = args
        const href = src instanceof URL ? src.href : String(src)
        const match = REPL_WORKER_RE.exec(href)
        if (match) {
          const label = match[1]
          return new target(`/lib/repl-workers/${label}.worker.js`, options)
        }
        return new target(src, options)
      },
    })
  }

  const importMap = {
    imports: {
      vue: '/lib/vue.esm-browser.prod.js',
      zod: '/lib/zod.js',
      attaform: '/lib/attaform.js',
      'attaform/zod': '/lib/attaform-zod.js',
    },
  }

  // Sample app served by the REPL preview iframe. Hand-written here
  // (rather than imported from a fixture file) because @vue/repl reads
  // it as a single string. The closing script + style tags inside the
  // template literal are split via interpolation (e.g. ${'</' + 'script>'})
  // so the HTML parser of the *outer* SFC doesn't terminate this
  // script block early. Visual styling lives in a dedicated style
  // block at the end of the example — the template uses semantic
  // class names (form, field, submit, …) so a reader can see the
  // form structure without parsing inline declarations.
  const appCode = `<${'script'} setup lang="ts">
  // ─────────────────────────────────────────────────────────────────
  // Cargo shipment booking — a stress test for Attaform.
  //
  // Exercises (in roughly this order):
  //   - Discriminated unions (cargo class, service mode)
  //   - Enums (country, hazard class, container size, coverage)
  //   - Field arrays with min/max, undo/redo across mutations
  //   - Async field-level validation (postal-code lookup, SKU lookup)
  //   - Async aggregate validation (capacity check on cargo.items)
  //   - Transforms (SKU uppercase normalisation)
  //   - Unset sentinel for optional fields (notes, permit number)
  //   - Persistence (drafts auto-saved to localStorage)
  //   - Multi-step navigation gated on per-step validity
  //   - meta.valid / field.valid for green/red field state
  //   - meta.validating / field.validating for per-field "Checking…"
  //   - Touched-aware error display (no error spam pre-blur)
  // ─────────────────────────────────────────────────────────────────

  import { computed, nextTick, ref, watch } from 'vue'
  import { z } from 'zod'
  import { useForm, unset, isUnset } from 'attaform/zod'
  import type { FieldStateLeaf } from 'attaform'

  // ─── Mock async services ─────────────────────────────────────────
  // Real apps would hit a backend; here we fake out latency + a
  // hardcoded valid set so the validation behaviour is observable.

  const KNOWN_POSTAL_PREFIXES = new Set([
    '10', '11', '90', '94', '60', '20',            // US
    'M5', 'V6', 'H3',                              // CA (alphanumeric)
    '01', '20', '75',                              // EU-style
    'SW', 'EC', 'W1',                              // UK
  ])
  function lookupPostalCode(value: string): Promise<boolean> {
    return new Promise((resolve) => {
      setTimeout(() => {
        const head = value.slice(0, 2).toUpperCase()
        resolve(KNOWN_POSTAL_PREFIXES.has(head))
      }, 600)
    })
  }

  const KNOWN_SKUS = new Set([
    'SKU-1001', 'SKU-1002', 'SKU-1003',
    'SKU-2001', 'SKU-2002',
    'PALLET-A', 'PALLET-B',
  ])
  function lookupSku(value: string): Promise<boolean> {
    return new Promise((resolve) => {
      setTimeout(() => resolve(KNOWN_SKUS.has(value)), 450)
    })
  }

  // Aggregate capacity check, attached to cargo.items via .superRefine
  // below. Pretends an over-3000 total weight exceeds today's capacity.
  function checkCapacity(totalKg: number): Promise<boolean> {
    return new Promise((resolve) => {
      setTimeout(() => resolve(totalKg <= 3000), 800)
    })
  }

  // ─── Schemas ─────────────────────────────────────────────────────

  const COUNTRIES = ['US', 'CA', 'MX', 'GB', 'DE', 'FR', 'JP', 'CN', 'AU'] as const

  const addressSchema = z.object({
    line1: z.string().min(1, 'Required'),
    line2: z.string().optional(),
    city: z.string().min(1, 'Required'),
    region: z.string().min(2, 'Two-letter region'),
    postalCode: z
      .string()
      .min(3, 'Required')
      .refine(async (v) => await lookupPostalCode(v), 'Postal code not found'),
    country: z.enum(COUNTRIES),
  })

  const lineItemSchema = z.object({
    sku: z
      .string()
      .regex(/^[A-Z0-9-]{4,16}$/, 'Format: A-Z, 0-9, dashes')
      .refine(async (sku) => await lookupSku(sku), 'Unknown SKU'),
    description: z.string().min(1, 'Required').max(120, 'Max 120 chars'),
    quantity: z.number().int('Whole units only').min(1, 'At least 1').max(10_000, 'Max 10,000'),
    unitWeightKg: z.number().positive('Must be positive'),
  })

  // Items array shared across cargo variants. The async .superRefine
  // is the capacity check — runs whenever items change (debounced by
  // the form's debounceMs), and handleSubmit awaits it before firing
  // the success callback. The error attaches at this array's path
  // (cargo.items), surfacing through cargoItemsArrayError below.
  const lineItemArraySchema = z
    .array(lineItemSchema)
    .min(1, 'Add at least one line item')
    .superRefine(async (items, ctx) => {
      const totalKg = items.reduce(
        (sum, it) => sum + it.quantity * it.unitWeightKg,
        0
      )
      const ok = await checkCapacity(totalKg)
      if (!ok) {
        ctx.addIssue({
          code: 'custom',
          message: \`Today's capacity is exhausted (\${totalKg} kg). Try a smaller shipment or schedule for tomorrow.\`,
        })
      }
    })

  const dryGoodsSchema = z.object({
    type: z.literal('dry'),
    items: lineItemArraySchema,
    fragile: z.boolean(),
  })

  const refrigeratedSchema = z
    .object({
      type: z.literal('refrigerated'),
      items: lineItemArraySchema,
      tempMinC: z.number().min(-30, 'Min -30°C').max(20, 'Max 20°C'),
      tempMaxC: z.number().min(-30, 'Min -30°C').max(20, 'Max 20°C'),
    })
    .refine((v) => v.tempMinC < v.tempMaxC, {
      message: 'Min temp must be below max',
      path: ['tempMaxC'],
    })

  const hazmatSchema = z.object({
    type: z.literal('hazmat'),
    items: lineItemArraySchema,
    unNumber: z.string().regex(/^UN\\d{4}$/, 'Format: UN1234'),
    hazardClass: z.enum(['1', '2', '3', '4', '5', '6', '7', '8', '9']),
    acknowledged: z.literal(true, { message: 'Acknowledge handling rules to continue' }),
  })

  const oversizedSchema = z.object({
    type: z.literal('oversized'),
    items: lineItemArraySchema,
    lengthCm: z.number().positive(),
    widthCm: z.number().positive(),
    heightCm: z.number().positive(),
    permitNumber: z.string().optional(),
  })

  const cargoSchema = z.discriminatedUnion('type', [
    dryGoodsSchema,
    refrigeratedSchema,
    hazmatSchema,
    oversizedSchema,
  ])

  const truckServiceSchema = z.object({
    mode: z.literal('truck'),
    truckType: z.enum(['box', 'flatbed', 'reefer', 'tanker']),
    liftgate: z.boolean(),
  })

  const airServiceSchema = z.object({
    mode: z.literal('air'),
    airline: z.string().min(2, 'Required'),
    awbPrefix: z.string().regex(/^\\d{3}$/, 'AWB prefix is 3 digits'),
  })

  const oceanServiceSchema = z.object({
    mode: z.literal('ocean'),
    vessel: z.string().min(2, 'Required'),
    containerSize: z.enum(['20FT', '40FT', '40FTHC', '45FTHC']),
  })

  const serviceSchema = z.discriminatedUnion('mode', [
    truckServiceSchema,
    airServiceSchema,
    oceanServiceSchema,
  ])

  const schema = z.object({
    reference: z.string().regex(/^SHP-\\d{6}$/, 'Format: SHP-123456'),
    pickup: addressSchema,
    delivery: addressSchema,
    // When true, delivery mirrors pickup — see the watch below that
    // calls form.setValue('delivery', () => ({ ...form.values.pickup }))
    // to keep the two subforms in sync. Modeling the toggle in the
    // schema (instead of a component-local ref) means it's persisted
    // via the form's autosave and restored on reload.
    useSameDeliveryAddress: z.boolean(),
    cargo: cargoSchema,
    service: serviceSchema,
    desiredPickupDate: z.string().min(1, 'Required'),
    desiredDeliveryDate: z.string().min(1, 'Required'),
    insurance: z.object({
      declaredValueUSD: z.number().min(0, 'Cannot be negative'),
      coverage: z.enum(['none', 'basic', 'full']),
    }),
    notes: z.string().max(500, 'Max 500 chars').optional(),
  })

  // ─── Form composable ─────────────────────────────────────────────
  // - persist: 'local' → drafts survive a page refresh.
  // - history → undo / redo across cargo / service mutations.
  // - debounceMs: 200 → coalesces rapid keystrokes into one async run.
  // - validateOn: 'change' (default) → live errors as the user types.

  const form = useForm({
    schema,
    key: 'shipment',
    persist: 'local',
    history: { max: 50 },
    validateOn: 'change',
    debounceMs: 200,
    defaultValues: {
      reference: 'SHP-100001',
      cargo: { type: 'dry', items: [], fragile: false },
      service: { mode: 'truck', truckType: 'box', liftgate: false },
      // declaredValueUSD starts unset rather than 0 — declaring $0
      // explicitly is a meaningful choice ("self-insured / no coverage
      // value"), so the input shows empty until the user commits.
      insurance: { declaredValueUSD: unset, coverage: 'basic' },
      pickup: { country: 'US' },
      delivery: { country: 'US' },
      useSameDeliveryAddress: false,
      // Optional fields start displayed-empty AND marked-blank: the
      // unset sentinel distinguishes "the user deliberately left this
      // empty" from "the user hasn't touched it yet". Live blank state
      // shows up under form.fields.notes.blank — typing into the field
      // clears the unset marker automatically.
      notes: unset,
    },
  })

  // ─── Pickup → delivery live mirror ───────────────────────────────
  // The "Same as pickup" checkbox just flips a schema-modeled flag
  // (form.register('useSameDeliveryAddress') below). This watch is
  // the engine: while the flag is on, it copies pickup → delivery
  // via the WHOLE-FORM callback variant of setValue. Cross-subform
  // moves read naturally as one expression: receive the previous
  // form value, return the next with delivery overridden. Pickup
  // edits propagate live; un-ticking stops the sync without
  // touching delivery, leaving the snapshot for the user to edit.
  watch(
    [() => form.values.useSameDeliveryAddress, () => form.values.pickup],
    ([same]) => {
      if (!same) return
      form.setValue((v) => ({ ...v, delivery: v.pickup }))
    },
    { deep: true, immediate: true }
  )

  // SKU transform: uppercase + collapse spaces, applied per keystroke.
  const skuTransforms = [
    (raw: unknown) => (typeof raw === 'string' ? raw.toUpperCase().replace(/\\s+/g, '') : raw),
  ]

  // ─── Step navigation ─────────────────────────────────────────────
  const STEPS = [
    { id: 1, title: 'Origin & destination' },
    { id: 2, title: 'Cargo' },
    { id: 3, title: 'Service & insurance' },
    { id: 4, title: 'Review & submit' },
  ] as const
  const step = ref<1 | 2 | 3 | 4>(1)

  // A step is "done" when none of its top-level paths carry an error
  // AND none of those paths' subtrees have a validation in flight.
  // form.isValid(paths) handles both checks natively: scoped to the
  // step's prefixes, so an unrelated debounce in another step
  // doesn't block this step's green state. Step 4 owns no fields
  // (it's the review/submit summary), so it's never independently
  // "done" — its completion is the submit, not a validity check.
  const STEP_PATHS = {
    1: ['reference', 'pickup', 'delivery'],
    2: ['cargo'],
    3: ['service', 'insurance', 'desiredPickupDate', 'desiredDeliveryDate', 'notes'],
    4: [],
  } as const
  function isStepValid(id: 1 | 2 | 3 | 4): boolean {
    const paths = STEP_PATHS[id]
    if (paths.length === 0) return false
    return form.isValid(paths)
  }
  const currentStepValid = computed(() => isStepValid(step.value))

  function goNext() {
    if (step.value < 4) step.value = (step.value + 1) as 1 | 2 | 3 | 4
  }
  function goBack() {
    if (step.value > 1) step.value = (step.value - 1) as 1 | 2 | 3 | 4
  }

  // ─── Error summary (review step) ────────────────────────────────
  // Group form.meta.errors by their top-level segment so the Review
  // step renders one panel per logical section (Pickup address /
  // Cargo / Service / …) instead of a flat list of dotted paths.
  // Each row is clickable — switches \`step.value\` to the step that
  // owns the path so the user lands on the right page in one tap.
  // (No focus-on-field yet: would need a registry hook on v-register
  // to map path → bound element. Worth adding to the library; for
  // now the visual error state on the field is enough of a target.)
  const ROOT_LABELS: Record<string, string> = {
    reference: 'Reference',
    pickup: 'Pickup address',
    delivery: 'Delivery address',
    cargo: 'Cargo',
    service: 'Service',
    insurance: 'Insurance',
    desiredPickupDate: 'Pickup date',
    desiredDeliveryDate: 'Delivery date',
    notes: 'Notes',
  }
  const LEAF_LABELS: Record<string, string> = {
    line1: 'Line 1',
    line2: 'Line 2',
    city: 'City',
    region: 'Region',
    postalCode: 'Postal code',
    country: 'Country',
    declaredValueUSD: 'Declared value',
    coverage: 'Coverage',
    carrier: 'Carrier',
    mode: 'Mode',
    items: 'Line items',
    fragile: 'Fragile',
    tempMinC: 'Min temperature',
    tempMaxC: 'Max temperature',
    unNumber: 'UN number',
    hazardClass: 'Hazard class',
    acknowledged: 'Hazmat acknowledgement',
    lengthCm: 'Length',
    widthCm: 'Width',
    heightCm: 'Height',
    permitNumber: 'Permit number',
    sku: 'SKU',
    description: 'Description',
    quantity: 'Quantity',
    type: 'Type',
  }
  type ErrorGroup = {
    rootKey: string
    rootLabel: string
    items: { leafLabel: string | null; message: string; path: ReadonlyArray<string | number> }[]
  }
  const groupedErrors = computed<ErrorGroup[]>(() => {
    const groups = new Map<string, ErrorGroup>()
    for (const e of form.meta.errors) {
      const root = String(e.path[0] ?? '(root)')
      let group = groups.get(root)
      if (!group) {
        group = { rootKey: root, rootLabel: ROOT_LABELS[root] ?? root, items: [] }
        groups.set(root, group)
      }
      let leaf: string | null = null
      if (e.path.length > 1) {
        const leafKey = String(e.path[e.path.length - 1])
        leaf = LEAF_LABELS[leafKey] ?? leafKey
      }
      group.items.push({ leafLabel: leaf, message: e.message, path: e.path })
    }
    return [...groups.values()]
  })
  function pathToStep(path: ReadonlyArray<string | number>): 1 | 2 | 3 | 4 {
    const root = String(path[0] ?? '')
    for (const id of [1, 2, 3] as const) {
      if ((STEP_PATHS[id] as ReadonlyArray<string>).includes(root)) return id
    }
    return 4
  }
  function goToError(path: ReadonlyArray<string | number>) {
    step.value = pathToStep(path)
    // Walk the fields proxy with the dynamic path and focus the
    // first registered element. nextTick lets v-show paint the
    // newly-active step body so the input is in the document tree
    // by the time we focus.
    nextTick(() => {
      let view: unknown = form.fields
      for (const seg of path) {
        if (view == null) break
        view = (view as Record<string | number, unknown>)[seg]
      }
      const el = (view as { element?: HTMLElement | null } | undefined)?.element
      el?.focus()
    })
  }

  // ─── Cargo / service variant switching ───────────────────────────
  // Discriminator writes are a wholesale variant swap: setting cargo.type
  // reshapes the entire cargo subtree to the variant defaults. Attaform
  // remembers per-variant state so flipping back restores prior values.

  const CARGO_TYPES = ['dry', 'refrigerated', 'hazmat', 'oversized'] as const
  const HAZARD_CLASSES = ['1', '2', '3', '4', '5', '6', '7', '8', '9'] as const
  const SERVICE_MODES = ['truck', 'air', 'ocean'] as const

  function setCargoType(type: (typeof CARGO_TYPES)[number]) {
    if (type === 'dry') form.setValue('cargo', { type, items: [], fragile: false })
    else if (type === 'refrigerated')
      form.setValue('cargo', { type, items: [], tempMinC: 2, tempMaxC: 8 })
    else if (type === 'hazmat')
      form.setValue('cargo', {
        type,
        items: [],
        unNumber: 'UN0000',
        hazardClass: '3',
        acknowledged: false,
      })
    else
      form.setValue('cargo', {
        type,
        items: [],
        // unset (not 0) — dimensions have no meaningful default. The
        // inputs render empty until the user types, and form.fields
        // .cargo.<dim>.blank reflects that intentionally-blank state.
        lengthCm: unset,
        widthCm: unset,
        heightCm: unset,
        // permitNumber is optional — start it as deliberately blank
        // (unset) rather than undefined-because-untouched.
        permitNumber: unset,
      })
  }

  function setServiceMode(mode: (typeof SERVICE_MODES)[number]) {
    if (mode === 'truck')
      form.setValue('service', { mode, truckType: 'box', liftgate: false })
    else if (mode === 'air')
      form.setValue('service', { mode, airline: '', awbPrefix: '000' })
    else form.setValue('service', { mode, vessel: '', containerSize: '40FT' })
  }

  // ─── Line items (field array) ────────────────────────────────────
  function addLineItem() {
    form.append('cargo.items', {
      sku: '',
      description: '',
      quantity: 1,
      unitWeightKg: 1,
    })
  }
  function removeLineItem(idx: number) {
    form.remove('cargo.items', idx)
  }

  const totalKg = computed(() => {
    const items = form.values.cargo?.items ?? []
    let sum = 0
    for (const it of items) {
      const qty = typeof it.quantity === 'number' ? it.quantity : 0
      const w = typeof it.unitWeightKg === 'number' ? it.unitWeightKg : 0
      sum += qty * w
    }
    return sum
  })

  // ─── Submit ──────────────────────────────────────────────────────
  // handleSubmit awaits every async refinement (postal lookups, SKU
  // checks, cargo capacity) before deciding success vs failure. The
  // success callback is the victory lap — by the time it fires, the
  // schema (including the async capacity check on cargo.items) has
  // signed off on every value.

  const submitError = ref<string | null>(null)
  const onSubmit = form.handleSubmit(
    (values) => {
      submitError.value = null
      alert('Booked!\\n\\n' + JSON.stringify(values, null, 2))
      form.reset()
      step.value = 1
    },
    () => {
      submitError.value = 'Please fix the highlighted fields above.'
    }
  )

  function resetAll() {
    form.reset()
    step.value = 1
    submitError.value = null
  }

  // ─── Template helpers ────────────────────────────────────────────
  // - fieldClasses: green when the user has touched/dirtied a leaf and
  //   it's currently valid, red on visible errors, yellow while async.
  // - visibleError: only surface a leaf's first error after blur, so
  //   the user isn't yelled at mid-typing.
  // FieldStateLeaf<unknown> accepts every leaf shape via covariance —
  // the helpers only read metadata flags / errors, never .value.
  function fieldClasses(field: FieldStateLeaf<unknown> | undefined) {
    if (!field) return {}
    return {
      valid: field.valid && (field.dirty || field.touched),
      invalid: field.touched && !field.valid && !field.validating,
      validating: field.validating,
    }
  }
  function visibleError(field: FieldStateLeaf<unknown> | undefined): string {
    if (!field || !field.touched) return ''
    return field.errors[0]?.message ?? ''
  }
  // Cargo.items ARRAY-level error. Lives at the container path, not a
  // leaf — read via the form.meta.errors filter. Covers both the synch
  // min(1) "Add at least one line item" and the async capacity check
  // attached via .superRefine on lineItemArraySchema above.
  const cargoItemsArrayError = computed<string>(() => {
    const e = form.meta.errors.find(
      (e) => e.path.length === 2 && e.path[0] === 'cargo' && e.path[1] === 'items'
    )
    return e?.message ?? ''
  })

  // Address blocks driven by v-for so pickup + delivery share one
  // fieldset template — the prefix passes through into path strings
  // and proxy descents alike.
  const addressBlocks = [
    { prefix: 'pickup', label: 'Pickup' },
    { prefix: 'delivery', label: 'Delivery' },
  ] as const
${'</'}script>

<template>
  <div class="page">
    <form class="form" @submit.prevent="onSubmit">
      <header class="form-header">
        <h1>Cargo shipment booking</h1>
        <p>4 steps · your manifest waits at the dock</p>
      </header>

      <!-- ─── Stepper ─── -->
      <nav class="stepper" aria-label="Form progress">
        <button
          v-for="s in STEPS"
          :key="s.id"
          type="button"
          class="step"
          :class="{
            active: step === s.id,
            done: isStepValid(s.id),
          }"
          :aria-current="step === s.id ? 'step' : undefined"
          @click="step = s.id"
        >
          <span class="step-num">{{ s.id }}</span>
          <span class="step-title">{{ s.title }}</span>
        </button>
      </nav>

      <!-- ─── Step 1: addresses ─── -->
      <section v-show="step === 1" class="step-body">
        <div class="field" :class="fieldClasses(form.fields.reference)">
          <label for="reference">Reference</label>
          <input
            v-register="form.register('reference')"
            id="reference"
            placeholder="SHP-123456"
          />
          <small class="hint" v-if="form.fields.reference.validating">Checking…</small>
          <small class="error" v-else>
            {{ visibleError(form.fields.reference) }}
          </small>
        </div>

        <fieldset
          v-for="block in addressBlocks"
          :key="block.prefix"
          class="address"
          :class="{ mirrored: block.prefix === 'delivery' && form.values.useSameDeliveryAddress }"
        >
          <legend>{{ block.label }}</legend>
          <label v-if="block.prefix === 'delivery'" class="checkbox">
            <input
              v-register="form.register('useSameDeliveryAddress')"
              type="checkbox"
            />
            Same as pickup address
          </label>
          <div class="grid-2">
            <div class="field" :class="fieldClasses(form.fields[block.prefix].line1)">
              <label>Line 1</label>
              <input
                v-register="form.register([block.prefix, 'line1'])"
                placeholder="Street address"
                :disabled="block.prefix === 'delivery' && form.values.useSameDeliveryAddress"
              />
              <small class="error">{{ visibleError(form.fields[block.prefix].line1) }}</small>
            </div>
            <div class="field">
              <label>Line 2 <span class="muted">(optional)</span></label>
              <input
                v-register="form.register([block.prefix, 'line2'])"
                placeholder="Suite, unit, etc."
                :disabled="block.prefix === 'delivery' && form.values.useSameDeliveryAddress"
              />
            </div>
          </div>
          <div class="grid-3">
            <div class="field" :class="fieldClasses(form.fields[block.prefix].city)">
              <label>City</label>
              <input
                v-register="form.register([block.prefix, 'city'])"
                :disabled="block.prefix === 'delivery' && form.values.useSameDeliveryAddress"
              />
              <small class="error">{{ visibleError(form.fields[block.prefix].city) }}</small>
            </div>
            <div class="field" :class="fieldClasses(form.fields[block.prefix].region)">
              <label>Region</label>
              <input
                v-register="form.register([block.prefix, 'region'])"
                placeholder="CA / ON"
                :disabled="block.prefix === 'delivery' && form.values.useSameDeliveryAddress"
              />
              <small class="error">{{ visibleError(form.fields[block.prefix].region) }}</small>
            </div>
            <div class="field" :class="fieldClasses(form.fields[block.prefix].country)">
              <label>Country</label>
              <select
                v-register="form.register([block.prefix, 'country'])"
                :disabled="block.prefix === 'delivery' && form.values.useSameDeliveryAddress"
              >
                <option v-for="c in COUNTRIES" :key="c" :value="c">{{ c }}</option>
              </select>
            </div>
          </div>
          <div class="field" :class="fieldClasses(form.fields[block.prefix].postalCode)">
            <label>Postal code</label>
            <input
              v-register="form.register([block.prefix, 'postalCode'])"
              placeholder="Try 10xxx, M5xxx, SWxxx…"
              :disabled="block.prefix === 'delivery' && form.values.useSameDeliveryAddress"
            />
            <small class="hint" v-if="form.fields[block.prefix].postalCode.validating">
              Looking up postal code…
            </small>
            <small class="error" v-else>
              {{ visibleError(form.fields[block.prefix].postalCode) }}
            </small>
          </div>
        </fieldset>
      </section>

      <!-- ─── Step 2: cargo ─── -->
      <section v-show="step === 2" class="step-body">
        <div class="variant-picker">
          <label>Cargo class</label>
          <div class="chip-row">
            <button
              v-for="t in CARGO_TYPES"
              :key="t"
              type="button"
              class="chip"
              :class="{ active: form.values.cargo?.type === t }"
              @click="setCargoType(t)"
            >
              {{ t === 'dry' ? 'Dry goods'
                 : t === 'refrigerated' ? 'Refrigerated'
                 : t === 'hazmat' ? 'Hazmat'
                 : 'Oversized' }}
            </button>
          </div>
        </div>

        <!-- Per-variant fields -->
        <div v-if="form.values.cargo?.type === 'dry'" class="row">
          <label class="checkbox">
            <input v-register="form.register('cargo.fragile')" type="checkbox" />
            Mark as fragile
          </label>
        </div>

        <div v-else-if="form.values.cargo?.type === 'refrigerated'" class="grid-2">
          <div class="field" :class="fieldClasses(form.fields.cargo.tempMinC)">
            <label>Min temp (°C)</label>
            <input
              v-register.number="form.register('cargo.tempMinC')"
              type="number"
              step="0.5"
            />
            <small class="error">{{ visibleError(form.fields.cargo.tempMinC) }}</small>
          </div>
          <div class="field" :class="fieldClasses(form.fields.cargo.tempMaxC)">
            <label>Max temp (°C)</label>
            <input
              v-register.number="form.register('cargo.tempMaxC')"
              type="number"
              step="0.5"
            />
            <small class="error">{{ visibleError(form.fields.cargo.tempMaxC) }}</small>
          </div>
        </div>

        <div v-else-if="form.values.cargo?.type === 'hazmat'" class="hazmat">
          <div class="grid-2">
            <div class="field" :class="fieldClasses(form.fields.cargo.unNumber)">
              <label>UN number</label>
              <input
                v-register="form.register('cargo.unNumber')"
                placeholder="UN1234"
              />
              <small class="error">{{ visibleError(form.fields.cargo.unNumber) }}</small>
            </div>
            <div class="field" :class="fieldClasses(form.fields.cargo.hazardClass)">
              <label>Hazard class</label>
              <select v-register="form.register('cargo.hazardClass')">
                <option v-for="c in HAZARD_CLASSES" :key="c" :value="c">
                  Class {{ c }}
                </option>
              </select>
              <small class="error">{{ visibleError(form.fields.cargo.hazardClass) }}</small>
            </div>
          </div>
          <label class="checkbox">
            <input v-register="form.register('cargo.acknowledged')" type="checkbox" />
            I have read and acknowledge the dangerous-goods handling rules.
          </label>
          <small class="error">{{ visibleError(form.fields.cargo.acknowledged) }}</small>
        </div>

        <div v-else-if="form.values.cargo?.type === 'oversized'" class="oversized">
          <div class="grid-3">
            <div class="field" :class="fieldClasses(form.fields.cargo.lengthCm)">
              <label>Length (cm)</label>
              <input v-register.number="form.register('cargo.lengthCm')" type="number" />
              <small class="error">{{ visibleError(form.fields.cargo.lengthCm) }}</small>
            </div>
            <div class="field" :class="fieldClasses(form.fields.cargo.widthCm)">
              <label>Width (cm)</label>
              <input v-register.number="form.register('cargo.widthCm')" type="number" />
              <small class="error">{{ visibleError(form.fields.cargo.widthCm) }}</small>
            </div>
            <div class="field" :class="fieldClasses(form.fields.cargo.heightCm)">
              <label>Height (cm)</label>
              <input v-register.number="form.register('cargo.heightCm')" type="number" />
              <small class="error">{{ visibleError(form.fields.cargo.heightCm) }}</small>
            </div>
          </div>
          <div class="field">
            <label>
              Permit # <span class="muted">(optional, leave blank if none)</span>
            </label>
            <input v-register="form.register('cargo.permitNumber')" />
            <small class="muted" v-if="isUnset(form.values.cargo?.permitNumber)">
              No permit on file — start typing to add one.
            </small>
          </div>
        </div>

        <!-- Line items (field array) -->
        <div class="line-items">
          <div class="line-items-header">
            <h3>Line items <span class="muted">({{ totalKg }} kg total)</span></h3>
            <button type="button" class="ghost" @click="addLineItem">+ Add item</button>
          </div>
          <div v-if="(form.values.cargo?.items ?? []).length === 0" class="empty">
            No line items yet. Try
            <code>SKU-1001</code>, <code>SKU-2001</code>, or <code>PALLET-A</code>.
          </div>
          <div
            v-for="(_, idx) in form.values.cargo?.items ?? []"
            :key="idx"
            class="line-item"
          >
            <div class="li-grid">
              <div class="field" :class="fieldClasses(form.fields.cargo.items[idx].sku)">
                <label>SKU</label>
                <input
                  v-register="form.register(\`cargo.items.\${idx}.sku\`, { transforms: skuTransforms })"
                  placeholder="SKU-1001"
                />
                <small class="hint" v-if="form.fields.cargo.items[idx]?.sku.validating">
                  Checking SKU…
                </small>
                <small class="error" v-else>
                  {{ visibleError(form.fields.cargo.items[idx].sku) }}
                </small>
              </div>
              <div class="field" :class="fieldClasses(form.fields.cargo.items[idx].description)">
                <label>Description</label>
                <input v-register="form.register(\`cargo.items.\${idx}.description\`)" />
                <small class="error">{{ visibleError(form.fields.cargo.items[idx].description) }}</small>
              </div>
              <div class="field qty" :class="fieldClasses(form.fields.cargo.items[idx].quantity)">
                <label>Qty</label>
                <input
                  v-register.number="form.register(\`cargo.items.\${idx}.quantity\`)"
                  type="number"
                  min="1"
                />
                <small class="error">{{ visibleError(form.fields.cargo.items[idx].quantity) }}</small>
              </div>
              <div class="field qty" :class="fieldClasses(form.fields.cargo.items[idx].unitWeightKg)">
                <label>Wt (kg)</label>
                <input
                  v-register.number="form.register(\`cargo.items.\${idx}.unitWeightKg\`)"
                  type="number"
                  step="0.01"
                  min="0"
                />
                <small class="error">{{ visibleError(form.fields.cargo.items[idx].unitWeightKg) }}</small>
              </div>
              <button
                type="button"
                class="icon-btn"
                aria-label="Remove line item"
                @click="removeLineItem(idx)"
              >
                ✕
              </button>
            </div>
          </div>
          <small class="error" v-if="cargoItemsArrayError">{{ cargoItemsArrayError }}</small>
        </div>
      </section>

      <!-- ─── Step 3: service & insurance ─── -->
      <section v-show="step === 3" class="step-body">
        <div class="variant-picker">
          <label>Service mode</label>
          <div class="chip-row">
            <button
              v-for="m in SERVICE_MODES"
              :key="m"
              type="button"
              class="chip"
              :class="{ active: form.values.service?.mode === m }"
              @click="setServiceMode(m)"
            >
              {{ m === 'truck' ? '🚚 Truck' : m === 'air' ? '✈️ Air' : '🚢 Ocean' }}
            </button>
          </div>
        </div>

        <div v-if="form.values.service?.mode === 'truck'" class="grid-2">
          <div class="field" :class="fieldClasses(form.fields.service.truckType)">
            <label>Truck type</label>
            <select v-register="form.register('service.truckType')">
              <option value="box">Box</option>
              <option value="flatbed">Flatbed</option>
              <option value="reefer">Reefer</option>
              <option value="tanker">Tanker</option>
            </select>
          </div>
          <label class="checkbox align-end">
            <input v-register="form.register('service.liftgate')" type="checkbox" />
            Liftgate required
          </label>
        </div>

        <div v-else-if="form.values.service?.mode === 'air'" class="grid-2">
          <div class="field" :class="fieldClasses(form.fields.service.airline)">
            <label>Airline</label>
            <input v-register="form.register('service.airline')" placeholder="Lufthansa" />
            <small class="error">{{ visibleError(form.fields.service.airline) }}</small>
          </div>
          <div class="field" :class="fieldClasses(form.fields.service.awbPrefix)">
            <label>AWB prefix</label>
            <input v-register="form.register('service.awbPrefix')" placeholder="220" />
            <small class="error">{{ visibleError(form.fields.service.awbPrefix) }}</small>
          </div>
        </div>

        <div v-else-if="form.values.service?.mode === 'ocean'" class="grid-2">
          <div class="field" :class="fieldClasses(form.fields.service.vessel)">
            <label>Vessel</label>
            <input v-register="form.register('service.vessel')" placeholder="MSC Aurelia" />
            <small class="error">{{ visibleError(form.fields.service.vessel) }}</small>
          </div>
          <div class="field" :class="fieldClasses(form.fields.service.containerSize)">
            <label>Container</label>
            <select v-register="form.register('service.containerSize')">
              <option value="20FT">20 ft</option>
              <option value="40FT">40 ft</option>
              <option value="40FTHC">40 ft high-cube</option>
              <option value="45FTHC">45 ft high-cube</option>
            </select>
          </div>
        </div>

        <div class="grid-2">
          <div class="field" :class="fieldClasses(form.fields.desiredPickupDate)">
            <label>Pickup date</label>
            <input v-register="form.register('desiredPickupDate')" type="date" />
            <small class="error">{{ visibleError(form.fields.desiredPickupDate) }}</small>
          </div>
          <div class="field" :class="fieldClasses(form.fields.desiredDeliveryDate)">
            <label>Delivery date</label>
            <input v-register="form.register('desiredDeliveryDate')" type="date" />
            <small class="error">{{ visibleError(form.fields.desiredDeliveryDate) }}</small>
          </div>
        </div>

        <fieldset class="address">
          <legend>Insurance</legend>
          <div class="grid-2">
            <div class="field" :class="fieldClasses(form.fields.insurance.declaredValueUSD)">
              <label>Declared value (USD)</label>
              <input
                v-register.number="form.register('insurance.declaredValueUSD')"
                type="number"
                min="0"
              />
              <small class="error">{{ visibleError(form.fields.insurance.declaredValueUSD) }}</small>
            </div>
            <div class="field">
              <label>Coverage</label>
              <select v-register="form.register('insurance.coverage')">
                <option value="none">None</option>
                <option value="basic">Basic</option>
                <option value="full">Full</option>
              </select>
            </div>
          </div>
        </fieldset>

        <div class="field">
          <label>
            Notes <span class="muted">(optional)</span>
          </label>
          <textarea
            v-register="form.register('notes')"
            rows="3"
            placeholder="Special handling instructions…"
          />
          <small class="muted" v-if="isUnset(form.values.notes)">
            No notes recorded — start typing to add some.
          </small>
          <small class="error">{{ visibleError(form.fields.notes) }}</small>
        </div>
      </section>

      <!-- ─── Step 4: review ─── -->
      <section v-show="step === 4" class="step-body review">
        <h3>Review</h3>
        <pre>{{ JSON.stringify(form.values(), null, 2) }}</pre>
        <aside v-if="!form.meta.valid" class="errors-summary" aria-live="polite">
          <header class="errors-summary-head">
            <span class="errors-summary-icon" aria-hidden="true">⚠</span>
            <div>
              <h3 class="errors-summary-title">
                {{ form.meta.errors.length }}
                {{ form.meta.errors.length === 1 ? 'item' : 'items' }} on the manifest before it
                ships.
              </h3>
              <p class="errors-summary-hint">Tap any line to jump to the field.</p>
            </div>
          </header>
          <ol class="errors-summary-groups">
            <li v-for="group in groupedErrors" :key="group.rootKey">
              <h4 class="errors-summary-group-head">{{ group.rootLabel }}</h4>
              <ul class="errors-summary-items">
                <li v-for="(item, i) in group.items" :key="i">
                  <button
                    type="button"
                    class="errors-summary-row"
                    @click="goToError(item.path)"
                  >
                    <span v-if="item.leafLabel" class="errors-summary-leaf">{{ item.leafLabel }}</span>
                    <span class="errors-summary-msg">{{ item.message }}</span>
                    <span class="errors-summary-arrow" aria-hidden="true">→</span>
                  </button>
                </li>
              </ul>
            </li>
          </ol>
        </aside>
      </section>

      <!-- ─── Submit-row error (form-level) ─── -->
      <p v-if="submitError" class="banner-error">{{ submitError }}</p>

      <!-- ─── Nav row ─── -->
      <div class="nav">
        <div class="nav-left">
          <button
            type="button"
            class="ghost"
            :disabled="!form.meta.canUndo"
            @click="form.undo()"
          >
            ↶ Undo
          </button>
          <button
            type="button"
            class="ghost"
            :disabled="!form.meta.canRedo"
            @click="form.redo()"
          >
            ↷ Redo
          </button>
          <button type="button" class="ghost danger" @click="resetAll">Reset</button>
        </div>
        <div class="nav-right">
          <button
            v-if="step > 1"
            type="button"
            class="secondary"
            @click="goBack"
          >
            Back
          </button>
          <button
            v-if="step < 4"
            type="button"
            class="primary"
            :disabled="!currentStepValid"
            @click="goNext"
          >
            Next
            <span class="badge" v-if="form.meta.validating">…</span>
          </button>
          <button
            v-else
            type="submit"
            class="primary"
            :disabled="form.meta.submitting || !form.meta.valid"
          >
            {{ form.meta.submitting ? 'Booking…' : 'Book shipment' }}
          </button>
        </div>
      </div>
    </form>
  </div>
</template>

<style>
* { box-sizing: border-box; }

body {
  margin: 0;
  padding: 0;
  background: #F9FAFB;
  font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
  font-feature-settings: 'cv11', 'ss01', 'ss03';
  color: #101828;
  -webkit-font-smoothing: antialiased;
}

.page {
  display: flex;
  align-items: flex-start;
  justify-content: center;
  min-height: 100vh;
  padding: 2rem 1rem;
}

.form {
  width: 100%;
  max-width: 48rem;
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
  padding: 2rem;
  background: #FFFFFF;
  border: 0.0625rem solid #EAECF0;
  border-radius: 0.75rem;
  box-shadow:
    0 0.0625rem 0.1875rem 0 rgb(16 24 40 / 0.10),
    0 0.0625rem 0.125rem -0.0625rem rgb(16 24 40 / 0.06);
}

.form-header { display: flex; flex-direction: column; gap: 0.25rem; }
.form-header h1 { margin: 0; font-size: 1.5rem; font-weight: 600; letter-spacing: -0.012em; }
.form-header p { margin: 0; font-size: 0.875rem; color: #667085; }

/* ─── Stepper ─── */
.stepper {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 0.5rem;
  padding: 0.75rem;
  background: #F9FAFB;
  border-radius: 0.5rem;
  /* Sticky so the four-step nav stays in reach while the user
     scrolls through a long step body. \`top\` matches \`.form\`'s
     padding so the chip doesn't jam against the iframe top edge. */
  position: sticky;
  top: 0.5rem;
  z-index: 10;
}
.step {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem 0.625rem;
  background: transparent;
  border: none;
  border-radius: 0.375rem;
  font: inherit;
  font-size: 0.8125rem;
  color: #667085;
  cursor: pointer;
  text-align: left;
}
.step:hover { background: #F2F4F7; color: #344054; }
.step.active { background: #FFFFFF; color: #101828; box-shadow: 0 0.0625rem 0.125rem 0 rgb(16 24 40 / 0.05); }
.step.done { color: #027A48; }
.step-num {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.5rem; height: 1.5rem;
  border-radius: 999px;
  background: #EAECF0;
  font-weight: 600;
  font-size: 0.75rem;
}
.step.active .step-num { background: #6938EF; color: #FFF; }
.step.done .step-num { background: #027A48; color: #FFF; }
.step-title { font-weight: 500; }

/* ─── Step body ─── */
.step-body { display: flex; flex-direction: column; gap: 1rem; }

/* ─── Field ─── */
.field { display: flex; flex-direction: column; gap: 0.375rem; }
.field label { font-size: 0.875rem; font-weight: 500; color: #344054; }
.field .muted { color: #98A2B3; font-weight: 400; }

.field input, .field select, .field textarea {
  width: 100%;
  height: 2.5rem;
  padding: 0 0.875rem;
  border: 0.0625rem solid #D0D5DD;
  border-radius: 0.5rem;
  background: #FFFFFF;
  color: #101828;
  font: inherit;
  font-size: 0.9375rem;
  outline: none;
  box-shadow: 0 0.0625rem 0.125rem 0 rgb(16 24 40 / 0.05);
  transition:
    border-color 120ms cubic-bezier(0.165, 0.84, 0.44, 1),
    box-shadow 120ms cubic-bezier(0.165, 0.84, 0.44, 1);
}
.field textarea { height: auto; padding: 0.625rem 0.875rem; resize: vertical; min-height: 4.5rem; }
.field input::placeholder, .field textarea::placeholder { color: #98A2B3; }
.field input:hover, .field select:hover, .field textarea:hover { border-color: #98A2B3; }
.field input:focus, .field select:focus, .field textarea:focus {
  border-color: #BDB4FE;
  box-shadow:
    0 0 0 0.25rem #EBE9FE,
    0 0.0625rem 0.125rem 0 rgb(16 24 40 / 0.05);
}

/* Validity states — applied per-field via :class binding. */
.field.valid input, .field.valid select, .field.valid textarea { border-color: #6CE9A6; }
.field.valid input:focus, .field.valid select:focus, .field.valid textarea:focus {
  box-shadow: 0 0 0 0.25rem #D1FADF, 0 0.0625rem 0.125rem 0 rgb(16 24 40 / 0.05);
}
.field.invalid input, .field.invalid select, .field.invalid textarea { border-color: #FDA29B; }
.field.invalid input:focus, .field.invalid select:focus, .field.invalid textarea:focus {
  box-shadow: 0 0 0 0.25rem #FEE4E2, 0 0.0625rem 0.125rem 0 rgb(16 24 40 / 0.05);
}
.field.validating input, .field.validating select, .field.validating textarea {
  border-color: #FDB022;
}

.field .error { display: block; font-size: 0.8125rem; line-height: 1.125rem; min-height: 1.125rem; color: #B42318; }
.field .hint { display: block; font-size: 0.8125rem; line-height: 1.125rem; min-height: 1.125rem; color: #B54708; }

/* ─── Layouts ─── */
.row { display: flex; gap: 0.75rem; }
.grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 0.75rem; }
.grid-3 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 0.75rem; }

.address {
  border: 0.0625rem solid #EAECF0;
  border-radius: 0.5rem;
  padding: 0.75rem 1rem 1rem;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}
.address legend { font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.04em; color: #667085; padding: 0 0.375rem; }
.address.mirrored .field input,
.address.mirrored .field select { background: #F9FAFB; color: #98A2B3; cursor: not-allowed; }
.address.mirrored .field input:focus,
.address.mirrored .field select:focus { border-color: #D0D5DD; box-shadow: none; }
.address.mirrored .field label { color: #98A2B3; }

/* ─── Variant chips ─── */
.variant-picker { display: flex; flex-direction: column; gap: 0.5rem; }
.variant-picker > label { font-size: 0.875rem; font-weight: 500; color: #344054; }
.chip-row { display: flex; flex-wrap: wrap; gap: 0.5rem; }
.chip {
  padding: 0.5rem 0.875rem;
  border: 0.0625rem solid #D0D5DD;
  border-radius: 999px;
  background: #FFFFFF;
  font: inherit; font-size: 0.875rem; font-weight: 500;
  color: #344054;
  cursor: pointer;
  transition: background 120ms, border-color 120ms;
}
.chip:hover { background: #F9FAFB; border-color: #98A2B3; }
.chip.active { background: #EBE9FE; border-color: #BDB4FE; color: #5925DC; }

/* ─── Checkbox ─── */
.checkbox { display: inline-flex; align-items: center; gap: 0.5rem; font-size: 0.875rem; color: #344054; }
.checkbox input { width: 1rem; height: 1rem; }
.align-end { align-self: end; padding-bottom: 0.5rem; }

/* ─── Line items ─── */
.line-items { display: flex; flex-direction: column; gap: 0.5rem; padding-top: 0.25rem; }
.line-items-header { display: flex; align-items: center; justify-content: space-between; }
.line-items-header h3 { margin: 0; font-size: 0.9375rem; font-weight: 600; color: #344054; }
.muted { color: #98A2B3; font-weight: 400; }
.empty { padding: 1rem; background: #F9FAFB; border-radius: 0.5rem; font-size: 0.875rem; color: #667085; text-align: center; }
.empty code { background: #FFF; padding: 0.0625rem 0.375rem; border-radius: 0.25rem; border: 0.0625rem solid #EAECF0; }

.line-item { padding: 0.625rem; border: 0.0625rem solid #EAECF0; border-radius: 0.5rem; background: #FAFAFB; }
.li-grid {
  display: grid;
  grid-template-columns: 1fr 1.5fr 4.5rem 5rem auto;
  gap: 0.5rem;
  align-items: end;
}
.field.qty input { padding: 0 0.5rem; }

.icon-btn {
  height: 2.5rem; width: 2.5rem;
  display: inline-flex; align-items: center; justify-content: center;
  border: 0.0625rem solid #EAECF0;
  border-radius: 0.5rem;
  background: #FFF;
  color: #B42318;
  cursor: pointer;
  transition: background 120ms;
}
.icon-btn:hover { background: #FEE4E2; }

/* ─── Hazmat / oversized ─── */
.hazmat, .oversized { display: flex; flex-direction: column; gap: 0.75rem; }

/* ─── Review pre ─── */
.review pre {
  background: #0C111D;
  color: #D0D5DD;
  padding: 1rem;
  border-radius: 0.5rem;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 0.8125rem;
  line-height: 1.5;
  overflow: auto;
  max-height: 16rem;
}
/* ─── Errors summary (review step) ─── */
.errors-summary {
  display: flex;
  flex-direction: column;
  gap: 0.875rem;
  padding: 1rem 1.125rem 1.125rem;
  background: #FEF3F2;
  border: 0.0625rem solid #FECDCA;
  border-radius: 0.625rem;
}
.errors-summary-head { display: flex; gap: 0.75rem; align-items: flex-start; }
.errors-summary-icon { font-size: 1.125rem; line-height: 1.25; color: #B42318; }
.errors-summary-title {
  margin: 0;
  font-size: 0.9375rem;
  font-weight: 600;
  letter-spacing: -0.005em;
  color: #7A271A;
}
.errors-summary-hint { margin: 0.125rem 0 0 0; color: #B42318; font-size: 0.8125rem; }
.errors-summary-groups {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 0.625rem;
}
.errors-summary-group-head {
  margin: 0 0 0.3125rem 0;
  font-size: 0.6875rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: #B42318;
}
.errors-summary-items {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}
.errors-summary-row {
  display: flex;
  width: 100%;
  align-items: center;
  gap: 0.5rem;
  padding: 0.4375rem 0.625rem;
  background: #FFFFFF;
  border: 0.0625rem solid #FEE4E2;
  border-radius: 0.375rem;
  font: inherit;
  font-size: 0.8125rem;
  color: #7A271A;
  cursor: pointer;
  text-align: left;
  transition:
    border-color 120ms ease,
    background-color 120ms ease;
}
.errors-summary-row:hover {
  border-color: #FDA29B;
  background: #FFFCFC;
}
.errors-summary-row:focus-visible {
  outline: 0.125rem solid #F97066;
  outline-offset: 0.0625rem;
}
.errors-summary-leaf { font-weight: 600; }
.errors-summary-msg { color: #B42318; }
.errors-summary-arrow {
  margin-left: auto;
  color: #B42318;
  opacity: 0.5;
  transition: transform 120ms ease, opacity 120ms ease;
}
.errors-summary-row:hover .errors-summary-arrow { transform: translateX(0.125rem); opacity: 1; }

/* ─── Banner ─── */
.banner-error {
  margin: 0;
  padding: 0.75rem 1rem;
  background: #FEF3F2;
  border: 0.0625rem solid #FECDCA;
  border-radius: 0.5rem;
  color: #B42318;
  font-size: 0.875rem;
}

/* ─── Nav row ─── */
.nav { display: flex; justify-content: space-between; align-items: center; padding-top: 0.5rem; border-top: 0.0625rem solid #EAECF0; }
.nav-left, .nav-right { display: flex; gap: 0.5rem; }

button.primary, button.secondary, button.ghost {
  height: 2.5rem;
  padding: 0 1rem;
  border-radius: 0.5rem;
  font: inherit; font-size: 0.875rem; font-weight: 600;
  cursor: pointer;
  transition: background-color 120ms, border-color 120ms;
  display: inline-flex; align-items: center; justify-content: center; gap: 0.375rem;
}
button.primary { background: #6938EF; color: #FFF; border: none; }
button.primary:hover:not(:disabled) { background: #5925DC; }
button.primary:disabled { background: #F2F4F7; color: #98A2B3; cursor: not-allowed; }
button.secondary { background: #FFF; color: #344054; border: 0.0625rem solid #D0D5DD; }
button.secondary:hover { background: #F9FAFB; }
button.ghost { background: transparent; color: #667085; border: 0.0625rem solid transparent; padding: 0 0.625rem; }
button.ghost:hover:not(:disabled) { background: #F2F4F7; color: #344054; }
button.ghost:disabled { color: #D0D5DD; cursor: not-allowed; }
button.ghost.danger:hover { color: #B42318; background: #FEF3F2; }

.badge {
  display: inline-flex; align-items: center;
  padding: 0 0.375rem;
  background: rgba(255, 255, 255, 0.25);
  border-radius: 0.25rem;
  font-size: 0.75rem;
}

/* ─── Mobile (< 40rem ≈ 640px) ─── */
@media (max-width: 40rem) {
  .page { padding: 1rem 0.75rem; }
  .form { padding: 1.25rem; gap: 1rem; }
  .form-header h1 { font-size: 1.25rem; }

  /* All multi-column grids collapse to one. */
  .grid-2, .grid-3 { grid-template-columns: 1fr; }

  /* Stepper: switch from a 4-column grid to a flex-wrap row so steps
     wrap onto multiple lines on narrow viewports rather than crushing
     into a single row with hidden labels. flex: 1 1 auto lets each
     step take its natural width but share extra space evenly when
     they fit on one line. */
  .stepper {
    display: flex;
    flex-wrap: wrap;
    gap: 0.375rem;
    padding: 0.5rem;
  }
  .step {
    flex: 1 1 auto;
    padding: 0.5rem 0.625rem;
    font-size: 0.8125rem;
    gap: 0.375rem;
  }
  .step-num { width: 1.375rem; height: 1.375rem; font-size: 0.6875rem; }
  .step-title { white-space: normal; }

  /* Address fieldset: trim padding so input gutters don't squeeze. */
  .address { padding: 0.75rem; gap: 0.625rem; }

  /* Line items: 2-column layout — SKU + description full width on
     their own rows, qty + wt side-by-side, remove button on its own
     trailing row, right-aligned. Bigger tap target via grid stretch. */
  .li-grid {
    grid-template-columns: 1fr 1fr;
    gap: 0.5rem;
  }
  .li-grid > :nth-child(1),
  .li-grid > :nth-child(2) { grid-column: 1 / -1; }
  .li-grid > :nth-child(3) { grid-column: 1 / 2; }
  .li-grid > :nth-child(4) { grid-column: 2 / 3; }
  .li-grid > .icon-btn {
    grid-column: 1 / -1;
    justify-self: end;
    width: auto;
    padding: 0 0.875rem;
  }

  /* Nav row: stack with primary (Next / Submit) above secondary
     (Undo / Redo / Reset). column-reverse keeps the primary group on
     top because it's the first child in DOM order. */
  .nav {
    flex-direction: column-reverse;
    align-items: stretch;
    gap: 0.625rem;
    padding-top: 0.75rem;
  }
  .nav-right { justify-content: stretch; }
  .nav-right > button { flex: 1; }
  .nav-left { justify-content: space-between; }
  .nav-left > button { flex: 1; }

  /* Review pre: smaller font + lower max-height so the review JSON
     doesn't dominate the viewport. */
  .review pre { font-size: 0.75rem; max-height: 12rem; }

  /* Variant chips: full-width row when there are 4+ chips so they
     wrap evenly rather than stair-stepping. */
  .chip-row .chip { flex: 1 1 calc(50% - 0.25rem); justify-content: center; }
}

/* ─── Tiny phones (< 22.5rem ≈ 360px) ─── */
@media (max-width: 22.5rem) {
  .form { padding: 1rem; }
  .stepper { padding: 0.375rem; gap: 0.25rem; }
  .step { padding: 0.375rem 0.5rem; font-size: 0.75rem; }
  /* Line items: full single column so SKU has room for its async
     "Checking…" hint. */
  .li-grid {
    grid-template-columns: 1fr;
  }
  .li-grid > :nth-child(3),
  .li-grid > :nth-child(4) { grid-column: 1 / -1; }
}
${'</'}style>`

  // @vue/repl auto-creates the Vue app and mounts it from `mainFile`. To
  // install our plugin we use previewOptions.customCode — `importCode`
  // appends to the iframe's import block, `useCode` runs after
  // `const app = createApp(AppComponent)` and before `app.mount('#app')`.
  // Without this the REPL boots a bare Vue app and `useForm()` throws
  // "Registry not found" because createAttaform()'s plugin never runs.
  const previewOptions = {
    customCode: {
      importCode: `import { createAttaform } from 'attaform'`,
      useCode: `app.use(createAttaform())`,
    },
  }

  // Route the three packages we self-host through their /lib/types/ URLs.
  // Volar (via @vue/repl's Monaco bundle) needs THREE callbacks wired up
  // on `resourceLinks` for self-hosted type bundles to work. Missing any
  // one of them silently falls back to unpkg, which doesn't have our
  // pre-release attaform — so symbols resolve to nothing.
  //
  //   - pkgFileTextUrl: returns the URL for a single file inside the
  //     package (`<pkg>/<path>`). The LSP fetches package.json, .d.ts
  //     entries, and stub runtime entries through this.
  //   - pkgDirUrl: returns the URL for a JSON directory listing of the
  //     package (the file is `meta.json`, format `{ files: [...] }`,
  //     mimicking unpkg's `?meta` endpoint). Volar's worker uses this
  //     for EVERY file-existence check via _stat — without it, the LSP
  //     can't confirm `attaform/zod.d.ts` exists and resolution fails.
  //   - pkgLatestVersionUrl: returns a URL whose JSON exposes a
  //     `version` field. Defaults to unpkg's "@latest/package.json".
  //     We point it at our package.json. Strictly speaking this gets
  //     skipped when `dependencyVersion` (below) pins the version, but
  //     leaving it in keeps the fallback path local-only.
  //
  // Anything outside our allowlist falls through to @vue/repl's default
  // unpkg resolver. That happens occasionally for transitive type-only
  // deps; we accept the CDN fetch there.
  //
  // Two non-obvious constraints, both imposed by @vue/repl shipping
  // these resolvers string-serialized to the type-checking worker:
  //
  //   1. Must be an arrow function (or function expression). The worker
  //      reconstructs via `Function('return ' + str)()` (vue.worker.js
  //      `createFunc`). Method-shorthand `name(...) { ... }` gives
  //      `return name(...) { ... }` — a syntax error.
  //   2. No closure over outer scope. The reconstructed function runs
  //      in the worker's global scope; module-scoped consts become
  //      ReferenceErrors. Inline the package allowlist in each body.
  //
  // useStore types `resourceLinks` as a Ref so consumers can swap the
  // resolver at runtime (e.g. on a "load my own types" toggle). We
  // never reassign it, but the type still demands a Ref wrapper.
  const resourceLinks = ref({
    pkgFileTextUrl: (pkgName: string, _pkgVersion: string | undefined, pkgPath: string) => {
      if (pkgName === 'attaform' || pkgName === 'vue' || pkgName === 'zod') {
        return `/lib/types/${pkgName}/${pkgPath}`
      }
      return `https://cdn.jsdelivr.net/npm/${pkgName}/${pkgPath}`
    },
    pkgDirUrl: (pkgName: string, _pkgVersion: string | undefined, _pkgPath: string) => {
      if (pkgName === 'attaform' || pkgName === 'vue' || pkgName === 'zod') {
        return `/lib/types/${pkgName}/meta.json`
      }
      return `https://unpkg.com/${pkgName}@${_pkgVersion || 'latest'}/${_pkgPath}/?meta`
    },
    pkgLatestVersionUrl: (pkgName: string) => {
      if (pkgName === 'attaform' || pkgName === 'vue' || pkgName === 'zod') {
        return `/lib/types/${pkgName}/package.json`
      }
      return `https://unpkg.com/${pkgName}@latest/package.json`
    },
  })

  // Pin the versions Volar uses when constructing CDN-style URLs. Without
  // this, the worker treats every package as "latest" and round-trips
  // through pkgLatestVersionUrl (slow, and unpkg doesn't have our
  // pre-release attaform). The values flow into the worker's
  // `dependencies` map and short-circuit the latest-version lookup.
  //
  // Versions come from `runtimeConfig.public.replDependencyVersion`,
  // populated in nuxt.config.ts by reading attaform's, vue's, and
  // zod's actual package.json files. That way a `pnpm version` bump
  // updates everything in lockstep, including what `bundle-repl-deps.mjs`
  // writes into each virtual package.json — no hard-coded literal
  // here to forget about when the lib promotes from -rc.x to stable.
  const { replDependencyVersion } = useRuntimeConfig().public
  const dependencyVersion = ref(replDependencyVersion)

  // Monaco theme follows the site's color mode via the `<Repl>`
  // component's reactive `theme` prop ('light' | 'dark'). The
  // Monaco preset internally maps that to Shiki's bundled
  // `light-plus` / `dark-plus` and re-applies on change via
  // `editor.updateOptions`. Don't set `theme` in `monacoOptions`
  // here — it spreads AFTER the prop-derived default at construct
  // time and would never change again because the preset's watcher
  // only listens on the `<Repl>` prop.
  const colorMode = useColorMode()
  const replTheme = computed(() => (colorMode.value === 'dark' ? 'dark' : 'light'))
  const monacoOptions = {
    fontSize: 13,
    fontFamily:
      "'JetBrains Mono', ui-monospace, SFMono-Regular, 'Fira Code', Menlo, Consolas, monospace",
    fontLigatures: true,
    minimap: { enabled: false },
    scrollBeyondLastLine: false,
    renderLineHighlight: 'gutter' as const,
    smoothScrolling: true,
  }
  // `showErrorText: false` and `autoSaveText: false` opt out of the
  // "Show Error" / "Auto Save" toggle buttons @vue/repl floats in the
  // bottom-right of the editor pane (`.editor-floating` strip in
  // EditorContainer.vue). The toggles are gated on
  // `editorOptions.showErrorText !== false` / `autoSaveText !== false`,
  // so passing literal `false` short-circuits both renders. Auto-save
  // stays on by default for the underlying store, so the editor still
  // commits on each keystroke; we just don't surface the toggle.
  const editorOptions = {
    monacoOptions,
    showErrorText: false as const,
    autoSaveText: false as const,
  }

  const store = useStore({
    builtinImportMap: ref(importMap),
    resourceLinks,
    dependencyVersion,
  })

  store.setFiles({ 'src/App.vue': appCode }, 'src/App.vue')
</script>

<template>
  <Repl
    :store="store"
    :editor="MonacoEditor"
    :theme="replTheme"
    :preview-options="previewOptions"
    :editor-options="editorOptions"
    :show-compile-output="false"
    :show-import-map="false"
    :show-tsconfig="false"
  />
</template>

<!-- Visual overrides for the rendered Repl (error overlay tone, hidden
     "+" file-add button, "preview" → "Preview" tab label) live on the
     SSR-rendered parent `<DemoRepl>` so they're in the page stylesheet
     before this client-only component hydrates and renders. -->
