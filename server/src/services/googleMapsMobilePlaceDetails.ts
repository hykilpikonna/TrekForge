import { gunzipSync } from 'node:zlib';

import {
  GOOGLE_MAPS_FTID_RE,
  type GoogleMapsPreviewOpeningPeriod,
  type GoogleMapsPreviewOpeningPoint,
  type GoogleMapsPreviewPlaceDetails,
} from './googleMapsPreviewPlaceDetails';

export interface GoogleMapsMobilePlaceDetailsRequest {
  ftid: string;
  language?: string;
  timeoutMs?: number;
  includeRaw?: boolean;
}

interface NormalizedRequest {
  ftid: string;
  language: string;
  timeoutMs: number;
  includeRaw: boolean;
}

interface BuiltMobilePlaceDetailsRequest {
  endpoint: string;
  body: Buffer;
  headers: Record<string, string>;
}

interface ProtoField {
  field: number;
  wire: number;
  value: number | Buffer;
  tagPos: number;
  end: number;
}

const GOOGLE_MAPS_MOBILE_MMAP_ENDPOINT = 'https://mobilemaps.googleapis.com/glm/mmap';
const DEFAULT_LANGUAGE = 'en-US,en;q=0.9';
const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_TIMEOUT_MS = 30_000;
const DAY_MINUTES = 24 * 60;
const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// Captured from the iOS Google Maps 25.47 /glm/mmap place preview request. The
// following type-450 chunk is generated per FTID.
const MOBILE_MMAP_PREFIX_AND_CLIENT_CHUNK_BASE64 =
  'ABhGn1Se+1h53QAFZW4tVVMADmlvczppUGhvbmUxNiwxABIyNS40Ny4wLjgzMzU0MjkzMDAADGlPUy1BcHBTdG9yZQA+AAACJQoEMTE5MSABKg9jb20uZ29vZ2xlLk1hcHMyAkpQOAFC0AE1MzI9dVBaYU1zNS1QZVg3TDB2QmJYSkpiRThydVgzSHk1ckd3STdDZ0UzZ0tNTFlrcDJKTFBMQnlLcW50aXNZaEI3V1k4VmR4aTFUVVZOM1BWYUYyS05DNWM1dUdMUlR5YjcwdDg3TlgwUzJmc29HVTdBSGZhWWMtVVlIQmZpVnlRNnd5akRrbDhRQWNYUmNuZVYyX2NJUHBmbzJaY3V2MkpTajRndUp4ZHJxSmVxRzNkcDEzM0FRRmF6TUVuVmlIS2lFSjZILVhBdm5OYWVoqAEAsAEEwAEByAEB2gEGMTguNy4ygAIBiAIBmgMCEAPaA+cBrLIM6beoEsnSzyKX4PUstIX2LMqV9iyXg/csop33LNee9yzwkvgs16X4LNup+CyjtfgsrvD4LOGR+Sy0lvksp5r5LKma+Sy6pfks/6r5LJKx+SyKs/ks/7z5LMe++SzLv/ksrMb5LNbN+SzW2fksn/j5LIb/+Sy3m/osw776LKj4+izHh/ssgZD7LIK6+yyR36Mv7b6nL7j0hTD24Ycwg+eHMPrwhzDFpYgw5fiIML2FiTCEhokw4p+JMPKniTCp04kwiumJMOjA4zHPteUxpZCxMrzavzLx+sYy9frGMvn6xjKjvcoy8AMCiAQAkgQSMjUuNDcuMC44MzM1NDI5MzAwoAT0A6oEAMAEAsgEDw==';

const PLACE_DETAILS_CHUNK_TYPE = 450;
const PLACE_DETAILS_FIELD_MASK = Buffer.from(
  '10011801200128014001480150015801800101880101980101a80101b00101ba01020801',
  'hex',
);

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

