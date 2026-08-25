import { describe, expect, it } from 'vitest'
import { chunkRunWithProfiles, effectiveLegProfile, legProfileFor } from '../utils/routeProfiles'
import type { RouteProfile } from '../types'

type P = { lat: number; lng: number; legProfile?: RouteProfile }

const pt = (lat: number, lng: number, legProfile?: RouteProfile): P => (legProfile ? { lat, lng, legProfile } : { lat, lng })

describe('useRouteCalculation per-segment transport modes', () => {
  it('legProfileFor maps known modes and rejects unknown values', () => {
    expect(legProfileFor('walking')).toBe('walking')
    expect(legProfileFor('driving')).toBe('driving')
    expect(legProfileFor('cycling')).toBe('cycling')
    expect(legProfileFor('transit')).toBe('transit')
    expect(legProfileFor(null)).toBeNull()
    expect(legProfileFor(undefined)).toBeNull()
    expect(legProfileFor('flight')).toBeNull()
  })

  it('effectiveLegProfile falls back to the trip-wide profile', () => {
    expect(effectiveLegProfile({ lat: 1, lng: 2 }, 'driving')).toBe('driving')
    expect(effectiveLegProfile({ lat: 1, lng: 2, legProfile: 'walking' }, 'driving')).toBe('walking')
  })

  it('keeps a single-mode run as one chunk', () => {
    const a = pt(0, 0)
    const b = pt(1, 1, 'walking')
    const c = pt(2, 2, 'walking')
    expect(chunkRunWithProfiles([a, b, c], 'driving')).toEqual([
      { points: [a, b, c], profile: 'walking' },
    ])
  })

  it('splits a mixed run at mode changes', () => {
    // Drive out of the city (trip-wide), walk between two stops, drive again,
    // then a final transit leg back to the trip-wide profile.
    const a = pt(0, 0)
    const b = pt(1, 1, 'walking')
    const c = pt(2, 2, 'walking')
    const d = pt(3, 3, 'driving')
    const e = pt(4, 4)
    expect(chunkRunWithProfiles([a, b, c, d, e], 'transit')).toEqual([
      { points: [a, b, c], profile: 'walking' },
      { points: [c, d], profile: 'driving' },
      { points: [d, e], profile: 'transit' },
    ])
  })

  it('splits when only the last stop overrides the mode', () => {
    const a = pt(0, 0)
    const b = pt(1, 1)
    const c = pt(2, 2, 'walking')
    expect(chunkRunWithProfiles([a, b, c], 'driving')).toEqual([
      { points: [a, b], profile: 'driving' },
      { points: [b, c], profile: 'walking' },
    ])
  })

  it('returns no chunks for degenerate runs', () => {
    expect(chunkRunWithProfiles([], 'driving')).toEqual([])
    expect(chunkRunWithProfiles([pt(0, 0)], 'driving')).toEqual([])
  })
})
