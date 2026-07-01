import {
  type ProtoField,
  allProtoMessages as allMessages,
  firstProtoMessage as firstMessage,
  firstProtoVarint as firstVarint,
  isProtoText as isText,
  parseProtoMessage as parseMessage,
  protoFieldStrings as fieldStrings,
  readVarint,
  tryParseProtoMessage as tryParseMessage,
} from './googleMapsMobile/protobuf';
import { GOOGLE_MAPS_MOBILE_MMAP_ENDPOINT, buildMmapDirectionsRequestBody } from './googleMapsMobile/reversedProto';

import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import tzLookup from 'tz-lookup';

export type GoogleMapsMobileDirectionsLocation =
  | string
  | {
      text?: string;
      label?: string;
      address?: string;
      lat?: number;
      lng?: number;
      placeId?: string;
      dataId?: string;
      cid?: string;
    };

export type GoogleMapsMobileDirectionsDepartureTime =
  | number
  | string
  | { kind: 'departAt'; epochSeconds: number; timeZone?: string }
  | { kind: 'departAtLocal'; localDateTime: string; timeZone?: string }
  | { kind: 'raw'; googleMapsEpochSeconds: number; timeZone?: string };

export interface GoogleMapsMobileDirectionsOptions {
  language?: string;
  region?: string;
  timeZone?: string;
  timeoutMs?: number;
  includeRaw?: boolean;
  includeDebug?: boolean;
  avoidTolls?: boolean;
  avoidHighways?: boolean;
  avoidFerries?: boolean;
}

export interface GoogleMapsMobileDirectionsRequest {
  from: GoogleMapsMobileDirectionsLocation;
  to: GoogleMapsMobileDirectionsLocation;
  departureTime?: GoogleMapsMobileDirectionsDepartureTime;
  options?: GoogleMapsMobileDirectionsOptions;
}

export interface GoogleMapsMobileDirectionsDuration {
  seconds: number | null;
  text: string | null;
}

export interface GoogleMapsMobileDirectionsDistance {
  meters: number | null;
  text: string | null;
}

export interface GoogleMapsMobileDirectionsMoney {
  amount: number | null;
  text: string | null;
  currency: string | null;
  label: string | null;
}

export interface GoogleMapsMobileDirectionsTrafficPrediction {
  optimistic: GoogleMapsMobileDirectionsDuration;
  pessimistic: GoogleMapsMobileDirectionsDuration;
  text: string | null;
}

export interface GoogleMapsMobileDirectionsLatLng {
  lat: number;
  lng: number;
}

export interface GoogleMapsMobileDirectionsStep {
  instruction: string | null;
  maneuver: string | null;
  distance: GoogleMapsMobileDirectionsDistance;
}

export interface GoogleMapsMobileDirectionsRoute {
  index: number;
  title: string | null;
  distance: GoogleMapsMobileDirectionsDistance;
  duration: GoogleMapsMobileDirectionsDuration;
  trafficPrediction: GoogleMapsMobileDirectionsTrafficPrediction | null;
  tollFee: GoogleMapsMobileDirectionsMoney | null;
  overviewGeometry?: GoogleMapsMobileDirectionsLatLng[];
  steps?: GoogleMapsMobileDirectionsStep[];
}

export interface GoogleMapsMobileDirectionsResult {
  source: 'google-mobile-mmap';
  from: string;
  to: string;
  departureTime: {
    googleMapsEpochSeconds: number;
    timeKindEnum: number;
    timeZone: string;
  } | null;
  optimisticDuration: GoogleMapsMobileDirectionsDuration | null;
  pessimisticDuration: GoogleMapsMobileDirectionsDuration | null;
  predictionText: string | null;
  tollFee: GoogleMapsMobileDirectionsMoney | null;
  routes: GoogleMapsMobileDirectionsRoute[];
  debug?: {
    endpoint: string;
    requestBytes: number;
    responseBytes: number;
    gzipOffset: number;
    protobufBytes: number;
  };
  raw?: {
    protobufBase64: string;
  };
}

