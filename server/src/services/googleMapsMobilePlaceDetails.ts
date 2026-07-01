import {
  allProtoMessages as allMessages,
  firstProtoMessage as firstMessage,
  firstProtoVarint as firstVarint,
  isProtoText as isText,
  parseProtoMessage as parseMessage,
  protoFieldStrings as fieldStrings,
  protoFixed32Float as fixed32Float,
  protoFixed64Double as fixed64Double,
  tryParseProtoMessage as tryParseMessage,
} from './googleMapsMobile/protobuf';
import {
  GOOGLE_MAPS_MOBILE_API_KEY,
  GOOGLE_MAPS_MOBILE_CLIENT_DATA_BIN,
  GOOGLE_MAPS_MOBILE_GMM_CLIENT_BIN,
  GOOGLE_MAPS_MOBILE_MMAP_ENDPOINT,
  GOOGLE_MAPS_MOBILE_UGC_POSTS_ENDPOINT,
  GoogleMapsMobileReversedProtoError,
  buildListUgcPostsReviewsPageBody,
  buildMmapPlaceDetailsRequestBody,
  buildMmapRichPlacePhotosRequestBody,
} from './googleMapsMobile/reversedProto';
import {
  GOOGLE_MAPS_FTID_RE,
  type GoogleMapsPreviewOpeningPeriod,
  type GoogleMapsPreviewOpeningPoint,
  type GoogleMapsPreviewPopularTime,
  type GoogleMapsPreviewPlaceDetails,
} from './googleMapsPreviewPlaceDetails';

import { gunzipSync } from 'node:zlib';

export interface GoogleMapsMobilePlaceDetailsRequest {
  ftid: string;
  language?: string;
  timeoutMs?: number;
  includeRaw?: boolean;
}

export interface GoogleMapsMobilePlacePhoto {
  url: string;
  width: number | null;
  height: number | null;
  attribution: string | null;
  source: 'google_maps_mobile';
}

export interface GoogleMapsMobileRichPlaceDetails {
  popular_times: GoogleMapsPreviewPopularTime[] | null;
  popular_status: string | null;
  reviews: unknown[];
  next_reviews_page_token?: string | null;
  photos: GoogleMapsMobilePlacePhoto[];
  summary: string | null;
}

export interface GoogleMapsMobilePlaceReviewsRequest {
  ftid: string;
  pageToken: string;
  language?: string;
  timeoutMs?: number;
}

