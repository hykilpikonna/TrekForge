import type { RouteLineSegment, RouteSegment, RouteStep, RouteTransitStop } from '../../types'

export const DEFAULT_ROUTE_COLOR = '#0a84ff'
export const DEFAULT_ROUTE_CASING_COLOR = '#0a5cc2'
export const WALK_ROUTE_COLOR = '#64748b'
export const WALK_ROUTE_CASING_COLOR = '#475569'

function safeColor(value?: string | null): string | null {
  if (!value) return null
  const trimmed = value.trim()
  if (/^#[0-9a-f]{3,8}$/i.test(trimmed)) return trimmed
  if (/^[0-9a-f]{3,8}$/i.test(trimmed)) return `#${trimmed}`
  return null
}

function stopPoint(stop?: RouteTransitStop | null): [number, number] | null {
  if (!Number.isFinite(stop?.lat) || !Number.isFinite(stop?.lng)) return null
  return [Number(stop!.lat), Number(stop!.lng)]
}

function samePoint(a: [number, number], b: [number, number]): boolean {
  return Math.abs(a[0] - b[0]) < 0.000001 && Math.abs(a[1] - b[1]) < 0.000001
}

function pushPart(
  parts: RouteLineSegment[],
  coordinates: Array<[number, number] | null>,
  color: string,
  casingColor: string,
  mode: RouteLineSegment['mode'],
): void {
  const valid = coordinates.filter((point): point is [number, number] =>
    Boolean(point && Number.isFinite(point[0]) && Number.isFinite(point[1])),
  )
  const deduped = valid.filter((point, index) => index === 0 || !samePoint(point, valid[index - 1]))
  if (deduped.length < 2) return
  parts.push({ coordinates: deduped, color, casingColor, mode })
}

function walkingConnector(parts: RouteLineSegment[], from: [number, number], to: [number, number]): void {
  pushPart(parts, [from, to], WALK_ROUTE_COLOR, WALK_ROUTE_CASING_COLOR, 'walking')
}

function transitStepPath(step: RouteStep): [number, number][] {
  const transit = step.transit
  const departure = stopPoint(transit?.departureStop)
  const arrival = stopPoint(transit?.arrivalStop)
  if (!departure || !arrival) return []
  return [
    departure,
    ...(transit?.intermediateStops ?? []).map(stopPoint).filter((point): point is [number, number] => Boolean(point)),
    arrival,
  ]
}

function transitPartsForSegment(segment: RouteSegment): RouteLineSegment[] {
  const parts: RouteLineSegment[] = []
  let current = segment.from
  let hasTransitPath = false

  for (const step of segment.steps ?? []) {
    if (step.mode !== 'transit' || !step.transit) continue
    const path = transitStepPath(step)
    if (path.length < 2) continue
    const departure = path[0]
    const arrival = path[path.length - 1]
    if (!samePoint(current, departure)) walkingConnector(parts, current, departure)
    const color = safeColor(step.transit.line.color) ?? DEFAULT_ROUTE_COLOR
    pushPart(parts, path, color, DEFAULT_ROUTE_CASING_COLOR, 'transit')
    current = arrival
    hasTransitPath = true
  }

  if (!hasTransitPath) return []
  if (!samePoint(current, segment.to)) walkingConnector(parts, current, segment.to)
  return parts
}

function isWalkingOnlySegment(segment: RouteSegment): boolean {
  const steps = segment.steps ?? []
  return steps.length > 0 && steps.every(step => step.mode === 'walking' && !step.transit)
}

export function buildDisplayRouteLineSegments(
  route: [number, number][][] | null | undefined,
  routeSegments: RouteSegment[] = [],
): RouteLineSegment[] {
  const transitBySegment = routeSegments.map(transitPartsForSegment)
  const hasTransitParts = transitBySegment.some(parts => parts.length > 0)

  if (!hasTransitParts) {
    return (route ?? [])
      .filter(coordinates => coordinates.length > 1)
      .map(coordinates => ({
        coordinates,
        color: DEFAULT_ROUTE_COLOR,
        casingColor: DEFAULT_ROUTE_CASING_COLOR,
        mode: 'route',
      }))
  }

  const displayParts: RouteLineSegment[] = []
  routeSegments.forEach((segment, index) => {
    const transitParts = transitBySegment[index]
    if (transitParts.length > 0) {
      displayParts.push(...transitParts)
      return
    }

    const coordinates = route?.[index]?.length && route[index].length > 1
      ? route[index]
      : [segment.from, segment.to]
    const walkingOnly = isWalkingOnlySegment(segment)
    displayParts.push({
      coordinates,
      color: walkingOnly ? WALK_ROUTE_COLOR : DEFAULT_ROUTE_COLOR,
      casingColor: walkingOnly ? WALK_ROUTE_CASING_COLOR : DEFAULT_ROUTE_CASING_COLOR,
      mode: walkingOnly ? 'walking' : 'route',
    })
  })

  return displayParts.filter(part => part.coordinates.length > 1)
}
