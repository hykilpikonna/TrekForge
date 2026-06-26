export interface GoogleMapsPreviewOpeningPoint {
  day: number;
  hour: number;
  minute: number;
}

export interface GoogleMapsPreviewOpeningPeriod {
  open: GoogleMapsPreviewOpeningPoint;
  close?: GoogleMapsPreviewOpeningPoint;
}

export interface GoogleMapsPreviewPlaceDetails {
  google_place_id: string | null;
  google_ftid: string | null;
  name: string;
  address: string;
  lat: number | null;
  lng: number | null;
  rating: number | null;
  rating_count: number | null;
  website: string | null;
  phone: string | null;
  opening_hours: string[] | null;
  opening_periods: GoogleMapsPreviewOpeningPeriod[] | null;
  open_now: boolean | null;
  business_status: string | null;
  google_maps_url: string | null;
  summary: string | null;
  reviews: unknown[];
  source: 'google';
  raw?: unknown;
}

export interface GoogleMapsPreviewPlaceDetailsRequest {
  ftid?: string | null;
  placeId?: string | null;
  query?: string | null;
  language?: string;
  region?: string;
  timeoutMs?: number;
  includeRaw?: boolean;
}

const GOOGLE_MAPS_PREVIEW_PLACE_ENDPOINT = 'https://www.google.com/maps/preview/place';
const GOOGLE_MAPS_SEARCH_ENDPOINT = 'https://www.google.com/search';
const GOOGLE_MAPS_PREVIEW_XSSI_PREFIX = ")]}'\n";
const DEFAULT_LANGUAGE = 'en';
const DEFAULT_REGION = 'ca';
const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_TIMEOUT_MS = 30_000;
const DAY_MINUTES = 24 * 60;
const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export const GOOGLE_MAPS_FTID_RE = /^0x[0-9a-f]+:0x[0-9a-f]+$/i;

function makeHttpError(status: number, message: string): Error & { status: number } {
  return Object.assign(new Error(message), { status });
}

function finiteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function normalizeFtid(value?: string | null): string | null {
  const trimmed = value?.trim();
  return trimmed && GOOGLE_MAPS_FTID_RE.test(trimmed) ? trimmed.toLowerCase() : null;
}

function normalizeRequest(input: GoogleMapsPreviewPlaceDetailsRequest): Required<Pick<GoogleMapsPreviewPlaceDetailsRequest, 'language' | 'region' | 'timeoutMs'>> & GoogleMapsPreviewPlaceDetailsRequest {
  const ftid = normalizeFtid(input.ftid ?? null);
  const query = nonEmptyString(input.query);
  const placeId = nonEmptyString(input.placeId);
  if (!ftid && !query && !placeId) {
    throw makeHttpError(400, 'Google Maps preview place details require an ftid, placeId, or query');
  }

  return {
    ...input,
    ftid,
    placeId,
    query,
    language: nonEmptyString(input.language) ?? DEFAULT_LANGUAGE,
    region: nonEmptyString(input.region) ?? DEFAULT_REGION,
    timeoutMs: finiteNumber(input.timeoutMs)
      ? Math.min(Math.max(input.timeoutMs, 1), MAX_TIMEOUT_MS)
      : DEFAULT_TIMEOUT_MS,
  };
}

function buildPreviewPlaceUrl(request: ReturnType<typeof normalizeRequest>): string | null {
  if (!request.ftid) return null;
  const query = new URLSearchParams({
    authuser: '0',
    hl: request.language,
    gl: request.region,
    pf: 't',
  });
  if (request.query || request.placeId) query.set('q', request.query || request.placeId || '');
  return `${GOOGLE_MAPS_PREVIEW_PLACE_ENDPOINT}?${query.toString()}&pb=!1m1!1s${encodeURIComponent(request.ftid)}`;
}

function buildSearchUrl(request: ReturnType<typeof normalizeRequest>): string | null {
  const searchText = request.query || request.placeId;
  if (!searchText) return null;
  const query = new URLSearchParams({
    tbm: 'map',
    authuser: '0',
    hl: request.language,
    gl: request.region,
    q: searchText,
  });
  return `${GOOGLE_MAPS_SEARCH_ENDPOINT}?${query.toString()}`;
}

export function buildGoogleMapsPreviewPlaceDetailsUrls(input: GoogleMapsPreviewPlaceDetailsRequest): string[] {
  const request = normalizeRequest(input);
  return [buildPreviewPlaceUrl(request), buildSearchUrl(request)].filter((url): url is string => Boolean(url));
}

