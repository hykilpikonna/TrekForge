import { db } from '../db/database';
import {
  getCachedRouteLeg,
  setCachedRouteLeg,
  clearRouteCache,
} from '../db/trekforge';
import {
  fetchGoogleMapsPreviewDirections,
  type GoogleMapsPreviewDirectionsRequest,
  type GoogleMapsPreviewDirectionsMode,
} from './googleMapsPreviewDirections';
import {
  fetchGoogleMapsMobileDirections,
  type GoogleMapsMobileDirectionsRequest,
} from './googleMapsMobileDirections';

export interface RoutePoint {
  lat: number;
  lng: number;
  name?: string | null;
  address?: string | null;
}

export interface RouteLegResult {
  durationSeconds: number;
  distanceMeters: number;
}

export interface RouteLegOptions {
  provider?: 'osrm' | 'google_maps' | 'google_maps_mobile';
  profile?: 'driving' | 'walking' | 'cycling' | 'transit';
  optimism?: number;
  avoidTolls?: boolean;
  avoidHighways?: boolean;
  avoidFerries?: boolean;
  departureLocalDateTime?: string | null;
  timeoutMs?: number;
  signal?: AbortSignal;
}

const OSRM_PROFILE_BASE = {
  driving: 'https://routing.openstreetmap.de/routed-car/route/v1/driving',
  walking: 'https://routing.openstreetmap.de/routed-foot/route/v1/foot',
  cycling: 'https://routing.openstreetmap.de/routed-bike/route/v1/bike',
} as const;

const routeCache = new Map<string, RouteLegResult>();
const MAX_CACHE_SIZE = 500;

export function clearRouteCacheForTests(): void {
  routeCache.clear();
  try {
    clearRouteCache(db);
  } catch {
    // Non-fatal in tests with stubbed db
  }
}

export async function calculateRouteLeg(
  from: RoutePoint,
  to: RoutePoint,
  options: RouteLegOptions = {},
): Promise<RouteLegResult> {
  const fromLat = Number(from.lat);
  const fromLng = Number(from.lng);
  const toLat = Number(to.lat);
  const toLng = Number(to.lng);

  if (
    !Number.isFinite(fromLat) ||
    !Number.isFinite(fromLng) ||
    !Number.isFinite(toLat) ||
    !Number.isFinite(toLng)
  ) {
    return { durationSeconds: 0, distanceMeters: 0 };
  }

  if (fromLat === toLat && fromLng === toLng) {
    return { durationSeconds: 0, distanceMeters: 0 };
  }

  const provider = options.provider || 'osrm';
  const profile = options.profile || 'driving';
  const departure = options.departureLocalDateTime || null;
  const timeoutMs = options.timeoutMs ?? 5000;

  const cacheKey = `${provider}:${profile}:${departure || ''}:${options.avoidTolls ? 1 : 0}:${options.avoidHighways ? 1 : 0}:${options.avoidFerries ? 1 : 0}:${fromLat.toFixed(6)},${fromLng.toFixed(6)}->${toLat.toFixed(6)},${toLng.toFixed(6)}`;

  if (routeCache.has(cacheKey)) {
    return routeCache.get(cacheKey)!;
  }

  try {
    const persisted = getCachedRouteLeg(db, cacheKey);
    if (persisted) {
      routeCache.set(cacheKey, persisted);
      return persisted;
    }
  } catch {
    // Non-fatal if DB read fails
  }

  let result: RouteLegResult = { durationSeconds: 0, distanceMeters: 0 };

  try {
    if (provider === 'google_maps') {
      result = await calculateGooglePreviewLeg(
        fromLat,
        fromLng,
        toLat,
        toLng,
        from.name,
        to.name,
        profile,
        departure,
        options,
        timeoutMs,
      );
    } else if (provider === 'google_maps_mobile') {
      if (profile === 'driving') {
        result = await calculateGoogleMobileLeg(
          fromLat,
          fromLng,
          toLat,
          toLng,
          departure,
          options,
          timeoutMs,
        );
      } else {
        result = await calculateGooglePreviewLeg(
          fromLat,
          fromLng,
          toLat,
          toLng,
          from.name,
          to.name,
          profile,
          departure,
          options,
          timeoutMs,
        );
      }
    } else {
      result = await calculateOsrmLeg(
        fromLat,
        fromLng,
        toLat,
        toLng,
        profile,
        timeoutMs,
        options.signal,
      );
    }
  } catch {
    if (provider !== 'osrm') {
      try {
        result = await calculateOsrmLeg(
          fromLat,
          fromLng,
          toLat,
          toLng,
          profile,
          timeoutMs,
          options.signal,
        );
      } catch {
        result = { durationSeconds: 0, distanceMeters: 0 };
      }
    } else {
      result = { durationSeconds: 0, distanceMeters: 0 };
    }
  }

  if (routeCache.size >= MAX_CACHE_SIZE) {
    const firstKey = routeCache.keys().next().value;
    if (firstKey !== undefined) routeCache.delete(firstKey);
  }
  routeCache.set(cacheKey, result);

  if (result.durationSeconds > 0 || result.distanceMeters > 0) {
    try {
      setCachedRouteLeg(db, {
        cacheKey,
        provider,
        profile,
        fromLat,
        fromLng,
        toLat,
        toLng,
        durationSeconds: result.durationSeconds,
        distanceMeters: result.distanceMeters,
      });
    } catch {
      // Non-fatal if DB write fails
    }
  }

  return result;
}

