# Dynamic field arrays

Forms that edit a list of items — tags on a post, line items on an
invoice, social links on a profile — need primitives for adding,
removing, reordering, and replacing entries. `useForm` ships seven typed
helpers that operate on any path whose leaf is an array.

## The helpers

```ts
import { z } from 'zod'
import { useForm } from '@chemical-x/forms/zod'

const schema = z.object({
  tags: z.array(z.string()),
  posts: z.array(
    z.object({
      title: z.string(),
      views: z.number(),
    })
  ),
})

const form = useForm({ schema, key: 'blog-editor' })

form.append('tags', 'new-tag')                 // push
form.prepend('tags', 'first-tag')              // unshift
form.insert('tags', 2, 'at-index-two')         // splice-insert
form.remove('tags', 0)                         // splice-remove (no-op if out of range)
form.swap('tags', 0, 2)                        // exchange two indices
form.move('tags', 3, 1)                        // move from→to, shifting others
form.replace('tags', 0, 'replaced-in-place')   // in-place; never grows
```

All seven helpers are typed:

- The path argument is constrained to `ArrayPath<Form>`, so calling
  `append('title', …)` on a `string` field is a compile error.
- The value argument is constrained to the array's element type, so
  `append('posts', 'not-a-post')` is a compile error.

## The v-for pattern

```vue
<script setup lang="ts">
import { useForm } from '@chemical-x/forms/zod'
import { z } from 'zod'

const schema = z.object({
  posts: z.array(
    z.object({
      title: z.string(),
      views: z.number(),
    })
  ),
})

const form = useForm({ schema, key: 'blog-editor' })
const posts = form.getValue('posts')
</script>

<template>
  <div v-for="(post, index) in posts" :key="index">
    <input v-register="form.register(`posts.${index}.title`)" />
    <input v-register="form.register(`posts.${index}.views`)" type="number" />
    <button type="button" @click="form.remove('posts', index)">Remove</button>
  </div>
  <button type="button" @click="form.append('posts', { title: '', views: 0 })">
    Add post
  </button>
</template>
```

Note the template-literal path: `` `posts.${index}.title` `` is a legal
`FlatPath<Form>`, so `register` narrows the DOM binding to
`RegisterValue<string | undefined>` — same type-safety you get for static
paths.

## Keying rows when items don't have IDs

Using the array index as `:key` is fine for a display-only list, but it
breaks badly when rows get reordered or removed: Vue will reuse DOM
nodes across what are conceptually different rows, and the inputs
register against the wrong path for a render cycle. Two options:

1. **Generate a stable ID client-side when you append**, and carry it
   on the row object:

   ```ts
   form.append('posts', {
     id: crypto.randomUUID(),
     title: '',
     views: 0,
   })
   ```

   Then `:key="post.id"` is stable across inserts / moves / removes.
   This costs one extra field on the schema but pays for itself
   anywhere the list is mutated mid-session.

2. **Use a counter stored outside the form**:

   ```ts
   const nextId = ref(0)
   function addPost() {
     form.append('posts', { title: '', views: 0 })
     nextId.value++
   }
   ```

   `:key="`${nextId.value}-${index}`"` is a weaker guarantee (two
   remounts of the component reset the counter) but is enough for an
   in-memory session.

For lists that only ever append at the end and never reorder, the raw
index is fine — `:key="index"` is a valid choice when rows are stable.

## getValue vs getFieldState for array items

`getValue('posts.0.title')` returns a `Readonly<Ref<string>>` — the
current *value* of that leaf. Use it when rendering the data.

`getFieldState('posts.0.title')` returns a `Ref<FieldState>` with the
error list, touched / focused / blurred flags, and connection state. Use
it when rendering validation UI or styling based on interaction.

```vue
<template>
  <div v-for="(post, index) in posts" :key="post.id">
    <input v-register="form.register(`posts.${index}.title`)" />
    <!-- Title errors live here. -->
    <span
      v-if="form.getFieldState(`posts.${index}.title`).value.errors.length > 0"
      class="error"
    >
      {{ form.getFieldState(`posts.${index}.title`).value.errors[0].message }}
    </span>
  </div>
</template>
```

## What happens under the hood

Every helper:

1. Reads the current array at the path (treating `undefined` as `[]`).
2. Produces a fresh array via `slice()` + the appropriate mutation.
3. Writes it back through `setValueAtPath`, which triggers the normal
   `diffAndApply` pipeline.

That means:

- Errors on *removed* paths stay in the error store until
  `clearFieldErrors` or `resetField(path)` fires — the array helpers
  don't know which indices map to which errors after a shift.
- Field records (touched / focused / blurred) for the old indices stay
  too. Call `resetField('posts')` if you want a clean slate after a
  big rearrangement.
- Out-of-range indices (for `remove` / `swap` / `replace`) are no-ops;
  `insert` and `move` clamp `to` to `[0, length]`.
