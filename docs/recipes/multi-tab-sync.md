---
title: 'Multi-tab sync'
description: 'Same-keyed forms in same-origin tabs auto-pair via BroadcastChannel — every keystroke mirrors across tabs in near real-time, with sensitive paths filtered both directions and HTTPS-or-localhost required.'
---

# Multi-tab sync

A user with multiple open tabs of the same keyed form gets one
logical form across all of them. Type in tab A → tab B converges
on the next microtask. No reload, no manual subscription, no
persistence required.

```ts
useForm({ schema, key: 'signup' })
```

That's the whole opt-in. Anywhere `key:` is set and the runtime
is in a secure context, same-keyed `useForm` callsites in
same-origin tabs auto-pair over a `BroadcastChannel` and mirror
every mutation.

## What it closes

The user-impact footgun without sync: a user submits in tab A
while tab B holds stale state. Tab B looks live (no error), so
subsequent edits there race against and overwrite the
just-submitted truth. The data-loss mode is invisible to the
user.

With sync on, every same-keyed tab converges in near real-time.
Tab B sees tab A's submit (the cleared form), so further edits
there start from a known baseline.

## What syncs

| Surface                 | Sync model                                                          |
| ----------------------- | ------------------------------------------------------------------- |
| `form.values`           | Per-mutation `Patch[]` (live); full snapshot on join.               |
| `blankPaths` set        | Per-mutation added/removed; snapshot on join.                       |
| `errors`                | NOT synced — locally re-derived from value via validation.          |
| Field interaction state | NOT synced — `touched`/`focused`/`blurred` are UI-state, tab-local. |
| Submit lifecycle        | NOT synced — `submitCount` / `submitError` are per-callsite.        |
| `instanceId`            | NOT synced — per-mount identity by definition.                      |
| History chain           | NOT synced — each tab's undo timeline walks its own user's intent.  |

Errors aren't broadcast because they'd carry sensitive context
("invalid SSN: 123-45-6789"). Each tab re-runs its own validation
against the synced value — one source of truth, zero leaks.

## Conflict semantics

Last-writer-wins. Two tabs typing into the same field at the
same instant produce convergent state on whichever message
arrives later. For form fields (mostly short scalars), the cost
of an occasional clobbered character is far less than the cost
of invisible divergence.

There's no focus-skip rule — the field a user is currently in
WILL accept remote writes mid-typing. If you need stricter
semantics for a particular field, opt it out per-register:

```vue
<input v-register="register('notes', { multiTab: false })" />
```

The opted-out field stays tab-local — broadcasts neither out
nor in for that path, even when the rest of the form syncs.

## Disabling sync

Three levels of opt-out. The cascade goes (most specific wins):

```
register(path, { multiTab: false })   ◀── single field tab-local
useForm({ multiTab: false })          ◀── whole form tab-isolated
createAttaform({ defaults: { multiTab: false } })  ◀── app-wide
```

The cascade is downgrade-only. `multiTab: false` at any level
prevents the broadcaster from instantiating; `multiTab: true` at
a more specific level can NOT bring it back if a broader scope
already disabled it.

## Pairing with `persist:`

Sync and persistence are independent — both, either, or neither.

- **Sync only**: live cross-tab convergence; no durable
  baseline. Reloading the tab loses the in-memory state and
  fresh-joins via handshake to any other live tab.
- **Persist only**: durable baseline; tabs don't see each
  other's mid-edit state.
- **Both**: sync drives live convergence; persist drives
  warm-start. Persistence hydration is the floor — when a
  BroadcastChannel snapshot arrives on a fresh mount, it
  overrides the disk-persisted baseline.

```ts
useForm({
  schema,
  key: 'signup',
  persist: 'local', // warm-start
  // multiTab implicit-true → live cross-tab convergence
})
```

## Security

This section is required reading for production deployments,
particularly regulated-data contexts (PII, PHI, FedRAMP, HIPAA).

### Secure-context requirement (HTTPS or localhost)

The module activates only when `window.isSecureContext === true`,
which the browser defines as HTTPS in production OR localhost in
development (covers `localhost`, `127.0.0.1`, `[::1]`,
`*.localhost`). Plain HTTP on a real hostname silently noops with
a one-shot dev warning.

Same gate browsers apply to other sensitive APIs (clipboard,
geolocation, push, web crypto subtle) — no new mental model.