function normalizeRequest(input: GoogleMapsMobilePlaceDetailsRequest): NormalizedRequest {
  const ftid = normalizeFtid(input.ftid);
  if (!ftid) throw makeHttpError(400, 'Google Maps mobile place details require a Google Maps feature ID');
  const language = nonEmptyString(input.language) ?? DEFAULT_LANGUAGE;
  const timeoutMs = finiteNumber(input.timeoutMs)
    ? Math.min(Math.max(input.timeoutMs, 1), MAX_TIMEOUT_MS)
    : DEFAULT_TIMEOUT_MS;
  return {
    ftid,
    language,
    timeoutMs,
    includeRaw: input.includeRaw === true,
  };
}

function varint(value: number): Buffer {
  let n = BigInt(Math.floor(value));
  const bytes: number[] = [];
  do {
    let byte = Number(n & 0x7fn);
    n >>= 7n;
    if (n) byte |= 0x80;
    bytes.push(byte);
  } while (n);
  return Buffer.from(bytes);
}

function readVarint(buffer: Buffer, pos: number, end = buffer.length): [number, number] {
  let value = 0n;
  let shift = 0n;
  let index = pos;
  while (index < end) {
    const byte = buffer[index++];
    value |= BigInt(byte & 0x7f) << shift;
    if (!(byte & 0x80)) return [Number(value), index];
    shift += 7n;
  }
  throw new Error('Unterminated protobuf varint');
}

function tag(field: number, wire: number): Buffer {
  return varint(field * 8 + wire);
}

function delimited(buffer: Buffer): Buffer {
  return Buffer.concat([varint(buffer.length), buffer]);
}

function varintField(field: number, value: number): Buffer {
  return Buffer.concat([tag(field, 0), varint(value)]);
}

function bytesField(field: number, value: Buffer): Buffer {
  return Buffer.concat([tag(field, 2), delimited(value)]);
}

function stringField(field: number, value: string): Buffer {
  return bytesField(field, Buffer.from(value, 'utf8'));
}

function messageField(field: number, parts: Buffer[]): Buffer {
  return bytesField(field, Buffer.concat(parts));
}

function skipField(buffer: Buffer, pos: number, end: number, wire: number): number {
  if (wire === 0) return readVarint(buffer, pos, end)[1];
  if (wire === 1) return pos + 8 <= end ? pos + 8 : Infinity;
  if (wire === 2) {
    const [length, valuePos] = readVarint(buffer, pos, end);
    return valuePos + length <= end ? valuePos + length : Infinity;
  }
  if (wire === 5) return pos + 4 <= end ? pos + 4 : Infinity;
  return Infinity;
}

function parseMessage(buffer: Buffer, start = 0, end = buffer.length): ProtoField[] {
  const fields: ProtoField[] = [];
  let pos = start;
  while (pos < end) {
    const tagPos = pos;
    const [tagValue, valuePos] = readVarint(buffer, pos, end);
    pos = valuePos;
    const field = Math.floor(tagValue / 8);
    const wire = tagValue % 8;
    if (field <= 0) throw new Error('Invalid protobuf field number');

    let value: number | Buffer;
    if (wire === 0) {
      const [varintValue, next] = readVarint(buffer, pos, end);
      value = varintValue;
      pos = next;
    } else if (wire === 1 || wire === 5) {
      const next = skipField(buffer, pos, end, wire);
      if (!Number.isFinite(next)) throw new Error('Invalid fixed-width protobuf field');
      value = buffer.subarray(pos, next);
      pos = next;
    } else if (wire === 2) {
      const [length, dataPos] = readVarint(buffer, pos, end);
      const next = dataPos + length;
      if (next > end) throw new Error('Invalid length-delimited protobuf field');
      value = buffer.subarray(dataPos, next);
      pos = next;
    } else {
      throw new Error(`Unsupported protobuf wire type ${wire}`);
    }

    fields.push({ field, wire, value, tagPos, end: pos });
  }
  return fields;
}

function tryParseMessage(buffer: Buffer): ProtoField[] | null {
  try {
    return parseMessage(buffer);
  } catch {
    return null;
  }
}