export interface GoogleMapsMobileReviewListPage {
  reviews: unknown[];
  next_page_token: string | null;
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

const DEFAULT_LANGUAGE = 'en-US,en;q=0.9';
const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_TIMEOUT_MS = 30_000;
const MAX_REVIEW_PAGES = 3;
const MAX_MOBILE_REVIEWS = 32;
const DAY_MINUTES = 24 * 60;
const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const richPlaceDetailsResponseCache = new Map<string, GoogleMapsMobileRichPlaceDetails>();
const richPlaceDetailsInFlight = new Map<string, Promise<GoogleMapsMobileRichPlaceDetails>>();

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

function buildMobileMmapHeaders(request: NormalizedRequest, bodyLength: number): Record<string, string> {
  return {
    'content-type': 'application/binary',
    accept: '*/*',
    'accept-encoding': 'gzip, deflate, br',
    'accept-language': request.language,
    'user-agent': 'com.google.Maps/25.47.0 iPhone/18.7.2 hw/iPhone16_1 (gzip)',
    'upload-draft-interop-version': '6',
    'x-client-time-format': 'CAI=',
    'upload-complete': '?1',
    'x-goog-ext-353267353-bin': 'IOTDCA==',
    'content-length': String(bodyLength),
  };
}

function buildMobileMmapRequest(request: NormalizedRequest): BuiltMobilePlaceDetailsRequest {
  const body = buildMmapPlaceDetailsRequestBody(request.ftid);

  return {
    endpoint: GOOGLE_MAPS_MOBILE_MMAP_ENDPOINT,
    body,
    headers: buildMobileMmapHeaders(request, body.length),
  };
}

function buildMobileMmapRichPhotosRequest(request: NormalizedRequest): BuiltMobilePlaceDetailsRequest {
  let body: Buffer;
  try {
    body = buildMmapRichPlacePhotosRequestBody(request.ftid);
  } catch (err) {
    if (err instanceof GoogleMapsMobileReversedProtoError) {
      throw makeHttpError(err.status, err.message);
    }
    throw err;
  }

  return {
    endpoint: GOOGLE_MAPS_MOBILE_MMAP_ENDPOINT,
    body,
    headers: buildMobileMmapHeaders(request, body.length),
  };
}

function normalizeReviewListRequest(
  input: GoogleMapsMobilePlaceReviewsRequest,
): NormalizedRequest & { pageToken: string } {
  const request = normalizeRequest(input);
  const pageToken = nonEmptyString(input.pageToken);
  if (!pageToken) throw makeHttpError(400, 'Google Maps mobile review list requires a page token');
  return { ...request, pageToken };
}

function buildMobileReviewListHeaders(request: NormalizedRequest, bodyLength: number): Record<string, string> {
  return {
    'content-type': 'application/x-protobuf',
    accept: '*/*',
    'accept-encoding': 'gzip, deflate, br',
    'accept-language': request.language,
    'x-client-data-bin': GOOGLE_MAPS_MOBILE_CLIENT_DATA_BIN,
    'x-gmm-client-bin': GOOGLE_MAPS_MOBILE_GMM_CLIENT_BIN,
    'x-goog-api-key': GOOGLE_MAPS_MOBILE_API_KEY,
    'x-goog-request-params': 'frontend=boq',
    'x-server-timeout': '15.000000',
    'user-agent': 'grpc-objc/1.77.0-dev (GTMSessionFetcher;)',
    'content-length': String(bodyLength),
    'x-client-time-format-bin': 'CAI=',
    'x-goog-ext-353267353-bin': 'IOTDCA==',
  };
}

export function buildGoogleMapsMobileReviewListRequest(
  input: GoogleMapsMobilePlaceReviewsRequest,
): BuiltMobilePlaceDetailsRequest {
  const request = normalizeReviewListRequest(input);
  const body = buildListUgcPostsReviewsPageBody(request.ftid, request.pageToken);
  return {
    endpoint: GOOGLE_MAPS_MOBILE_UGC_POSTS_ENDPOINT,
    body,
    headers: buildMobileReviewListHeaders(request, body.length),
  };
}

export function buildGoogleMapsMobilePlaceDetailsRequest(
  input: GoogleMapsMobilePlaceDetailsRequest,
): BuiltMobilePlaceDetailsRequest {
  return buildMobileMmapRequest(normalizeRequest(input));
}

function decodeMmapResponse(responseBody: Buffer): { protobuf: Buffer; gzipOffset: number } {
  const gzipMarker = Buffer.from([0x1f, 0x8b]);
  let offset = 0;
  const candidates: Array<{ protobuf: Buffer; gzipOffset: number }> = [];
  const errors: string[] = [];

  while ((offset = responseBody.indexOf(gzipMarker, offset)) >= 0) {
    try {
      candidates.push({ protobuf: gunzipSync(responseBody.subarray(offset)), gzipOffset: offset });
    } catch (err) {
      errors.push(err instanceof Error ? err.message : 'invalid gzip');
    }
    offset += gzipMarker.length;
  }

  if (candidates.length === 0) {
    if (errors.length > 0) {
      throw makeHttpError(502, `Unable to inflate Google Maps mobile place response: ${errors[0]}`);
    }
    throw makeHttpError(502, 'Google Maps mobile place response did not contain a gzip protobuf payload');
  }

  return candidates.reduce((best, candidate) => (candidate.protobuf.length > best.protobuf.length ? candidate : best));
}

function responseBufferFrom(value: Buffer | ArrayBuffer): Buffer {
  return Buffer.isBuffer(value) ? value : Buffer.from(value);
}

function isUrlByte(byte: number): boolean {
  return byte > 0x20 && byte < 0x7f && byte !== 0x22 && byte !== 0x3c && byte !== 0x3e && byte !== 0x5c;
}

function normalizeRichPhotoUrl(raw: string): GoogleMapsMobilePlacePhoto | null {
  const cleaned = raw.replace(/[:;),\]]+\d*$/g, '');
  let parsed: URL;
  try {
    parsed = new URL(cleaned);
  } catch {
    return null;
  }
  if (!parsed.hostname.endsWith('googleusercontent.com')) return null;
  if (!/(?:^|\/)(?:gps|gpms|grass)-cs-s\//.test(parsed.pathname)) return null;
  if (/\/a-|photo\.jpg|=mm|manifest|googlevideo/i.test(cleaned)) return null;
  const variantIndex = cleaned.lastIndexOf('=');
  if (variantIndex < 0) return null;
  const base = cleaned.slice(0, variantIndex);
  if (!base || base.includes('?')) return null;
  return {
    url: `${base}=w640-h426-k-no`,
    width: 640,
    height: 426,
    attribution: null,
    source: 'google_maps_mobile',
  };
}

