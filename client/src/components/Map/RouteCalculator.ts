import { useSettingsStore } from '../../store/settingsStore'
import type { DistanceUnit, RouteAlternative, RouteResult, RouteSegment, RouteStep, RouteTransitStop, RouteWithLegs, Waypoint, RouteAnchors } from '../../types'
import { formatDistance } from '../../utils/units'
import { apiClient } from '../../api/client'

const OSRM_BASE = 'https://router.project-osrm.org/route/v1'

// FOSSGIS hosts OSRM with real per-profile routing (car/foot/bike) — the
// project-osrm.org demo is car-only (it ignores the profile in the URL). Use
// the matching profile so walking routes follow footpaths, not the road network.
export type RouteProfile = 'driving' | 'walking' | 'cycling' | 'transit'
type OsrmRouteProfile = Exclude<RouteProfile, 'transit'>

const OSRM_PROFILE_BASE: Record<OsrmRouteProfile, string> = {
  driving: 'https://routing.openstreetmap.de/routed-car/route/v1/driving',
  walking: 'https://routing.openstreetmap.de/routed-foot/route/v1/foot',
  cycling: 'https://routing.openstreetmap.de/routed-bike/route/v1/bike',
}

// Cache route responses keyed by the exact waypoint list. Routes are stable, so
// this avoids re-hitting the public OSRM demo server on every day switch / reorder.
const routeCache = new Map<string, RouteWithLegs>()
const ROUTE_CACHE_MAX = 200
const ROUTE_CACHE_STORAGE_KEY = 'trek:route-cache:v1'
const ROUTE_CACHE_VERSION = 18
const ROUTE_CACHE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000
const ROUTE_CHOICE_STORAGE_KEY = 'trek:route-alternative-choices:v1'
const ROUTE_CHOICE_VERSION = 1
export const ROUTE_ALTERNATIVE_CHOICE_EVENT = 'trek:route-alternative-choice'
export type RoutingProvider = 'osrm' | 'google_maps' | 'google_maps_mobile'

export interface GoogleRoutingOptions {
  avoidTolls?: boolean
  avoidHighways?: boolean
  avoidFerries?: boolean
}

interface GoogleDirectionsDuration {
  seconds: number | null
  text: string | null
}

interface GoogleDirectionsFare {
  amount?: number | null
  text?: string | null
  currency?: string | null
}

interface GoogleDirectionsTime {
  epochSeconds?: number | null
  text?: string | null
  roundedEpochSeconds?: number | null
}

interface GoogleDirectionsStep {
  instructionText?: string | null
  distance?: { meters: number | null; text: string | null }
  duration?: GoogleDirectionsDuration
}

interface GoogleDirectionsTransitStop {
  name: string
  platform?: string | null
  lat?: number | null
  lng?: number | null
  arrivalTime?: GoogleDirectionsTime | null
  departureTime?: GoogleDirectionsTime | null
}

interface GoogleDirectionsTransitDetails {
  lineName?: string | null
  serviceName?: string | null
  serviceShortName?: string | null
  headsign?: string | null
  vehicleType?: string | null
  color?: string | null
  textColor?: string | null
  stopCount?: number | null
  agencies?: Array<{ name?: string | null }> | null
  departureStop?: GoogleDirectionsTransitStop | null
  arrivalStop?: GoogleDirectionsTransitStop | null
  intermediateStops?: GoogleDirectionsTransitStop[]
}

interface GoogleDirectionsLeg {
  distance?: { meters: number | null; text: string | null }
  duration?: GoogleDirectionsDuration
  fare?: GoogleDirectionsFare | null
  departureTime?: GoogleDirectionsTime | null
  arrivalTime?: GoogleDirectionsTime | null
  transit?: GoogleDirectionsTransitDetails | null
  steps?: GoogleDirectionsStep[]
}

interface GoogleDirectionsRoute {
  index?: number
  distance?: { meters: number | null; text: string | null }
  duration?: GoogleDirectionsDuration
  fare?: GoogleDirectionsFare | null
  traffic?: {
    duration?: GoogleDirectionsDuration | null
    range?: { minSeconds: number | null; maxSeconds: number | null; text: string | null } | null
  } | null
  departureTime?: GoogleDirectionsTime | null
  arrivalTime?: GoogleDirectionsTime | null
  overviewGeometry?: Array<{ lat: number; lng: number }>
  legs?: GoogleDirectionsLeg[]
}

interface GoogleDirectionsResponse {
  routes?: GoogleDirectionsRoute[]
}

interface GoogleMobileDirectionsDuration {
  seconds: number | null
  text: string | null
}

interface GoogleMobileDirectionsMoney {
  amount: number | null
  text: string | null
  currency: string | null
  label: string | null
}

interface GoogleMobileDirectionsStep {
  instruction?: string | null
  maneuver?: string | null
  distance?: { meters: number | null; text: string | null }
  duration?: GoogleMobileDirectionsDuration | null
}

interface GoogleMobileDirectionsRoute {
  distance?: { meters: number | null; text: string | null }
  duration?: GoogleMobileDirectionsDuration
  trafficPrediction?: {
    optimistic?: GoogleMobileDirectionsDuration | null
    pessimistic?: GoogleMobileDirectionsDuration | null
    text?: string | null
  } | null
  tollFee?: GoogleMobileDirectionsMoney | null
  overviewGeometry?: Array<{ lat: number; lng: number }>
  steps?: GoogleMobileDirectionsStep[]
}

interface GoogleMobileDirectionsResponse {
  routes?: GoogleMobileDirectionsRoute[]
  optimisticDuration?: GoogleMobileDirectionsDuration | null
  pessimisticDuration?: GoogleMobileDirectionsDuration | null
}

interface StoredRouteCacheEntry {
  key: string
  savedAt: number
  route: RouteWithLegs
}

interface StoredRouteCache {
  version: number
  entries: StoredRouteCacheEntry[]
}

interface StoredRouteChoices {
  version: number
  choices: Record<string, number>
}

function getStorage(): Storage | null {
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage
  } catch {
    return null
  }
}