function isText(buffer: Buffer): boolean {
  if (buffer.length === 0) return false;
  const text = buffer.toString('utf8');
  if (text.includes('\uFFFD')) return false;
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    if (code !== 9 && code !== 10 && code !== 13 && code < 32) return false;
  }
  return true;
}

function fieldStrings(fields: ProtoField[], field: number): string[] {
  return fields
    .filter((entry) => entry.field === field && entry.wire === 2 && Buffer.isBuffer(entry.value) && isText(entry.value))
    .map((entry) => (entry.value as Buffer).toString('utf8'));
}

function firstVarint(fields: ProtoField[], field: number): number | null {
  const found = fields.find((entry) => entry.field === field && entry.wire === 0 && typeof entry.value === 'number');
  return typeof found?.value === 'number' ? found.value : null;
}

function firstMessage(fields: ProtoField[], field: number): Buffer | null {
  const found = fields.find((entry) => entry.field === field && entry.wire === 2 && Buffer.isBuffer(entry.value));
  return Buffer.isBuffer(found?.value) ? found.value : null;
}

function allMessages(fields: ProtoField[], field: number): Buffer[] {
  return fields
    .filter((entry) => entry.field === field && entry.wire === 2 && Buffer.isBuffer(entry.value))
    .map((entry) => entry.value as Buffer);
}

function fixed64Double(fields: ProtoField[], field: number): number | null {
  const found = fields.find((entry) => entry.field === field && entry.wire === 1 && Buffer.isBuffer(entry.value));
  return Buffer.isBuffer(found?.value) && found.value.length === 8 ? found.value.readDoubleLE(0) : null;
}

function fixed32Float(fields: ProtoField[], field: number): number | null {
  const found = fields.find((entry) => entry.field === field && entry.wire === 5 && Buffer.isBuffer(entry.value));
  return Buffer.isBuffer(found?.value) && found.value.length === 4 ? found.value.readFloatLE(0) : null;
}

function buildPlaceDetailsPayload(ftid: string): Buffer {
  return Buffer.concat([
    messageField(1, [messageField(1, [stringField(1, ftid)])]),
    bytesField(2, PLACE_DETAILS_FIELD_MASK),
    messageField(3, [messageField(4, [varintField(2, 4989)])]),
    varintField(5, 1),
  ]);
}

function buildMobileMmapRequest(request: NormalizedRequest): BuiltMobilePlaceDetailsRequest {
  const payload = buildPlaceDetailsPayload(request.ftid);
  const header = Buffer.alloc(6);
  header.writeUInt16BE(PLACE_DETAILS_CHUNK_TYPE, 0);
  header.writeUInt32BE(payload.length, 2);
  const body = Buffer.concat([
    Buffer.from(MOBILE_MMAP_PREFIX_AND_CLIENT_CHUNK_BASE64, 'base64'),
    header,
    payload,
  ]);

  return {
    endpoint: GOOGLE_MAPS_MOBILE_MMAP_ENDPOINT,
    body,
    headers: {
      'content-type': 'application/binary',
      accept: '*/*',
      'accept-encoding': 'gzip, deflate, br',
      'accept-language': request.language,
      'user-agent': 'com.google.Maps/25.47.0 iPhone/18.7.2 hw/iPhone16_1 (gzip)',
      'upload-draft-interop-version': '6',
      'x-client-time-format': 'CAI=',
      'upload-complete': '?1',
      'x-goog-ext-353267353-bin': 'IOTDCA==',
      'content-length': String(body.length),
    },
  };
}

export function buildGoogleMapsMobilePlaceDetailsRequest(
  input: GoogleMapsMobilePlaceDetailsRequest,
): BuiltMobilePlaceDetailsRequest {
  return buildMobileMmapRequest(normalizeRequest(input));
}

function decodeMmapResponse(responseBody: Buffer): { protobuf: Buffer; gzipOffset: number } {
  const gzipOffset = responseBody.indexOf(Buffer.from([0x1f, 0x8b]));
  if (gzipOffset < 0) throw makeHttpError(502, 'Google Maps mobile place response did not contain a gzip protobuf payload');
  try {
    return { protobuf: gunzipSync(responseBody.subarray(gzipOffset)), gzipOffset };
  } catch (err) {
    throw makeHttpError(
      502,
      `Unable to inflate Google Maps mobile place response: ${err instanceof Error ? err.message : 'invalid gzip'}`,
    );
  }
}

