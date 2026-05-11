<script setup lang="ts">
  // ─────────────────────────────────────────────────────────────────
  // Cargo shipment booking — a stress test for Attaform. Exercises:
  // discriminated unions, enums, field arrays, async field + aggregate
  // validation, transforms, the unset sentinel, persistence, multi-step
  // navigation, meta + field valid/validating flags, and the
  // `field.showErrors` / `field.firstError` error-display primitives.
  //
  // Error display: every field reads `showErrors` (heuristic-gated:
  // show after submit OR after touched + dirty) plus `firstError` (the
  // top error in schema order). Override the heuristic globally via
  // `createAttaform({ defaults: { shouldShowErrors } })` or per-form
  // via `useForm({ shouldShowErrors })`. Library default kicks in
  // here — see the `errorMessage` helper below.
  // ─────────────────────────────────────────────────────────────────

  import { computed, nextTick, ref, watch } from 'vue'
  import { z } from 'zod'
  import { fieldMeta, useForm, unset, withMeta } from 'attaform/zod'
  import type { FieldState } from 'attaform'

  // ─── Mock async services ─────────────────────────────────────────
  const KNOWN_POSTAL_PREFIXES = new Set([
    '10',
    '11',
    '90',
    '94',
    '60',
    '20', // US
    'M5',
    'V6',
    'H3', // CA (alphanumeric)
    '01',
    '20',
    '75', // EU-style
    'SW',
    'EC',
    'W1', // UK
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
    'SKU-1001',
    'SKU-1002',
    'SKU-1003',
    'SKU-2001',
    'SKU-2002',
    'PALLET-A',
    'PALLET-B',
  ])
  function lookupSku(value: string): Promise<boolean> {
    return new Promise((resolve) => {
      setTimeout(() => resolve(KNOWN_SKUS.has(value)), 450)
    })
  }

  // Aggregate capacity check — wired to cargo.items via .superRefine.
  function checkCapacity(totalLb: number): Promise<boolean> {
    return new Promise((resolve) => {
      setTimeout(() => resolve(totalLb <= 6500), 800)
    })
  }

  // ─── Schemas ─────────────────────────────────────────────────────
  const COUNTRIES = ['US', 'CA', 'MX', 'GB', 'DE', 'FR', 'JP', 'CN', 'AU'] as const
  const HAZARD_CLASSES = ['1', '2', '3', '4', '5', '6', '7', '8', '9'] as const
  const TRUCK_TYPES = ['box', 'flatbed', 'reefer', 'tanker'] as const
  const CONTAINER_SIZES = ['20FT', '40FT', '40FTHC', '45FTHC'] as const
  const COVERAGES = ['none', 'basic', 'full'] as const

  const addressSchema = z.object({
    line1: z
      .string()
      .min(1, 'Add a street address.')
      .register(fieldMeta, { label: 'Line 1', description: 'Street and number.' }),
    line2: z
      .string()
      .optional()
      .register(fieldMeta, { label: 'Line 2', description: 'Suite, unit, etc. — optional.' }),
    city: z.string().min(1, 'Add a city.').register(fieldMeta, { label: 'City' }),
    region: z.string().min(2, 'Two-letter code, like CA or ON.').register(fieldMeta, {
      label: 'Region',
      description: 'Two-letter abbreviation (CA, ON, NY, …).',
    }),
    postalCode: z
      .string()
      .min(3, 'Postal code is required.')
      .refine(
        async (v) => await lookupPostalCode(v),
        "We can't find that postal code — double-check the digits."
      )
      .register(fieldMeta, {
        label: 'Postal code',
        description: 'We auto-validate against the postal-code service.',
      }),
    country: z.enum(COUNTRIES).register(fieldMeta, { label: 'Country' }),
  })

  const lineItemSchema = z.object({
    sku: z
      .string()
      .regex(/^[A-Z0-9-]{4,16}$/, 'Letters, numbers, and dashes (e.g. SKU-1001).')
      .refine(async (sku) => await lookupSku(sku), "We don't see that SKU in our catalog yet.")
      .register(fieldMeta, { label: 'SKU', description: 'A–Z, 0–9, dashes (4–16 chars).' }),
    description: z
      .string()
      .min(1, 'Add a short description.')
      .max(120, 'Keep it under 120 characters.')
      .register(fieldMeta, { label: 'Description' }),
    quantity: z
      .number()
      .int('Use a whole number.')
      .min(1, 'Order at least 1.')
      .max(10_000, 'More than 10,000 in one row? Split it across multiple line items.')
      .register(fieldMeta, { label: 'Qty' }),
    unitWeightLb: z
      .number()
      .positive('Weight has to be greater than zero.')
      .register(fieldMeta, { label: 'Wt (lb)' }),
  })

  // Manifest array — lifted out of the cargo discriminated union so
  // "dry → hazmat" reclassification keeps whatever items the user
  // already typed instead of resetting items: [] on each variant
  // reshape. The async .superRefine attaches the capacity error at
  // this array's path (cargo.items), surfaced via cargoItemsArrayError.
  const lineItemArraySchema = z
    .array(lineItemSchema)
    .min(1, 'Add at least one line item to ship.')
    .superRefine(async (items, ctx) => {
      const totalLb = items.reduce((sum, it) => sum + it.quantity * it.unitWeightLb, 0)
      const ok = await checkCapacity(totalLb)
      if (!ok) {
        ctx.addIssue({
          code: 'custom',
          message: `Today's max is 6,500 lb — you're at ${totalLb} lb. Trim a row or schedule for tomorrow.`,
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
      tempMinF: z
        .number()
        .min(-22, "Cold-chain low is -22°F — we can't go colder.")
        .max(68, 'Cold-chain top is 68°F.')
        .register(fieldMeta, { label: 'Min temp (°F)' }),
      tempMaxF: z
        .number()
        .min(-22, 'Cold-chain low is -22°F.')
        .max(68, "Cold-chain top is 68°F — we can't go warmer.")
        .register(fieldMeta, { label: 'Max temp (°F)' }),
    })
    .refine((v) => v.tempMinF < v.tempMaxF, {
      message: 'Min temp should be lower than max temp.',
      path: ['tempMaxF'],
    })

  const hazmatDetailsSchema = z.object({
    type: z.literal('hazmat').register(fieldMeta, { label: 'Type' }),
    unNumber: z
      .string()
      .regex(/^UN\d{4}$/, 'UN numbers look like UN1234 — UN plus 4 digits.')
      .register(fieldMeta, {
        label: 'UN number',
        description: 'UN identifier for hazardous materials.',
      }),
    hazardClass: z
      .enum(HAZARD_CLASSES)
      .register(fieldMeta, { label: 'Hazard class', description: 'Per UN hazard classification.' }),
    acknowledged: z
      .literal(true, { message: 'Confirm the handling rules to continue.' })
      .register(fieldMeta, { label: 'Hazmat acknowledgement' }),
  })

  const oversizedDetailsSchema = z.object({
    type: z.literal('oversized').register(fieldMeta, { label: 'Type' }),
    lengthIn: z.number().positive().register(fieldMeta, { label: 'Length (in)' }),
    widthIn: z.number().positive().register(fieldMeta, { label: 'Width (in)' }),
    heightIn: z.number().positive().register(fieldMeta, { label: 'Height (in)' }),
    permitNumber: z.string().optional().register(fieldMeta, {
      label: 'Permit number',
      description: 'Required for some oversized cargo. Leave blank if none.',
    }),
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
    truckType: z.enum(TRUCK_TYPES).register(fieldMeta, { label: 'Truck type' }),
    liftgate: z.boolean().register(fieldMeta, { label: 'Liftgate required' }),
  })

  const airServiceSchema = z.object({
    mode: z.literal('air'),
    airline: z
      .string()
      .min(2, 'Pick an airline (or type its name).')
      .register(fieldMeta, { label: 'Airline' }),
    awbPrefix: z
      .string()
      .regex(/^\d{3}$/, 'AWB prefix is exactly 3 digits — like 220.')
      .register(fieldMeta, {
        label: 'AWB prefix',
        description: '3 digits identifying the issuing airline.',
      }),
  })

  const oceanServiceSchema = z.object({
    mode: z.literal('ocean'),
    vessel: z.string().min(2, 'Vessel name is required.').register(fieldMeta, { label: 'Vessel' }),
    containerSize: z.enum(CONTAINER_SIZES).register(fieldMeta, { label: 'Container' }),
  })

  const serviceSchema = z.discriminatedUnion('mode', [
    truckServiceSchema,
    airServiceSchema,
    oceanServiceSchema,
  ])

  const schema = z.object({
    reference: z
      .string()
      .regex(/^SHP-\d{6}$/, 'Reference looks like SHP-123456 — SHP plus 6 digits.')
      .register(fieldMeta, {
        label: 'Reference',
        placeholder: 'SHP-123456',
        description: 'Tracking ID for this shipment.',
      }),
    pickup: withMeta(addressSchema, { label: 'Pickup address' }),
    delivery: withMeta(addressSchema, { label: 'Delivery address' }),
    // Schema-modeled toggle so the flag is persisted + restored
    // alongside the rest of the draft. The watch below keeps
    // delivery in sync with pickup whenever it's true.
    useSameDeliveryAddress: z.boolean().register(fieldMeta, { label: 'Same as pickup address' }),
    cargo: cargoSchema.register(fieldMeta, { label: 'Cargo' }),
    service: serviceSchema.register(fieldMeta, { label: 'Service' }),
    desiredPickupDate: z
      .string()
      .min(1, 'Pick a pickup date.')
      .register(fieldMeta, { label: 'Pickup date' }),
    desiredDeliveryDate: z
      .string()
      .min(1, 'Pick a delivery date.')
      .register(fieldMeta, { label: 'Delivery date' }),
    insurance: z
      .object({
        declaredValueUSD: z
          .number()
          .min(0, "Declared value can't be negative.")
          .register(fieldMeta, {
            label: 'Declared value (USD)',
            description: 'Used to calculate insurance coverage.',
          }),
        coverage: z.enum(COVERAGES).register(fieldMeta, { label: 'Coverage' }),
      })
      .register(fieldMeta, { label: 'Insurance' }),
    notes: z
      .string()
      .max(500, 'Keep notes under 500 characters.')
      .optional()
      .register(fieldMeta, { label: 'Notes', description: 'Optional handling instructions.' }),
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
    (raw: unknown) => (typeof raw === 'string' ? raw.toUpperCase().replace(/\s+/g, '') : raw),
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
    // `form.fields(path)` resolves the FieldState directly (call-form);
    // `.element` is the first DOM node bound at that path.
    nextTick(() => form.fields(path).element?.focus())
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
      unitWeightLb: 1,
    })
  }
  function removeLineItem(idx: number) {
    form.remove('cargo.items', idx)
  }

  const totalLb = computed(() =>
    form.values.cargo.items.reduce(
      (sum, it) => sum + (Number(it.quantity) || 0) * (Number(it.unitWeightLb) || 0),
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
      alert('Booked!\n\n' + JSON.stringify(values, null, 2))
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
  // `field.showErrors` is the heuristic-gated render flag (library
  // default: submit-or-touched-and-dirty); `firstError` is the top
  // error in schema order. The two compose into a single readable
  // call site — no per-template repetition of the heuristic.
  function fieldClasses(field: FieldState<unknown> | undefined) {
    if (!field) return {}
    return {
      valid: field.valid && (field.dirty || field.touched),
      invalid: field.showErrors,
      validating: field.validating,
    }
  }
  function errorMessage(field: FieldState<unknown> | undefined) {
    return field?.showErrors ? (field.firstError?.message ?? '') : ''
  }

  // Array-level error at cargo.items (min(1) + async capacity refine).
  // Filtered to path.length === 2 so per-row errors at
  // cargo.items.${i}.${leaf} don't bleed into the array banner.
  const cargoItemsArrayError = computed(
    () => form.errors('cargo.items')?.find((e) => e.path.length === 2)?.message ?? ''
  )

  const addressBlocks = computed(() => [
    {
      prefix: 'pickup' as const,
      label: form.fields('pickup').label,
      mirrored: false,
    },
    {
      prefix: 'delivery' as const,
      label: form.fields('delivery').label,
      mirrored: form.values.useSameDeliveryAddress,
    },
  ])
</script>

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
          <label for="reference">{{ form.fields.reference.label }}</label>
          <small v-if="form.fields.reference.description" class="help">
            {{ form.fields.reference.description }}
          </small>
          <input
            id="reference"
            v-register="form.register('reference')"
            :placeholder="form.fields.reference.placeholder"
          />
          <small v-if="form.fields.reference.validating" class="hint">Checking…</small>
          <small v-else class="error">
            {{ errorMessage(form.fields.reference) }}
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
            <input v-register="form.register('useSameDeliveryAddress')" type="checkbox" />
            {{ form.fields.useSameDeliveryAddress.label }}
          </label>
          <div class="grid-2">
            <div class="field" :class="fieldClasses(form.fields[block.prefix].line1)">
              <label>{{ form.fields[block.prefix].line1.label }}</label>
              <small v-if="form.fields[block.prefix].line1.description" class="help">
                {{ form.fields[block.prefix].line1.description }}
              </small>
              <input
                v-register="form.register([block.prefix, 'line1'])"
                :disabled="block.mirrored"
              />
              <small class="error">{{ errorMessage(form.fields[block.prefix].line1) }}</small>
            </div>
            <div class="field">
              <label>{{ form.fields[block.prefix].line2.label }}</label>
              <small v-if="form.fields[block.prefix].line2.description" class="help">
                {{ form.fields[block.prefix].line2.description }}
              </small>
              <input
                v-register="form.register([block.prefix, 'line2'])"
                :disabled="block.mirrored"
              />
            </div>
          </div>
          <div class="grid-3">
            <div class="field" :class="fieldClasses(form.fields[block.prefix].city)">
              <label>{{ form.fields[block.prefix].city.label }}</label>
              <input
                v-register="form.register([block.prefix, 'city'])"
                :disabled="block.mirrored"
              />
              <small class="error">{{ errorMessage(form.fields[block.prefix].city) }}</small>
            </div>
            <div class="field" :class="fieldClasses(form.fields[block.prefix].region)">
              <label>{{ form.fields[block.prefix].region.label }}</label>
              <small v-if="form.fields[block.prefix].region.description" class="help">
                {{ form.fields[block.prefix].region.description }}
              </small>
              <input
                v-register="form.register([block.prefix, 'region'])"
                :disabled="block.mirrored"
              />
              <small class="error">{{ errorMessage(form.fields[block.prefix].region) }}</small>
            </div>
            <div class="field" :class="fieldClasses(form.fields[block.prefix].country)">
              <label>{{ form.fields[block.prefix].country.label }}</label>
              <select
                v-register="form.register([block.prefix, 'country'])"
                :disabled="block.mirrored"
              >
                <option v-for="c in COUNTRIES" :key="c" :value="c">{{ c }}</option>
              </select>
            </div>
          </div>
          <div class="field" :class="fieldClasses(form.fields[block.prefix].postalCode)">
            <label>{{ form.fields[block.prefix].postalCode.label }}</label>
            <small v-if="form.fields[block.prefix].postalCode.description" class="help">
              {{ form.fields[block.prefix].postalCode.description }}
            </small>
            <input
              v-register="form.register([block.prefix, 'postalCode'])"
              placeholder="Try 10xxx, M5xxx, SWxxx…"
              :disabled="block.mirrored"
            />
            <small v-if="form.fields[block.prefix].postalCode.validating" class="hint">
              Looking up postal code…
            </small>
            <small v-else class="error">
              {{ errorMessage(form.fields[block.prefix].postalCode) }}
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
          <div class="field" :class="fieldClasses(form.fields.cargo.details.tempMinF)">
            <label>{{ form.fields.cargo.details.tempMinF.label }}</label>
            <input
              v-register.number="form.register('cargo.details.tempMinF')"
              type="number"
              step="0.5"
            />
            <small class="error">{{ errorMessage(form.fields.cargo.details.tempMinF) }}</small>
          </div>
          <div class="field" :class="fieldClasses(form.fields.cargo.details.tempMaxF)">
            <label>{{ form.fields.cargo.details.tempMaxF.label }}</label>
            <input
              v-register.number="form.register('cargo.details.tempMaxF')"
              type="number"
              step="0.5"
            />
            <small class="error">{{ errorMessage(form.fields.cargo.details.tempMaxF) }}</small>
          </div>
        </div>

        <div v-else-if="cargoType === 'hazmat'" class="hazmat">
          <div class="grid-2">
            <div class="field" :class="fieldClasses(form.fields.cargo.details.unNumber)">
              <label>{{ form.fields.cargo.details.unNumber.label }}</label>
              <small v-if="form.fields.cargo.details.unNumber.description" class="help">
                {{ form.fields.cargo.details.unNumber.description }}
              </small>
              <input v-register="form.register('cargo.details.unNumber')" placeholder="UN1234" />
              <small class="error">{{ errorMessage(form.fields.cargo.details.unNumber) }}</small>
            </div>
            <div class="field" :class="fieldClasses(form.fields.cargo.details.hazardClass)">
              <label>{{ form.fields.cargo.details.hazardClass.label }}</label>
              <small v-if="form.fields.cargo.details.hazardClass.description" class="help">
                {{ form.fields.cargo.details.hazardClass.description }}
              </small>
              <select v-register="form.register('cargo.details.hazardClass')">
                <option v-for="c in HAZARD_CLASSES" :key="c" :value="c"> Class {{ c }} </option>
              </select>
              <small class="error">{{ errorMessage(form.fields.cargo.details.hazardClass) }}</small>
            </div>
          </div>
          <label class="checkbox">
            <input v-register="form.register('cargo.details.acknowledged')" type="checkbox" />
            I have read and acknowledge the dangerous-goods handling rules.
          </label>
          <small class="error">{{ errorMessage(form.fields.cargo.details.acknowledged) }}</small>
        </div>

        <div v-else-if="cargoType === 'oversized'" class="oversized">
          <div class="grid-3">
            <div class="field" :class="fieldClasses(form.fields.cargo.details.lengthIn)">
              <label>{{ form.fields.cargo.details.lengthIn.label }}</label>
              <input v-register.number="form.register('cargo.details.lengthIn')" type="number" />
              <small class="error">{{ errorMessage(form.fields.cargo.details.lengthIn) }}</small>
            </div>
            <div class="field" :class="fieldClasses(form.fields.cargo.details.widthIn)">
              <label>{{ form.fields.cargo.details.widthIn.label }}</label>
              <input v-register.number="form.register('cargo.details.widthIn')" type="number" />
              <small class="error">{{ errorMessage(form.fields.cargo.details.widthIn) }}</small>
            </div>
            <div class="field" :class="fieldClasses(form.fields.cargo.details.heightIn)">
              <label>{{ form.fields.cargo.details.heightIn.label }}</label>
              <input v-register.number="form.register('cargo.details.heightIn')" type="number" />
              <small class="error">{{ errorMessage(form.fields.cargo.details.heightIn) }}</small>
            </div>
          </div>
          <div class="field">
            <label>{{ form.fields.cargo.details.permitNumber.label }}</label>
            <small v-if="form.fields.cargo.details.permitNumber.description" class="help">
              {{ form.fields.cargo.details.permitNumber.description }}
            </small>
            <input v-register="form.register('cargo.details.permitNumber')" />
            <small v-if="!form.values.cargo.details.permitNumber" class="muted">
              No permit on file — start typing to add one.
            </small>
          </div>
        </div>

        <!-- Line items (field array) -->
        <div class="line-items">
          <div class="line-items-header">
            <h3
              >Line items <span class="muted">({{ totalLb }} lb total)</span></h3
            >
            <button type="button" class="ghost" @click="addLineItem">+ Add item</button>
          </div>
          <div v-if="form.values.cargo.items.length === 0" class="empty">
            No line items yet. Try
            <code>SKU-1001</code>, <code>SKU-2001</code>, or <code>PALLET-A</code>.
          </div>
          <div v-for="(item, idx) in form.fields.cargo.items" :key="idx" class="line-item">
            <div class="li-grid">
              <div class="field" :class="fieldClasses(item.sku)">
                <label>{{ item.sku.label }}</label>
                <input
                  v-register="
                    form.register(`cargo.items.${idx}.sku`, { transforms: skuTransforms })
                  "
                  placeholder="SKU-1001"
                />
                <small v-if="item.sku.validating" class="hint"> Checking SKU… </small>
                <small v-else class="error">
                  {{ errorMessage(item.sku) }}
                </small>
              </div>
              <div class="field" :class="fieldClasses(item.description)">
                <label>{{ item.description.label }}</label>
                <input v-register="form.register(`cargo.items.${idx}.description`)" />
                <small class="error">{{ errorMessage(item.description) }}</small>
              </div>
              <div class="field qty" :class="fieldClasses(item.quantity)">
                <label>{{ item.quantity.label }}</label>
                <input
                  v-register.number="form.register(`cargo.items.${idx}.quantity`)"
                  type="number"
                  min="1"
                />
                <small class="error">{{ errorMessage(item.quantity) }}</small>
              </div>
              <div class="field qty" :class="fieldClasses(item.unitWeightLb)">
                <label>{{ item.unitWeightLb.label }}</label>
                <input
                  v-register.number="form.register(`cargo.items.${idx}.unitWeightLb`)"
                  type="number"
                  step="0.01"
                  min="0"
                />
                <small class="error">{{ errorMessage(item.unitWeightLb) }}</small>
              </div>
              <button
                type="button"
                class="icon-btn"
                aria-label="Remove line item"
                @click="removeLineItem(Number(idx))"
              >
                ✕
              </button>
            </div>
          </div>
          <small v-if="cargoItemsArrayError" class="error">{{ cargoItemsArrayError }}</small>
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
            <label>{{ form.fields.service.truckType.label }}</label>
            <select v-register="form.register('service.truckType')">
              <option v-for="t in TRUCK_TYPES" :key="t" :value="t">{{
                TRUCK_TYPE_LABELS[t]
              }}</option>
            </select>
          </div>
          <label class="checkbox align-end">
            <input v-register="form.register('service.liftgate')" type="checkbox" />
            {{ form.fields.service.liftgate.label }}
          </label>
        </div>

        <div v-else-if="serviceMode === 'air'" class="grid-2">
          <div class="field" :class="fieldClasses(form.fields.service.airline)">
            <label>{{ form.fields.service.airline.label }}</label>
            <input v-register="form.register('service.airline')" placeholder="Lufthansa" />
            <small class="error">{{ errorMessage(form.fields.service.airline) }}</small>
          </div>
          <div class="field" :class="fieldClasses(form.fields.service.awbPrefix)">
            <label>{{ form.fields.service.awbPrefix.label }}</label>
            <small v-if="form.fields.service.awbPrefix.description" class="help">
              {{ form.fields.service.awbPrefix.description }}
            </small>
            <input v-register="form.register('service.awbPrefix')" placeholder="220" />
            <small class="error">{{ errorMessage(form.fields.service.awbPrefix) }}</small>
          </div>
        </div>

        <div v-else-if="serviceMode === 'ocean'" class="grid-2">
          <div class="field" :class="fieldClasses(form.fields.service.vessel)">
            <label>{{ form.fields.service.vessel.label }}</label>
            <input v-register="form.register('service.vessel')" placeholder="MSC Aurelia" />
            <small class="error">{{ errorMessage(form.fields.service.vessel) }}</small>
          </div>
          <div class="field" :class="fieldClasses(form.fields.service.containerSize)">
            <label>{{ form.fields.service.containerSize.label }}</label>
            <select v-register="form.register('service.containerSize')">
              <option v-for="s in CONTAINER_SIZES" :key="s" :value="s">{{
                CONTAINER_SIZE_LABELS[s]
              }}</option>
            </select>
          </div>
        </div>

        <div class="grid-2">
          <div class="field" :class="fieldClasses(form.fields.desiredPickupDate)">
            <label>{{ form.fields.desiredPickupDate.label }}</label>
            <input v-register="form.register('desiredPickupDate')" type="date" />
            <small class="error">{{ errorMessage(form.fields.desiredPickupDate) }}</small>
          </div>
          <div class="field" :class="fieldClasses(form.fields.desiredDeliveryDate)">
            <label>{{ form.fields.desiredDeliveryDate.label }}</label>
            <input v-register="form.register('desiredDeliveryDate')" type="date" />
            <small class="error">{{ errorMessage(form.fields.desiredDeliveryDate) }}</small>
          </div>
        </div>

        <fieldset class="address">
          <legend>{{ form.fields('insurance').label }}</legend>
          <div class="grid-2">
            <div class="field" :class="fieldClasses(form.fields.insurance.declaredValueUSD)">
              <label>{{ form.fields.insurance.declaredValueUSD.label }}</label>
              <small v-if="form.fields.insurance.declaredValueUSD.description" class="help">
                {{ form.fields.insurance.declaredValueUSD.description }}
              </small>
              <input
                v-register.number="form.register('insurance.declaredValueUSD')"
                type="number"
                min="0"
              />
              <small class="error">{{
                errorMessage(form.fields.insurance.declaredValueUSD)
              }}</small>
            </div>
            <div class="field">
              <label>{{ form.fields.insurance.coverage.label }}</label>
              <select v-register="form.register('insurance.coverage')">
                <option v-for="c in COVERAGES" :key="c" :value="c">{{ COVERAGE_LABELS[c] }}</option>
              </select>
            </div>
          </div>
        </fieldset>

        <div class="field">
          <label>{{ form.fields.notes.label }}</label>
          <small v-if="form.fields.notes.description" class="help">
            {{ form.fields.notes.description }}
          </small>
          <textarea
            v-register="form.register('notes')"
            rows="3"
            placeholder="Special handling instructions…"
          />
          <small v-if="!form.values.notes" class="muted">
            No notes recorded — start typing to add some.
          </small>
          <small class="error">{{ errorMessage(form.fields.notes) }}</small>
        </div>
      </section>

      <!-- ─── Step 4: review ─── -->
      <section v-show="step === 4" class="step-body review">
        <h3>Review</h3>
        <pre>{{ JSON.stringify(form.values(), null, 2) }}</pre>
        <!-- `form.meta.showErrors` runs the configured heuristic against
             the root container's aggregated state — same gate as every
             per-field error site, so the summary only appears when the
             user is ready to see issues. -->
        <aside v-if="form.meta.showErrors" class="errors-summary" aria-live="polite">
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
                  <button type="button" class="errors-summary-row" @click="goToError(item.path)">
                    <span v-if="item.leafLabel" class="errors-summary-leaf">{{
                      item.leafLabel
                    }}</span>
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
            :disabled="!form.history.canUndo"
            @click="form.history.undo()"
          >
            ↶ Undo
          </button>
          <button
            type="button"
            class="ghost"
            :disabled="!form.history.canRedo"
            @click="form.history.redo()"
          >
            ↷ Redo
          </button>
          <button type="button" class="ghost danger" @click="resetAll">Reset</button>
        </div>
        <div class="nav-right">
          <button v-if="step > 1" type="button" class="secondary" @click="goBack"> Back </button>
          <button
            v-if="step < 4"
            type="button"
            class="primary"
            :disabled="!currentStepValid"
            @click="goNext"
          >
            Next
            <span v-if="form.meta.validating" class="badge">…</span>
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
  * {
    box-sizing: border-box;
  }

  body {
    margin: 0;
    padding: 0;
    background: #f9fafb;
    font-family:
      'Inter',
      -apple-system,
      BlinkMacSystemFont,
      'Segoe UI',
      system-ui,
      sans-serif;
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
    background: #ffffff;
    border: 0.0625rem solid #eaecf0;
    border-radius: 0.75rem;
    box-shadow:
      0 0.0625rem 0.1875rem 0 rgb(16 24 40 / 0.1),
      0 0.0625rem 0.125rem -0.0625rem rgb(16 24 40 / 0.06);
  }

  .form-header {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }
  .form-header h1 {
    margin: 0;
    font-size: 1.5rem;
    font-weight: 600;
    letter-spacing: -0.012em;
  }
  .form-header p {
    margin: 0;
    font-size: 0.875rem;
    color: #667085;
  }

  /* ─── Stepper ─── */
  .stepper {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 0.5rem;
    padding: 0.75rem;
    background: #f9fafb;
    border-radius: 0.5rem;
    /* Sticky so the four-step nav stays in reach while the user
     scrolls through a long step body. `top` matches `.form`'s
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
  .step:hover {
    background: #f2f4f7;
    color: #344054;
  }
  .step.active {
    background: #ffffff;
    color: #101828;
    box-shadow: 0 0.0625rem 0.125rem 0 rgb(16 24 40 / 0.05);
  }
  .step.done {
    color: #027a48;
  }
  .step-num {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 1.5rem;
    height: 1.5rem;
    border-radius: 999px;
    background: #eaecf0;
    font-weight: 600;
    font-size: 0.75rem;
  }
  .step.active .step-num {
    background: #6938ef;
    color: #fff;
  }
  .step.done .step-num {
    background: #027a48;
    color: #fff;
  }
  .step-title {
    font-weight: 500;
  }

  /* ─── Step body ─── */
  .step-body {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  /* ─── Field ─── */
  .field {
    display: flex;
    flex-direction: column;
    gap: 0.375rem;
  }
  .field label {
    font-size: 0.875rem;
    font-weight: 500;
    color: #344054;
  }
  .field .muted {
    color: #98a2b3;
    font-weight: 400;
  }

  .field input,
  .field select,
  .field textarea {
    width: 100%;
    height: 2.5rem;
    padding: 0 0.875rem;
    border: 0.0625rem solid #d0d5dd;
    border-radius: 0.5rem;
    background: #ffffff;
    color: #101828;
    font: inherit;
    font-size: 0.9375rem;
    outline: none;
    box-shadow: 0 0.0625rem 0.125rem 0 rgb(16 24 40 / 0.05);
    transition:
      border-color 120ms cubic-bezier(0.165, 0.84, 0.44, 1),
      box-shadow 120ms cubic-bezier(0.165, 0.84, 0.44, 1);
  }
  .field textarea {
    height: auto;
    padding: 0.625rem 0.875rem;
    resize: vertical;
    min-height: 4.5rem;
  }
  .field input::placeholder,
  .field textarea::placeholder {
    color: #98a2b3;
  }
  .field input:hover,
  .field select:hover,
  .field textarea:hover {
    border-color: #98a2b3;
  }
  .field input:focus,
  .field select:focus,
  .field textarea:focus {
    border-color: #bdb4fe;
    box-shadow:
      0 0 0 0.25rem #ebe9fe,
      0 0.0625rem 0.125rem 0 rgb(16 24 40 / 0.05);
  }

  /* Validity states — applied per-field via :class binding. */
  .field.valid input,
  .field.valid select,
  .field.valid textarea {
    border-color: #6ce9a6;
  }
  .field.valid input:focus,
  .field.valid select:focus,
  .field.valid textarea:focus {
    box-shadow:
      0 0 0 0.25rem #d1fadf,
      0 0.0625rem 0.125rem 0 rgb(16 24 40 / 0.05);
  }
  .field.invalid input,
  .field.invalid select,
  .field.invalid textarea {
    border-color: #fda29b;
  }
  .field.invalid input:focus,
  .field.invalid select:focus,
  .field.invalid textarea:focus {
    box-shadow:
      0 0 0 0.25rem #fee4e2,
      0 0.0625rem 0.125rem 0 rgb(16 24 40 / 0.05);
  }
  .field.validating input,
  .field.validating select,
  .field.validating textarea {
    border-color: #fdb022;
  }

  .field .error {
    display: block;
    font-size: 0.8125rem;
    line-height: 1.125rem;
    min-height: 1.125rem;
    color: #b42318;
  }
  .field .hint {
    display: block;
    font-size: 0.8125rem;
    line-height: 1.125rem;
    min-height: 1.125rem;
    color: #b54708;
  }
  .field .help {
    display: block;
    font-size: 0.8125rem;
    line-height: 1.125rem;
    color: #667085;
    margin-top: -0.125rem;
  }

  /* ─── Layouts ─── */
  .row {
    display: flex;
    gap: 0.75rem;
  }
  .grid-2 {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.75rem;
  }
  .grid-3 {
    display: grid;
    grid-template-columns: 1fr 1fr 1fr;
    gap: 0.75rem;
  }

  .address {
    border: 0.0625rem solid #eaecf0;
    border-radius: 0.5rem;
    padding: 0.75rem 1rem 1rem;
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }
  .address legend {
    font-size: 0.8125rem;
    font-weight: 600;
    color: #344054;
    padding: 0 0.375rem;
  }
  .address.mirrored .field input,
  .address.mirrored .field select {
    background: #f9fafb;
    color: #98a2b3;
    cursor: not-allowed;
  }
  .address.mirrored .field input:focus,
  .address.mirrored .field select:focus {
    border-color: #d0d5dd;
    box-shadow: none;
  }
  .address.mirrored .field label {
    color: #98a2b3;
  }

  /* ─── Variant chips ─── */
  .variant-picker {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }
  .variant-picker > label {
    font-size: 0.875rem;
    font-weight: 500;
    color: #344054;
  }
  .chip-row {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
  }
  .chip {
    padding: 0.5rem 0.875rem;
    border: 0.0625rem solid #d0d5dd;
    border-radius: 999px;
    background: #ffffff;
    font: inherit;
    font-size: 0.875rem;
    font-weight: 500;
    color: #344054;
    cursor: pointer;
    transition:
      background 120ms,
      border-color 120ms;
  }
  .chip:hover {
    background: #f9fafb;
    border-color: #98a2b3;
  }
  .chip.active {
    background: #ebe9fe;
    border-color: #bdb4fe;
    color: #5925dc;
  }

  /* ─── Checkbox ─── */
  .checkbox {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.875rem;
    color: #344054;
  }
  .checkbox input {
    width: 1rem;
    height: 1rem;
  }
  .align-end {
    align-self: end;
    padding-bottom: 0.5rem;
  }

  /* ─── Line items ─── */
  .line-items {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    padding-top: 0.25rem;
  }
  .line-items-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .line-items-header h3 {
    margin: 0;
    font-size: 0.9375rem;
    font-weight: 600;
    color: #344054;
  }
  .muted {
    color: #98a2b3;
    font-weight: 400;
  }
  .empty {
    padding: 1rem;
    background: #f9fafb;
    border-radius: 0.5rem;
    font-size: 0.875rem;
    color: #667085;
    text-align: center;
  }
  .empty code {
    background: #fff;
    padding: 0.0625rem 0.375rem;
    border-radius: 0.25rem;
    border: 0.0625rem solid #eaecf0;
  }

  .line-item {
    padding: 0.625rem;
    border: 0.0625rem solid #eaecf0;
    border-radius: 0.5rem;
    background: #fafafb;
  }
  .li-grid {
    display: grid;
    grid-template-columns: 1fr 1.5fr 4.5rem 5rem auto;
    gap: 0.5rem;
    align-items: end;
  }
  .field.qty input {
    padding: 0 0.5rem;
  }

  .icon-btn {
    height: 2.5rem;
    width: 2.5rem;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border: 0.0625rem solid #eaecf0;
    border-radius: 0.5rem;
    background: #fff;
    color: #b42318;
    cursor: pointer;
    transition: background 120ms;
  }
  .icon-btn:hover {
    background: #fee4e2;
  }

  /* ─── Hazmat / oversized ─── */
  .hazmat,
  .oversized {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  /* ─── Review pre ─── */
  .review pre {
    background: #0c111d;
    color: #d0d5dd;
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
    background: #fef3f2;
    border: 0.0625rem solid #fecdca;
    border-radius: 0.625rem;
  }
  .errors-summary-head {
    display: flex;
    gap: 0.75rem;
    align-items: flex-start;
  }
  .errors-summary-icon {
    font-size: 1.125rem;
    line-height: 1.25;
    color: #b42318;
  }
  .errors-summary-title {
    margin: 0;
    font-size: 0.9375rem;
    font-weight: 600;
    letter-spacing: -0.005em;
    color: #7a271a;
  }
  .errors-summary-hint {
    margin: 0.125rem 0 0 0;
    color: #b42318;
    font-size: 0.8125rem;
  }
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
    color: #b42318;
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
    background: #ffffff;
    border: 0.0625rem solid #fee4e2;
    border-radius: 0.375rem;
    font: inherit;
    font-size: 0.8125rem;
    color: #7a271a;
    cursor: pointer;
    text-align: left;
    transition:
      border-color 120ms ease,
      background-color 120ms ease;
  }
  .errors-summary-row:hover {
    border-color: #fda29b;
    background: #fffcfc;
  }
  .errors-summary-row:focus-visible {
    outline: 0.125rem solid #f97066;
    outline-offset: 0.0625rem;
  }
  .errors-summary-leaf {
    font-weight: 600;
  }
  .errors-summary-msg {
    color: #b42318;
  }
  .errors-summary-arrow {
    margin-left: auto;
    color: #b42318;
    opacity: 0.5;
    transition:
      transform 120ms ease,
      opacity 120ms ease;
  }
  .errors-summary-row:hover .errors-summary-arrow {
    transform: translateX(0.125rem);
    opacity: 1;
  }

  /* ─── Banner ─── */
  .banner-error {
    margin: 0;
    padding: 0.75rem 1rem;
    background: #fef3f2;
    border: 0.0625rem solid #fecdca;
    border-radius: 0.5rem;
    color: #b42318;
    font-size: 0.875rem;
  }

  /* ─── Nav row ─── */
  .nav {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding-top: 0.5rem;
    border-top: 0.0625rem solid #eaecf0;
  }
  .nav-left,
  .nav-right {
    display: flex;
    gap: 0.5rem;
  }

  button.primary,
  button.secondary,
  button.ghost {
    height: 2.5rem;
    padding: 0 1rem;
    border-radius: 0.5rem;
    font: inherit;
    font-size: 0.875rem;
    font-weight: 600;
    cursor: pointer;
    transition:
      background-color 120ms,
      border-color 120ms;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.375rem;
  }
  button.primary {
    background: #6938ef;
    color: #fff;
    border: none;
  }
  button.primary:hover:not(:disabled) {
    background: #5925dc;
  }
  button.primary:disabled {
    background: #f2f4f7;
    color: #98a2b3;
    cursor: not-allowed;
  }
  button.secondary {
    background: #fff;
    color: #344054;
    border: 0.0625rem solid #d0d5dd;
  }
  button.secondary:hover {
    background: #f9fafb;
  }
  button.ghost {
    background: transparent;
    color: #667085;
    border: 0.0625rem solid transparent;
    padding: 0 0.625rem;
  }
  button.ghost:hover:not(:disabled) {
    background: #f2f4f7;
    color: #344054;
  }
  button.ghost:disabled {
    color: #d0d5dd;
    cursor: not-allowed;
  }
  button.ghost.danger:hover {
    color: #b42318;
    background: #fef3f2;
  }

  .badge {
    display: inline-flex;
    align-items: center;
    padding: 0 0.375rem;
    background: rgba(255, 255, 255, 0.25);
    border-radius: 0.25rem;
    font-size: 0.75rem;
  }

  /* ─── Mobile (< 40rem ≈ 640px) ─── */
  @media (max-width: 40rem) {
    .page {
      padding: 1rem 0.75rem;
    }
    .form {
      padding: 1.25rem;
      gap: 1rem;
    }
    .form-header h1 {
      font-size: 1.25rem;
    }

    /* All multi-column grids collapse to one. */
    .grid-2,
    .grid-3 {
      grid-template-columns: 1fr;
    }

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
    .step-num {
      width: 1.375rem;
      height: 1.375rem;
      font-size: 0.6875rem;
    }
    .step-title {
      white-space: normal;
    }

    /* Address fieldset: trim padding so input gutters don't squeeze. */
    .address {
      padding: 0.75rem;
      gap: 0.625rem;
    }

    /* Line items: 2-column layout — SKU + description full width on
     their own rows, qty + wt side-by-side, remove button on its own
     trailing row, right-aligned. Bigger tap target via grid stretch. */
    .li-grid {
      grid-template-columns: 1fr 1fr;
      gap: 0.5rem;
    }
    .li-grid > :nth-child(1),
    .li-grid > :nth-child(2) {
      grid-column: 1 / -1;
    }
    .li-grid > :nth-child(3) {
      grid-column: 1 / 2;
    }
    .li-grid > :nth-child(4) {
      grid-column: 2 / 3;
    }
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
    .nav-right {
      justify-content: stretch;
    }
    .nav-right > button {
      flex: 1;
    }
    .nav-left {
      justify-content: space-between;
    }
    .nav-left > button {
      flex: 1;
    }

    /* Review pre: smaller font + lower max-height so the review JSON
     doesn't dominate the viewport. */
    .review pre {
      font-size: 0.75rem;
      max-height: 12rem;
    }

    /* Variant chips: full-width row when there are 4+ chips so they
     wrap evenly rather than stair-stepping. */
    .chip-row .chip {
      flex: 1 1 calc(50% - 0.25rem);
      justify-content: center;
    }
  }

  /* ─── Tiny phones (< 22.5rem ≈ 360px) ─── */
  @media (max-width: 22.5rem) {
    .form {
      padding: 1rem;
    }
    .stepper {
      padding: 0.375rem;
      gap: 0.25rem;
    }
    .step {
      padding: 0.375rem 0.5rem;
      font-size: 0.75rem;
    }
    /* Line items: full single column so SKU has room for its async
     "Checking…" hint. */
    .li-grid {
      grid-template-columns: 1fr;
    }
    .li-grid > :nth-child(3),
    .li-grid > :nth-child(4) {
      grid-column: 1 / -1;
    }
  }
</style>