function readStoredRouteCache(): StoredRouteCacheEntry[] {
  const storage = getStorage()
  if (!storage) return []
  try {
    const raw = storage.getItem(ROUTE_CACHE_STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as StoredRouteCache
    if (parsed?.version !== ROUTE_CACHE_VERSION || !Array.isArray(parsed.entries)) return []
    const cutoff = Date.now() - ROUTE_CACHE_MAX_AGE_MS
    return parsed.entries
      .filter(entry => entry && typeof entry.key === 'string' && entry.savedAt >= cutoff && entry.route)
      .slice(-ROUTE_CACHE_MAX)
  } catch {
    return []
  }
}

function writeStoredRouteCache(entries: StoredRouteCacheEntry[]): void {
  const storage = getStorage()
  if (!storage) return
  try {
    storage.setItem(ROUTE_CACHE_STORAGE_KEY, JSON.stringify({
      version: ROUTE_CACHE_VERSION,
      entries: entries.slice(-ROUTE_CACHE_MAX),
    }))
  } catch {
    // Storage can be unavailable or full; the in-memory cache still works.
  }
}

function getPersistedRoute(cacheKey: string): RouteWithLegs | null {
  const entries = readStoredRouteCache()
  const entry = entries.find(e => e.key === cacheKey)
  if (!entry) return null
  routeCache.set(cacheKey, entry.route)
  return entry.route
}

function setCachedRoute(cacheKey: string, route: RouteWithLegs): void {
  routeCache.set(cacheKey, route)
  if (routeCache.size > ROUTE_CACHE_MAX) {
    const oldest = routeCache.keys().next().value
    if (oldest !== undefined) routeCache.delete(oldest)
  }

  const entries = readStoredRouteCache().filter(e => e.key !== cacheKey)
  entries.push({ key: cacheKey, savedAt: Date.now(), route })
  writeStoredRouteCache(entries)
}

function readStoredRouteChoices(): Record<string, number> {
  const storage = getStorage()
  if (!storage) return {}
  try {
    const raw = storage.getItem(ROUTE_CHOICE_STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as StoredRouteChoices
    if (parsed?.version !== ROUTE_CHOICE_VERSION || !parsed.choices || typeof parsed.choices !== 'object') return {}
    return parsed.choices
  } catch {
    return {}
  }
}

function writeStoredRouteChoices(choices: Record<string, number>): void {
  const storage = getStorage()
  if (!storage) return
  try {
    storage.setItem(ROUTE_CHOICE_STORAGE_KEY, JSON.stringify({ version: ROUTE_CHOICE_VERSION, choices }))
  } catch {
    // Storage can be unavailable or full; route selection still works for the current render.
  }
}

function getRouteAlternativeChoice(choiceKey: string | undefined, alternativesCount: number): number | null {
  if (!choiceKey || alternativesCount <= 0) return null
  const value = readStoredRouteChoices()[choiceKey]
  return Number.isInteger(value) && value >= 0 && value < alternativesCount ? value : null
}

export function setRouteAlternativeChoice(choiceKey: string, index: number): void {
  if (!choiceKey || !Number.isInteger(index) || index < 0) return
  const choices = readStoredRouteChoices()
  choices[choiceKey] = index
  writeStoredRouteChoices(choices)
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(ROUTE_ALTERNATIVE_CHOICE_EVENT, { detail: { choiceKey, index } }))
  }
}

export function __clearRouteCacheForTests(): void {
  routeCache.clear()
}

/** Fetches a full route via OSRM and returns coordinates, distance, and duration estimates for driving/walking. */
export async function calculateRoute(
  waypoints: Waypoint[],
  profile: 'driving' | 'walking' | 'cycling' = 'driving',
  { signal }: { signal?: AbortSignal } = {}
): Promise<RouteResult> {
  if (!waypoints || waypoints.length < 2) {
    throw new Error('At least 2 waypoints required')
  }

  const coords = waypoints.map((p) => `${p.lng},${p.lat}`).join(';')
  const url = `${OSRM_BASE}/${profile}/${coords}?overview=full&geometries=geojson&steps=false`

  const response = await fetch(url, { signal })
  if (!response.ok) {
    throw new Error('Route could not be calculated')
  }

  const data = await response.json()

  if (data.code !== 'Ok' || !data.routes || data.routes.length === 0) {
    throw new Error('No route found')
  }

  const route = data.routes[0]
  const coordinates: [number, number][] = route.geometry.coordinates.map(([lng, lat]: [number, number]) => [lat, lng])

  const distance: number = route.distance
  let duration: number
  if (profile === 'walking') {
    duration = distance / (5000 / 3600)
  } else if (profile === 'cycling') {
    duration = distance / (15000 / 3600)
  } else {
    duration = route.duration
  }

  const walkingDuration = distance / (5000 / 3600)
  const drivingDuration: number = route.duration

  return {
    coordinates,
    distance,
    duration,
    distanceText: formatRouteDistance(distance),
    durationText: formatDuration(duration),
    walkingText: formatDuration(walkingDuration),
    drivingText: formatDuration(drivingDuration),
  }
}

/**
 * Prepends a hotel→first-waypoint run and appends a last-waypoint→hotel run to the
 * day's activity runs, so the drawn route starts and ends at the day's accommodation
 * (matching the sidebar's hotel connectors). A bookend is only added when both its
 * hotel and the first/last located waypoint exist; passing nulls leaves `runs`
 * untouched. The shared first/last waypoint is repeated so the polylines join.
 */
export function withHotelBookends(
  runs: Waypoint[][],
  firstWay: Waypoint | undefined,
  lastWay: Waypoint | undefined,
  startHotel: Waypoint | null,
  endHotel: Waypoint | null,
): Waypoint[][] {
  const out: Waypoint[][] = []
  if (startHotel && firstWay) out.push([startHotel, firstWay])
  out.push(...runs)
  if (endHotel && lastWay) out.push([lastWay, endHotel])
  return out
}

export function generateGoogleMapsUrl(places: Waypoint[]): string | null {
  const valid = places.filter((p) => p.lat && p.lng)
  if (valid.length === 0) return null
  if (valid.length === 1) {
    return `https://www.google.com/maps/search/?api=1&query=${valid[0].lat},${valid[0].lng}`
  }
  const stops = valid.map((p) => `${p.lat},${p.lng}`).join('/')
  return `https://www.google.com/maps/dir/${stops}`
}