interface NormalizedLocation {
  text: string;
  lat?: number;
  lng?: number;
  placeId?: string;
  dataId?: string;
}

interface NormalizedRequest {
  from: NormalizedLocation;
  to: NormalizedLocation;
  departureTime?: GoogleMapsMobileDirectionsDepartureTime;
  options: Required<Pick<GoogleMapsMobileDirectionsOptions, 'language' | 'region' | 'timeoutMs'>> &
    Omit<GoogleMapsMobileDirectionsOptions, 'language' | 'region' | 'timeoutMs'>;
}

interface BuiltMobileRequest {
  endpoint: string;
  body: Buffer;
  headers: Record<string, string>;
  departureTime: GoogleMapsMobileDirectionsResult['departureTime'];
}

const DEFAULT_LANGUAGE = 'en-US,en;q=0.9';
const DEFAULT_REGION = 'JP';
const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_TIMEOUT_MS = 30_000;
const MAX_LOCATION_TEXT_LENGTH = 500;
const TIME_KIND_DEPART_AT = 2;
const RESPONSE_CACHE_MAX = 200;
const responseCache = new Map<string, Buffer>();
const inFlightResponses = new Map<string, Promise<Buffer>>();

function makeHttpError(status: number, message: string): Error & { status: number } {
  return Object.assign(new Error(message), { status });
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw makeHttpError(400, 'Mobile directions request body must be an object');
  }
  return value as Record<string, unknown>;
}

function finiteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function formatCoordinateText(value: number): string {
  const rounded = roundCoordinate(value);
  return Object.is(rounded, -0) ? '0' : String(rounded);
}

function formatLatLngText(lat: number, lng: number): string {
  return `${formatCoordinateText(lat)},${formatCoordinateText(lng)}`;
}

function roundCoordinate(value: number): number {
  const rounded = Number(value.toFixed(7));
  return Object.is(rounded, -0) ? 0 : rounded;
}

function optionalString(value: unknown, field: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') throw makeHttpError(400, `${field} must be a string`);
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function validateLocation(value: unknown, field: string): NormalizedLocation {
  if (typeof value === 'string') {
    const text = value.trim();
    if (!text) throw makeHttpError(400, `${field} must not be empty`);
    if (text.length > MAX_LOCATION_TEXT_LENGTH) throw makeHttpError(400, `${field} is too long`);
    return { text };
  }

  const body = asRecord(value);
  const text =
    optionalString(body.text, `${field}.text`) ??
    optionalString(body.label, `${field}.label`) ??
    optionalString(body.address, `${field}.address`);

  const lat = body.lat;
  const lng = body.lng;
  if ((lat !== undefined || lng !== undefined) && (!finiteNumber(lat) || !finiteNumber(lng))) {
    throw makeHttpError(400, `${field}.lat and ${field}.lng must both be finite numbers when provided`);
  }
  const hasCoordinates = finiteNumber(lat) && finiteNumber(lng);
  if (!text && !hasCoordinates) {
    throw makeHttpError(400, `${field} must include text, label/address, or lat/lng`);
  }
  if (text && text.length > MAX_LOCATION_TEXT_LENGTH) throw makeHttpError(400, `${field} is too long`);
  const normalizedLat = hasCoordinates ? roundCoordinate(lat as number) : undefined;
  const normalizedLng = hasCoordinates ? roundCoordinate(lng as number) : undefined;

  return {
    text: text ?? formatLatLngText(normalizedLat!, normalizedLng!),
    ...(hasCoordinates ? { lat: normalizedLat, lng: normalizedLng } : {}),
    placeId: optionalString(body.placeId, `${field}.placeId`),
    dataId: optionalString(body.dataId, `${field}.dataId`) ?? optionalString(body.cid, `${field}.cid`),
  };
}

function validateDepartureTime(value: unknown): GoogleMapsMobileDirectionsDepartureTime | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'string') {
    if (!value.trim()) throw makeHttpError(400, 'departureTime must not be empty');
    return value.trim();
  }
  if (finiteNumber(value)) return value;

  const body = asRecord(value);
  const kind = optionalString(body.kind, 'departureTime.kind');
  if (kind === 'departAt') {
    if (!finiteNumber(body.epochSeconds)) {
      throw makeHttpError(400, 'departureTime.epochSeconds must be a finite number');
    }
    return {
      kind,
      epochSeconds: body.epochSeconds,
      timeZone: optionalString(body.timeZone, 'departureTime.timeZone'),
    };
  }
  if (kind === 'departAtLocal') {
    const localDateTime = optionalString(body.localDateTime, 'departureTime.localDateTime');
    if (!localDateTime) throw makeHttpError(400, 'departureTime.localDateTime is required');
    return {
      kind,
      localDateTime,
      timeZone: optionalString(body.timeZone, 'departureTime.timeZone'),
    };
  }
  if (kind === 'raw') {
    if (!finiteNumber(body.googleMapsEpochSeconds)) {
      throw makeHttpError(400, 'departureTime.googleMapsEpochSeconds must be a finite number');
    }
    return {
      kind,
      googleMapsEpochSeconds: body.googleMapsEpochSeconds,
      timeZone: optionalString(body.timeZone, 'departureTime.timeZone'),
    };
  }
  throw makeHttpError(400, 'departureTime.kind must be one of departAt, departAtLocal, raw');
}

