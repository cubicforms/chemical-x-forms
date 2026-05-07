# Persistence policy

What gets stored in a persisted draft, how schema changes
invalidate old payloads, and what persistence is — and isn't —
designed for.

## Sparse payloads

The persisted payload contains only opted-in paths:

```ts
// Schema: { email: string, phone: string, cvv: string }
// register('email', { persist: true })
// register('phone', { persist: true })
// register('cvv')                     ← no opt-in

// Persisted payload, written under key attaform:signup:${fingerprint}
{
  v: 4,                                          // attaform-internal envelope version
  data: { form: { email: '…', phone: '…' } }     // no `cvv`
}
```

The `v` field on the envelope is internal to attaform — it tracks the
on-disk format and is bumped only when attaform itself changes the
serialised shape. Consumers don't (and now can't) set it. Drafts
saved against a stale envelope version are dropped with a one-time
dev-warn on read.

The envelope also round-trips the form's `blankPaths` set when
populated, so a numeric field cleared by the user stays visually
empty after reload (storage holds the slim default; the
displayed-empty state survives).

On hydration, opted-in fields restore from storage; non-opted fields
come from schema defaults. The opt-in set can change between mounts
— a previously-persisted path that's no longer opted in stays in
storage until the next write (which won't include it) or an explicit
`form.clearPersistedDraft(path)`.

## Including errors

Default `include: 'form'` persists just the values. Server-side
validation errors on reload are stale by then.

For multi-step wizards where reconstructing errors is expensive,
`include: 'form+errors'` persists and re-hydrates `errors`.

Errors on non-opted-in paths are dropped from the persisted envelope
— a persisted error without a persisted value would dangle on
rehydration.

## Auto-invalidation on schema change

Storage keys carry the schema's structural fingerprint:

```text
attaform:signup:7c3a0b   ← key on disk
                       └────┘
                       fingerprint of the current schema
```

When the schema changes shape — adding / removing / renaming a
field, changing a leaf type, restructuring nested objects — the
fingerprint changes. New writes go to a new key
(`attaform:signup:9d2b1f`); the old key
(`attaform:signup:7c3a0b`) becomes unreachable.

On the next mount, the orphan-cleanup pass enumerates keys under
`attaform:signup` (via `FormStorage.listKeys`), keeps the
current-fingerprint entry, and removes the rest. No manual `version`
bump, no possibility of forgetting it, no draft drops when only
refinement logic changed (refinements collapse to opaque sentinels
in the fingerprint).

Malformed-shape entries (corrupted JSON, attaform-internal envelope-version
mismatch, anything that doesn't match the expected payload contract)
are wiped on read. "Truly absent" entries (the key was never set)
are a no-op — the wipe only fires when there's actually something to
clean.

If you need to force-invalidate a draft without changing the schema
(e.g. shipping an unrelated field-validation tweak that you want
users to retest from scratch), call `form.clearPersistedDraft()` at
mount or wrap the schema in a thin no-op layer that perturbs the
fingerprint. The library deliberately doesn't expose a
"force-version" knob — most consumers don't need it, and the schema
fingerprint already captures every legitimate "shape changed"
signal.

## What persistence is NOT for

- **Sensitive data.** See [Security](/docs/recipes/persistence#security-what-not-to-persist).
- **Authoritative state.** Persistence is for draft UX, not for
  source-of-truth data. The server still owns the canonical record.
- **Cross-form coordination.** Each form persists independently.
  Multiple forms can share a key (and so a FormStore + a persistence
  entry), but they're still one form to the persistence layer.
- **Schema migrations.** Auto-invalidation handles the common case
  (see above). To rename a field without losing state, read the raw
  entry before the schema change ships and massage it into the new
  shape before calling `reset()`. The library deliberately doesn't
  ship a renaming-aware migration helper — renames are a write-once
  transformation the consumer owns.

## See also

- [Persistence walkthrough](/docs/recipes/persistence) — the basics
- [Persistence backends](/docs/recipes/persistence-backends) — picking and configuring storage
- [Persistence edge cases](/docs/recipes/persistence-edge-cases) — imperative APIs, gotchas
