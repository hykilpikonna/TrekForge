import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
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

export interface GoogleMapsMobileDirectionsRoute {
  index: number;
  title: string | null;
  distance: GoogleMapsMobileDirectionsDistance;
  duration: GoogleMapsMobileDirectionsDuration;
  trafficPrediction: GoogleMapsMobileDirectionsTrafficPrediction | null;
  tollFee: GoogleMapsMobileDirectionsMoney | null;
  overviewGeometry?: GoogleMapsMobileDirectionsLatLng[];
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

interface ProtoField {
  field: number;
  wire: number;
  value: number | Buffer;
  tagPos: number;
  end: number;
}

const GOOGLE_MAPS_MOBILE_MMAP_ENDPOINT = 'https://mobilemaps.googleapis.com/glm/mmap';
const DEFAULT_LANGUAGE = 'en-US,en;q=0.9';
const DEFAULT_REGION = 'JP';
const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_TIMEOUT_MS = 30_000;
const MAX_LOCATION_TEXT_LENGTH = 500;
const TIME_KIND_DEPART_AT = 2;
const RESPONSE_CACHE_MAX = 200;
const responseCache = new Map<string, Buffer>();
const inFlightResponses = new Map<string, Promise<Buffer>>();

// Captured iOS Google Maps 25.47 client envelope plus chunk 0x003e client metadata.
// The route chunk (0x008e) is generated per request below.
const MOBILE_MMAP_PREFIX_AND_CLIENT_CHUNK_BASE64 =
  'ABhGn1Se+1h53QAFZW4tVVMADmlvczppUGhvbmUxNiwxABIyNS40Ny4wLjgzMzU0MjkzMDAADGlPUy1BcHBTdG9yZQA+AAAGEQoEMTE5MSABKg9jb20uZ29vZ2xlLk1hcHMyAkpQOAFC0AE1MzI9T3BjNldVbVNXMVhReXJTVmpuS1pHUF96Q0l2YldTbFpYY3pJcmFIeWhIMmo1czRjR1hqdWZxZE9qZ1B2NEpmalpjYXFPMmlaemFfc3Jab3FtWEdSQ2czSm8wc0NoQUFTTk5aMzBOeVpELVdETGUwUjFab1VOeENCQ0pQblJpcTc4Tlk0OVRhdUNCaHd4dTBMbU1KQ2pvcm43ZkducEJMa2FVSXZUbWptQ2hZa0MtWVBCdUFGV0gtSjc2OHhPZmN1Sk1FU3gwNmo2VDI5qAEAsAEEwAEByAEB2gEGMTguNy4ygAIBiAIBmgMCEAPaA+wB6beoEsnSzyKX4PUstIX2LMqV9iyXg/csop33LNee9yzwkvgs16X4LNup+CyjtfgsrvD4LOGR+Sy0lvksp5r5LKma+Sy6pfks/6r5LJKx+SyKs/ks/7z5LMe++SzLv/ksrMb5LNbN+SzW2fksn/j5LIb/+Sy3m/osw776LKj4+izHh/ssgZD7LIK6+yzUyPsskd+jL+2+py+49IUw9uGHMIPnhzD68IcwxaWIMNLoiDDT6Igw5fiIML6FiTCChokw4p+JMISoiTCx04kw6MDjMc+15TGlkLEyvNq/MvH6xjL1+sYy+frGMqO9yjLwAwKCBKgHQ0FNU3R3VU54QVBrekVnRjlZY0RzWlBsRXR0TnBLVUdpU253Qlp3MDBoTFBDZ1RnQVFUWEJZd0NCTTRHQktrTUJNSUY2d2pZRHdURUR3Nm5BQVRwQm93Q0JQOEZCSVlQQkpvQ0JJTUlCSk12Qk1NWEJMY0Z3Z1FFNU15OEVRU2tEZ2I2QkFhb0JRU0VFd1NNQ3dUY0RBU3dCQVNwQUFTRUJxVVVCR2tFeHhDMkhGVUVwQUlFX2dZRTB3a0VzQThFdHcwRW9RWUVxaFFFeVFVRXloY0VFQVNpQlFTT0N3U3NEQVNoQmdTLUJnVFlBUVNhQlFTTUR3VExDN3NDQk9VREJETUVyd1lFQ0FUNUJBVGtEZ1RqQk1FTUF2QUdCTGNHQktRRzN3VUV2Z09PRHdiRkFRZmpBQVRtQXdhRUFBU29Ed1JEQk5zTkJJVUVCTEVFcUFBRWtBYTRBd1RHQ0FUMERBUWpCTDhHQkpBQkJMMEFCTDhHQkk4QkE4QUFCSzRCQkJFRTF3UUVfQjhGM2dVRThnQUVtUWEwQlFST19BTUdzQVlFQWdXX0FBYkZBQVdqQlZjRXJ3TUZKZ1VfQkxnRC1nTUZ2d1VFTFFXZUJRWFVCQVh0QkFYWkF3WHZBd1NEQlFDdUFMMERCU0VGMWdrRnR3RUFBSHNGakFNRkF3VURCUU1GQXdVREJRTUY2QVlGM1FGeEJZVUNCZE1HQllJRkFBQUE1Z1d5QmdiTURBU0pBZ09HQUFTMkJnWEVCQVV0QmFnRkJNRUZCYVVHQmFzRUJiTUVCYk1OQlh4d0JWQUZ6d0VHNVFZRkFBWE5Bd1dMRFFVREJmTUZCZjROQlZFRmxnWUZnZ1lGbkFVRkt3V3NEUVVEQmFBR0JmZ0xaZ1dSQmdkZUJhdVhpd1FGdEFNRjlRVjZCdWdHVHdYUkJRVzBBZ1hCREFVREJiZ0ZCWjBXMGdhZEJmb0NZQVhWRGFzT0JyOENCWWdCQlFYSENRVUxCY2dCcndMQkNMOFFxZ3lHRVFYTkZRT0tBUWFPRVFVVmFPNndyeFhZbmFBWHlvcWhEWnNpa2hmTGFvMGRzd2FmYy1FVmhBUEFESTA4dFNiQ0R3YVhETU1DbFFId0J2TU93QWJqQUs0QS1BelBHZUVCdHh1TUpPTS0zeENITFltaXJ3WGMyQVROc2xtNjZnYUxBdkVPelRPYmZZS20zUWJoOHdiUzNVeVJ6UW16cHdBRUJLN0ZCQT09iAQAkgQSMjUuNDcuMC44MzM1NDI5MzAwoAT0A6oEAMAEAsgED9IEOEFkSlZFYXRmSzhkbFQ0ZnY3alY2TkJ1MU80ejhmTUlTRmMtcS10YTdIcE9lYmI1bFBqenZpT0xI';

const BASE_ROUTE_OPTIONS_MESSAGE_BASE64 =
  'CkFABkgBcgIIAnICCAGIAQGQAQCiARoKCggBEAEYASABKAESCggBEAEYASABKAEwAcABAcABAtABAeABAfgBAYACARI7KgQwAlACQACgAQPQAQHaAQwQARgBIAEoAjABOAHoAQH6AQQIARABkgICCADqAgIIAeoCAggC6gICCAMgAUABgAEBigGKAQgGEAQYASABKAEwADgBQABQAVgBanQKFAoSCAASBggCEAYYARIGCAMQBhgBCiQKIggDEgYIAhABGAASBggLEAEYABIGCAgQARgAEgYIBBABGAAKBAoCCAIKDAoKCAESBggLEAYYAAoECgIICAoECgIIBBAAGAAiEgoOCAAdAACAPyUAAIA/KAQQAagBAbABAMIBCggACAMIBBgBGADQAQHYAQHwAQHiAgQSAhAB6gIGCgQIARABugMICgQIARABEAHCAwIQAZAEAJgEAbgEAcAEAcgEAdAEAeAEAfIEBAgCGAGABQGIBQGaBQIIAaAFAaoFAggAugUGCAEQARgBwgUCEAHQBQE=';

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
  if (!text && (!finiteNumber(lat) || !finiteNumber(lng))) {
    throw makeHttpError(400, `${field} must include text, label/address, or lat/lng`);
  }
  if (text && text.length > MAX_LOCATION_TEXT_LENGTH) throw makeHttpError(400, `${field} is too long`);

