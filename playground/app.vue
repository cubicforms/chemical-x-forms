<script setup lang="ts">
import type { OnError, OnSubmit } from "@chemical-x/forms/types"
import { z } from "zod"

const planetSchema = z.object({
  address: z.object({
    planet: z
      .string()
      .refine(x => x.toLowerCase() !== "moon", {
        message: "the moon ain't no planet",
        path: ["address.planet"],
      })
      .default("Moon"),
  }),
})

type Bio = z.infer<typeof planetSchema>

const { getFieldState, register, handleSubmit, key, validate } = useForm({
  schema: planetSchema,
  key: "planet-form-key",
})

const planetState = getFieldState("address.planet")

const onSubmit: OnSubmit<Bio> = async data => console.log("nice!", data)
const onError: OnError = async error => console.log("oopsies!", error)

const planetValidationResponse = validate("address.planet")
</script>

<template>
  <form @submit.prevent="handleSubmit(onSubmit, onError)">
    <h1>Fancy Form '{{ key }}'</h1>

    <input
      v-xmodel="register('address.planet')"
      placeholder="Enter your favorite planet"
    >

    <hr>

    <p>Favorite Planet field state:</p>

    <pre>
      {{ JSON.stringify(planetState, null, 2) }}
    </pre>
    <hr>

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