async function calculateOsrmLeg(
  fromLat: number,
  fromLng: number,
  toLat: number,
  toLng: number,
  profile: 'driving' | 'walking' | 'cycling' | 'transit',
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<RouteLegResult> {
  const osrmProfile =
    profile === 'walking' ? 'walking' : profile === 'cycling' ? 'cycling' : 'driving';
  const coords = `${fromLng},${fromLat};${toLng},${toLat}`;
  const base = OSRM_PROFILE_BASE[osrmProfile];
  const url = `${base}/${coords}?overview=false&geometries=geojson&annotations=distance,duration`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  if (signal) {
    signal.addEventListener('abort', () => controller.abort());
  }

  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) {
      const fallbackUrl = `https://router.project-osrm.org/route/v1/${osrmProfile}/${coords}?overview=false&geometries=geojson&annotations=distance,duration`;
      const fallbackRes = await fetch(fallbackUrl, { signal: controller.signal });
      if (!fallbackRes.ok) return { durationSeconds: 0, distanceMeters: 0 };
      const fallbackData = (await fallbackRes.json()) as any;
      if (fallbackData?.code !== 'Ok' || !fallbackData?.routes?.[0]) {
        return { durationSeconds: 0, distanceMeters: 0 };
      }
      return parseOsrmRoute(fallbackData.routes[0], osrmProfile);
    }
    const data = (await res.json()) as any;
    if (data?.code !== 'Ok' || !data?.routes?.[0]) {
      return { durationSeconds: 0, distanceMeters: 0 };
    }
    return parseOsrmRoute(data.routes[0], osrmProfile);
  } finally {
    clearTimeout(timeoutId);
  }
}

function parseOsrmRoute(route: any, profile: 'driving' | 'walking' | 'cycling'): RouteLegResult {
  const distance = Number(route.distance) || 0;
  let duration = Number(route.duration) || 0;
  if (profile === 'walking') {
    duration = distance / (5000 / 3600);
  } else if (profile === 'cycling') {
    duration = distance / (15000 / 3600);
  }
  return {
    durationSeconds: Math.max(0, Math.round(duration)),
    distanceMeters: Math.max(0, Math.round(distance)),
  };
}

async function calculateGooglePreviewLeg(
  fromLat: number,
  fromLng: number,
  toLat: number,
  toLng: number,
  fromName: string | null | undefined,
  toName: string | null | undefined,
  profile: 'driving' | 'walking' | 'cycling' | 'transit',
  departure: string | null,
  options: RouteLegOptions,
  timeoutMs: number,
): Promise<RouteLegResult> {
  const mode: GoogleMapsPreviewDirectionsMode =
    profile === 'cycling'
      ? 'bicycling'
      : profile === 'walking'
        ? 'walking'
        : profile === 'transit'
          ? 'transit'
          : 'driving';
  const req: GoogleMapsPreviewDirectionsRequest = {
    origin: { lat: fromLat, lng: fromLng, label: fromName || undefined },
    destination: { lat: toLat, lng: toLng, label: toName || undefined },
    mode,
    avoidTolls: options.avoidTolls,
    avoidHighways: options.avoidHighways,
    avoidFerries: options.avoidFerries,
    timeoutMs,
    ...(departure ? { time: { kind: 'departAtLocal', localDateTime: departure } } : {}),
  };
  const res = await fetchGoogleMapsPreviewDirections(req);
  if (!res.routes || res.routes.length === 0) {
    return { durationSeconds: 0, distanceMeters: 0 };
  }
  const route = res.routes[0];
  const durationSeconds = route.duration?.seconds ?? (route.legs?.[0]?.duration?.seconds ?? 0);
  const distanceMeters = route.distance?.meters ?? (route.legs?.[0]?.distance?.meters ?? 0);
  return {
    durationSeconds: Math.max(0, Math.round(Number(durationSeconds) || 0)),
    distanceMeters: Math.max(0, Math.round(Number(distanceMeters) || 0)),
  };
}

