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

- `getValue('posts.0.title')` → `Readonly<Ref<string | undefined>>`.
  Reads carry `| undefined` once a path crosses an array index — at
  runtime, `posts[0]` could be missing (sparse, deleted, fresh-mount
  empty). Narrow with `?.` / optional checks before non-null
  operations. Tuple positions stay strict (their length is static).
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

The directive's `v-register` binding handles `undefined` correctly
(renders empty), so most templates don't need defensive narrowing.
Defensive narrowing matters when scripts read the value:

```ts
const title = form.getValue('posts.0.title')
// title.value is `string | undefined`.
const upper = title.value?.toUpperCase() ?? ''
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

`setValue` types lead with the full element shape — pass elements
matching the schema's element type. If you have partial elements
from a server payload (some keys missing), the runtime
mergeStructural fills missing keys from the schema's element
default, so the bulk assignment still produces a structurally
complete array. The type system points the IDE at the canonical
"give me the whole shape" pattern at the call site; the runtime
backstop catches dynamic / server-shaped inputs.

## Sparse-index writes auto-pad

`setValue('posts.21', { ... })` against an empty `posts` array
fills indices `0..20` with the schema's element default before
writing index `21`. The structural-completeness invariant means
the array is never sparse on disk — every index `< length` is a
fully-shaped element matching the schema:

```ts
const form = useForm({
  schema: z.object({ posts: z.array(z.object({ title: z.string() })) }),
  key: 'blog',
})

// posts is initially []
form.setValue('posts.5.title', 'sixth post')
// posts.length === 6
// posts[0..4] are { title: '' } (the schema's element default)
// posts[5] is { title: 'sixth post' }
```

This makes `posts.length` honest and lets `v-for` over `posts`
render N rows without filtering for `undefined`. Most consumers
never write sparse indices intentionally — the invariant just
means the framework no longer has to guess what to do when one
slips through.