// Squared planar distance — enough for nearest-neighbor comparisons and cheaper than a full haversine.
function sqDist(a: Waypoint, b: Waypoint): number {
  return (a.lat - b.lat) ** 2 + (a.lng - b.lng) ** 2
}

// Length of visiting `order` in sequence, optionally pinned to a fixed start and/or end anchor.
// With start === end this is a closed loop back to the anchor (a day out from and back to the hotel).
function tourLength(order: Waypoint[], start?: Waypoint, end?: Waypoint): number {
  if (order.length === 0) return 0
  let total = 0
  if (start) total += Math.sqrt(sqDist(start, order[0]))
  for (let i = 0; i < order.length - 1; i++) total += Math.sqrt(sqDist(order[i], order[i + 1]))
  if (end) total += Math.sqrt(sqDist(order[order.length - 1], end))
  return total
}

// Greedy nearest-neighbor ordering, seeded at the start anchor when there is one.
function nearestNeighborOrder<T extends Waypoint>(valid: T[], start?: Waypoint): T[] {
  const visited = new Set<number>()
  const result: T[] = []
  let current: Waypoint
  if (start) {
    current = start
  } else {
    current = valid[0]
    visited.add(0)
    result.push(valid[0])
  }
  while (result.length < valid.length) {
    let nearestIdx = -1
    let minDist = Infinity
    for (let i = 0; i < valid.length; i++) {
      if (visited.has(i)) continue
      const d = sqDist(valid[i], current)
      if (d < minDist) { minDist = d; nearestIdx = i }
    }
    if (nearestIdx === -1) break
    visited.add(nearestIdx)
    current = valid[nearestIdx]
    result.push(valid[nearestIdx])
  }
  return result
}

// 2-opt: repeatedly reverse a sub-segment whenever it shortens the tour. This removes the crossings
// a pure nearest-neighbor pass leaves behind. The start/end anchors stay fixed, so a round trip
// (start === end) is untangled into a clean loop rather than an open path.
function twoOptImprove<T extends Waypoint>(order: T[], start?: Waypoint, end?: Waypoint): T[] {
  if (order.length < 3) return order
  let best = order
  let bestLen = tourLength(best, start, end)
  let improved = true
  while (improved) {
    improved = false
    for (let i = 0; i < best.length - 1; i++) {
      for (let j = i + 1; j < best.length; j++) {
        const candidate = best.slice(0, i).concat(best.slice(i, j + 1).reverse(), best.slice(j + 1))
        const len = tourLength(candidate, start, end)
        if (len < bestLen - 1e-12) {
          best = candidate
          bestLen = len
          improved = true
        }
      }
    }
  }
  return best
}

/**
 * Reorders waypoints to minimize travel distance: a nearest-neighbor pass for a good starting order,
 * then 2-opt to untangle crossings. Optional anchors (e.g. the day's accommodation) pin the route's
 * ends — start === end makes it a loop out from and back to the hotel; a transfer day runs start → end.
 */
export function optimizeRoute<T extends Waypoint>(places: T[], anchors: RouteAnchors = {}): T[] {
  const { start, end } = anchors
  const valid = places.filter((p) => p.lat && p.lng)
  if (valid.length <= 1) return places
  // Two unanchored stops have no meaningful order to optimize; anchors can still flip them.
  if (valid.length === 2 && !start && !end) return places

  const order = twoOptImprove(nearestNeighborOrder(valid, start), start, end)

  // A round trip's loop direction is arbitrary, so orient it to begin at the stop nearest the hotel —
  // that reads naturally as "leave the hotel, head to the closest place, …, come back".
  if (start && end && start.lat === end.lat && start.lng === end.lng && order.length > 1) {
    if (sqDist(order[order.length - 1], start) < sqDist(order[0], start)) order.reverse()
  }

  return order
}

/** Fetches per-leg distance/duration from OSRM and returns segment metadata (midpoints, walking/driving times). */
export async function calculateSegments(
  waypoints: Waypoint[],
  { signal }: { signal?: AbortSignal } = {}
): Promise<RouteSegment[]> {
  if (!waypoints || waypoints.length < 2) return []

  const coords = waypoints.map((p) => `${p.lng},${p.lat}`).join(';')
  const url = `${OSRM_BASE}/driving/${coords}?overview=false&geometries=geojson&steps=false&annotations=distance,duration`

  const response = await fetch(url, { signal })
  if (!response.ok) throw new Error('Route could not be calculated')

  const data = await response.json()
  if (data.code !== 'Ok' || !data.routes?.[0]) throw new Error('No route found')

  const legs = data.routes[0].legs
  return legs.map((leg: { distance: number; duration: number }, i: number): RouteSegment => {
    const from: [number, number] = [waypoints[i].lat, waypoints[i].lng]
    const to: [number, number] = [waypoints[i + 1].lat, waypoints[i + 1].lng]
    const mid: [number, number] = [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2]
    const walkingDuration = leg.distance / (5000 / 3600)
    return {
      mid, from, to,
      distance: leg.distance,
      duration: leg.duration,
      walkingText: formatDuration(walkingDuration),
      drivingText: formatDuration(leg.duration),
      distanceText: formatRouteDistance(leg.distance),
    }
  })
}

/**
 * One OSRM call per waypoint-run that returns BOTH the real road geometry (for the
 * map) and per-leg distance/duration (for the sidebar connectors). Results are cached
 * by the exact waypoint list. Throws on provider failure so callers can surface the
 * route error instead of showing stale or synthetic routing data.
 */
