# Discriminated unions with variant memory

When a discriminated-union variant changes, attaform reshapes storage
to the new variant's slim default — the old variant's keys are
purged, the new variant's keys are seeded. By default, switching
back to a previously-visited variant restores its prior typed
subtree (the "memory" — opt-out via `rememberVariants: false`).

## The default behaviour

```ts
import { z } from 'zod'

const schema = z.object({
  notify: z.discriminatedUnion('channel', [
    z.object({ channel: z.literal('email'), address: z.email() }),
    z.object({ channel: z.literal('sms'), phone: z.string() }),
  ]),
})

const form = useForm({ schema, key: 'notify-prefs' })
```

```ts
form.setValue('notify.channel', 'email')
form.setValue('notify.address', 'a@b.com')
// storage: { notify: { channel: 'email', address: 'a@b.com' } }

form.setValue('notify.channel', 'sms')
// storage: { notify: { channel: 'sms', phone: '' } }
//   (email's `address` is purged; sms's `phone` is seeded)

form.setValue('notify.channel', 'email')
// storage: { notify: { channel: 'email', address: 'a@b.com' } }
//   (`address` restored — variant memory)
```

`rememberVariants` defaults to `true`. Switching back to a
previously-visited variant lands on its prior subtree, including
nested fields. Each discriminated union at every nesting depth is
independently memorised.

## Opting out

```ts
useForm({ schema, rememberVariants: false })
```

With `false`, every switch drops the outgoing variant's typed
state. The new variant initialises from its slim default; the
old data is gone.

Use the opt-out when:

- The variants represent unrelated data (a "type" picker over
  contact info should clear the address when switching to phone).
- Memory leaks user input you don't want re-applied (a wizard
  step that should reset when the user backtracks).
- You're running on memory-constrained targets and the snapshots
  add up.

## Caveat: `meta.errors` includes inactive-variant errors

The form-level `form.meta.errors` aggregate is **unfiltered** —
errors for the inactive variant's fields stay in the array. A
"show all" UI iterating `meta.errors` will surface stale errors
for the variant the user left.

The per-leaf `form.errors.<path>` view IS variant-filtered — only
errors on the active variant's path show up. Use it for inline
field feedback:

```vue
<input v-register="form.register('notify.address')" />
<small v-if="form.errors.notify.address?.[0]">
  <!-- only renders when notify.channel === 'email' -->
  {{ form.errors.notify.address[0].message }}
</small>
```

## Caveat: memory is in-memory only

Variant memory does NOT survive a page reload. Persisted state
(`useForm({ persist: 'local' })`) restores values into form storage
on hydration, but the variant memory snapshots start empty — the
first discriminator switch after reload loses any persisted typing
in the outgoing variant.

If you need cross-session continuity of inactive-variant typing,
persist beyond the union boundary yourself (e.g. mirror the
inactive subtree into a separate persisted slot via
`@update:registerValue` on the discriminator).

## `reset()` and `resetField()` interactions

- **`reset()`** — clears all variant memory. The reset state
  becomes the new "no memory" baseline.
- **`resetField(path)`** — clears any memory entry whose union
  path equals or sits under `path`. Resetting a single union's
  path drops only that union's memory; sibling unions retain
  theirs.

## Programmatic switch via `setValue`

The reshape fires for every variant write — `setValue('notify',
{ channel: 'sms', phone: '' })` reshapes the same way as
`setValue('notify.channel', 'sms')`. The structural-completeness
invariant kicks in: missing variant keys get filled from the new
variant's slim default before the callback's `prev` snapshot.

## When the discriminator value itself is invalid

If the user types a discriminator value that doesn't match any
variant (`channel: 'fax'` against `'email' | 'sms'`), the reshape
is skipped — the variant fields stay as they were, and the schema
surfaces a refinement error on the discriminator itself. Your
template's variant-conditional rendering can branch on the
schema's `kind` rather than relying on the runtime to "guess" a
variant.