function googleusercontentPhotoDedupeKey(url: string): string {
  const cleaned = url.replace(/[:;),\]]+\d*$/g, '');
  try {
    const parsed = new URL(cleaned);
    const pathKey = `${parsed.origin}${parsed.pathname}`;
    const variantIndex = pathKey.lastIndexOf('=');
    return variantIndex > pathKey.lastIndexOf('/') ? pathKey.slice(0, variantIndex) : pathKey;
  } catch {
    return cleaned.replace(/[?#].*$/, '').replace(/=[^=/?#]+$/, '');
  }
}

function extractGoogleMapsMobilePhotoUrls(protobuf: Buffer): GoogleMapsMobilePlacePhoto[] {
  const photos: GoogleMapsMobilePlacePhoto[] = [];
  const seen = new Set<string>();
  const marker = Buffer.from('https://', 'ascii');
  let offset = 0;
  while ((offset = protobuf.indexOf(marker, offset)) >= 0) {
    let end = offset;
    while (end < protobuf.length && isUrlByte(protobuf[end])) end += 1;
    const photo = normalizeRichPhotoUrl(protobuf.subarray(offset, end).toString('ascii'));
    const dedupeKey = photo ? googleusercontentPhotoDedupeKey(photo.url) : null;
    if (photo && dedupeKey && !seen.has(dedupeKey)) {
      seen.add(dedupeKey);
      photos.push(photo);
      if (photos.length >= 24) break;
    }
    offset = Math.max(end, offset + marker.length);
  }
  return photos;
}

export function parseGoogleMapsMobilePlacePhotosResponse(
  responseBody: Buffer | ArrayBuffer,
): GoogleMapsMobilePlacePhoto[] {
  const body = responseBufferFrom(responseBody);
  const decoded = decodeMmapResponse(body);
  return extractGoogleMapsMobilePhotoUrls(decoded.protobuf);
}

export function parseGoogleMapsMobileRichPlaceDetailsResponse(
  responseBody: Buffer | ArrayBuffer,
): GoogleMapsMobileRichPlaceDetails {
  const body = responseBufferFrom(responseBody);
  const decoded = decodeMmapResponse(body);
  const photos = extractGoogleMapsMobilePhotoUrls(decoded.protobuf);
  const rootFields = tryParseMessage(decoded.protobuf);
  const placeMessage = rootFields ? firstMessage(rootFields, 1) : null;
  const placeFields = placeMessage ? tryParseMessage(placeMessage) : null;

  const popularTimesMessage = placeFields ? firstMessage(placeFields, 57) : null;
  const reviewsMessage = placeFields ? firstMessage(placeFields, 81) : null;
  return {
    popular_times: parseMobilePopularTimes(popularTimesMessage),
    popular_status: parseMobilePopularStatus(popularTimesMessage),
    reviews: parseMobileReviews(reviewsMessage),
    next_reviews_page_token: extractReviewPageToken(reviewsMessage) ?? extractReviewPageToken(decoded.protobuf),
    photos,
    summary: null,
  };
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
    day: (((day + Math.floor(minutes / DAY_MINUTES)) % 7) + 7) % 7,
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

function parseMobilePopularTimes(popularTimesMessage: Buffer | null): GoogleMapsPreviewPopularTime[] | null {
  if (!popularTimesMessage) return null;
  const fields = tryParseMessage(popularTimesMessage);
  if (!fields) return null;

  const popularTimes: GoogleMapsPreviewPopularTime[] = [];
  for (const dayMessage of allMessages(fields, 1)) {
    const dayFields = tryParseMessage(dayMessage);
    if (!dayFields) continue;
    const day = googleDayFromMobile(firstVarint(dayFields, 1));
    if (day === null) continue;

    for (const hourMessage of allMessages(dayFields, 2)) {
      const hourFields = tryParseMessage(hourMessage);
      if (!hourFields) continue;
      const hour = firstVarint(hourFields, 1);
      const percent = firstVarint(hourFields, 2);
      if (
        hour === null ||
        percent === null ||
        !Number.isInteger(hour) ||
        !Number.isInteger(percent) ||
        hour < 0 ||
        hour > 23 ||
        percent < 0 ||
        percent > 100
      ) {
        continue;
      }
      popularTimes.push({ day, hour, occupancy_percent: percent });
    }
  }

  return popularTimes.length > 0 ? popularTimes : null;
}

function parseMobilePopularStatus(popularTimesMessage: Buffer | null): string | null {
  if (!popularTimesMessage) return null;
  const fields = tryParseMessage(popularTimesMessage);
  if (!fields) return null;
  return fieldStrings(fields, 2)[0] ?? null;
}

function parseMobileReviewAuthor(authorMessage: Buffer | null): {
  author: string | null;
  photo: string | null;
  uri: string | null;
} {
  if (!authorMessage) return { author: null, photo: null, uri: null };
  const fields = tryParseMessage(authorMessage);
  if (!fields) return { author: null, photo: null, uri: null };
  return {
    uri: fieldStrings(fields, 1)[0] ?? null,
    author: fieldStrings(fields, 2)[0] ?? null,
    photo: fieldStrings(fields, 3)[0] ?? null,
  };
}

function publishedAtFromMillis(value: number | null): string | null {
  if (value === null || !Number.isFinite(value) || value <= 0) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function publishedAtFromGoogleTimestamp(value: number | null): string | null {
  if (value === null || !Number.isFinite(value) || value <= 0) return null;
  const millis = value > 1_000_000_000_000_000 ? value / 1000 : value > 1_000_000_000_000 ? value : value * 1000;
  return publishedAtFromMillis(millis);
}

function parseMobileReviews(reviewsMessage: Buffer | null): unknown[] {
  if (!reviewsMessage) return [];
  const fields = tryParseMessage(reviewsMessage);
  if (!fields) return [];

  const reviews: unknown[] = [];
  for (const reviewMessage of allMessages(fields, 1)) {
    const reviewFields = tryParseMessage(reviewMessage);
    if (!reviewFields) continue;
    const text = fieldStrings(reviewFields, 4)[0] ?? null;
    const authorInfo = parseMobileReviewAuthor(firstMessage(reviewFields, 1));
    const author = authorInfo.author;
    if (!text && !author) continue;

    reviews.push({
      author,
      rating: firstVarint(reviewFields, 5),
      text,
      time: fieldStrings(reviewFields, 2)[0] ?? null,
      published_at: publishedAtFromMillis(firstVarint(reviewFields, 58) ?? firstVarint(reviewFields, 28)),
      photo: authorInfo.photo,
      uri: fieldStrings(reviewFields, 19)[0] ?? authorInfo.uri,
      language: fieldStrings(reviewFields, 33)[0] ?? null,
    });
  }

  return reviews;
}

function extractReviewPageToken(buffer: Buffer | null): string | null {
  if (!buffer) return null;
  const tokenPattern = /\b(Cj[A-Za-z0-9_-]{20,}:[0-9]{1,5})\b/g;
  let bestToken: string | null = null;
  let bestOffset = -1;

  for (const text of collectText(buffer)) {
    tokenPattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = tokenPattern.exec(text)) !== null) {
      const offset = Number(match[1].split(':').pop());
      if (Number.isInteger(offset) && offset >= bestOffset) {
        bestOffset = offset;
        bestToken = match[1];
      }
    }
  }

  return bestToken;
}

function parseUgcReviewAuthor(authorMessage: Buffer | null): {
  author: string | null;
  photo: string | null;
  uri: string | null;
  time: string | null;
  published_at: string | null;
} {
  if (!authorMessage) return { author: null, photo: null, uri: null, time: null, published_at: null };
  const fields = tryParseMessage(authorMessage);
  if (!fields) return { author: null, photo: null, uri: null, time: null, published_at: null };
  const profileContainer = firstMessage(fields, 5);
  const profileContainerFields = profileContainer ? tryParseMessage(profileContainer) : null;
  const profileMessage = profileContainerFields ? firstMessage(profileContainerFields, 1) : null;
  const profileFields = profileMessage ? tryParseMessage(profileMessage) : null;

  return {
    author: profileFields ? (fieldStrings(profileFields, 5)[0] ?? null) : null,
    photo: profileFields ? (fieldStrings(profileFields, 4)[0] ?? null) : null,
    uri: profileFields ? (fieldStrings(profileFields, 6)[0] ?? fieldStrings(profileFields, 9)[0] ?? null) : null,
    time: fieldStrings(fields, 7)[0] ?? null,
    published_at: publishedAtFromGoogleTimestamp(firstVarint(fields, 4) ?? firstVarint(fields, 3)),
  };
}

function parseUgcReviewContent(contentMessage: Buffer | null): {
  rating: number | null;
  text: string | null;
  language: string | null;
} {
  if (!contentMessage) return { rating: null, text: null, language: null };
  const fields = tryParseMessage(contentMessage);
  if (!fields) return { rating: null, text: null, language: null };
  const ratingMessage = firstMessage(fields, 1);
  const ratingFields = ratingMessage ? tryParseMessage(ratingMessage) : null;
  const textMessage = firstMessage(fields, 2);
  const textFields = textMessage ? tryParseMessage(textMessage) : null;

  return {
    rating: ratingFields ? firstVarint(ratingFields, 1) : null,
    text: textFields ? (fieldStrings(textFields, 1)[0] ?? null) : null,
    language: textFields ? (fieldStrings(textFields, 2)[0] ?? null) : null,
  };
}

function parseUgcReviewUri(actionsMessage: Buffer | null): string | null {
  if (!actionsMessage) return null;
  const fields = tryParseMessage(actionsMessage);
  if (!fields) return null;
  const reviewUrlMessage = firstMessage(fields, 4);
  const reviewUrlFields = reviewUrlMessage ? tryParseMessage(reviewUrlMessage) : null;
  const urls = reviewUrlFields ? fieldStrings(reviewUrlFields, 1) : [];
  return urls.find((url) => /\/maps\/reviews\//.test(url)) ?? urls[0] ?? null;
}

function parseUgcPostReview(postMessage: Buffer): unknown | null {
  const postFields = tryParseMessage(postMessage);
  if (!postFields) return null;
  const reviewMessage = firstMessage(postFields, 1) ?? postMessage;
  const reviewFields = tryParseMessage(reviewMessage);
  if (!reviewFields) return null;

  const authorInfo = parseUgcReviewAuthor(firstMessage(reviewFields, 2));
  const content = parseUgcReviewContent(firstMessage(reviewFields, 3));
  const text = nonEmptyString(content.text);
  const author = nonEmptyString(authorInfo.author);
  if (!text && !author && content.rating === null) return null;

  return {
    author,
    rating: content.rating,
    text,
    time: nonEmptyString(authorInfo.time),
    published_at: authorInfo.published_at,
    photo: nonEmptyString(authorInfo.photo),
    uri: parseUgcReviewUri(firstMessage(reviewFields, 5)) ?? nonEmptyString(authorInfo.uri),
    language: nonEmptyString(content.language),
  };
}

export function parseGoogleMapsMobileReviewListResponse(
  responseBody: Buffer | ArrayBuffer,
): GoogleMapsMobileReviewListPage {
  const body = responseBufferFrom(responseBody);
  const fields = parseMessage(body);
  const reviews = allMessages(fields, 1)
    .map(parseUgcPostReview)
    .filter((review): review is Record<string, unknown> => Boolean(review));

  return {
    reviews,
    next_page_token: fieldStrings(fields, 2)[0] ?? null,
  };
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

export async function fetchGoogleMapsMobilePlacePhotos(
  input: GoogleMapsMobilePlaceDetailsRequest,
): Promise<GoogleMapsMobilePlacePhoto[]> {
  const details = await fetchGoogleMapsMobileRichPlaceDetails(input);
  return details.photos;
}

export async function fetchGoogleMapsMobileReviewList(
  input: GoogleMapsMobilePlaceReviewsRequest,
): Promise<GoogleMapsMobileReviewListPage> {
  const request = normalizeReviewListRequest(input);
  const built = buildGoogleMapsMobileReviewListRequest(input);
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
        `Google Maps mobile review list failed with ${response.status} ${response.statusText}`,
      );
    }
    return parseGoogleMapsMobileReviewListResponse(body);
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw makeHttpError(504, 'Google Maps mobile review list request timed out');
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchAdditionalMobileReviews(
  request: NormalizedRequest,
  initialPageToken: string | null | undefined,
  initialReviewCount: number,
): Promise<unknown[]> {
  const reviews: unknown[] = [];
  const seenTokens = new Set<string>();
  let pageToken = initialPageToken ?? null;

  for (
    let page = 0;
    pageToken && page < MAX_REVIEW_PAGES && initialReviewCount + reviews.length < MAX_MOBILE_REVIEWS;
    page += 1
  ) {
    if (seenTokens.has(pageToken)) break;
    seenTokens.add(pageToken);

    const reviewPage = await fetchGoogleMapsMobileReviewList({
      ftid: request.ftid,
      pageToken,
      language: request.language,
      timeoutMs: request.timeoutMs,
    });
    reviews.push(...reviewPage.reviews);
    pageToken = reviewPage.next_page_token;
  }

  return reviews.slice(0, Math.max(0, MAX_MOBILE_REVIEWS - initialReviewCount));
}

export async function fetchGoogleMapsMobileRichPlaceDetails(
  input: GoogleMapsMobilePlaceDetailsRequest,
): Promise<GoogleMapsMobileRichPlaceDetails> {
  const request = normalizeRequest(input);
  const cached = richPlaceDetailsResponseCache.get(`${request.ftid}:${request.language}`);
  if (cached) return cached;

  const cacheKey = `${request.ftid}:${request.language}`;
  let inFlight = richPlaceDetailsInFlight.get(cacheKey);
  if (!inFlight) {
    inFlight = (async () => {
      const built = buildMobileMmapRichPhotosRequest(request);
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
            `Google Maps mobile place photos failed with ${response.status} ${response.statusText}`,
          );
        }
        const details = parseGoogleMapsMobileRichPlaceDetailsResponse(body);
        if (details.next_reviews_page_token) {
          try {
            const additionalReviews = await fetchAdditionalMobileReviews(
              request,
              details.next_reviews_page_token,
              details.reviews.length,
            );
            if (additionalReviews.length > 0) {
              details.reviews = [...details.reviews, ...additionalReviews].slice(0, MAX_MOBILE_REVIEWS);
            }
          } catch (err) {
            console.warn(
              `Google Maps mobile review list failed for ${request.ftid}: ${err instanceof Error ? err.message : 'unknown error'}`,
            );
          }
        }
        richPlaceDetailsResponseCache.set(cacheKey, details);
        if (richPlaceDetailsResponseCache.size > 200) {
          const oldest = richPlaceDetailsResponseCache.keys().next().value;
          if (oldest !== undefined) richPlaceDetailsResponseCache.delete(oldest);
        }
        return details;
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') {
          throw makeHttpError(504, 'Google Maps mobile place photos request timed out');
        }
        throw err;
      } finally {
        clearTimeout(timeout);
        richPlaceDetailsInFlight.delete(cacheKey);
      }
    })();
    richPlaceDetailsInFlight.set(cacheKey, inFlight);
  }

  return inFlight;
}