export async function calculateRouteWithLegs(
  waypoints: Waypoint[],
  {
    signal,
    profile = 'driving',
    provider = 'osrm',
    optimism = 0.33,
    departureLocalDateTime,
    google = {},
  }: {
    signal?: AbortSignal
    profile?: RouteProfile
    provider?: RoutingProvider
    optimism?: number
    departureLocalDateTime?: string | null
    google?: GoogleRoutingOptions
  } = {}
): Promise<RouteWithLegs> {
  if (!waypoints || waypoints.length < 2) {
    return { coordinates: [], distance: 0, duration: 0, legs: [] }
  }

  const coords = waypoints.map((p) => `${p.lng},${p.lat}`).join(';')
  const effectiveProvider: RoutingProvider = profile === 'transit' && provider === 'osrm' ? 'google_maps' : provider
  // The cached result carries formatted leg distances, so the active distance unit is
  // part of the key — otherwise switching km↔mi would return stale text (#1300).
  const distanceUnit = getDistanceUnit()
  const boundedOptimism = normalizeOptimism(optimism)
  const googleOptionsKey = googleOptionsCacheKey(google)
  const cacheKey = effectiveProvider === 'google_maps' || effectiveProvider === 'google_maps_mobile'
    ? `${effectiveProvider}:${profile}:${distanceUnit}:${boundedOptimism.toFixed(2)}:${googleOptionsKey}:${departureLocalDateTime || 'now'}:${coords}`
    : `${effectiveProvider}:${profile}:${distanceUnit}:${coords}`
  const needsRouteRefresh = (route: RouteWithLegs) =>
    effectiveProvider !== 'google_maps_mobile' && hasIncompleteTransitDetails(route, profile)
  const cached = routeCache.get(cacheKey)
  if (cached && !needsRouteRefresh(cached)) return applyPersistedRouteChoices(cached)
  const persisted = getPersistedRoute(cacheKey)
  if (persisted && !needsRouteRefresh(persisted)) return applyPersistedRouteChoices(persisted)

  if (effectiveProvider === 'google_maps') {
    const result = await calculateGoogleRouteWithLegs(waypoints, {
      signal,
      profile,
      optimism: boundedOptimism,
      departureLocalDateTime,
      google,
    })
    setCachedRoute(cacheKey, result)
    return result
  }

  if (effectiveProvider === 'google_maps_mobile') {
    const result = await calculateGoogleMobileRouteWithLegs(waypoints, {
      signal,
      profile,
      optimism: boundedOptimism,
      departureLocalDateTime,
      google,
    })
    setCachedRoute(cacheKey, result)
    return result
  }

  const osrmProfile: OsrmRouteProfile = profile === 'transit' ? 'driving' : profile
  const url = `${OSRM_PROFILE_BASE[osrmProfile]}/${coords}?overview=full&geometries=geojson&annotations=distance,duration`
  const response = await fetch(url, { signal })
  if (!response.ok) throw new Error('Route could not be calculated')

  const data = await response.json()
  if (data.code !== 'Ok' || !data.routes?.[0]) throw new Error('No route found')

  const route = data.routes[0]
  const coordinates: [number, number][] = route.geometry.coordinates.map(
    ([lng, lat]: [number, number]) => [lat, lng]
  )
  const legs: RouteSegment[] = (route.legs || []).map(
    (leg: { distance: number; duration: number }, i: number): RouteSegment => {
      const from: [number, number] = [waypoints[i].lat, waypoints[i].lng]
      const to: [number, number] = [waypoints[i + 1].lat, waypoints[i + 1].lng]
      const mid: [number, number] = [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2]
      const walkingDuration = leg.distance / (5000 / 3600)
      return {
        mid, from, to,
        distance: leg.distance,
        duration: leg.duration,
        walkingText: formatDuration(walkingDuration),
        drivingText: formatDuration(leg.duration),
        distanceText: formatRouteDistance(leg.distance),
        durationText: formatDuration(leg.duration),
      }
    }
  )

  const result: RouteWithLegs = { coordinates, distance: route.distance, duration: route.duration, legs }
  setCachedRoute(cacheKey, result)
  return result
}

function getDistanceUnit(): DistanceUnit {
  return useSettingsStore.getState().settings.distance_unit === 'imperial' ? 'imperial' : 'metric'
}

function normalizeOptimism(value: unknown): number {
  const n = Number(value)
  return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0.33
}

function googleOptionsCacheKey(options: GoogleRoutingOptions = {}): string {
  return [
    options.avoidTolls ? 'tolls' : 'no-tolls',
    options.avoidHighways ? 'highways' : 'no-highways',
    options.avoidFerries ? 'ferries' : 'no-ferries',
  ].join(',')
}

function hasIncompleteTransitDetails(route: RouteWithLegs, profile: RouteProfile): boolean {
  if (profile !== 'transit') return false
  return route.legs.some(leg => {
    const choices: Array<Pick<RouteSegment | RouteAlternative, 'steps'>> = leg.alternatives?.length ? leg.alternatives : [leg]
    return choices.some(choice => !choice.steps?.length)
  })
}

function waypointCacheKey(point: Waypoint): string {
  return `${point.lng},${point.lat}`
}

function buildRouteChoiceKey(
  provider: RoutingProvider,
  profile: RouteProfile,
  optimism: number,
  google: GoogleRoutingOptions | undefined,
  departureLocalDateTime: string | null | undefined,
  from: Waypoint,
  to: Waypoint,
): string {
  return [
    provider,
    profile,
    optimism.toFixed(2),
    googleOptionsCacheKey(google),
    departureLocalDateTime || 'now',
    `${waypointCacheKey(from)};${waypointCacheKey(to)}`,
  ].join(':')
}

function coordinatesFromGeometry(
  geometry: Array<{ lat: number; lng: number }> | undefined,
  from: Waypoint,
  to: Waypoint,
): [number, number][] {
  const points = (geometry ?? [])
    .map(p => [p.lat, p.lng] as [number, number])
    .filter(point => Number.isFinite(point[0]) && Number.isFinite(point[1]))
  return points.length >= 2 ? points : [[from.lat, from.lng], [to.lat, to.lng]]
}

function sameCoordinate(a: [number, number], b: [number, number]): boolean {
  return a[0] === b[0] && a[1] === b[1]
}

function appendLegCoordinates(coordinates: [number, number][], points: [number, number][]): void {
  const valid = points.filter(point => Number.isFinite(point[0]) && Number.isFinite(point[1]))
  if (valid.length === 0) return
  if (coordinates.length && sameCoordinate(coordinates[coordinates.length - 1], valid[0])) {
    coordinates.push(...valid.slice(1))
  } else {
    coordinates.push(...valid)
  }
}