function normalizeGoogleMapsMobileDirectionsRequest(
  input: GoogleMapsMobileDirectionsRequest | unknown,
): NormalizedRequest {
  const body = asRecord(input);
  const optionsBody =
    body.options === undefined || body.options === null
      ? {}
      : (asRecord(body.options) as GoogleMapsMobileDirectionsOptions);
  const timeoutMs = finiteNumber(optionsBody.timeoutMs)
    ? Math.min(Math.max(optionsBody.timeoutMs, 1), MAX_TIMEOUT_MS)
    : DEFAULT_TIMEOUT_MS;

  return {
    from: validateLocation(body.from, 'from'),
    to: validateLocation(body.to, 'to'),
    departureTime: validateDepartureTime(body.departureTime),
    options: {
      language: optionalString(optionsBody.language, 'options.language') ?? DEFAULT_LANGUAGE,
      region: optionalString(optionsBody.region, 'options.region') ?? DEFAULT_REGION,
      timeZone: optionalString(optionsBody.timeZone, 'options.timeZone'),
      timeoutMs,
      includeRaw: optionsBody.includeRaw === true,
      includeDebug: optionsBody.includeDebug === true,
      avoidTolls: optionsBody.avoidTolls === true,
      avoidHighways: optionsBody.avoidHighways === true,
      avoidFerries: optionsBody.avoidFerries === true,
    },
  };
}

function safeTimeZone(location: NormalizedLocation, request: NormalizedRequest): string {
  const explicit = request.options.timeZone;
  if (explicit) return explicit;
  const departure = request.departureTime;
  if (departure && typeof departure === 'object' && 'timeZone' in departure && departure.timeZone) {
    return departure.timeZone;
  }
  if (finiteNumber(location.lat) && finiteNumber(location.lng)) {
    try {
      return tzLookup(location.lat, location.lng);
    } catch {
      return 'Asia/Tokyo';
    }
  }
  return 'Asia/Tokyo';
}

function partsInTimeZone(epochSeconds: number, timeZone: string): Record<string, number> {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  const parts: Record<string, number> = {};
  for (const part of formatter.formatToParts(new Date(epochSeconds * 1000))) {
    if (part.type !== 'literal') parts[part.type] = Number(part.value);
  }
  return parts;
}

function googleEpochFromAbsoluteEpoch(epochSeconds: number, timeZone: string): number {
  const epoch = epochSeconds > 1_000_000_000_000 ? Math.floor(epochSeconds / 1000) : Math.floor(epochSeconds);
  const parts = partsInTimeZone(epoch, timeZone);
  return Math.floor(Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second) / 1000);
}

function googleEpochFromLocalDateTime(value: string): number {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T\s](\d{2}):(\d{2})(?::(\d{2}))?)?$/);
  if (!match) {
    throw makeHttpError(400, 'departureTime local value must use YYYY-MM-DDTHH:mm[:ss]');
  }
  const [, year, month, day, hour = '0', minute = '0', second = '0'] = match;
  return Math.floor(
    Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second)) / 1000,
  );
}

