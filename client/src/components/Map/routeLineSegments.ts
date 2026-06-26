import type { RouteLineSegment, RouteSegment, RouteStep, RouteTransitStop } from '../../types'

export const DEFAULT_ROUTE_COLOR = '#0a84ff'
export const DEFAULT_ROUTE_CASING_COLOR = '#0a5cc2'
export const WALK_ROUTE_COLOR = '#64748b'
export const WALK_ROUTE_CASING_COLOR = '#475569'

type RouteLinePart = RouteLineSegment & { transferKey?: string | null }

export interface RouteTransferPoint {
  position: [number, number]
  color: string
  casingColor: string
}

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

function pointDistance(a: [number, number], b: [number, number]): number {
  const dLat = b[0] - a[0]
  const dLng = b[1] - a[1]
  return Math.sqrt(dLat * dLat + dLng * dLng)
}

function interpolatePoint(a: [number, number], b: [number, number], ratio: number): [number, number] {
  return [
    a[0] + (b[0] - a[0]) * ratio,
    a[1] + (b[1] - a[1]) * ratio,
  ]
}

function polylineLength(points: [number, number][]): number {
  let length = 0
  for (let i = 1; i < points.length; i++) length += pointDistance(points[i - 1], points[i])
  return length
}

function pointAtDistance(points: [number, number][], target: number): [number, number] {
  if (points.length <= 1 || target <= 0) return points[0]
  let walked = 0
  for (let i = 1; i < points.length; i++) {
    const from = points[i - 1]
    const to = points[i]
    const segmentLength = pointDistance(from, to)
    if (segmentLength <= 0) continue
    if (walked + segmentLength >= target) {
      return interpolatePoint(from, to, (target - walked) / segmentLength)
    }
    walked += segmentLength
  }
  return points[points.length - 1]
}

function slicePolyline(points: [number, number][], start: number, end: number): [number, number][] {
  if (points.length < 2 || end <= start) return []
  const sliced: [number, number][] = [pointAtDistance(points, start)]
  let walked = 0

  for (let i = 1; i < points.length; i++) {
    const from = points[i - 1]
    const to = points[i]
    const segmentLength = pointDistance(from, to)
    const segmentStart = walked
    const segmentEnd = walked + segmentLength
    walked = segmentEnd
    if (segmentLength <= 0 || segmentEnd <= start || segmentStart >= end) continue
    if (segmentEnd < end) sliced.push(to)
  }

  sliced.push(pointAtDistance(points, end))
  return sliced
}

function pushPart(
  parts: RouteLinePart[],
  coordinates: Array<[number, number] | null>,
  color: string,
  casingColor: string,
  mode: RouteLineSegment['mode'],
  transferKey?: string | null,
): void {
  const valid = coordinates.filter((point): point is [number, number] =>
    Boolean(point && Number.isFinite(point[0]) && Number.isFinite(point[1])),
  )
  const deduped = valid.filter((point, index) => index === 0 || !samePoint(point, valid[index - 1]))
  if (deduped.length < 2) return
  parts.push({ coordinates: deduped, color, casingColor, mode, transferKey })
}

function walkingConnector(parts: RouteLinePart[], from: [number, number], to: [number, number]): void {
  pushPart(parts, [from, to], WALK_ROUTE_COLOR, WALK_ROUTE_CASING_COLOR, 'walking', 'walking')
}

function stepWeight(step: RouteStep): number {
  if (Number.isFinite(step.duration) && Number(step.duration) > 0) return Number(step.duration)
  if (Number.isFinite(step.distance) && Number(step.distance) > 0) return Number(step.distance)
  return 1
}

function stepTransferKey(step: RouteStep): string {
  if (step.mode !== 'transit') return step.mode || 'route'
  const line = step.transit?.line
  return [
    'transit',
    line?.shortName,
    line?.name,
    line?.serviceName,
    line?.vehicleType,
    line?.headsign,
  ].filter(Boolean).join(':') || 'transit'
}

function stepColor(step: RouteStep): { color: string; casingColor: string; mode: RouteLineSegment['mode']; transferKey: string } {
  if (step.mode === 'walking') {
    return { color: WALK_ROUTE_COLOR, casingColor: WALK_ROUTE_CASING_COLOR, mode: 'walking', transferKey: 'walking' }
  }
  if (step.mode === 'transit') {
    return {
      color: safeColor(step.transit?.line.color) ?? DEFAULT_ROUTE_COLOR,
      casingColor: DEFAULT_ROUTE_CASING_COLOR,
      mode: 'transit',
      transferKey: stepTransferKey(step),
    }
  }
  return { color: DEFAULT_ROUTE_COLOR, casingColor: DEFAULT_ROUTE_CASING_COLOR, mode: step.mode || 'route', transferKey: stepTransferKey(step) }
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

function fallbackPartsForSegment(segment: RouteSegment, routeCoordinates?: [number, number][]): RouteLinePart[] {
  const steps = segment.steps ?? []
  if (!steps.some(step => step.mode === 'transit' && step.transit)) return []

  const path = routeCoordinates?.length && routeCoordinates.length > 1
    ? routeCoordinates
    : segment.coordinates?.length && segment.coordinates.length > 1
      ? segment.coordinates
      : [segment.from, segment.to]
  const length = polylineLength(path)
  if (path.length < 2 || length <= 0) return []

  const totalWeight = steps.reduce((sum, step) => sum + stepWeight(step), 0)
  const parts: RouteLinePart[] = []
  let usedWeight = 0

  steps.forEach((step, index) => {
    const start = index === 0 ? 0 : (usedWeight / totalWeight) * length
    usedWeight += stepWeight(step)
    const end = index === steps.length - 1 ? length : (usedWeight / totalWeight) * length
    const style = stepColor(step)
    pushPart(parts, slicePolyline(path, start, end), style.color, style.casingColor, style.mode, style.transferKey)
  })

  return parts
}

function transitPartsForSegment(segment: RouteSegment, routeCoordinates?: [number, number][]): RouteLinePart[] {
  const parts: RouteLinePart[] = []
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
    pushPart(parts, path, color, DEFAULT_ROUTE_CASING_COLOR, 'transit', stepTransferKey(step))
    current = arrival
    hasTransitPath = true
  }

  if (!hasTransitPath) return fallbackPartsForSegment(segment, routeCoordinates)
  if (!samePoint(current, segment.to)) walkingConnector(parts, current, segment.to)
  return parts
}