function routeSegmentFromAlternative(
  base: Pick<RouteSegment, 'mid' | 'from' | 'to'>,
  alternative: RouteAlternative,
  alternatives: RouteAlternative[],
  choiceKey: string,
): RouteSegment {
  return {
    mid: base.mid,
    from: base.from,
    to: base.to,
    distance: alternative.distance,
    duration: alternative.duration,
    walkingText: alternative.walkingText,
    drivingText: alternative.drivingText,
    distanceText: alternative.distanceText,
    durationText: alternative.durationText,
    ...(alternative.tollText ? { tollText: alternative.tollText } : {}),
    ...(alternative.fareText ? { fareText: alternative.fareText } : {}),
    ...(alternative.steps?.length ? { steps: alternative.steps } : {}),
    ...(alternative.coordinates?.length ? { coordinates: alternative.coordinates } : {}),
    routeChoiceKey: choiceKey,
    routeAlternativeIndex: alternative.index,
    ...(alternatives.length > 1 ? { alternatives } : {}),
  }
}

function selectRouteAlternative(
  from: Waypoint,
  to: Waypoint,
  alternatives: RouteAlternative[],
  choiceKey: string,
): RouteSegment {
  const selectedIndex = getRouteAlternativeChoice(choiceKey, alternatives.length) ?? 0
  const alternative = alternatives[selectedIndex] ?? alternatives[0]
  const base = {
    mid: [(from.lat + to.lat) / 2, (from.lng + to.lng) / 2] as [number, number],
    from: [from.lat, from.lng] as [number, number],
    to: [to.lat, to.lng] as [number, number],
  }
  return routeSegmentFromAlternative(base, alternative, alternatives, choiceKey)
}

function applyPersistedRouteChoices(route: RouteWithLegs): RouteWithLegs {
  const hasChoiceLegs = route.legs.some(leg => leg.routeChoiceKey && leg.alternatives?.length)
  if (!hasChoiceLegs) return route

  const coordinates: [number, number][] = []
  let distance = 0
  let duration = 0
  const legs = route.legs.map((leg): RouteSegment => {
    if (!leg.routeChoiceKey || !leg.alternatives?.length) {
      distance += leg.distance
      duration += leg.duration
      appendLegCoordinates(coordinates, leg.coordinates?.length ? leg.coordinates : [leg.from, leg.to])
      return leg
    }

    const selectedIndex = getRouteAlternativeChoice(leg.routeChoiceKey, leg.alternatives.length) ?? leg.routeAlternativeIndex ?? 0
    const selected = leg.alternatives[selectedIndex] ?? leg.alternatives[0]
    const next = routeSegmentFromAlternative(leg, selected, leg.alternatives, leg.routeChoiceKey)
    distance += next.distance
    duration += next.duration
    appendLegCoordinates(coordinates, next.coordinates?.length ? next.coordinates : [next.from, next.to])
    return next
  })

  return {
    coordinates: coordinates.length >= 2 ? coordinates : route.coordinates,
    distance,
    duration,
    legs,
  }
}

function googleMode(profile: RouteProfile): 'driving' | 'walking' | 'bicycling' | 'transit' {
  return profile === 'cycling' ? 'bicycling' : profile
}

const FREE_ROUTE_FEE_TEXT = 'Free'

function isZeroMoneyAmount(amount: number | null | undefined): boolean {
  return Number.isFinite(amount) && Math.abs(Number(amount)) < 0.000001
}

function formatGoogleFareText(fare?: GoogleDirectionsFare | null): string | undefined {
  if (!fare) return undefined
  if (isZeroMoneyAmount(fare.amount)) return FREE_ROUTE_FEE_TEXT
  return fare.text?.trim() || undefined
}

function formatGoogleMobileTollText(tollFee?: GoogleMobileDirectionsMoney | null): string | undefined {
  if (!tollFee) return undefined
  if (isZeroMoneyAmount(tollFee.amount)) return FREE_ROUTE_FEE_TEXT
  const text = tollFee?.text?.trim()
  if (!text) return undefined
  const label = tollFee?.label?.trim()
  if (!label) return text
  return text.toLowerCase().includes(label.toLowerCase()) ? text : `${label} ${text}`
}

function addSecondsToLocalDateTime(localDateTime: string, seconds: number): string {
  const match = localDateTime.match(/^(\d{4})-(\d{2})-(\d{2})[T\s](\d{2}):(\d{2})(?::(\d{2}))?$/)
  if (!match) return localDateTime
  const [, y, mo, d, h, mi, s = '0'] = match
  const date = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s)))
  date.setUTCSeconds(date.getUTCSeconds() + Math.max(0, Math.round(seconds)))
  return date.toISOString().slice(0, 16)
}

function pickGoogleDurationSeconds(route: GoogleDirectionsRoute, optimism: number): number {
  const min = route.traffic?.range?.minSeconds
  const max = route.traffic?.range?.maxSeconds
  if (Number.isFinite(min) && Number.isFinite(max)) {
    const best = Number(min)
    const worst = Number(max)
    return Math.max(0, worst - (worst - best) * optimism)
  }
  const trafficDuration = route.traffic?.duration?.seconds
  if (Number.isFinite(trafficDuration)) return Math.max(0, Number(trafficDuration))
  const duration = route.duration?.seconds
  return Number.isFinite(duration) ? Math.max(0, Number(duration)) : 0
}

function googleTimeEpochSeconds(time?: GoogleDirectionsTime | null): number | null {
  const seconds = time?.epochSeconds ?? time?.roundedEpochSeconds
  return Number.isFinite(seconds) ? Number(seconds) : null
}

function elapsedSeconds(start?: GoogleDirectionsTime | null, end?: GoogleDirectionsTime | null): number | null {
  const startSeconds = googleTimeEpochSeconds(start)
  const endSeconds = googleTimeEpochSeconds(end)
  if (!Number.isFinite(startSeconds) || !Number.isFinite(endSeconds)) return null
  return endSeconds! >= startSeconds! ? endSeconds! - startSeconds! : null
}