function buildDepartureTime(request: NormalizedRequest): GoogleMapsMobileDirectionsResult['departureTime'] {
  if (request.departureTime === undefined) return null;
  const timeZone = safeTimeZone(request.from, request);
  const option = request.departureTime;

  if (typeof option === 'number') {
    return {
      googleMapsEpochSeconds: googleEpochFromAbsoluteEpoch(option, timeZone),
      timeKindEnum: TIME_KIND_DEPART_AT,
      timeZone,
    };
  }
  if (typeof option === 'string') {
    const hasExplicitOffset = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(option);
    return {
      googleMapsEpochSeconds: hasExplicitOffset
        ? googleEpochFromAbsoluteEpoch(Date.parse(option) / 1000, timeZone)
        : googleEpochFromLocalDateTime(option),
      timeKindEnum: TIME_KIND_DEPART_AT,
      timeZone,
    };
  }
  if (option.kind === 'raw') {
    return {
      googleMapsEpochSeconds: Math.floor(option.googleMapsEpochSeconds),
      timeKindEnum: TIME_KIND_DEPART_AT,
      timeZone: option.timeZone ?? timeZone,
    };
  }
  if (option.kind === 'departAtLocal') {
    return {
      googleMapsEpochSeconds: googleEpochFromLocalDateTime(option.localDateTime),
      timeKindEnum: TIME_KIND_DEPART_AT,
      timeZone: option.timeZone ?? timeZone,
    };
  }
  return {
    googleMapsEpochSeconds: googleEpochFromAbsoluteEpoch(option.epochSeconds, option.timeZone ?? timeZone),
    timeKindEnum: TIME_KIND_DEPART_AT,
    timeZone: option.timeZone ?? timeZone,
  };
}

function buildMobileMmapRequest(request: NormalizedRequest): BuiltMobileRequest {
  const departureTime = buildDepartureTime(request);
  const body = buildMmapDirectionsRequestBody({
    from: request.from,
    to: request.to,
    routeOptions: {
      avoidFerries: request.options.avoidFerries,
      avoidHighways: request.options.avoidHighways,
      avoidTolls: request.options.avoidTolls,
      departureTime,
    },
  });
  return {
    endpoint: GOOGLE_MAPS_MOBILE_MMAP_ENDPOINT,
    body,
    departureTime,
    headers: {
      'content-type': 'application/binary',
      accept: '*/*',
      'accept-encoding': 'gzip, deflate, br',
      'upload-draft-interop-version': '6',
      'accept-language': request.options.language,
      'user-agent': 'com.google.Maps/25.47.0 iPhone/18.7.2 hw/iPhone16_1 (gzip)',
      'x-client-time-format': 'CAI=',
      'upload-complete': '?1',
      'x-goog-ext-353267353-bin': 'IOTDCA==',
      'x-geo': 'w CAEQDBiAl5flwJqVAyoKDUAm3hkVUtYD0D0GrhhG',
      'content-length': String(body.length),
    },
  };
}

export function buildGoogleMapsMobileDirectionsRequest(
  input: GoogleMapsMobileDirectionsRequest | unknown,
): BuiltMobileRequest {
  return buildMobileMmapRequest(normalizeGoogleMapsMobileDirectionsRequest(input));
}

function decodeMmapResponsePayloads(responseBody: Buffer): Array<{ protobuf: Buffer; gzipOffset: number }> {
  const gzipMagic = Buffer.from([0x1f, 0x8b]);
  const payloads: Array<{ protobuf: Buffer; gzipOffset: number }> = [];
  let searchStart = 0;

  while (searchStart < responseBody.length) {
    const gzipOffset = responseBody.indexOf(gzipMagic, searchStart);
    if (gzipOffset < 0) break;
    searchStart = gzipOffset + 1;
    try {
      payloads.push({ protobuf: gunzipSync(responseBody.subarray(gzipOffset)), gzipOffset });
    } catch {
      // Gzip magic can appear inside a compressed member; keep scanning for later members.
    }
  }

  if (!payloads.length) {
    throw makeHttpError(502, 'Google Maps mobile response did not contain a gzip protobuf payload');
  }
  return payloads;
}

