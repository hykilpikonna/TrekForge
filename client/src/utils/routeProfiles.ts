import type { RouteProfile } from '../types'

export type ProfilePoint = { lat: number; lng: number; label?: string | null; legProfile?: RouteProfile }

const LEG_PROFILES: readonly RouteProfile[] = ['driving', 'walking', 'cycling', 'transit']

/** A stop's stored mode as a routable profile, or null when absent/unknown (fall back to the trip-wide profile). */
export function legProfileFor(mode: string | null | undefined): RouteProfile | null {
  return mode && (LEG_PROFILES as readonly string[]).includes(mode) ? (mode as RouteProfile) : null
}

/** Profile of the leg arriving at `pt`: its own override, else the trip-wide one. */
export function effectiveLegProfile(pt: ProfilePoint, base: RouteProfile): RouteProfile {
  return pt.legProfile ?? base
}

/**
 * Split a waypoint run into chunks whose legs share one routing profile, so a
 * mixed day (drive out of the city, walk inside it) gets one provider call per
 * mode instead of forcing the whole run through a single profile.
 */
export function chunkRunWithProfiles<T extends ProfilePoint>(run: T[], base: RouteProfile): Array<{ points: T[]; profile: RouteProfile }> {
  if (run.length < 2) return []
  const chunks: Array<{ points: T[]; profile: RouteProfile }> = []
  let current: T[] = [run[0]]
  let currentProfile = effectiveLegProfile(run[1], base)
  for (let i = 1; i < run.length; i++) {
    const legProfile = effectiveLegProfile(run[i], base)
    if (i > 1 && legProfile !== currentProfile) {
      chunks.push({ points: current, profile: currentProfile })
      current = [run[i - 1]]
      currentProfile = legProfile
    }
    current.push(run[i])
  }
  chunks.push({ points: current, profile: currentProfile })
  return chunks.filter(c => c.points.length >= 2)
}
