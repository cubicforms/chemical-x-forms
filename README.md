# Chemical X Forms

[![npm version][npm-version-src]][npm-version-href]
[![npm downloads][npm-downloads-src]][npm-downloads-href]
[![License][license-src]][license-href]
[![Node.js Test Suite](https://github.com/cubicforms/chemical-x-forms/actions/workflows/matrix.yml/badge.svg)](https://github.com/cubicforms/chemical-x-forms/actions/workflows/matrix.yml)
[![Nuxt][nuxt-src]][nuxt-href]

**A fully type-safe, schema-driven form library that gives you superpowers**.<br>Comes with a minimal composition API that prioritizes developer experience and form correctness.<br><br>
🚧 this library is not production ready _yet_.
<br><br>

## 🏔️ Features

- **Compact API** – Minimal yet expressive API surface with core functions like `useForm`, `register`, and `handleSubmit` to reduce boilerplate.
- **Abstract Schema Support** – Integrates with validation libraries like Zod for type-safe schemas and automatic validation.
- **v-register Directive** – One SSR-safe directive that automatically tracks everything.
- **Full State Tracking** – Automatically tracks field states (value, touched, dirty status, validation errors, etc).
- **TypeScript Friendly** – Fully type-safe, with advanced form type inference from your schema.
  <br><br>

## 🪩 Installation

**Install with Nuxi:**

```bash
npx nuxi module add @chemical-x/forms
```

That's it! You can now use Chemical X Forms in your Nuxt app ✨<br><br>

**Install manually:**

```bash
# Using npm
npm install @chemical-x/forms
```

Then add the module to your nuxt.config.ts:

```ts
export default defineNuxtConfig({
  modules: ["@chemical-x/forms"],
});
```

<br>

## 🪄 Usage

**Basic Example**

```vue
<script setup lang="ts">
import { z } from "zod";

// Define your schema
const schema = z.object({ planet: z.string() });

// Create your form
const { getFieldState, register, key } = useForm({ schema });

// Get the state of the 'planet' field
const planetState = getFieldState("planet");
</script>

<template>
  <div>
    <h1>Planet Form</h1>

    <input
      v-register="register('planet')"
      placeholder="Enter your favorite planet"
    />

    <p>Planet field State:</p>
    <pre>{{ JSON.stringify(planetState, null, 2) }}</pre>
    <hr />
  </div>
</template>
```

**Core API Functions**

_**note**: detailed documentation coming soon_

`useForm(options?)` – Initializes form state. Abstract schema required.

`v-register` – Custom, SSR-safe directive for registering components with Chemical X

`register(name: string)` – Binds a field to form state.

`handleSubmit(onSubmit, onError?)` – Handles submission with validation.

`getValue(name: string)` – Retrieves a field value.

`setValue(name: string, value: any)` – Updates a field programmatically.

`getFieldState(name: string)` – Returns field state (value, touched, errors, etc.).
<br><br>

## 🥇 Advanced Features

- **Fully SSR Safe** – Fully Nuxt 3-compatible with hydration-safe bindings.

- **Validation Handling** – Displays schema validation errors automatically.

- **Performance Optimizations** – Efficient reactive updates for optimal performance.

<br>

## 🪪 License

`@chemical-x/forms` is released under the MIT License. See the [LICENSE](https://github.com/cubicforms/chemical-x-forms/blob/main/LICENSE) file for details.

<!-- Badges -->

[npm-version-src]: https://img.shields.io/npm/v/@chemical-x/forms/latest.svg?style=flat&colorA=020420&colorB=00DC82
[npm-version-href]: https://npmjs.com/package/@chemical-x/forms
[npm-downloads-src]: https://img.shields.io/npm/dm/@chemical-x/forms.svg?style=flat&colorA=020420&colorB=00DC82
[npm-downloads-href]: https://npm.chart.dev/@chemical-x/forms
[license-src]: https://img.shields.io/npm/l/@chemical-x/forms.svg?style=flat&colorA=020420&colorB=00DC82
[license-href]: https://npmjs.com/package/@chemical-x/forms
[nuxt-src]: https://img.shields.io/badge/Nuxt-020420?logo=nuxt.js
[nuxt-href]: https://nuxt.com