function walkMessages(buffer: Buffer, visit: (message: Buffer, fields: ProtoField[]) => void, depth = 0): void {
  if (depth > 14 || buffer.length === 0) return;
  const fields = tryParseMessage(buffer);
  if (!fields) return;
  visit(buffer, fields);
  for (const field of fields) {
    if (field.wire === 2 && Buffer.isBuffer(field.value) && !isText(field.value)) {
      walkMessages(field.value, visit, depth + 1);
    }
  }
}

function durationFromSeconds(seconds: number | null): GoogleMapsMobileDirectionsDuration {
  return { seconds, text: null };
}

function parseDistance(message: Buffer | null): GoogleMapsMobileDirectionsDistance {
  if (!message) return { meters: null, text: null };
  const fields = tryParseMessage(message);
  if (!fields) return { meters: null, text: null };
  return { meters: firstVarint(fields, 1), text: fieldStrings(fields, 2)[0] ?? null };
}

function parseDuration(message: Buffer | null): GoogleMapsMobileDirectionsDuration {
  if (!message) return { seconds: null, text: null };
  const fields = tryParseMessage(message);
  if (!fields) return { seconds: null, text: null };
  return { seconds: firstVarint(fields, 1), text: fieldStrings(fields, 2)[0] ?? null };
}

function parseMoney(message: Buffer): { currency: string; units: number; nanos: number } | null {
  const fields = tryParseMessage(message);
  if (!fields) return null;
  const currency = fieldStrings(fields, 1)[0];
  const units = firstVarint(fields, 2);
  const nanos = firstVarint(fields, 3) ?? 0;
  if (!currency || units === null) return null;
  return { currency, units, nanos };
}

function parseTollDetail(message: Buffer): GoogleMapsMobileDirectionsMoney | null {
  const fields = tryParseMessage(message);
  if (!fields) return null;
  const display = fieldStrings(fields, 1)[0];
  const label = fieldStrings(fields, 4)[0] ?? null;
  const moneyContainer = firstMessage(fields, 6);
  if (!display || !moneyContainer) return null;

  const moneyContainerFields = tryParseMessage(moneyContainer);
  if (!moneyContainerFields) return null;
  const moneyMessage = firstMessage(moneyContainerFields, 1);
  if (!moneyMessage) return null;
  const money = parseMoney(moneyMessage);
  if (!money) return null;
  const formatted = fieldStrings(moneyContainerFields, 2)[0] ?? display;
  const amount = money.units + money.nanos / 1_000_000_000;
  return { amount, text: formatted, currency: money.currency, label };
}

function findTolls(message: Buffer): GoogleMapsMobileDirectionsMoney[] {
  const tolls: GoogleMapsMobileDirectionsMoney[] = [];
  const seen = new Set<string>();
  walkMessages(message, (nested) => {
    const toll = parseTollDetail(nested);
    if (!toll) return;
    const key = `${toll.label ?? ''}:${toll.currency ?? ''}:${toll.amount ?? ''}:${toll.text ?? ''}`;
    if (!seen.has(key)) {
      seen.add(key);
      tolls.push(toll);
    }
  });
  return tolls;
}

function decodeXmlEntities(value: string): string {
  return value
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function stepTextFromXml(value: string): string | null {
  const body = value
    .replace(/^<step\b[^>]*>/i, '')
    .replace(/<\/step>$/i, '')
    .replace(
      /<\/(road|sign|exit|intersection|interchange)>\s*<(road|sign|exit|intersection|interchange)\b/gi,
      '</$1> / <$2',
    )
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.;:)])/g, '$1')
    .replace(/([(/])\s+/g, '$1')
    .trim();
  return body ? decodeXmlEntities(body) : null;
}