function googleLegDurationSeconds(leg: GoogleDirectionsLeg): number | null {
  const duration = leg.duration?.seconds
  return Number.isFinite(duration) ? Math.max(0, Number(duration)) : null
}

function googleLegStartTime(leg: GoogleDirectionsLeg): GoogleDirectionsTime | null | undefined {
  return leg.departureTime ?? leg.transit?.departureStop?.departureTime
}

function googleLegEndTime(leg: GoogleDirectionsLeg): GoogleDirectionsTime | null | undefined {
  return leg.arrivalTime ?? leg.transit?.arrivalStop?.arrivalTime
}

function sumGoogleLegDurations(legs: GoogleDirectionsLeg[]): number | null {
  const durations = legs.map(googleLegDurationSeconds).filter((seconds): seconds is number => Number.isFinite(seconds))
  return durations.length ? durations.reduce((sum, seconds) => sum + seconds, 0) : null
}

function googleRouteElapsedDurationSeconds(route: GoogleDirectionsRoute): number | null {
  const routeElapsed = elapsedSeconds(route.departureTime, route.arrivalTime)
  if (routeElapsed !== null) return routeElapsed

  const legs = route.legs ?? []
  const firstTimedIndex = legs.findIndex(leg => googleTimeEpochSeconds(googleLegStartTime(leg)) !== null)
  const lastTimedIndexFromEnd = [...legs].reverse().findIndex(leg => googleTimeEpochSeconds(googleLegEndTime(leg)) !== null)
  if (firstTimedIndex < 0 || lastTimedIndexFromEnd < 0) return null

  const lastTimedIndex = legs.length - 1 - lastTimedIndexFromEnd
  if (lastTimedIndex < firstTimedIndex) return null

  const timedElapsed = elapsedSeconds(googleLegStartTime(legs[firstTimedIndex]), googleLegEndTime(legs[lastTimedIndex]))
  if (timedElapsed === null) return null

  const before = sumGoogleLegDurations(legs.slice(0, firstTimedIndex)) ?? 0
  const after = sumGoogleLegDurations(legs.slice(lastTimedIndex + 1)) ?? 0
  return before + timedElapsed + after
}

function googleRouteDurationSeconds(route: GoogleDirectionsRoute, optimism: number): number {
  const hasRouteDuration =
    Number.isFinite(route.traffic?.range?.minSeconds) ||
    Number.isFinite(route.traffic?.range?.maxSeconds) ||
    Number.isFinite(route.traffic?.duration?.seconds) ||
    Number.isFinite(route.duration?.seconds)
  const candidates = [
    hasRouteDuration ? pickGoogleDurationSeconds(route, optimism) : null,
    sumGoogleLegDurations(route.legs ?? []),
    googleRouteElapsedDurationSeconds(route),
  ].filter((seconds): seconds is number => Number.isFinite(seconds))

  return candidates.length ? Math.max(...candidates) : 0
}

function googleRouteDistanceMeters(route: GoogleDirectionsRoute): number {
  if (Number.isFinite(route.distance?.meters)) return Math.max(0, Number(route.distance?.meters))
  const legMeters = (route.legs ?? [])
    .map(leg => leg.distance?.meters)
    .filter((meters): meters is number => Number.isFinite(meters))
  return legMeters.length ? legMeters.reduce((sum, meters) => sum + Math.max(0, Number(meters)), 0) : 0
}

function pickGoogleMobileDurationSeconds(
  response: GoogleMobileDirectionsResponse,
  route: GoogleMobileDirectionsRoute,
  optimism: number,
): number {
  const best = route.trafficPrediction?.optimistic?.seconds ?? response.optimisticDuration?.seconds
  const worst = route.trafficPrediction?.pessimistic?.seconds ?? response.pessimisticDuration?.seconds
  if (Number.isFinite(best) && Number.isFinite(worst)) {
    const optimistic = Number(best)
    const pessimistic = Number(worst)
    return Math.max(0, pessimistic - (pessimistic - optimistic) * optimism)
  }
  const duration = route.duration?.seconds
  return Number.isFinite(duration) ? Math.max(0, Number(duration)) : 0
}

function googleTransitStopToRouteStop(stop?: GoogleDirectionsTransitStop | null): RouteTransitStop | null {
  if (!stop?.name) return null
  return {
    name: stop.name,
    platform: stop.platform ?? null,
    lat: stop.lat ?? null,
    lng: stop.lng ?? null,
    arrivalTimeText: stop.arrivalTime?.text ?? null,
    departureTimeText: stop.departureTime?.text ?? null,
  }
}

function googleStepToRouteStep(step: GoogleDirectionsStep, mode: RouteStep['mode']): RouteStep {
  return {
    mode,
    instruction: step.instructionText ?? null,
    distance: step.distance?.meters ?? null,
    duration: step.duration?.seconds ?? null,
    distanceText: step.distance?.text ?? null,
    durationText: step.duration?.text ?? null,
  }
}

function googleMobileStepToRouteStep(step: GoogleMobileDirectionsStep, mode: RouteStep['mode']): RouteStep {
  const distance = Number.isFinite(step.distance?.meters) ? Number(step.distance?.meters) : null
  const duration = Number.isFinite(step.duration?.seconds) ? Number(step.duration?.seconds) : null
  return {
    mode,
    instruction: step.instruction ?? null,
    distance,
    duration,
    distanceText: step.distance?.text ?? (distance !== null ? formatRouteDistance(distance) : null),
    durationText: step.duration?.text ?? (duration !== null ? formatDuration(duration) : null),
  }
}