function stripGoogleWrapper(text: string): string {
  let body = text.trim().replace(/\/\*""\*\/\s*$/, '');
  if (body.startsWith('{')) {
    try {
      const outer = JSON.parse(body) as { d?: unknown };
      if (typeof outer.d === 'string') body = outer.d;
    } catch {
      // Fall through to the regular XSSI JSON parse below.
    }
  }
  return body.startsWith(GOOGLE_MAPS_PREVIEW_XSSI_PREFIX)
    ? body.slice(GOOGLE_MAPS_PREVIEW_XSSI_PREFIX.length)
    : body;
}

function parseJsonResponse(text: string): unknown {
  try {
    return JSON.parse(stripGoogleWrapper(text));
  } catch (err) {
    throw makeHttpError(
      502,
      `Unable to parse Google Maps preview place response: ${err instanceof Error ? err.message : 'invalid JSON'}`,
    );
  }
}

function isPlaceTuple(value: unknown): value is unknown[] {
  return Array.isArray(value)
    && typeof value[10] === 'string'
    && GOOGLE_MAPS_FTID_RE.test(value[10])
    && (typeof value[11] === 'string' || typeof value[78] === 'string' || Array.isArray(value[9]));
}

function tupleMatches(tuple: unknown[], request: ReturnType<typeof normalizeRequest>): boolean {
  const ftid = normalizeFtid(tuple[10] as string | null);
  if (request.ftid && ftid === request.ftid) return true;
  if (request.placeId && tuple[78] === request.placeId) return true;
  if (request.query && typeof tuple[11] === 'string' && tuple[11].toLowerCase() === request.query.toLowerCase()) return true;
  return !request.ftid && !request.placeId && !request.query;
}

function findPlaceTuple(root: unknown, request: ReturnType<typeof normalizeRequest>): unknown[] | null {
  if (Array.isArray(root) && isPlaceTuple(root[6]) && tupleMatches(root[6], request)) return root[6];

  const stack: unknown[] = [root];
  let first: unknown[] | null = null;
  while (stack.length) {
    const value = stack.pop();
    if (!Array.isArray(value)) continue;
    if (isPlaceTuple(value)) {
      if (!first) first = value;
      if (tupleMatches(value, request)) return value;
    }
    for (let i = value.length - 1; i >= 0; i--) stack.push(value[i]);
  }
  return request.ftid || request.placeId ? null : first;
}

function googleDayFromPreview(value: unknown): number | null {
  if (!Number.isInteger(value)) return null;
  const day = value as number;
  if (day === 7) return 0;
  return day >= 0 && day <= 6 ? day : null;
}

function openingPoint(day: number, minutes: number): GoogleMapsPreviewOpeningPoint {
  const normalized = ((minutes % DAY_MINUTES) + DAY_MINUTES) % DAY_MINUTES;
  return {
    day: ((day + Math.floor(minutes / DAY_MINUTES)) % 7 + 7) % 7,
    hour: Math.floor(normalized / 60),
    minute: normalized % 60,
  };
}

function previewTimeTupleToMinutes(value: unknown): number | null {
  if (!Array.isArray(value)) return null;
  if (value.length === 0) return 0;
  const hour = finiteNumber(value[0]) ? value[0] : null;
  const minute = finiteNumber(value[1]) ? value[1] : 0;
  if (hour === null || !Number.isInteger(hour) || !Number.isInteger(minute)) return null;
  if (hour === 24 && minute === 0) return DAY_MINUTES;
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return hour * 60 + minute;
}

function legacyTimeTupleToMinutes(value: unknown): number | null {
  if (!Array.isArray(value)) return null;
  const hour = finiteNumber(value[2]) ? value[2] : null;
  const minute = finiteNumber(value[1]) ? value[1] : 0;
  if (hour === null || !Number.isInteger(hour) || !Number.isInteger(minute)) return null;
  if (hour === 24 && minute === 0) return DAY_MINUTES;
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return hour * 60 + minute;
}

function periodForRange(day: number, startMinutes: number, endMinutes: number): GoogleMapsPreviewOpeningPeriod {
  let closeDay = day;
  let closeMinutes = endMinutes;
  if (endMinutes <= startMinutes) closeDay = (day + 1) % 7;
  if (endMinutes >= DAY_MINUTES) {
    closeDay = (day + Math.floor(endMinutes / DAY_MINUTES)) % 7;
    closeMinutes = endMinutes % DAY_MINUTES;
  }
  return {
    open: openingPoint(day, startMinutes),
    close: openingPoint(closeDay, closeMinutes),
  };
}

