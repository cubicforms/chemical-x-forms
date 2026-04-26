// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import {
  createPersistOptInRegistry,
  getOrAssignElementId,
} from '../../src/runtime/core/persistence/opt-in-registry'
import type { PathKey } from '../../src/runtime/core/paths'

const path = (s: string): PathKey => s as PathKey

describe('createPersistOptInRegistry', () => {
  it('starts empty', () => {
    const r = createPersistOptInRegistry()
    expect(r.isEmpty()).toBe(true)
    expect([...r.optedInPaths()]).toEqual([])
    expect(r.hasAnyOptInForPath(path('email'))).toBe(false)
    expect(r.hasOptIn('el-1', path('email'))).toBe(false)
  })

  it('add() is idempotent for the same (id, path)', () => {
    const r = createPersistOptInRegistry()
    r.add('el-1', path('email'))
    r.add('el-1', path('email'))
    r.add('el-1', path('email'))
    expect(r.hasOptIn('el-1', path('email'))).toBe(true)
    expect([...r.optedInPaths()]).toEqual(['email'])
  })

  it('tracks multiple elements opting into the same path', () => {
    // Same form, two inputs bound to the same path, both opted in.
    // Both must register independently; remove of one leaves the other.
    const r = createPersistOptInRegistry()
    r.add('el-1', path('email'))
    r.add('el-2', path('email'))
    expect(r.hasOptIn('el-1', path('email'))).toBe(true)
    expect(r.hasOptIn('el-2', path('email'))).toBe(true)
    expect(r.hasAnyOptInForPath(path('email'))).toBe(true)

    r.remove('el-1', path('email'))
    expect(r.hasOptIn('el-1', path('email'))).toBe(false)
    expect(r.hasOptIn('el-2', path('email'))).toBe(true)
    expect(r.hasAnyOptInForPath(path('email'))).toBe(true)
  })

  it('removes path entry when last element opts out', () => {
    // hasAnyOptInForPath flips false the moment the last opt-in for a
    // path leaves; persistence layer relies on this to wipe storage
    // when no fields remain opted in.
    const r = createPersistOptInRegistry()
    r.add('el-1', path('email'))
    r.remove('el-1', path('email'))
    expect(r.hasAnyOptInForPath(path('email'))).toBe(false)
    expect([...r.optedInPaths()]).toEqual([])
    expect(r.isEmpty()).toBe(true)
  })

  it('remove on a non-existent (id, path) is a no-op', () => {
    const r = createPersistOptInRegistry()
    r.remove('el-99', path('never-added'))
    expect(r.isEmpty()).toBe(true)
  })

  it('removeAllFor(elementId) drops every opt-in held by that element', () => {
    // Mirrors the directive's beforeUnmount path — when an element
    // unmounts, every path it ever opted into goes with it. Other
    // elements' opt-ins on the same paths must survive.
    const r = createPersistOptInRegistry()
    r.add('el-1', path('email'))
    r.add('el-1', path('profile.name'))
    r.add('el-1', path('contacts.0.phone'))
    r.add('el-2', path('email'))

    r.removeAllFor('el-1')

    expect(r.hasOptIn('el-1', path('email'))).toBe(false)
    expect(r.hasOptIn('el-1', path('profile.name'))).toBe(false)
    expect(r.hasOptIn('el-1', path('contacts.0.phone'))).toBe(false)
    // el-2's email opt-in survived
    expect(r.hasOptIn('el-2', path('email'))).toBe(true)
    expect(r.hasAnyOptInForPath(path('email'))).toBe(true)
    // path entries for the now-emptied paths are gone
    expect(r.hasAnyOptInForPath(path('profile.name'))).toBe(false)
    expect(r.hasAnyOptInForPath(path('contacts.0.phone'))).toBe(false)
    expect([...r.optedInPaths()].sort()).toEqual(['email'])
  })

  it('clear() wipes everything', () => {
    const r = createPersistOptInRegistry()
    r.add('el-1', path('email'))
    r.add('el-2', path('password'))
    r.clear()
    expect(r.isEmpty()).toBe(true)
    expect(r.hasAnyOptInForPath(path('email'))).toBe(false)
    expect(r.hasAnyOptInForPath(path('password'))).toBe(false)
  })
})

describe('getOrAssignElementId', () => {
  it('returns a stable id for the same element across repeated calls', () => {
    const el = document.createElement('input')
    const id1 = getOrAssignElementId(el)
    const id2 = getOrAssignElementId(el)
    expect(id1).toBe(id2)
  })

  it('issues distinct ids for distinct elements', () => {
    // Element identity drives the per-element opt-in semantic — two
    // inputs at the same path must NOT share an id, otherwise an
    // opt-in on one would leak persistence onto writes from the other.
    const a = document.createElement('input')
    const b = document.createElement('input')
    const c = document.createElement('input')
    const ids = new Set([getOrAssignElementId(a), getOrAssignElementId(b), getOrAssignElementId(c)])
    expect(ids.size).toBe(3)
  })

  it('id format matches the documented "el-<n>" shape', () => {
    const el = document.createElement('input')
    expect(getOrAssignElementId(el)).toMatch(/^el-\d+$/)
  })
})