function responseBufferFrom(value: Buffer | ArrayBuffer): Buffer {
  return Buffer.isBuffer(value) ? value : Buffer.from(value);
}

function googleDayFromMobile(value: unknown): number | null {
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

function normalizeHoursLabel(value: string): string {
  return value
    .replace(/\u202f/g, ' ')
    .replace(/\u2013/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

function buildWeekdayDescriptions(dayLabels: Map<number, string[]>): string[] {
  return [1, 2, 3, 4, 5, 6, 0].map((day) => {
    const labels = dayLabels.get(day);
    return `${WEEKDAY_NAMES[day]}: ${labels?.length ? labels.join(', ') : 'Closed'}`;
  });
}

function mobileTimePointToMinutes(message: Buffer | null): number | null {
  if (!message) return null;
  const fields = tryParseMessage(message);
  if (!fields) return null;
  const hour = firstVarint(fields, 1);
  const minute = firstVarint(fields, 2) ?? 0;
  if (hour === null || !Number.isInteger(hour) || !Number.isInteger(minute)) return null;
  if (hour === 24 && minute === 0) return DAY_MINUTES;
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return hour * 60 + minute;
}

function parseHoursRange(rangeMessage: Buffer): { label: string | null; start: number | null; end: number | null } {
  const fields = tryParseMessage(rangeMessage);
  if (!fields) return { label: null, start: null, end: null };

  const label = fieldStrings(fields, 1)[0];
  const timePair = firstMessage(fields, 2);
  const timeFields = timePair ? tryParseMessage(timePair) : null;
  return {
    label: label ? normalizeHoursLabel(label) : null,
    start: timeFields ? mobileTimePointToMinutes(firstMessage(timeFields, 1)) : null,
    end: timeFields ? mobileTimePointToMinutes(firstMessage(timeFields, 2)) : null,
  };
}

function parseStructuredWeeklyHours(
  hoursMessage: Buffer | null,
): { opening_hours: string[]; opening_periods: GoogleMapsPreviewOpeningPeriod[] } | null {
  if (!hoursMessage) return null;
  const fields = tryParseMessage(hoursMessage);
  if (!fields) return null;

  const seenDays = new Set<number>();
  const periods: GoogleMapsPreviewOpeningPeriod[] = [];
  const labelsByDay = new Map<number, string[]>();

  for (const rowMessage of allMessages(fields, 1)) {
    const rowFields = tryParseMessage(rowMessage);
    if (!rowFields) continue;
    const day = googleDayFromMobile(firstVarint(rowFields, 2));
    if (day === null) continue;
    seenDays.add(day);
    if (!labelsByDay.has(day)) labelsByDay.set(day, []);

    for (const rangeMessage of allMessages(rowFields, 4)) {
      const range = parseHoursRange(rangeMessage);
      if (range.label) labelsByDay.get(day)!.push(range.label);
      if (range.label && /closed/i.test(range.label)) continue;
      if (range.label && /24\s*hours|open\s*24/i.test(range.label)) {
        periods.push(periodForRange(day, 0, DAY_MINUTES));
        continue;
      }
      if (range.start === null || range.end === null) continue;
      periods.push(periodForRange(day, range.start, range.end));
    }
  }

  if (seenDays.size < 7) return null;
  return {
    opening_hours: buildWeekdayDescriptions(labelsByDay),
    opening_periods: periods,
  };
}

function collectText(buffer: Buffer, depth = 0): string[] {
  if (depth > 8) return [];
  const fields = tryParseMessage(buffer);
  if (!fields) return [];
  const strings: string[] = [];
  for (const field of fields) {
    if (field.wire !== 2 || !Buffer.isBuffer(field.value)) continue;
    if (isText(field.value)) {
      strings.push(field.value.toString('utf8'));
    } else {
      strings.push(...collectText(field.value, depth + 1));
    }
  }
  return strings;
}

function parseOpenNow(hoursMessage: Buffer | null): boolean | null {
  if (!hoursMessage) return null;
  for (const text of collectText(hoursMessage)) {
    if (/^open\b/i.test(text)) return true;
    if (/^closed\b/i.test(text)) return false;
  }
  return null;
}

function parsePhone(phoneMessage: Buffer | null): string | null {
  if (!phoneMessage) return null;
  const fields = tryParseMessage(phoneMessage);
  if (!fields) return null;
  return fieldStrings(fields, 1)[0] ?? fieldStrings(fields, 4)[0] ?? null;
}

function parseLatLng(coordsMessage: Buffer | null): { lat: number | null; lng: number | null } {
  if (!coordsMessage) return { lat: null, lng: null };
  const fields = tryParseMessage(coordsMessage);
  if (!fields) return { lat: null, lng: null };
  return {
    lat: fixed64Double(fields, 3),
    lng: fixed64Double(fields, 4),
  };
}

function normalizePlaceMessage(
  placeMessage: Buffer,
  context?: Pick<GoogleMapsMobilePlaceDetailsRequest, 'ftid' | 'includeRaw'>,
  raw?: Buffer,
): GoogleMapsPreviewPlaceDetails {
  const fields = parseMessage(placeMessage);
  const ftid = normalizeFtid(fieldStrings(fields, 3)[0]) ?? normalizeFtid(context?.ftid) ?? null;
  const coords = parseLatLng(firstMessage(fields, 4));
  const hoursMessage = firstMessage(fields, 19);
  const openingHours = parseStructuredWeeklyHours(hoursMessage);

  return {
    google_place_id: null,
    google_ftid: ftid,
    name: fieldStrings(fields, 5)[0] ?? '',
    address: fieldStrings(fields, 6)[0] ?? '',
    lat: coords.lat,
    lng: coords.lng,
    rating: fixed32Float(fields, 8),
    rating_count: firstVarint(fields, 9),
    website: null,
    phone: parsePhone(firstMessage(fields, 17)),
    opening_hours: openingHours?.opening_hours ?? null,
    opening_periods: openingHours?.opening_periods.length ? openingHours.opening_periods : null,
    open_now: parseOpenNow(hoursMessage),
    business_status: null,
    google_maps_url: ftid ? `https://www.google.com/maps?ftid=${encodeURIComponent(ftid)}` : null,
    summary: null,
    reviews: [],
    source: 'google',
    ...(context?.includeRaw ? { raw: raw?.toString('base64') } : {}),
  };
}

export function parseGoogleMapsMobilePlaceDetailsResponse(
  responseBody: Buffer | ArrayBuffer,
  context?: Pick<GoogleMapsMobilePlaceDetailsRequest, 'ftid' | 'includeRaw'>,
): GoogleMapsPreviewPlaceDetails {
  const body = responseBufferFrom(responseBody);
  const decoded = decodeMmapResponse(body);
  const rootFields = parseMessage(decoded.protobuf);
  const placeMessage = firstMessage(rootFields, 1);
  if (!placeMessage) throw makeHttpError(404, 'Google Maps mobile place details not found');
  return normalizePlaceMessage(placeMessage, context, decoded.protobuf);
}

export async function fetchGoogleMapsMobilePlaceDetails(
  input: GoogleMapsMobilePlaceDetailsRequest,
): Promise<GoogleMapsPreviewPlaceDetails> {
  const request = normalizeRequest(input);
  const built = buildMobileMmapRequest(request);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), request.timeoutMs);
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
        `Google Maps mobile place details failed with ${response.status} ${response.statusText}`,
      );
    }
    return parseGoogleMapsMobilePlaceDetailsResponse(body, {
      ftid: request.ftid,
      includeRaw: request.includeRaw,
    });
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw makeHttpError(504, 'Google Maps mobile place details request timed out');
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}
