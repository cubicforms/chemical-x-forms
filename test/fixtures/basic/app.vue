<template>
  <div>basic</div>
</template>

<script setup lang="ts">
import { z } from "zod"
// import { useForm } from "../../../src/runtime/composables/use-form"
import { useForm } from "@runtime/composables/use-form"

const schema = z.object({ name: z.string() })
useForm({ schema })
</script>
