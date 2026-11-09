import { describe, expect, it } from 'vitest'
import { isVisibleTo } from './modpackVisibility'
import type { Modpack } from '../../../shared/modpack'

const listed: Modpack = { id: 'pack', name: 'Pack', accentColor: null, isPublic: true, enabled: true }

// The rule JUGAR re-checks: a modpack the list would not show must not launch either.
describe('isVisibleTo', () => {
  it('lists a public, enabled modpack open to everyone', () => {
    expect(isVisibleTo(listed, 'Steve')).toBe(true)
    expect(isVisibleTo({ ...listed, usersAllowed: [] }, null)).toBe(true)
  })

  it('hides a modpack that is not both public and enabled', () => {
    expect(isVisibleTo({ ...listed, isPublic: false }, 'Steve')).toBe(false)
    expect(isVisibleTo({ ...listed, enabled: false }, 'Steve')).toBe(false)
    // A flag missing or of the wrong type is dropped by `toModpack`, as the query ignores it.
    expect(isVisibleTo({ id: 'pack', name: 'Pack', accentColor: null }, 'Steve')).toBe(false)
  })

  it('shows a restricted modpack only to the usernames it names', () => {
    const restricted = { ...listed, usersAllowed: ['Steve'] }
    expect(isVisibleTo(restricted, 'Steve')).toBe(true)
    expect(isVisibleTo(restricted, 'Alex')).toBe(false)
    expect(isVisibleTo(restricted, null)).toBe(false)
  })
})