function parseRouteStepXml(value: string): GoogleMapsMobileDirectionsStep | null {
  const instruction = stepTextFromXml(value);
  if (!instruction) return null;
  const maneuver = value.match(/\bmaneuver=(['"])(.*?)\1/i)?.[2] ?? null;
  const metersText = value.match(/\bmeters=(['"])(\d+)\1/i)?.[2] ?? null;
  const meters = metersText ? Number(metersText) : null;
  return {
    instruction,
    maneuver,
    distance: {
      meters: Number.isFinite(meters) ? meters : null,
      text: null,
    },
  };
}

function textFieldValues(fields: ProtoField[]): string[] {
  const values: string[] = [];
  for (const field of fields) {
    if (field.wire === 2 && Buffer.isBuffer(field.value) && isText(field.value)) {
      values.push((field.value as Buffer).toString('utf8'));
    }
  }
  return values;
}

function parseRouteSteps(message: Buffer): GoogleMapsMobileDirectionsStep[] {
  const steps: GoogleMapsMobileDirectionsStep[] = [];
  const seen = new Set<string>();
  walkMessages(message, (_nested, fields) => {
    for (const text of textFieldValues(fields)) {
      for (const match of text.matchAll(/<step\b[^>]*>[\s\S]*?<\/step>/gi)) {
        const step = parseRouteStepXml(match[0]);
        if (!step) continue;
        const key = `${step.maneuver ?? ''}:${step.distance.meters ?? ''}:${step.instruction}`;
        if (seen.has(key)) continue;
        seen.add(key);
        steps.push(step);
      }
    }
  });
  return steps;
}

function parsePrediction(summaryMessage: Buffer): GoogleMapsMobileDirectionsTrafficPrediction | null {
  const summaryFields = tryParseMessage(summaryMessage);
  if (!summaryFields) return null;
  for (const rangeMessage of allMessages(summaryFields, 5)) {
    const rangeFields = tryParseMessage(rangeMessage);
    if (!rangeFields) continue;
    const optimistic = firstVarint(rangeFields, 1);
    const pessimistic = firstVarint(rangeFields, 2);
    if (optimistic === null && pessimistic === null) continue;
    return {
      optimistic: durationFromSeconds(optimistic),
      pessimistic: durationFromSeconds(pessimistic),
      text: fieldStrings(rangeFields, 3)[0] ?? null,
    };
  }
  return null;
}

function readPackedVarints(buffer: Buffer): number[] | null {
  const values: number[] = [];
  let pos = 0;
  try {
    while (pos < buffer.length) {
      const [value, next] = readVarint(buffer, pos);
      if (next <= pos) return null;
      values.push(value);
      pos = next;
    }
  } catch {
    return null;
  }
  return values;
}

function zigZagDecode(value: number): number {
  return value % 2 === 0 ? value / 2 : -(value + 1) / 2;
}

function validLatLng(lat: number, lng: number): boolean {
  return Number.isFinite(lat) && Number.isFinite(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
}

function decodeOverviewGeometry(message: Buffer): GoogleMapsMobileDirectionsLatLng[] | undefined {
  const fields = tryParseMessage(message);
  if (!fields) return undefined;
  const latBytes = firstMessage(fields, 1);
  const lngBytes = firstMessage(fields, 2);
  if (!latBytes || !lngBytes) return undefined;

  const latDeltas = readPackedVarints(latBytes);
  const lngDeltas = readPackedVarints(lngBytes);
  if (!latDeltas || !lngDeltas || latDeltas.length !== lngDeltas.length || latDeltas.length < 2) {
    return undefined;
  }

  let latE7 = 0;
  let lngE7 = 0;
  const points: GoogleMapsMobileDirectionsLatLng[] = [];
  for (let index = 0; index < latDeltas.length; index++) {
    latE7 += zigZagDecode(latDeltas[index]);
    lngE7 += zigZagDecode(lngDeltas[index]);
    const point = { lat: latE7 / 1e7, lng: lngE7 / 1e7 };
    if (!validLatLng(point.lat, point.lng)) return undefined;
    points.push(point);
  }
  return points;
}

function parseRouteHeader(
  headerMessage: Buffer,
): Omit<GoogleMapsMobileDirectionsRoute, 'tollFee' | 'overviewGeometry' | 'steps'> | null {
  const fields = tryParseMessage(headerMessage);
  if (!fields) return null;

  let prediction: GoogleMapsMobileDirectionsTrafficPrediction | null = null;
  for (const summaryMessage of allMessages(fields, 11)) {
    prediction = parsePrediction(summaryMessage);
    if (prediction) break;
  }
  if (!prediction) return null;

  return {
    index: firstVarint(fields, 1) ?? 0,
    title: fieldStrings(fields, 2)[0] ?? null,
    distance: parseDistance(firstMessage(fields, 3)),
    duration: parseDuration(firstMessage(fields, 4)),
    trafficPrediction: prediction,
  };
}

function routeKey(route: GoogleMapsMobileDirectionsRoute): string {
  return [
    route.title ?? '',
    route.distance.meters ?? '',
    route.duration.seconds ?? '',
    route.trafficPrediction?.text ?? '',
  ].join(':');
}

function parseRoutes(protobuf: Buffer): GoogleMapsMobileDirectionsRoute[] {
  const routes: GoogleMapsMobileDirectionsRoute[] = [];
  const routeIndexes = new Map<string, number>();

  function addRoute(route: GoogleMapsMobileDirectionsRoute): void {
    const key = routeKey(route);
    const existingIndex = routeIndexes.get(key);
    if (existingIndex !== undefined) {
      const existing = routes[existingIndex]!;
      if (!existing.tollFee && route.tollFee) {
        routes[existingIndex] = {
          ...existing,
          tollFee: route.tollFee,
          overviewGeometry: existing.overviewGeometry ?? route.overviewGeometry,
          steps: existing.steps?.length ? existing.steps : route.steps,
        };
      }
      if (!existing.steps?.length && route.steps?.length) {
        routes[existingIndex] = {
          ...routes[existingIndex]!,
          steps: route.steps,
        };
      }
      return;
    }
    routeIndexes.set(key, routes.length);
    routes.push(route);
  }

  function parseRouteContainer(
    routeMessage: Buffer,
    overviewGeometry?: GoogleMapsMobileDirectionsLatLng[],
  ): GoogleMapsMobileDirectionsRoute | null {
    const routeFields = tryParseMessage(routeMessage);
    if (!routeFields) return null;
    const headerMessage = firstMessage(routeFields, 1);
    const header = headerMessage ? parseRouteHeader(headerMessage) : null;
    if (!header?.title) return null;
    const tolls = findTolls(routeMessage);
    const tollFee = tolls.find((toll) => toll.label === 'ETC') ?? tolls[0] ?? null;
    const steps = parseRouteSteps(routeMessage);
    return {
      ...header,
      tollFee,
      ...(overviewGeometry ? { overviewGeometry } : {}),
      ...(steps.length ? { steps } : {}),
    };
  }

  walkMessages(protobuf, (message, fields) => {
    const geometries = allMessages(fields, 8)
      .map((geometryMessage) => decodeOverviewGeometry(geometryMessage))
      .filter((geometry): geometry is GoogleMapsMobileDirectionsLatLng[] => Boolean(geometry));
    let geometryIndex = 0;
    for (const routeMessage of allMessages(fields, 2)) {
      const route = parseRouteContainer(routeMessage, geometries[geometryIndex]);
      if (!route) continue;
      geometryIndex += 1;
      addRoute(route);
    }

    for (const candidate of allMessages(fields, 1)) {
      const header = parseRouteHeader(candidate);
      if (!header?.title) continue;
      const tolls = findTolls(message);
      const tollFee = tolls.find((toll) => toll.label === 'ETC') ?? tolls[0] ?? null;
      addRoute({ ...header, tollFee });
    }
  });

  return routes;
}

function responseBufferFrom(value: Buffer | ArrayBuffer): Buffer {
  return Buffer.isBuffer(value) ? value : Buffer.from(value);
}

function cacheKeyForRequest(request: NormalizedRequest, built: BuiltMobileRequest): string {
  return createHash('sha256')
    .update(built.endpoint)
    .update('\0')
    .update(request.options.language)
    .update('\0')
    .update(built.body)
    .digest('hex');
}

function rememberResponse(cacheKey: string, responseBody: Buffer): void {
  responseCache.set(cacheKey, responseBody);
  if (responseCache.size > RESPONSE_CACHE_MAX) {
    const oldest = responseCache.keys().next().value;
    if (oldest !== undefined) responseCache.delete(oldest);
  }
}

export function parseGoogleMapsMobileDirectionsResponse(
  responseBody: Buffer | ArrayBuffer,
  context?: {
    request?: NormalizedRequest;
    built?: BuiltMobileRequest;
    includeRaw?: boolean;
    includeDebug?: boolean;
  },
): GoogleMapsMobileDirectionsResult {
  const body = responseBufferFrom(responseBody);
  const decodedPayloads = decodeMmapResponsePayloads(body);
  const parsedPayloads = decodedPayloads.map((decoded) => ({ decoded, routes: parseRoutes(decoded.protobuf) }));
  const selectedPayload = parsedPayloads.find((payload) => payload.routes.length > 0) ?? parsedPayloads[0]!;
  const { decoded, routes } = selectedPayload;
  const firstRoute = routes[0] ?? null;
  const includeDebug = context?.includeDebug ?? context?.request?.options.includeDebug === true;
  const includeRaw = context?.includeRaw ?? context?.request?.options.includeRaw === true;

  return {
    source: 'google-mobile-mmap',
    from: context?.request?.from.text ?? '',
    to: context?.request?.to.text ?? '',
    departureTime: context?.built?.departureTime ?? null,
    optimisticDuration: firstRoute?.trafficPrediction?.optimistic ?? null,
    pessimisticDuration: firstRoute?.trafficPrediction?.pessimistic ?? null,
    predictionText: firstRoute?.trafficPrediction?.text ?? null,
    tollFee: firstRoute?.tollFee ?? null,
    routes,
    ...(includeDebug
      ? {
          debug: {
            endpoint: context?.built?.endpoint ?? GOOGLE_MAPS_MOBILE_MMAP_ENDPOINT,
            requestBytes: context?.built?.body.length ?? 0,
            responseBytes: body.length,
            gzipOffset: decoded.gzipOffset,
            protobufBytes: decoded.protobuf.length,
          },
        }
      : {}),
    ...(includeRaw ? { raw: { protobufBase64: decoded.protobuf.toString('base64') } } : {}),
  };
}

export async function fetchGoogleMapsMobileDirections(
  input: GoogleMapsMobileDirectionsRequest | unknown,
): Promise<GoogleMapsMobileDirectionsResult> {
  const request = normalizeGoogleMapsMobileDirectionsRequest(input);
  const built = buildMobileMmapRequest(request);
  const cacheKey = cacheKeyForRequest(request, built);
  let responseBody = responseCache.get(cacheKey);
  if (!responseBody) {
    let inFlight = inFlightResponses.get(cacheKey);
    if (!inFlight) {
      inFlight = (async () => {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), request.options.timeoutMs);
        try {
          const response = await fetch(built.endpoint, {
            method: 'POST',
            headers: built.headers,
            body: built.body,
            signal: controller.signal,
          });
          const body = Buffer.from(await response.arrayBuffer());
          if (!response.ok) {
            throw makeHttpError(
              response.status,
              `Google Maps mobile directions failed with ${response.status} ${response.statusText}`,
            );
          }
          rememberResponse(cacheKey, body);
          return body;
        } catch (err) {
          if (err instanceof Error && err.name === 'AbortError') {
            throw makeHttpError(504, 'Google Maps mobile directions request timed out');
          }
          throw err;
        } finally {
          clearTimeout(timeout);
          inFlightResponses.delete(cacheKey);
        }
      })();
      inFlightResponses.set(cacheKey, inFlight);
    }
    responseBody = await inFlight;
  }
  return parseGoogleMapsMobileDirectionsResponse(responseBody, {
    request,
    built,
  });
}

export function __clearGoogleMapsMobileDirectionsCacheForTests(): void {
  responseCache.clear();
  inFlightResponses.clear();
}