  return {
    text: text ?? `${lat},${lng}`,
    ...(finiteNumber(lat) && finiteNumber(lng) ? { lat, lng } : {}),
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

function stringField(field: number, value: string): Buffer {
  return Buffer.concat([tag(field, 2), delimited(Buffer.from(value, 'utf8'))]);
}

function bytesField(field: number, value: Buffer): Buffer {
  return Buffer.concat([tag(field, 2), delimited(value)]);
}

function messageField(field: number, parts: Buffer[]): Buffer {
  return bytesField(field, Buffer.concat(parts));
}

function doubleField(field: number, value: number): Buffer {
  const buffer = Buffer.alloc(8);
  buffer.writeDoubleLE(value, 0);
  return Buffer.concat([tag(field, 1), buffer]);
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
    } else if (wire === 1) {
      const next = skipField(buffer, pos, end, wire);
      if (!Number.isFinite(next)) throw new Error('Invalid fixed64 protobuf field');
      value = buffer.subarray(pos, next);
      pos = next;
    } else if (wire === 2) {
      const [length, dataPos] = readVarint(buffer, pos, end);
      const next = dataPos + length;
      if (next > end) throw new Error('Invalid length-delimited protobuf field');
      value = buffer.subarray(dataPos, next);
      pos = next;
    } else if (wire === 5) {
      const next = skipField(buffer, pos, end, wire);
      if (!Number.isFinite(next)) throw new Error('Invalid fixed32 protobuf field');
      value = buffer.subarray(pos, next);
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

function waypoint(location: NormalizedLocation): Buffer {
  const parts = [stringField(1, location.text)];
  if (location.dataId) parts.push(stringField(2, location.dataId));
  if (finiteNumber(location.lat) && finiteNumber(location.lng)) {
    parts.push(messageField(3, [doubleField(3, location.lat), doubleField(4, location.lng)]));
  }
  parts.push(stringField(4, location.text), varintField(6, 0));
  if (location.placeId) parts.push(stringField(19, location.placeId));
  return messageField(1, parts);
}

function replaceOrInsertFields(message: Buffer, replacements: Map<number, Buffer>): Buffer {
  if (!replacements.size) return message;
  const fields = parseMessage(message);
  const replacementNumbers = [...replacements.keys()].sort((a, b) => a - b);
  const parts: Buffer[] = [];
  const inserted = new Set<number>();

  for (const field of fields) {
    for (const fieldNumber of replacementNumbers) {
      if (!inserted.has(fieldNumber) && fieldNumber < field.field) {
        parts.push(replacements.get(fieldNumber)!);
        inserted.add(fieldNumber);
      }
    }
    if (replacements.has(field.field)) {
      if (!inserted.has(field.field)) {
        parts.push(replacements.get(field.field)!);
        inserted.add(field.field);
      }
      continue;
    }
    parts.push(message.subarray(field.tagPos, field.end));
  }

  for (const fieldNumber of replacementNumbers) {
    if (!inserted.has(fieldNumber)) parts.push(replacements.get(fieldNumber)!);
  }
  return Buffer.concat(parts);
}

function routePreferenceOptionsWithAvoids(base: Buffer, options: NormalizedRequest['options']): Buffer {
  const replacements = new Map<number, Buffer>();
  if (options.avoidHighways) replacements.set(1, varintField(1, 1));
  if (options.avoidTolls) replacements.set(2, varintField(2, 1));
  return replaceOrInsertFields(base, replacements);
}

function routeOptionsWithAdjustments(
  departureTime: GoogleMapsMobileDirectionsResult['departureTime'],
  options: NormalizedRequest['options'],
): Buffer {
  const base = Buffer.from(BASE_ROUTE_OPTIONS_MESSAGE_BASE64, 'base64');
  const replacements = new Map<number, Buffer>();

  if (options.avoidHighways || options.avoidTolls) {
    const routePreferenceField = firstMessage(parseMessage(base), 2);
    if (!routePreferenceField) throw new Error('Captured mobile route options are missing route preferences');
    replacements.set(2, bytesField(2, routePreferenceOptionsWithAvoids(routePreferenceField, options)));
  }

  if (options.avoidFerries) {
    replacements.set(7, varintField(7, 1));
  }

  if (departureTime) {
    replacements.set(
      23,
      messageField(23, [
        varintField(1, 0),
        varintField(2, departureTime.timeKindEnum),
        varintField(3, departureTime.googleMapsEpochSeconds),
      ]),
    );
  }

  return replaceOrInsertFields(base, replacements);
}

function smallKV(field: number, first: number, second: number): Buffer {
  return messageField(field, [varintField(1, first), varintField(2, second)]);
}

function buildRoutePayload(
  request: NormalizedRequest,
  departureTime: GoogleMapsMobileDirectionsResult['departureTime'],
) {
  const route = messageField(1, [
    waypoint(request.from),
    waypoint(request.to),
    varintField(5, 5),
    messageField(6, [routeOptionsWithAdjustments(departureTime, request.options)]),
    varintField(7, 0),
    varintField(14, 1),
    messageField(15, [varintField(3, 0)]),
    varintField(16, 1),
    varintField(25, 0),
    smallKV(34, 10, 2),
    smallKV(37, 3, 4),
    smallKV(37, 4, 6),
  ]);

  return Buffer.concat([
    route,
    varintField(2, 18),
    varintField(2, 12),
    varintField(2, 13),
    varintField(4, 1),
    varintField(4, 3),
    varintField(7, 1),
    varintField(8, 1),
  ]);
}

function buildMobileMmapRequest(request: NormalizedRequest): BuiltMobileRequest {
  const departureTime = buildDepartureTime(request);
  const routePayload = buildRoutePayload(request, departureTime);
  const routeHeader = Buffer.alloc(6);
  routeHeader.writeUInt16BE(142, 0);
  routeHeader.writeUInt32BE(routePayload.length, 2);
  const body = Buffer.concat([
    Buffer.from(MOBILE_MMAP_PREFIX_AND_CLIENT_CHUNK_BASE64, 'base64'),
    routeHeader,
    routePayload,
  ]);
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

function decodeMmapResponse(responseBody: Buffer): { protobuf: Buffer; gzipOffset: number } {
  const gzipOffset = responseBody.indexOf(Buffer.from([0x1f, 0x8b]));
  if (gzipOffset < 0) throw makeHttpError(502, 'Google Maps mobile response did not contain a gzip protobuf payload');
  try {
    return { protobuf: gunzipSync(responseBody.subarray(gzipOffset)), gzipOffset };
  } catch (err) {
    throw makeHttpError(
      502,
      `Unable to inflate Google Maps mobile response: ${err instanceof Error ? err.message : 'invalid gzip'}`,
    );
  }
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
): Omit<GoogleMapsMobileDirectionsRoute, 'tollFee' | 'overviewGeometry'> | null {
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
    route.index,
    route.title ?? '',
    route.distance.meters ?? '',
    route.duration.seconds ?? '',
    route.trafficPrediction?.text ?? '',
    route.tollFee?.text ?? '',
  ].join(':');
}

function parseRoutes(protobuf: Buffer): GoogleMapsMobileDirectionsRoute[] {
  const routes: GoogleMapsMobileDirectionsRoute[] = [];
  const seen = new Set<string>();

  function addRoute(route: GoogleMapsMobileDirectionsRoute): void {
    const key = routeKey(route);
    if (seen.has(key)) return;
    seen.add(key);
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
    return {
      ...header,
      tollFee,
      ...(overviewGeometry ? { overviewGeometry } : {}),
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
  const decoded = decodeMmapResponse(body);
  const routes = parseRoutes(decoded.protobuf);
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