async function calculateGoogleMobileLeg(
  fromLat: number,
  fromLng: number,
  toLat: number,
  toLng: number,
  departure: string | null,
  options: RouteLegOptions,
  timeoutMs: number,
): Promise<RouteLegResult> {
  const req: GoogleMapsMobileDirectionsRequest = {
    from: { lat: fromLat, lng: fromLng },
    to: { lat: toLat, lng: toLng },
    ...(departure ? { departureTime: { kind: 'departAtLocal', localDateTime: departure } } : {}),
    options: {
      mode: 'driving',
      avoidTolls: options.avoidTolls,
      avoidHighways: options.avoidHighways,
      avoidFerries: options.avoidFerries,
      timeoutMs,
    },
  };
  const res = await fetchGoogleMapsMobileDirections(req);
  if (!res.routes || res.routes.length === 0) {
    return { durationSeconds: 0, distanceMeters: 0 };
  }
  const route = res.routes[0];
  const durationSeconds = route.duration?.seconds ?? 0;
  const distanceMeters = route.distance?.meters ?? 0;
  return {
    durationSeconds: Math.max(0, Math.round(Number(durationSeconds) || 0)),
    distanceMeters: Math.max(0, Math.round(Number(distanceMeters) || 0)),
  };
}

export function getDayOrder(
  day: { id: number; day_number?: number | null },
  days: Array<{ id: number; day_number?: number | null }>,
): number {
  return day.day_number ?? days.indexOf(day);
}

export function isDayInAccommodationRange(
  day: { id: number; day_number?: number | null },
  startDayId: number,
  endDayId: number,
  days: Array<{ id: number; day_number?: number | null }>,
): boolean {
  const startDay = days.find((d) => d.id === startDayId);
  const endDay = days.find((d) => d.id === endDayId);
  if (!startDay || !endDay) {
    return (
      day.id >= Math.min(startDayId, endDayId) && day.id <= Math.max(startDayId, endDayId)
    );
  }
  const lo = Math.min(getDayOrder(startDay, days), getDayOrder(endDay, days));
  const hi = Math.max(getDayOrder(startDay, days), getDayOrder(endDay, days));
  const ord = getDayOrder(day, days);
  return ord >= lo && ord <= hi;
}

export function getDayBookendHotels(
  day: { id: number; day_number?: number | null },
  days: Array<{ id: number; day_number?: number | null }>,
  accommodations: any[],
): { morning?: any; evening?: any; morningIsSleptHere?: boolean; eveningIsOvernight?: boolean } {
  const inRange = accommodations.filter(
    (a) =>
      a.place_lat != null &&
      a.place_lng != null &&
      isDayInAccommodationRange(day, a.start_day_id, a.end_day_id, days),
  );
  if (inRange.length === 0) return {};

  const dayOrd = getDayOrder(day, days);
  const orderOf = (id: number) => {
    const d = days.find((x) => x.id === id);
    return d ? getDayOrder(d, days) : dayOrd;
  };
  const checkIn = inRange.find((a) => a.start_day_id === day.id);
  const sleptHere = inRange.find((a) => orderOf(a.start_day_id) < dayOrd);

  return {
    morning: sleptHere ?? checkIn ?? inRange[0],
    evening: checkIn ?? sleptHere ?? inRange[0],
    morningIsSleptHere: sleptHere != null,
    eveningIsOvernight:
      checkIn != null || (sleptHere != null && orderOf(sleptHere.end_day_id) > dayOrd),
  };
}

function parseClockMinutes(t?: string | null): number | null {
  if (!t) return null;
  const [h, min] = t.split(':').map(Number);
  return Number.isFinite(h) && Number.isFinite(min) ? h * 60 + min : null;
}

export function shouldDrawMorningLeg(
  bookends: { morning?: any; morningIsSleptHere?: boolean },
  day: { id: number },
  firstStop?: { isPlace: boolean; time?: string | null },
): boolean {
  if (bookends.morningIsSleptHere) return true;
  const m = bookends.morning;
  if (!m || m.start_day_id !== day.id || !firstStop?.isPlace) return false;
  const checkIn = parseClockMinutes(m.check_in);
  const stop = parseClockMinutes(firstStop.time);
  return !(checkIn != null && stop != null && stop < checkIn);
}

export function shouldDrawEveningLeg(
  bookends: { evening?: any; eveningIsOvernight?: boolean },
  day: { id: number },
  lastStop?: { isPlace: boolean; time?: string | null },
): boolean {
  if (bookends.eveningIsOvernight) return true;
  const e = bookends.evening;
  if (!e || e.end_day_id !== day.id || !lastStop?.isPlace) return false;
  const checkOut = parseClockMinutes(e.check_out);
  const stop = parseClockMinutes(lastStop.time);
  return checkOut != null && stop != null && stop <= checkOut;
}
