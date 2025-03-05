# Chemical X Forms

[![npm version][npm-version-src]][npm-version-href]
[![npm downloads][npm-downloads-src]][npm-downloads-href]
[![License][license-src]][license-href]
[![Nuxt][nuxt-src]][nuxt-href]

**Chemical X Forms** (`@chemical-x/forms`) is a fully type-safe, schema-driven form library that gives you superpowers.

We offer a minimal composition API that prioritizes developer experience and correctness.

**Note:** this library is not production ready (yet). If you find _any_ bugs, please create an issue and we'll resolve them.

## Features

- **Compact API** – Minimal yet expressive API surface with core functions like `useForm`, `register`, and `handleSubmit` to reduce boilerplate.
- **Abstract Schema Support** – Integrates with validation libraries like Zod for type-safe schemas and automatic validation.
- **v-xmodel Directive** – One SSR-safe directive that automatically tracks everything.
- **Full State Tracking** – Automatically tracks field states (value, touched, dirty status, validation errors, etc).
- **TypeScript Friendly** – Fully type-safe, with advanced form type inference from you schema.

## Installation

**Install with Nuxi:**

```bash
npx nuxi module add chemical-x-forms
```

That's it! You can now use Chemical X Forms in your Nuxt app ✨<br>

**Alternatively, install manually:**

```bash
# Using pnpm

pnpm add @chemical-x/forms

# Using npm

npm install @chemical-x/forms

# Using yarn

yarn add @chemical-x/forms
```

Then add the module to your nuxt.config.ts:

```ts
export default defineNuxtConfig({
  modules: ["@chemical-x/forms"],
});
```

## Usage

### Basic Example

```vue
<script setup lang="ts">
import { z } from "zod";

const schema = z.object({ name: z.string(), age: z.age() });
const { register, handleSubmit } = useForm({ schema });

const submit = handleSubmit((data) => {
  console.log("Form submitted with values:", data);
});
</script>

<template>
  <form @submit.prevent="submit">
    <input v-xmodel="register('name')" placeholder="Name" />
    <input v-xmodel="register('age')" type="number" placeholder="Age" />
    <button>Submit</button>
  </form>
</template>
```

### Core API Functions

`useForm(options?)` – Initializes form state. Abstract schema required.

`v-xmodel` -Custom, SSR-safe directive for registering components with Chemical X

`register(name: string)` – Binds a field to form state.

`handleSubmit(onSubmit, onError?)` – Handles submission with validation.

`getValue(name: string)` – Retrieves field value.

`setValue(name: string, value: any)` – Updates a field programmatically.

`getElementState(name: string)` – Returns field state (value, touched, errors, etc.).

## Advanced Features

- **Fully SSR Compatible** – Fully Nuxt 3-compatible with hydration-safe bindings.

- **Validation Handling** – Displays schema validation errors automatically.

- **Performance Optimizations** – Efficient reactive updates for optimal performance.

## License

`@chemical-x/forms` is released under the MIT License. See the LICENSE file for details.

<!-- Badges -->

[npm-version-src]: https://img.shields.io/npm/v/chemical-x-forms/latest.svg?style=flat&colorA=020420&colorB=00DC82
[npm-version-href]: https://npmjs.com/package/@chemical-x/forms
[npm-downloads-src]: https://img.shields.io/npm/dm/chemical-x-forms.svg?style=flat&colorA=020420&colorB=00DC82
[npm-downloads-href]: https://npm.chart.dev/@chemical-x/forms
[license-src]: https://img.shields.io/npm/l/chemical-x-forms.svg?style=flat&colorA=020420&colorB=00DC82
[license-href]: https://npmjs.com/package/@chemical-x/forms
[nuxt-src]: https://img.shields.io/badge/Nuxt-020420?logo=nuxt.js
[nuxt-href]: https://nuxt.com
