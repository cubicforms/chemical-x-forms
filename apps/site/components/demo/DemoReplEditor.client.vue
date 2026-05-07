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
  // Cargo shipment booking — a stress test for Attaform. Exercises:
  // discriminated unions, enums, field arrays, async field + aggregate
  // validation, transforms, the unset sentinel, persistence, multi-step
  // navigation, meta + field valid/validating flags, and touched-aware
  // error display.
  // ─────────────────────────────────────────────────────────────────

  import { computed, nextTick, ref, watch } from 'vue'
  import { z } from 'zod'
  import { fieldMeta, useForm, unset } from 'attaform/zod'
  import type { FieldState } from 'attaform'

  // ─── Mock async services ─────────────────────────────────────────
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

  // Aggregate capacity check — wired to cargo.items via .superRefine.
  function checkCapacity(totalKg: number): Promise<boolean> {
    return new Promise((resolve) => {
      setTimeout(() => resolve(totalKg <= 3000), 800)
    })
  }

  // ─── Schemas ─────────────────────────────────────────────────────
  const COUNTRIES = ['US', 'CA', 'MX', 'GB', 'DE', 'FR', 'JP', 'CN', 'AU'] as const
  const HAZARD_CLASSES = ['1', '2', '3', '4', '5', '6', '7', '8', '9'] as const
  const TRUCK_TYPES = ['box', 'flatbed', 'reefer', 'tanker'] as const
  const CONTAINER_SIZES = ['20FT', '40FT', '40FTHC', '45FTHC'] as const
  const COVERAGES = ['none', 'basic', 'full'] as const

  const addressSchema = z.object({
    line1: z.string().min(1, 'Required').register(fieldMeta, { label: 'Line 1' }),
    line2: z.string().optional().register(fieldMeta, { label: 'Line 2' }),
    city: z.string().min(1, 'Required').register(fieldMeta, { label: 'City' }),
    region: z.string().min(2, 'Two-letter region').register(fieldMeta, { label: 'Region' }),
    postalCode: z
      .string()
      .min(3, 'Required')
      .refine(async (v) => await lookupPostalCode(v), 'Postal code not found')
      .register(fieldMeta, { label: 'Postal code' }),
    country: z.enum(COUNTRIES).register(fieldMeta, { label: 'Country' }),
  })

  const lineItemSchema = z.object({
    sku: z
      .string()
      .regex(/^[A-Z0-9-]{4,16}$/, 'Format: A-Z, 0-9, dashes')
      .refine(async (sku) => await lookupSku(sku), 'Unknown SKU')
      .register(fieldMeta, { label: 'SKU' }),
    description: z
      .string()
      .min(1, 'Required')
      .max(120, 'Max 120 chars')
      .register(fieldMeta, { label: 'Description' }),
    quantity: z
      .number()
      .int('Whole units only')
      .min(1, 'At least 1')
      .max(10_000, 'Max 10,000')
      .register(fieldMeta, { label: 'Quantity' }),
    unitWeightKg: z
      .number()
      .positive('Must be positive')
      .register(fieldMeta, { label: 'Unit weight' }),
  })

  // Manifest array — lifted out of the cargo discriminated union so
  // "dry → hazmat" reclassification keeps whatever items the user
  // already typed instead of resetting items: [] on each variant
  // reshape. The async .superRefine attaches the capacity error at
  // this array's path (cargo.items), surfaced via cargoItemsArrayError.
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

  const dryDetailsSchema = z.object({
    type: z.literal('dry').register(fieldMeta, { label: 'Type' }),
    fragile: z.boolean().register(fieldMeta, { label: 'Fragile' }),
  })

  const refrigeratedDetailsSchema = z
    .object({
      type: z.literal('refrigerated').register(fieldMeta, { label: 'Type' }),
      tempMinC: z
        .number()
        .min(-30, 'Min -30°C')
        .max(20, 'Max 20°C')
        .register(fieldMeta, { label: 'Min temperature' }),
      tempMaxC: z
        .number()
        .min(-30, 'Min -30°C')
        .max(20, 'Max 20°C')
        .register(fieldMeta, { label: 'Max temperature' }),
    })
    .refine((v) => v.tempMinC < v.tempMaxC, {
      message: 'Min temp must be below max',
      path: ['tempMaxC'],
    })

  const hazmatDetailsSchema = z.object({
    type: z.literal('hazmat').register(fieldMeta, { label: 'Type' }),
    unNumber: z
      .string()
      .regex(/^UN\\d{4}$/, 'Format: UN1234')
      .register(fieldMeta, { label: 'UN number' }),
    hazardClass: z.enum(HAZARD_CLASSES).register(fieldMeta, { label: 'Hazard class' }),
    acknowledged: z
      .literal(true, { message: 'Acknowledge handling rules to continue' })
      .register(fieldMeta, { label: 'Hazmat acknowledgement' }),
  })

  const oversizedDetailsSchema = z.object({
    type: z.literal('oversized').register(fieldMeta, { label: 'Type' }),
    lengthCm: z.number().positive().register(fieldMeta, { label: 'Length' }),
    widthCm: z.number().positive().register(fieldMeta, { label: 'Width' }),
    heightCm: z.number().positive().register(fieldMeta, { label: 'Height' }),
    permitNumber: z.string().optional().register(fieldMeta, { label: 'Permit number' }),
  })

  const cargoSchema = z.object({
    items: lineItemArraySchema.register(fieldMeta, { label: 'Line items' }),
    details: z
      .discriminatedUnion('type', [
        dryDetailsSchema,
        refrigeratedDetailsSchema,
        hazmatDetailsSchema,
        oversizedDetailsSchema,
      ])
      .register(fieldMeta, { label: 'Cargo details' }),
  })

  const truckServiceSchema = z.object({
    mode: z.literal('truck'),
    truckType: z.enum(TRUCK_TYPES),
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
    containerSize: z.enum(CONTAINER_SIZES),
  })

  const serviceSchema = z.discriminatedUnion('mode', [
    truckServiceSchema,
    airServiceSchema,
    oceanServiceSchema,
  ])

  const schema = z.object({
    reference: z
      .string()
      .regex(/^SHP-\\d{6}$/, 'Format: SHP-123456')
      .register(fieldMeta, { label: 'Reference', placeholder: 'SHP-123456' }),
    pickup: addressSchema.register(fieldMeta, { label: 'Pickup address' }),
    delivery: addressSchema.register(fieldMeta, { label: 'Delivery address' }),
    // Schema-modeled toggle so the flag is persisted + restored
    // alongside the rest of the draft. The watch below keeps
    // delivery in sync with pickup whenever it's true.
    useSameDeliveryAddress: z
      .boolean()
      .register(fieldMeta, { label: 'Use same delivery address' }),
    cargo: cargoSchema.register(fieldMeta, { label: 'Cargo' }),
    service: serviceSchema.register(fieldMeta, { label: 'Service' }),
    desiredPickupDate: z
      .string()
      .min(1, 'Required')
      .register(fieldMeta, { label: 'Pickup date' }),
    desiredDeliveryDate: z
      .string()
      .min(1, 'Required')
      .register(fieldMeta, { label: 'Delivery date' }),
    insurance: z
      .object({
        declaredValueUSD: z
          .number()
          .min(0, 'Cannot be negative')
          .register(fieldMeta, { label: 'Declared value' }),
        coverage: z.enum(COVERAGES).register(fieldMeta, { label: 'Coverage' }),
      })
      .register(fieldMeta, { label: 'Insurance' }),
    notes: z
      .string()
      .max(500, 'Max 500 chars')
      .optional()
      .register(fieldMeta, { label: 'Notes' }),
  })

  // ─── Form ────────────────────────────────────────────────────────
  const form = useForm({
    schema,
    key: 'shipment',
    persist: 'local',
    history: { max: 50 },
    validateOn: 'change',
    debounceMs: 200,
    defaultValues: {
      reference: 'SHP-100001',
      cargo: { items: [], details: { type: 'dry', fragile: false } },
      service: { mode: 'truck', truckType: 'box', liftgate: false },
      // unset = "show empty until the user commits a value". $0
      // declared insurance is a meaningful choice, so we don't paint
      // it until they type it.
      insurance: { declaredValueUSD: unset, coverage: 'basic' },
      pickup: { country: 'US' },
      delivery: { country: 'US' },
      useSameDeliveryAddress: false,
      // unset on an optional string keeps "untouched" distinguishable
      // from "intentionally empty". Watch form.fields.notes.blank.
      notes: unset,
    },
  })

  // ─── Pickup → delivery live mirror ───────────────────────────────
  // While the flag is on, copy pickup → delivery via the whole-form
  // callback variant of setValue. Un-ticking leaves the snapshot in
  // place for the user to edit.
  watch(
    [() => form.values.useSameDeliveryAddress, () => form.values.pickup],
    ([same]) => {
      if (!same) return
      form.setValue((v) => ({ ...v, delivery: v.pickup }))
    },
    { deep: true, immediate: true }
  )

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
  type StepId = (typeof STEPS)[number]['id']
  const step = ref<StepId>(1)

  // Step 4 owns no fields, so it's never independently "done" — its
  // completion is the submit itself, not a validity check.
  const STEP_PATHS = {
    1: ['reference', 'pickup', 'delivery'],
    2: ['cargo'],
    3: ['service', 'insurance', 'desiredPickupDate', 'desiredDeliveryDate', 'notes'],
    4: [],
  } as const
  function isStepValid(id: StepId) {
    const paths = STEP_PATHS[id]
    if (paths.length === 0) return false
    return paths.every((p) => form.fields(p).valid)
  }
  const currentStepValid = computed(() => isStepValid(step.value))

  function goNext() {
    if (step.value < 4) step.value = (step.value + 1) as StepId
  }
  function goBack() {
    if (step.value > 1) step.value = (step.value - 1) as StepId
  }

  // ─── Error summary (review step) ────────────────────────────────
  // Group form.meta.errors by top-level segment so the Review step
  // renders one panel per section. Each row jumps to the owning step.
  // Section / leaf labels read straight from the schema's registered
  // metadata via form.fields(path).label — the schema is the single
  // source of truth for both structure and presentation.
  type ErrorGroup = {
    rootKey: string
    rootLabel: string
    items: { leafLabel: string | null; message: string; path: ReadonlyArray<string | number> }[]
  }
  const groupedErrors = computed(() => {
    const groups = new Map<string, ErrorGroup>()
    for (const e of form.meta.errors) {
      const root = String(e.path[0] ?? '(root)')
      let group = groups.get(root)
      if (!group) {
        group = {
          rootKey: root,
          rootLabel: form.fields(root).label || root,
          items: [],
        }
        groups.set(root, group)
      }
      let leaf: string | null = null
      if (e.path.length > 1) {
        leaf = form.fields(e.path).label || null
      }
      group.items.push({ leafLabel: leaf, message: e.message, path: e.path })
    }
    return [...groups.values()]
  })
  function pathToStep(path: ReadonlyArray<string | number>) {
    const root = String(path[0] ?? '')
    for (const id of [1, 2, 3] as const) {
      if ((STEP_PATHS[id] as ReadonlyArray<string>).includes(root)) return id
    }
    return 4
  }
  function goToError(path: ReadonlyArray<string | number>) {
    step.value = pathToStep(path)
    // nextTick so v-show paints the active step body before we focus.
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
  // Write the discriminator; attaform reshapes. rememberVariants
  // (on by default) restores the prior variant's typed state on
  // switch-back instead of a freshly-defaulted shell.
  const CARGO_TYPES = ['dry', 'refrigerated', 'hazmat', 'oversized'] as const
  const SERVICE_MODES = ['truck', 'air', 'ocean'] as const

  const CARGO_LABELS = {
    dry: 'Dry goods',
    refrigerated: 'Refrigerated',
    hazmat: 'Hazmat',
    oversized: 'Oversized',
  }
  const SERVICE_LABELS = {
    truck: '🚚 Truck',
    air: '✈️ Air',
    ocean: '🚢 Ocean',
  }
  const TRUCK_TYPE_LABELS = {
    box: 'Box',
    flatbed: 'Flatbed',
    reefer: 'Reefer',
    tanker: 'Tanker',
  }
  const CONTAINER_SIZE_LABELS = {
    '20FT': '20 ft',
    '40FT': '40 ft',
    '40FTHC': '40 ft high-cube',
    '45FTHC': '45 ft high-cube',
  }
  const COVERAGE_LABELS = {
    none: 'None',
    basic: 'Basic',
    full: 'Full',
  }

  const cargoType = computed(() => form.values.cargo.details.type)
  const serviceMode = computed(() => form.values.service.mode)

  function setCargoType(type: (typeof CARGO_TYPES)[number]) {
    form.setValue('cargo.details.type', type)
  }

  function setServiceMode(mode: (typeof SERVICE_MODES)[number]) {
    form.setValue('service.mode', mode)
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

  const totalKg = computed(() =>
    form.values.cargo.items.reduce(
      (sum, it) => sum + (Number(it.quantity) || 0) * (Number(it.unitWeightKg) || 0),
      0
    )
  )

  // ─── Submit ──────────────────────────────────────────────────────
  // handleSubmit awaits every async refinement (postal lookups, SKU
  // checks, capacity) before deciding success vs failure.
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
  function fieldClasses(field: FieldState<unknown> | undefined) {
    if (!field) return {}
    return {
      valid: field.valid && (field.dirty || field.touched),
      invalid: field.touched && !field.valid && !field.validating,
      validating: field.validating,
    }
  }
  function visibleError(field: FieldState<unknown> | undefined) {
    if (!field || !field.touched) return ''
    return field.errors[0]?.message ?? ''
  }

  // Array-level error at cargo.items (min(1) + async capacity refine).
  const cargoItemsArrayError = computed(() => {
    const errs = form.errors('cargo.items')
    return errs?.find((e) => e.path.length === 2)?.message ?? ''
  })

  const addressBlocks = computed(() => [
    { prefix: 'pickup' as const, label: 'Pickup', mirrored: false },
    { prefix: 'delivery' as const, label: 'Delivery', mirrored: form.values.useSameDeliveryAddress },
  ])
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
          :class="{ mirrored: block.mirrored }"
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
                :disabled="block.mirrored"
              />
              <small class="error">{{ visibleError(form.fields[block.prefix].line1) }}</small>
            </div>
            <div class="field">
              <label>Line 2 <span class="muted">(optional)</span></label>
              <input
                v-register="form.register([block.prefix, 'line2'])"
                placeholder="Suite, unit, etc."
                :disabled="block.mirrored"
              />
            </div>
          </div>
          <div class="grid-3">
            <div class="field" :class="fieldClasses(form.fields[block.prefix].city)">
              <label>City</label>
              <input
                v-register="form.register([block.prefix, 'city'])"
                :disabled="block.mirrored"
              />
              <small class="error">{{ visibleError(form.fields[block.prefix].city) }}</small>
            </div>
            <div class="field" :class="fieldClasses(form.fields[block.prefix].region)">
              <label>Region</label>
              <input
                v-register="form.register([block.prefix, 'region'])"
                placeholder="CA / ON"
                :disabled="block.mirrored"
              />
              <small class="error">{{ visibleError(form.fields[block.prefix].region) }}</small>
            </div>
            <div class="field" :class="fieldClasses(form.fields[block.prefix].country)">
              <label>Country</label>
              <select
                v-register="form.register([block.prefix, 'country'])"
                :disabled="block.mirrored"
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
              :disabled="block.mirrored"
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
              :class="{ active: cargoType === t }"
              @click="setCargoType(t)"
            >
              {{ CARGO_LABELS[t] }}
            </button>
          </div>
        </div>

        <!-- Per-variant fields -->
        <div v-if="cargoType === 'dry'" class="row">
          <label class="checkbox">
            <input v-register="form.register('cargo.details.fragile')" type="checkbox" />
            Mark as fragile
          </label>
        </div>

        <div v-else-if="cargoType === 'refrigerated'" class="grid-2">
          <div class="field" :class="fieldClasses(form.fields.cargo.details.tempMinC)">
            <label>Min temp (°C)</label>
            <input
              v-register.number="form.register('cargo.details.tempMinC')"
              type="number"
              step="0.5"
            />
            <small class="error">{{ visibleError(form.fields.cargo.details.tempMinC) }}</small>
          </div>
          <div class="field" :class="fieldClasses(form.fields.cargo.details.tempMaxC)">
            <label>Max temp (°C)</label>
            <input
              v-register.number="form.register('cargo.details.tempMaxC')"
              type="number"
              step="0.5"
            />
            <small class="error">{{ visibleError(form.fields.cargo.details.tempMaxC) }}</small>
          </div>
        </div>

        <div v-else-if="cargoType === 'hazmat'" class="hazmat">
          <div class="grid-2">
            <div class="field" :class="fieldClasses(form.fields.cargo.details.unNumber)">
              <label>UN number</label>
              <input
                v-register="form.register('cargo.details.unNumber')"
                placeholder="UN1234"
              />
              <small class="error">{{ visibleError(form.fields.cargo.details.unNumber) }}</small>
            </div>
            <div class="field" :class="fieldClasses(form.fields.cargo.details.hazardClass)">
              <label>Hazard class</label>
              <select v-register="form.register('cargo.details.hazardClass')">
                <option v-for="c in HAZARD_CLASSES" :key="c" :value="c">
                  Class {{ c }}
                </option>
              </select>
              <small class="error">{{ visibleError(form.fields.cargo.details.hazardClass) }}</small>
            </div>
          </div>
          <label class="checkbox">
            <input v-register="form.register('cargo.details.acknowledged')" type="checkbox" />
            I have read and acknowledge the dangerous-goods handling rules.
          </label>
          <small class="error">{{ visibleError(form.fields.cargo.details.acknowledged) }}</small>
        </div>

        <div v-else-if="cargoType === 'oversized'" class="oversized">
          <div class="grid-3">
            <div class="field" :class="fieldClasses(form.fields.cargo.details.lengthCm)">
              <label>Length (cm)</label>
              <input v-register.number="form.register('cargo.details.lengthCm')" type="number" />
              <small class="error">{{ visibleError(form.fields.cargo.details.lengthCm) }}</small>
            </div>
            <div class="field" :class="fieldClasses(form.fields.cargo.details.widthCm)">
              <label>Width (cm)</label>
              <input v-register.number="form.register('cargo.details.widthCm')" type="number" />
              <small class="error">{{ visibleError(form.fields.cargo.details.widthCm) }}</small>
            </div>
            <div class="field" :class="fieldClasses(form.fields.cargo.details.heightCm)">
              <label>Height (cm)</label>
              <input v-register.number="form.register('cargo.details.heightCm')" type="number" />
              <small class="error">{{ visibleError(form.fields.cargo.details.heightCm) }}</small>
            </div>
          </div>
          <div class="field">
            <label>
              Permit # <span class="muted">(optional, leave blank if none)</span>
            </label>
            <input v-register="form.register('cargo.details.permitNumber')" />
            <small class="muted" v-if="!form.values.cargo.details.permitNumber">
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
          <div v-if="form.values.cargo.items.length === 0" class="empty">
            No line items yet. Try
            <code>SKU-1001</code>, <code>SKU-2001</code>, or <code>PALLET-A</code>.
          </div>
          <div
            v-for="(_, idx) in form.values.cargo.items"
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
                <small class="hint" v-if="form.fields.cargo.items[idx].sku.validating">
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
              :class="{ active: serviceMode === m }"
              @click="setServiceMode(m)"
            >
              {{ SERVICE_LABELS[m] }}
            </button>
          </div>
        </div>

        <div v-if="serviceMode === 'truck'" class="grid-2">
          <div class="field" :class="fieldClasses(form.fields.service.truckType)">
            <label>Truck type</label>
            <select v-register="form.register('service.truckType')">
              <option v-for="t in TRUCK_TYPES" :key="t" :value="t">{{ TRUCK_TYPE_LABELS[t] }}</option>
            </select>
          </div>
          <label class="checkbox align-end">
            <input v-register="form.register('service.liftgate')" type="checkbox" />
            Liftgate required
          </label>
        </div>

        <div v-else-if="serviceMode === 'air'" class="grid-2">
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

        <div v-else-if="serviceMode === 'ocean'" class="grid-2">
          <div class="field" :class="fieldClasses(form.fields.service.vessel)">
            <label>Vessel</label>
            <input v-register="form.register('service.vessel')" placeholder="MSC Aurelia" />
            <small class="error">{{ visibleError(form.fields.service.vessel) }}</small>
          </div>
          <div class="field" :class="fieldClasses(form.fields.service.containerSize)">
            <label>Container</label>
            <select v-register="form.register('service.containerSize')">
              <option v-for="s in CONTAINER_SIZES" :key="s" :value="s">{{ CONTAINER_SIZE_LABELS[s] }}</option>
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
                <option v-for="c in COVERAGES" :key="c" :value="c">{{ COVERAGE_LABELS[c] }}</option>
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
          <small class="muted" v-if="!form.values.notes">
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