function isWalkingOnlySegment(segment: RouteSegment): boolean {
  const steps = segment.steps ?? []
  return steps.length > 0 && steps.every(step => step.mode === 'walking' && !step.transit)
}

function buildRouteLinePartsBySegment(
  route: [number, number][][] | null | undefined,
  routeSegments: RouteSegment[] | null | undefined = [],
): RouteLinePart[][] {
  const safeRouteSegments = routeSegments ?? []
  const transitBySegment = safeRouteSegments.map((segment, index) => transitPartsForSegment(segment, route?.[index]))
  const hasTransitParts = transitBySegment.some(parts => parts.length > 0)

  if (!hasTransitParts) {
    const routeParts: RouteLinePart[][] = (route ?? [])
      .filter(coordinates => coordinates.length > 1)
      .map(coordinates => [{
        coordinates,
        color: DEFAULT_ROUTE_COLOR,
        casingColor: DEFAULT_ROUTE_CASING_COLOR,
        mode: 'route',
        transferKey: 'route',
      }])
    if (routeParts.length > 0) return routeParts
    return safeRouteSegments.map((segment): RouteLinePart[] => {
      const coordinates = segment.coordinates?.length && segment.coordinates.length > 1
        ? segment.coordinates
        : [segment.from, segment.to]
      const walkingOnly = isWalkingOnlySegment(segment)
      return [{
        coordinates,
        color: walkingOnly ? WALK_ROUTE_COLOR : DEFAULT_ROUTE_COLOR,
        casingColor: walkingOnly ? WALK_ROUTE_CASING_COLOR : DEFAULT_ROUTE_CASING_COLOR,
        mode: walkingOnly ? 'walking' : 'route',
        transferKey: walkingOnly ? 'walking' : 'route',
      }]
    }).filter(parts => parts[0]?.coordinates.length > 1)
  }

  const partsBySegment: RouteLinePart[][] = []
  safeRouteSegments.forEach((segment, index) => {
    const transitParts = transitBySegment[index]
    if (transitParts.length > 0) {
      partsBySegment.push(transitParts)
      return
    }

    const coordinates = route?.[index]?.length && route[index].length > 1
      ? route[index]
      : [segment.from, segment.to]
    const walkingOnly = isWalkingOnlySegment(segment)
    partsBySegment.push([{
      coordinates,
      color: walkingOnly ? WALK_ROUTE_COLOR : DEFAULT_ROUTE_COLOR,
      casingColor: walkingOnly ? WALK_ROUTE_CASING_COLOR : DEFAULT_ROUTE_CASING_COLOR,
      mode: walkingOnly ? 'walking' : 'route',
      transferKey: walkingOnly ? 'walking' : 'route',
    }])
  })

  return partsBySegment.map(parts => parts.filter(part => part.coordinates.length > 1))
}

export function buildDisplayRouteLineSegments(
  route: [number, number][][] | null | undefined,
  routeSegments: RouteSegment[] | null | undefined = [],
): RouteLineSegment[] {
  return buildRouteLinePartsBySegment(route, routeSegments).flat()
}

function partEndpoint(part: RouteLinePart, end: 'start' | 'end'): [number, number] | null {
  if (part.coordinates.length < 1) return null
  return end === 'start' ? part.coordinates[0] : part.coordinates[part.coordinates.length - 1]
}

export function buildRouteTransferPoints(
  route: [number, number][][] | null | undefined,
  routeSegments: RouteSegment[] | null | undefined = [],
): RouteTransferPoint[] {
  const points: RouteTransferPoint[] = []
  for (const parts of buildRouteLinePartsBySegment(route, routeSegments)) {
    for (let index = 1; index < parts.length; index++) {
      const previous = parts[index - 1]
      const next = parts[index]
      if (!previous.transferKey || !next.transferKey || previous.transferKey === next.transferKey) continue
      const previousEnd = partEndpoint(previous, 'end')
      const nextStart = partEndpoint(next, 'start')
      if (!previousEnd || !nextStart) continue
      const position = samePoint(previousEnd, nextStart) ? nextStart : previousEnd
      const last = points[points.length - 1]
      if (last && samePoint(last.position, position)) continue
      points.push({
        position,
        color: next.color || previous.color || DEFAULT_ROUTE_COLOR,
        casingColor: next.casingColor || previous.casingColor || DEFAULT_ROUTE_CASING_COLOR,
      })
    }
  }
  return points
}
