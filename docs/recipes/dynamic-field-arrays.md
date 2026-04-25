# Dynamic field arrays

Forms that edit a list — tags on a post, line items on an invoice,
social links on a profile — get seven typed helpers on any array
path.

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

form.append('tags', 'new-tag') // push
form.prepend('tags', 'first-tag') // unshift
form.insert('tags', 2, 'at-index-two') // splice-insert
form.remove('tags', 0) // splice-remove
form.swap('tags', 0, 2) // exchange two indices
form.move('tags', 3, 1) // move from → to, shift others
form.replace('tags', 0, 'replaced-in-place') // in-place; never grows
```

Every helper is type-narrowed:

- Path is `ArrayPath<Form>` — `append('title', …)` on a string field is a compile error.
- Value is `ArrayItem<Form, Path>` — `append('posts', 'not-a-post')` is a compile error.

Out-of-range behaviour:

- `remove` / `swap` / `move` / `replace` no-op on invalid indices.
- `insert` clamps via `Array.prototype.splice` semantics
  (`splice(-1, 0, v)` inserts just before the last item).

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
  <button type="button" @click="form.append('posts', { title: '', views: 0 })"> Add post </button>
</template>
```

Template literals like `` `posts.${index}.title` `` type-narrow
correctly — you get the same type safety as a static path.

## Keying rows when items don't have IDs

`:key="index"` is fine for a display-only list but breaks when rows
reorder or get removed (Vue reuses nodes across what are
conceptually different rows). Two patterns that work:

**1. Client-generated stable ID on append.** Add an `id` to the
row and key by it:

```ts
form.append('posts', {
  id: crypto.randomUUID(),
  title: '',
  views: 0,
})
```

```vue
<div v-for="post in posts" :key="post.id">…</div>
```

**2. External counter.** `nextId` ticks per append:

```ts
const nextId = ref(0)
function addPost() {
  form.append('posts', { title: '', views: 0 })
  nextId.value++
}
```

Weaker (remounts reset the counter) but good enough in-session.

For lists that only ever append and never reorder, raw index keys
are OK.

## getValue vs getFieldState

- `getValue('posts.0.title')` → `Readonly<Ref<string>>`. Use for the
  value.
- `getFieldState('posts.0.title')` → `Ref<FieldState>`. Use for
  errors + touched / focused / blurred.

```vue
<template>
  <div v-for="(post, index) in posts" :key="post.id">
    <input v-register="form.register(`posts.${index}.title`)" />
    <span v-if="form.getFieldState(`posts.${index}.title`).value.errors.length > 0" class="error">
      {{ form.getFieldState(`posts.${index}.title`).value.errors[0].message }}
    </span>
  </div>
</template>
```

## Stale state on removal

When you `remove` a row, errors + field records at the removed
path stay in the store until explicitly cleared — the helper can't
know which indices map to which errors after a shift. If the stale
state matters to you:

```ts
form.remove('posts', 2)
form.clearFieldErrors() // or form.resetField('posts') for full clean slate
```

For large rearrangements, `form.resetField('posts')` rebuilds the
subtree cleanly.

## Building arrays in bulk

Building an array by looping `append` is O(N²) — each call copies
the whole array. For a large seed, assign in one shot:

```ts
form.setValue('items', nextArray) // O(N), one assignment
```
