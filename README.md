# Chemical X Forms

[![npm version][npm-version-src]][npm-version-href]
[![npm downloads][npm-downloads-src]][npm-downloads-href]
[![License][license-src]][license-href]
[![Nuxt][nuxt-src]][nuxt-href]

**A fully type-safe, schema-driven form library that gives you superpowers**. Comes with a minimal composition API that prioritizes developer experience and form correctness.<br><br>
🚧 this library is not production ready _yet_.
<br><br>

## 🏔️ Features

- **Compact API** – Minimal yet expressive API surface with core functions like `useForm`, `register`, and `handleSubmit` to reduce boilerplate.
- **Abstract Schema Support** – Integrates with validation libraries like Zod for type-safe schemas and automatic validation.
- **v-xmodel Directive** – One SSR-safe directive that automatically tracks everything.
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

<br>

## 🪄 Usage

**Basic Example**

```vue
<script setup lang="ts">
import type { OnError, OnSubmit } from "@chemical-x/forms/types";
import { z } from "zod";

const planetSchema = z.object({
  address: z.object({
    planet: z
      .string()
      .refine((x) => x.toLowerCase() !== "moon", {
        message: "the moon ain't no planet",
        path: ["address.planet"],
      })
      .default("Moon"),
  }),
});

type Bio = z.infer<typeof planetSchema>;

const { getFieldState, register, handleSubmit, key, validate } = useForm({
  schema: planetSchema,
  key: "planet-form-key",
});

const planetState = getFieldState("address.planet");

const onSubmit: OnSubmit<Bio> = async (data) => console.log("nice!", data);
const onError: OnError = async (error) => console.log("oopsies!", error);

const planetValidationResponse = validate("address.planet");
</script>

<template>
  <form @submit.prevent="handleSubmit(onSubmit, onError)">
    <h1>Fancy Form '{{ key }}'</h1>

    <input
      v-xmodel="register('address.planet')"
      placeholder="Enter your favorite planet"
    />

    <hr />

    <p>Favorite Planet field state:</p>

    <pre>
      {{ JSON.stringify(planetState, null, 2) }}
    </pre>
    <hr />

    <p>Realtime path validation, if you need it:</p>

    <pre>
      {{ JSON.stringify(planetValidationResponse, null, 2) }}
    </pre>

    <button>Submit (check your console)</button>
  </form>
</template>

<style>
body {
  font-family: Arial, Helvetica, sans-serif;
}
</style>
```

**Core API Functions**

_**note**: detailed documentation coming soon_

`useForm(options?)` – Initializes form state. Abstract schema required.

`v-xmodel` – Custom, SSR-safe directive for registering components with Chemical X

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