**Production deployments must be served over HTTPS for sync to
function.** If sync isn't working in prod, check the protocol
first. The same gate fires for built-in persistence storage
adapters — see [Persistence — Security](./persistence#security-what-not-to-persist).

### Data-flow audit

What crosses tab boundaries:

- Form values (typed input, programmatic writes, `reset()`,
  array helpers).
- The `blankPaths` set (so cleared-but-defaulted numeric fields
  stay empty across tabs).

What stays tab-local:

- Errors (re-derived locally on the receiver).
- Field interaction state (`touched`, `focused`, `blurred`).
- Submit lifecycle (`submitCount`, `submitError`, in-flight
  promise).
- The history chain (undo/redo).
- Anything at a path matching `sensitiveNames` (stripped
  outbound AND rejected inbound).
- Anything at a path marked `register('x', { multiTab: false })`
  (symmetric tab-local).

### Threat model

`BroadcastChannel` is **same-origin only** — browser-enforced.
Cross-origin tabs / iframes / windows cannot subscribe. Messages
are transient (not persisted) — no replay-across-reload surface.

What sync expands vs. status quo:

- **XSS amplification.** An XSS bug in any tab can passively
  eavesdrop on or actively inject into every same-origin tab
  running the same keyed form. Same-origin trust is binary;
  this is irreducible at the library layer.
- **Third-party scripts on the same origin** (analytics,
  embedded widgets, ad SDKs) can subscribe to channels.
- **PII / PHI exposure** widens — previously gated behind a
  persistence opt-in, now flows by default for any keyed form.

### Defenses

Built into v1, not optional:

- **Sensitive-path filtering — outbound AND inbound.** Paths
  matching the resolved `sensitiveNames` list are stripped
  before posting AND rejected on receive. Defense in depth —
  the wire is never trusted, even when the originating tab
  "should have" stripped them. The same list gates persistence
  and the DevTools redact walk; extend per-form or globally:

  ```ts
  createAttaform({
    defaults: { sensitiveNames: [...DEFAULT_SENSITIVE_NAMES, 'mrn'] },
  })
  ```

- **Prototype-pollution defense.** Inbound patches with
  `__proto__` / `constructor` / `prototype` segments in their
  path are rejected before `applyPatchesForward` touches the
  form.

- **Echo drop via per-module `senderId`.** Every outbound
  message carries a per-`useForm` UUID; receivers drop messages
  whose `senderId` matches their own. Defends intra-tab self-
  loops (two `useForm({ key })` instances in one page) and any
  UA echo behaviour.

- **Protocol versioning.** Every message carries `v: 1`;
  unknown versions are dropped silently. Lets the wire format
  evolve across rolling deploys without silently corrupting
  older tabs.

- **No errors / submit lifecycle on the wire.** An error
  message can contain sensitive context ("invalid SSN: 123-45-
  6789"). Validation runs locally on the receiver; error maps
  are not synced.

- **Post-apply schema validate + rollback.** When the pre-apply
  form is valid, the post-apply candidate is schema-validated
  too; rollback on throw. Catches cross-field refinement
  violations a hostile sender could craft.

> **On XSS-style HTML sanitization**: deliberately NOT applied.
> Form values are data, not markup. Sanitization would mangle
> legit strings like `"O'Brien"` or `"2 < 3 = true"`. Same-
> origin trust is binary; an attacker with XSS already controls
> equivalent surfaces (cookies, localStorage, postMessage). The
> defenses above are strictly stronger (schema-driven,
> lossless).

### Plaintext on the wire

Persistence layers that wrap a custom storage adapter with
encryption (`persist: { storage: encryptedAdapter }`) still
ship plaintext over the BroadcastChannel. Encrypted-at-rest
expectations are **not** preserved across the channel. Forms
with that expectation should set `multiTab: false`.

### Recommended posture (regulated data)

For PII / PHI / FedRAMP / HIPAA contexts:

- **`multiTab: false` per-form** for any form holding regulated
  data. Tab-isolation is the conservative posture.
- **Extend `sensitiveNames`** with your compliance-specific
  field names (`mrn`, `tax_id`, etc.). The same list gates
  persistence AND sync AND DevTools.
- **Strict CSP** (`script-src 'self'` minimum). Reduces the
  same-origin attacker surface to scripts you control.
- **HTTPS only** in production. The library noops sync on
  plain HTTP — make it loud (audit logs, deployment gates) if
  any environment serves the app over HTTP.

### Iframe behavior

Same-origin iframes embedded on the page share the channel —
they receive broadcasts from the parent's keyed form. This is
by design; iframe-embedded forms commonly want the same
identity as the parent. For isolation, use cross-origin
iframes (browser-enforced channel isolation) or pass
`multiTab: false` to the iframe's `useForm`.

## How it works (mechanism)

The channel name derives from `form.key` + the schema's
structural fingerprint:

```
attaform:sync:${formKey}:${hashStableString(schema.fingerprint())}
```

Same `key` + same schema → same channel name → tabs auto-pair.
Different schemas at the same key would collide otherwise, so
the fingerprint disambiguates.

**Mount-time handshake (leader-election):**

1. Joining tab posts `{ kind: 'hello', senderId }`.
2. Established tabs respond `{ kind: 'announce', senderId }`
   (UUID only — cheap).
3. Joining tab collects announces for ~50ms, sorts the roster,
   picks lowest `senderId` as leader.
4. Joining tab posts `{ kind: 'requestSnapshot', targetId:
leader }`. Only the leader responds with a full snapshot.

Bandwidth on an N-tab join is N tiny announces + 1 snapshot,
regardless of N — vs the naive "everyone responds with a
snapshot" which would be O(N) full snapshots.

If no announces arrive (solo tab), the joining tab transitions
to established and proceeds with hydrated / default state.

If the elected leader doesn't reply within ~200ms, the joining
tab retries with the next-lowest `senderId`. Three attempts max
before falling back to solo.

**Steady state:** every local mutation diffs against a per-
module prior snapshot and posts `{ kind: 'patches', formPatches,
blankPathsAdded, blankPathsRemoved }`. Receivers apply via
`applyPatchesForward` + `state.applyFormReplacement(form, {
crossTab: true, persist: false })`.

The `crossTab: true` meta flag signals to:

- The outbound broadcaster: skip (this write came FROM a
  sibling).
- The history module: update the diff anchor but don't push a
  delta (remote writes aren't part of the local user's undo
  timeline).
- The persistence writer: skip (the originating tab already
  persisted to its own storage; double-write is wasteful).