function googleRouteTransitSteps(route: GoogleDirectionsRoute, profile: RouteProfile): RouteStep[] {
  const steps: RouteStep[] = []
  const nonTransitMode: RouteStep['mode'] =
    profile === 'transit' ? 'walking' : profile === 'driving' || profile === 'walking' || profile === 'cycling' ? profile : 'unknown'
  for (const leg of route.legs ?? []) {
    const transit = leg.transit
    if (transit) {
      const lineLabel = transit.serviceShortName ?? transit.lineName ?? transit.serviceName ?? transit.vehicleType ?? null
      steps.push({
        mode: 'transit',
        instruction: lineLabel ? `Take ${lineLabel}` : null,
        distance: leg.distance?.meters ?? null,
        duration: leg.duration?.seconds ?? null,
        distanceText: leg.distance?.text ?? null,
        durationText: leg.duration?.text ?? null,
        transit: {
          line: {
            name: transit.lineName ?? null,
            shortName: transit.serviceShortName ?? null,
            serviceName: transit.serviceName ?? null,
            headsign: transit.headsign ?? null,
            vehicleType: transit.vehicleType ?? null,
            color: transit.color ?? null,
            textColor: transit.textColor ?? null,
            agencies: (transit.agencies ?? []).map(agency => agency.name).filter((name): name is string => Boolean(name)),
          },
          departureStop: googleTransitStopToRouteStop(transit.departureStop),
          arrivalStop: googleTransitStopToRouteStop(transit.arrivalStop),
          intermediateStops: (transit.intermediateStops ?? []).map(stop => googleTransitStopToRouteStop(stop)).filter(Boolean),
          stopCount: transit.stopCount ?? null,
        },
      })
      continue
    }

    const nestedSteps = leg.steps ?? []
    if (nestedSteps.length > 0) {
      nestedSteps.forEach(step => steps.push(googleStepToRouteStep(step, nonTransitMode)))
    } else if (leg.distance || leg.duration) {
      steps.push({
        mode: nonTransitMode,
        distance: leg.distance?.meters ?? null,
        duration: leg.duration?.seconds ?? null,
        distanceText: leg.distance?.text ?? null,
        durationText: leg.duration?.text ?? null,
      })
    }
  }
  return steps
}

function routeWalkingDurationSeconds(steps: RouteStep[]): number | null {
  let hasWalkingStep = false
  const durations: number[] = []
  for (const step of steps) {
    if (step.mode !== 'walking' || step.transit) continue
    hasWalkingStep = true
    if (Number.isFinite(step.duration)) durations.push(Math.max(0, Number(step.duration)))
  }
  if (!hasWalkingStep) return steps.length ? 0 : null
  return durations.length ? durations.reduce((sum, seconds) => sum + seconds, 0) : null
}

function googleRouteFareText(route: GoogleDirectionsRoute): string | undefined {
  const fareText = formatGoogleFareText(route.fare)
  if (fareText) return fareText
  return (route.legs ?? []).map(leg => formatGoogleFareText(leg.fare)).find(Boolean)
}

function googleRouteAlternative(
  route: GoogleDirectionsRoute,
  from: Waypoint,
  to: Waypoint,
  profile: RouteProfile,
  optimism: number,
  index: number,
): RouteAlternative {
  const duration = googleRouteDurationSeconds(route, optimism)
  const distance = googleRouteDistanceMeters(route)
  const durationText = formatDuration(duration)
  const fareText = googleRouteFareText(route)
  const steps = googleRouteTransitSteps(route, profile)
  const walkingDuration = profile === 'transit' ? routeWalkingDurationSeconds(steps) : null
  const walkingText = walkingDuration !== null ? formatDuration(walkingDuration) : durationText
  return {
    index,
    distance,
    duration,
    walkingText,
    drivingText: durationText,
    distanceText: route.distance?.text ?? formatRouteDistance(distance),
    durationText,
    ...(fareText ? { fareText } : {}),
    ...(steps.length ? { steps } : {}),
    coordinates: coordinatesFromGeometry(route.overviewGeometry, from, to),
  }
}

function googleMobileRouteAlternative(
  response: GoogleMobileDirectionsResponse,
  route: GoogleMobileDirectionsRoute,
  from: Waypoint,
  to: Waypoint,
  profile: RouteProfile,
  optimism: number,
  index: number,
): RouteAlternative {
  const duration = pickGoogleMobileDurationSeconds(response, route, optimism)
  const distance = Number(route.distance?.meters) || 0
  const durationText = formatDuration(duration)
  const tollText = profile === 'transit' ? undefined : formatGoogleMobileTollText(route.tollFee)
  const stepMode: RouteStep['mode'] =
    profile === 'driving' || profile === 'walking' || profile === 'cycling' ? profile : 'unknown'
  const steps = (route.steps ?? []).map(step => googleMobileStepToRouteStep(step, stepMode))
  return {
    index,
    distance,
    duration,
    walkingText: durationText,
    drivingText: durationText,
    distanceText: route.distance?.text ?? formatRouteDistance(distance),
    durationText,
    ...(tollText ? { tollText } : {}),
    ...(steps.length ? { steps } : {}),
    coordinates: coordinatesFromGeometry(route.overviewGeometry, from, to),
  }
}

function googleMobileLocation(point: Waypoint): { lat: number; lng: number } {
  return { lat: point.lat, lng: point.lng }
}

async function fetchGoogleTransitPreviewRoutes(
  from: Waypoint,
  to: Waypoint,
  departureLocalDateTime: string | null,
  google: GoogleRoutingOptions | undefined,
  signal?: AbortSignal,
): Promise<GoogleDirectionsRoute[]> {
  const baseBody = {
    origin: { lat: from.lat, lng: from.lng },
    destination: { lat: to.lat, lng: to.lng },
    mode: 'transit',
    includeOverviewGeometry: false,
    includeSteps: true,
    avoidTolls: google?.avoidTolls === true,
    avoidHighways: google?.avoidHighways === true,
    avoidFerries: google?.avoidFerries === true,
  }

  const fetchRoutes = async (withDeparture: boolean): Promise<GoogleDirectionsRoute[]> => {
    const body = {
      ...baseBody,
      ...(withDeparture && departureLocalDateTime ? { time: { kind: 'departAtLocal' as const, localDateTime: departureLocalDateTime } } : {}),
    }
    const response = await apiClient.post('/maps/directions-preview', body, { signal }).then(r => r.data as GoogleDirectionsResponse)
    return response.routes ?? []
  }

  const hasUsefulSteps = (route: GoogleDirectionsRoute | null): route is GoogleDirectionsRoute =>
    Boolean(route && googleRouteTransitSteps(route, 'transit').length > 0)

  let timedRoutes: GoogleDirectionsRoute[] = []
  if (departureLocalDateTime) {
    try {
      timedRoutes = await fetchRoutes(true)
      const usefulTimedRoutes = timedRoutes.filter(hasUsefulSteps)
      if (usefulTimedRoutes.length) return usefulTimedRoutes
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') throw err
    }
  }

  try {
    const untimedRoutes = await fetchRoutes(false)
    const usefulUntimedRoutes = untimedRoutes.filter(hasUsefulSteps)
    if (usefulUntimedRoutes.length) return usefulUntimedRoutes
    return untimedRoutes.length ? untimedRoutes : timedRoutes
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') throw err
    return timedRoutes
  }
}