function timeLabel(minutes: number): string {
  const normalized = ((minutes % DAY_MINUTES) + DAY_MINUTES) % DAY_MINUTES;
  const hour = Math.floor(normalized / 60);
  const minute = normalized % 60;
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function buildWeekdayDescriptions(dayLabels: Map<number, string[]>): string[] {
  return [1, 2, 3, 4, 5, 6, 0].map((day) => {
    const labels = dayLabels.get(day);
    return `${WEEKDAY_NAMES[day]}: ${labels?.length ? labels.join(', ') : 'Closed'}`;
  });
}

function parseStructuredWeeklyHours(value: unknown): { opening_hours: string[]; opening_periods: GoogleMapsPreviewOpeningPeriod[] } | null {
  const rows = Array.isArray(value) && Array.isArray(value[0]) ? value[0] : null;
  if (!rows) return null;

  const seenDays = new Set<number>();
  const periods: GoogleMapsPreviewOpeningPeriod[] = [];
  const labelsByDay = new Map<number, string[]>();

  for (const row of rows) {
    if (!Array.isArray(row)) continue;
    const day = googleDayFromPreview(row[1]);
    const ranges = Array.isArray(row[3]) ? row[3] : [];
    if (day === null) continue;
    seenDays.add(day);
    if (!labelsByDay.has(day)) labelsByDay.set(day, []);

    for (const range of ranges) {
      if (!Array.isArray(range)) continue;
      const label = nonEmptyString(range[0]);
      if (label) labelsByDay.get(day)!.push(label);
      if (label && /closed/i.test(label)) continue;
      if (label && /24\s*hours|open\s*24/i.test(label)) {
        periods.push(periodForRange(day, 0, DAY_MINUTES));
        continue;
      }

      const timePair = Array.isArray(range[1]) ? range[1] : null;
      const start = previewTimeTupleToMinutes(timePair?.[0]);
      const end = previewTimeTupleToMinutes(timePair?.[1]);
      if (start === null || end === null) continue;
      periods.push(periodForRange(day, start, end));
    }
  }

  if (seenDays.size < 7) return null;
  return {
    opening_hours: buildWeekdayDescriptions(labelsByDay),
    opening_periods: periods,
  };
}

function parseLegacyWeeklyHours(value: unknown): { opening_hours: string[]; opening_periods: GoogleMapsPreviewOpeningPeriod[] } | null {
  const groups = Array.isArray(value) && Array.isArray(value[0]) ? value[0] : null;
  if (!groups) return null;

  const periods: GoogleMapsPreviewOpeningPeriod[] = [];
  const labelsByDay = new Map<number, string[]>();

  for (const group of groups) {
    if (!Array.isArray(group)) continue;
    for (const rule of group) {
      if (!Array.isArray(rule)) continue;
      const dayRange = Array.isArray(rule[0]) ? rule[0] : null;
      const timeRange = Array.isArray(rule[1]) ? rule[1] : null;
      const startRaw = Array.isArray(dayRange?.[5]) ? dayRange[5][3] : null;
      const endRaw = Array.isArray(dayRange?.[6]) ? dayRange[6][3] : null;
      const startDay = googleDayFromPreview(startRaw);
      const endDay = googleDayFromPreview(endRaw);
      const startMinutes = legacyTimeTupleToMinutes(timeRange?.[5]);
      const endMinutes = legacyTimeTupleToMinutes(timeRange?.[6]);
      if (startDay === null || endDay === null || startMinutes === null || endMinutes === null) continue;

      for (let offset = 0; offset < 7; offset++) {
        const day = (startDay + offset) % 7;
        if (!labelsByDay.has(day)) labelsByDay.set(day, []);
        labelsByDay.get(day)!.push(`${timeLabel(startMinutes)}-${timeLabel(endMinutes)}`);
        periods.push(periodForRange(day, startMinutes, endMinutes));
        if (((day + 1) % 7) === endDay) break;
      }
    }
  }

  if (periods.length === 0) return null;
  return {
    opening_hours: buildWeekdayDescriptions(labelsByDay),
    opening_periods: periods,
  };
}

function parseOpeningHours(tuple: unknown[]): Pick<GoogleMapsPreviewPlaceDetails, 'opening_hours' | 'opening_periods'> {
  const hours = parseStructuredWeeklyHours(tuple[203]) ?? parseLegacyWeeklyHours(tuple[24]);
  return {
    opening_hours: hours?.opening_hours ?? null,
    opening_periods: hours?.opening_periods?.length ? hours.opening_periods : null,
  };
}

function parseOpenNow(tuple: unknown[]): boolean | null {
  const statusRows = Array.isArray(tuple[203]) && Array.isArray(tuple[203][1]) ? tuple[203][1] : null;
  const candidates = [
    statusRows?.[8],
    statusRows?.[4],
    statusRows?.[5],
  ];
  for (const candidate of candidates) {
    const text = Array.isArray(candidate) ? nonEmptyString(candidate[0]) : null;
    if (!text) continue;
    if (/^open\b/i.test(text)) return true;
    if (/^closed\b/i.test(text)) return false;
  }
  return null;
}

function parseBusinessStatus(tuple: unknown[]): string | null {
  const raw = Array.isArray(tuple[88]) ? nonEmptyString(tuple[88][0]) : null;
  if (!raw) return null;
  const status = raw.toUpperCase();
  if (status === 'CLOSED' || status.includes('PERMANENTLY_CLOSED') || status.includes('PERMANENTLY CLOSED')) {
    return 'CLOSED_PERMANENTLY';
  }
  if (status.includes('TEMPORAR')) return 'CLOSED_TEMPORARILY';
  return 'OPERATIONAL';
}

function parseGoogleMapsUrl(tuple: unknown[]): string | null {
  const ftid = normalizeFtid(tuple[10] as string | null);
  const placeId = nonEmptyString(tuple[78]);
  const name = nonEmptyString(tuple[11]);
  if (placeId) {
    const query = encodeURIComponent(name || placeId);
    return `https://www.google.com/maps/search/?api=1&query=${query}&query_place_id=${encodeURIComponent(placeId)}`;
  }
  return ftid ? `https://www.google.com/maps?ftid=${encodeURIComponent(ftid)}` : null;
}

function normalizePlaceTuple(tuple: unknown[], request: ReturnType<typeof normalizeRequest>): GoogleMapsPreviewPlaceDetails {
  const coords = Array.isArray(tuple[9]) ? tuple[9] : [];
  const ratingBlock = Array.isArray(tuple[4]) ? tuple[4] : [];
  const websiteBlock = Array.isArray(tuple[7]) ? tuple[7] : [];
  const phoneBlock = Array.isArray(tuple[178]) && Array.isArray(tuple[178][0]) ? tuple[178][0] : [];
  const openingHours = parseOpeningHours(tuple);

  return {
    google_place_id: nonEmptyString(tuple[78]),
    google_ftid: normalizeFtid(tuple[10] as string | null) ?? request.ftid ?? null,
    name: nonEmptyString(tuple[11]) ?? '',
    address: nonEmptyString(tuple[18]) ?? '',
    lat: finiteNumber(coords[2]) ? coords[2] : null,
    lng: finiteNumber(coords[3]) ? coords[3] : null,
    rating: finiteNumber(ratingBlock[7]) ? ratingBlock[7] : null,
    rating_count: finiteNumber(ratingBlock[8]) ? ratingBlock[8] : null,
    website: nonEmptyString(websiteBlock[0]),
    phone: nonEmptyString(phoneBlock[0]),
    opening_hours: openingHours.opening_hours,
    opening_periods: openingHours.opening_periods,
    open_now: parseOpenNow(tuple),
    business_status: parseBusinessStatus(tuple),
    google_maps_url: parseGoogleMapsUrl(tuple),
    summary: null,
    reviews: [],
    source: 'google',
    ...(request.includeRaw ? { raw: tuple } : {}),
  };
}

export function parseGoogleMapsPreviewPlaceDetailsResponse(
  text: string,
  input: GoogleMapsPreviewPlaceDetailsRequest = {},
): GoogleMapsPreviewPlaceDetails {
  const request = normalizeRequest(input);
  const parsed = parseJsonResponse(text);
  const tuple = findPlaceTuple(parsed, request);
  if (!tuple) throw makeHttpError(404, 'Google Maps preview place details not found');
  return normalizePlaceTuple(tuple, request);
}

async function fetchText(url: string, request: ReturnType<typeof normalizeRequest>): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), request.timeoutMs);
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36',
        Accept: '*/*',
        'Accept-Language': `${request.language},en;q=0.9`,
        Referer: 'https://www.google.com/',
        'Cache-Control': 'no-cache',
        Pragma: 'no-cache',
      },
      signal: controller.signal,
    });
    const text = await response.text();
    if (!response.ok) {
      throw makeHttpError(response.status, `Google Maps preview place error: ${response.status} ${response.statusText}`);
    }
    return text;
  } catch (err) {
    if ((err as { status?: number }).status) throw err;
    if ((err as { name?: string }).name === 'AbortError') {
      throw makeHttpError(504, 'Google Maps preview place request timed out');
    }
    throw makeHttpError(
      502,
      `Google Maps preview place request failed: ${err instanceof Error ? err.message : 'unknown error'}`,
    );
  } finally {
    clearTimeout(timeout);
  }
}

export async function fetchGoogleMapsPreviewPlaceDetails(
  input: GoogleMapsPreviewPlaceDetailsRequest,
): Promise<GoogleMapsPreviewPlaceDetails> {
  const request = normalizeRequest(input);
  const urls = buildGoogleMapsPreviewPlaceDetailsUrls(request);
  let lastError: unknown = null;

  for (const url of urls) {
    try {
      const text = await fetchText(url, request);
      return parseGoogleMapsPreviewPlaceDetailsResponse(text, request);
    } catch (err) {
      lastError = err;
      if (!request.query && !request.placeId) break;
    }
  }

  if (lastError) throw lastError;
  throw makeHttpError(404, 'Google Maps preview place details not found');
}
