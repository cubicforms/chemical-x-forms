---
title: 'attaform/transforms — register transform pipeline'
description: 'Attach DOM input transforms to the v-register pipeline: shape user input on its way into Attaform form state without losing schema type safety.'
---

# `attaform/transforms`

The raw Vue compiler-core node transforms. Use this subpath only
when you're rolling your own bundler pipeline (esbuild, Rspack,
custom Rollup).

```ts
import { inputTextAreaNodeTransform, selectNodeTransform } from 'attaform/transforms'
```