async function fetchGooglePreviewRoutes(
  from: Waypoint,
  to: Waypoint,
  {
    profile,
    departureLocalDateTime,
    google,
    signal,
  }: {
    profile: RouteProfile
    departureLocalDateTime: string | null
    google?: GoogleRoutingOptions
    signal?: AbortSignal
  },
): Promise<GoogleDirectionsRoute[]> {
  if (profile === 'transit') {
    return fetchGoogleTransitPreviewRoutes(from, to, departureLocalDateTime, google, signal)
  }

  const body = {
    origin: { lat: from.lat, lng: from.lng },
    destination: { lat: to.lat, lng: to.lng },
    mode: googleMode(profile),
    includeOverviewGeometry: true,
    includeSteps: true,
    avoidTolls: google?.avoidTolls === true,
    avoidHighways: google?.avoidHighways === true,
    avoidFerries: google?.avoidFerries === true,
    ...(departureLocalDateTime ? { time: { kind: 'departAtLocal' as const, localDateTime: departureLocalDateTime } } : {}),
  }
  const response = await apiClient.post('/maps/directions-preview', body, { signal }).then(r => r.data as GoogleDirectionsResponse)
  return response.routes ?? []
}

async function calculateGoogleRouteWithLegs(
  waypoints: Waypoint[],
  {
    signal,
    profile,
    optimism,
    departureLocalDateTime,
    google,
  }: {
    signal?: AbortSignal
    profile: RouteProfile
    optimism: number
    departureLocalDateTime?: string | null
    google?: GoogleRoutingOptions
  },
): Promise<RouteWithLegs> {
  const legs: RouteSegment[] = []
  const coordinates: [number, number][] = []
  let distance = 0
  let duration = 0
  let currentDeparture = departureLocalDateTime || null

  for (let i = 0; i < waypoints.length - 1; i++) {
    const from = waypoints[i]
    const to = waypoints[i + 1]
    const routes = await fetchGooglePreviewRoutes(from, to, {
      profile,
      departureLocalDateTime: currentDeparture,
      google,
      signal,
    })
    if (!routes.length) throw new Error('No route found')

    const alternatives = routes.map((route, index) => googleRouteAlternative(route, from, to, profile, optimism, index))
    const choiceKey = buildRouteChoiceKey('google_maps', profile, optimism, google, currentDeparture, from, to)
    const selected = selectRouteAlternative(from, to, alternatives, choiceKey)
    appendLegCoordinates(coordinates, selected.coordinates?.length ? selected.coordinates : [selected.from, selected.to])

    legs.push(selected)
    distance += selected.distance
    duration += selected.duration
    if (currentDeparture) currentDeparture = addSecondsToLocalDateTime(currentDeparture, selected.duration)
  }

  return {
    coordinates,
    distance,
    duration,
    legs,
  }
}

async function calculateGoogleMobileRouteWithLegs(
  waypoints: Waypoint[],
  {
    signal,
    profile,
    optimism,
    departureLocalDateTime,
    google,
  }: {
    signal?: AbortSignal
    profile: RouteProfile
    optimism: number
    departureLocalDateTime?: string | null
    google?: GoogleRoutingOptions
  },
): Promise<RouteWithLegs> {
  const legs: RouteSegment[] = []
  const coordinates: [number, number][] = []
  let distance = 0
  let duration = 0
  let currentDeparture = departureLocalDateTime || null

  for (let i = 0; i < waypoints.length - 1; i++) {
    const from = waypoints[i]
    const to = waypoints[i + 1]
    const legDeparture = currentDeparture
    const buildBody = (departure: string | null) => ({
      from: googleMobileLocation(from),
      to: googleMobileLocation(to),
      ...(departure ? { departureTime: { kind: 'departAtLocal' as const, localDateTime: departure } } : {}),
      options: {
        mode: googleMode(profile),
        avoidTolls: google?.avoidTolls === true,
        avoidHighways: google?.avoidHighways === true,
        avoidFerries: google?.avoidFerries === true,
      },
    })
    const response = await apiClient.post('/maps/directions-mobile', buildBody(legDeparture), { signal }).then(r => r.data as GoogleMobileDirectionsResponse)
    const mobileRoutes = response.routes ?? []
    if (!mobileRoutes.length) throw new Error('No route found')

    const alternatives = mobileRoutes.map((route, index) => googleMobileRouteAlternative(response, route, from, to, profile, optimism, index))
    const choiceKey = buildRouteChoiceKey('google_maps_mobile', profile, optimism, google, legDeparture, from, to)
    const selected = selectRouteAlternative(from, to, alternatives, choiceKey)
    appendLegCoordinates(coordinates, selected.coordinates?.length ? selected.coordinates : [selected.from, selected.to])

    legs.push(selected)
    distance += selected.distance
    duration += selected.duration
    if (currentDeparture) currentDeparture = addSecondsToLocalDateTime(currentDeparture, selected.duration)
  }

  return {
    coordinates,
    distance,
    duration,
    legs,
  }
}

function formatRouteDistance(meters: number): string {
  const unit = getDistanceUnit()
  if (unit === 'metric' && meters < 1000) {
    return `${Math.round(meters)} m`
  }
  return formatDistance(meters / 1000, unit)
}

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  if (h > 0) {
    return `${h} h ${m} min`
  }
  return `${m} min`
}
