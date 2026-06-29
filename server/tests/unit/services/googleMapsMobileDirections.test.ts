import {
  buildGoogleMapsMobileDirectionsRequest,
  fetchGoogleMapsMobileDirections,
  parseGoogleMapsMobileDirectionsResponse,
  __clearGoogleMapsMobileDirectionsCacheForTests,
} from '../../../src/services/googleMapsMobileDirections';

import { gzipSync } from 'node:zlib';
import { afterEach, describe, expect, it, vi } from 'vitest';

function varint(value: number): Buffer {
  let n = BigInt(value);
  const bytes: number[] = [];
  do {
    let byte = Number(n & 0x7fn);
    n >>= 7n;
    if (n) byte |= 0x80;
    bytes.push(byte);
  } while (n);
  return Buffer.from(bytes);
}

interface ProtoField {
  field: number;
  wire: number;
  value: number | Buffer;
  tagPos: number;
  end: number;
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
  throw new Error('Unterminated varint');
}

function tag(field: number, wire: number): Buffer {
  return varint(field * 8 + wire);
}

function varintField(field: number, value: number): Buffer {
  return Buffer.concat([tag(field, 0), varint(value)]);
}

function stringField(field: number, value: string): Buffer {
  const bytes = Buffer.from(value, 'utf8');
  return Buffer.concat([tag(field, 2), varint(bytes.length), bytes]);
}

function bytesField(field: number, bytes: Buffer): Buffer {
  return Buffer.concat([tag(field, 2), varint(bytes.length), bytes]);
}

function messageField(field: number, parts: Buffer[]): Buffer {
  const payload = Buffer.concat(parts);
  return Buffer.concat([tag(field, 2), varint(payload.length), payload]);
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
    let value: number | Buffer;
    if (wire === 0) {
      const [varintValue, next] = readVarint(buffer, pos, end);
      value = varintValue;
      pos = next;
    } else if (wire === 1) {
      value = buffer.subarray(pos, pos + 8);
      pos += 8;
    } else if (wire === 2) {
      const [length, dataPos] = readVarint(buffer, pos, end);
      value = buffer.subarray(dataPos, dataPos + length);
      pos = dataPos + length;
    } else if (wire === 5) {
      value = buffer.subarray(pos, pos + 4);
      pos += 4;
    } else {
      throw new Error(`Unsupported wire type ${wire}`);
    }
    if (pos > end) throw new Error('Protobuf field overrun');
    fields.push({ field, wire, value, tagPos, end: pos });
  }
  return fields;
}

function firstVarint(fields: ProtoField[], field: number): number | null {
  const found = fields.find((entry) => entry.field === field && entry.wire === 0);
  return typeof found?.value === 'number' ? found.value : null;
}

function firstMessage(fields: ProtoField[], field: number): Buffer {
  const found = fields.find((entry) => entry.field === field && entry.wire === 2);
  if (!found || !Buffer.isBuffer(found.value)) throw new Error(`Missing message field ${field}`);
  return found.value;
}

function firstString(fields: ProtoField[], field: number): string | null {
  const found = fields.find((entry) => entry.field === field && entry.wire === 2);
  return found && Buffer.isBuffer(found.value) ? found.value.toString('utf8') : null;
}

function firstDouble(fields: ProtoField[], field: number): number | null {
  const found = fields.find((entry) => entry.field === field && entry.wire === 1);
  return found && Buffer.isBuffer(found.value) ? found.value.readDoubleLE(0) : null;
}

function extractMobileRouteOptions(body: Buffer): Buffer {
  for (let pos = 0; pos + 6 <= body.length; pos++) {
    if (body.readUInt16BE(pos) !== 142) continue;
    const length = body.readUInt32BE(pos + 2);
    if (length <= 0 || pos + 6 + length > body.length) continue;
    const root = parseMessage(body.subarray(pos + 6, pos + 6 + length));
    const route = parseMessage(firstMessage(root, 1));
    return firstMessage(route, 6);
  }
  throw new Error('Missing type 142 route chunk');
}

function extractMobileRouteWaypoints(body: Buffer): Array<{ text: string | null; lat: number | null; lng: number | null }> {
  for (let pos = 0; pos + 6 <= body.length; pos++) {
    if (body.readUInt16BE(pos) !== 142) continue;
    const length = body.readUInt32BE(pos + 2);
    if (length <= 0 || pos + 6 + length > body.length) continue;
    const root = parseMessage(body.subarray(pos + 6, pos + 6 + length));
    const route = parseMessage(firstMessage(root, 1));
    return route
      .filter((entry) => entry.field === 1 && entry.wire === 2 && Buffer.isBuffer(entry.value))
      .map((entry) => {
        const waypoint = parseMessage(entry.value as Buffer);
        const coordinates = parseMessage(firstMessage(waypoint, 3));
        return {
          text: firstString(waypoint, 1),
          lat: firstDouble(coordinates, 3),
          lng: firstDouble(coordinates, 4),
        };
      });
  }
  throw new Error('Missing type 142 route chunk');
}

function zigZag(value: number): number {
  return value < 0 ? -value * 2 - 1 : value * 2;
}

function packedVarints(values: number[]): Buffer {
  return Buffer.concat(values.map((value) => varint(value)));
}

function sampleOverviewGeometry(points: Array<{ lat: number; lng: number }>): Buffer {
  let previousLat = 0;
  let previousLng = 0;
  const latDeltas: number[] = [];
  const lngDeltas: number[] = [];

  for (const point of points) {
    const lat = Math.round(point.lat * 1e7);
    const lng = Math.round(point.lng * 1e7);
    latDeltas.push(zigZag(lat - previousLat));
    lngDeltas.push(zigZag(lng - previousLng));
    previousLat = lat;
    previousLng = lng;
  }

  return messageField(8, [bytesField(1, packedVarints(latDeltas)), bytesField(2, packedVarints(lngDeltas))]);
}

function sampleRouteSummary(): Buffer {
  const summary = messageField(11, [
    messageField(1, [varintField(1, 16_800)]),
    messageField(5, [varintField(1, 15_000), varintField(2, 21_000), stringField(3, '4 hr 10 min to 5 hr 50 min')]),
  ]);
  return summary;
}

function sampleRouteHeader(index = 0): Buffer {
  return messageField(1, [
    varintField(1, index),
    stringField(2, 'Tomei Expressway'),
    messageField(3, [varintField(1, 348_474)]),
    messageField(4, [varintField(1, 16_800)]),
    sampleRouteSummary(),
  ]);
}

function sampleRouteDetails(): Buffer {
  const money = messageField(1, [stringField(1, 'JPY'), varintField(2, 8_620), varintField(3, 0)]);
  const moneyContainer = messageField(6, [money, stringField(2, '\u00a58620')]);
  const tollDetail = messageField(1, [
    stringField(1, '\u00a58620'),
    varintField(2, 1),
    stringField(4, 'ETC'),
    moneyContainer,
  ]);
  const turnStep = messageField(20, [
    stringField(
      2,
      "<step maneuver='TURN' meters='1996'>Turn <turn side='RIGHT'>right</turn> at <intersectionlist><intersection lang='ja'>赤池２丁目北（交差点）</intersection></intersectionlist></step>",
    ),
  ]);
  const rampStep = messageField(20, [
    stringField(
      2,
      "<step maneuver='ON_RAMP' meters='91'>Use the left lane to take the <signlist><sign lang='en'>Mei-Nikan Expy</sign></signlist> ramp</step>",
    ),
  ]);
  return messageField(2, [messageField(10, [tollDetail]), turnStep, rampStep]);
}

function sampleMobileMmapResponse(options: { duplicateHeaderWithoutToll?: boolean } = {}): Buffer {
  const overviewGeometry = sampleOverviewGeometry([
    { lat: 35.6778606, lng: 139.763749 },
    { lat: 35.3433356, lng: 139.1565648 },
    { lat: 35.1700303, lng: 136.897241 },
  ]);
  const routeWrapper = messageField(2, [sampleRouteHeader(), sampleRouteDetails()]);
  const routeContainers = [messageField(1, [routeWrapper, overviewGeometry])];
  if (options.duplicateHeaderWithoutToll) {
    routeContainers.push(messageField(1, [sampleRouteHeader(8)]));
  }
  const protobuf = messageField(1, routeContainers);
  return Buffer.concat([Buffer.from([0, 24]), gzipSync(protobuf)]);
}

afterEach(() => {
  __clearGoogleMapsMobileDirectionsCacheForTests();
  vi.unstubAllGlobals();
});

describe('googleMapsMobileDirections wrapper', () => {
  it('encodes local departure time using the mobile mmap route option field', () => {
    const built = buildGoogleMapsMobileDirectionsRequest({
      from: 'Tokyo Station',
      to: 'Fushimi Station Nagoya',
      departureTime: { kind: 'departAtLocal', localDateTime: '2026-06-23T10:40', timeZone: 'Asia/Tokyo' },
    });

    expect(built.departureTime).toEqual({
      googleMapsEpochSeconds: 1782211200,
      timeKindEnum: 2,
      timeZone: 'Asia/Tokyo',
    });
    expect(built.body.indexOf(Buffer.from([0x00, 0x8e]))).toBeGreaterThan(0);

    const routeOptions = parseMessage(extractMobileRouteOptions(built.body));
    const departure = parseMessage(firstMessage(routeOptions, 23));
    expect(firstVarint(departure, 1)).toBe(0);
    expect(firstVarint(departure, 2)).toBe(2);
    expect(firstVarint(departure, 3)).toBe(1782211200);
  });

  it('encodes avoid options using the captured mobile route option fields', () => {
    function routeOptionsFor(options: { avoidTolls?: boolean; avoidHighways?: boolean; avoidFerries?: boolean }) {
      return parseMessage(
        extractMobileRouteOptions(
          buildGoogleMapsMobileDirectionsRequest({
            from: 'Tokyo Station',
            to: 'Fushimi Station Nagoya',
            departureTime: { kind: 'raw', googleMapsEpochSeconds: 1782211200, timeZone: 'Asia/Tokyo' },
            options,
          }).body,
        ),
      );
    }

    const avoidTolls = routeOptionsFor({ avoidTolls: true });
    const avoidTollsPreferences = parseMessage(firstMessage(avoidTolls, 2));
    expect(firstVarint(avoidTollsPreferences, 1)).toBeNull();
    expect(firstVarint(avoidTollsPreferences, 2)).toBe(1);
    expect(firstVarint(avoidTolls, 7)).toBeNull();

    const avoidHighways = routeOptionsFor({ avoidHighways: true });
    const avoidHighwaysPreferences = parseMessage(firstMessage(avoidHighways, 2));
    expect(firstVarint(avoidHighwaysPreferences, 1)).toBe(1);
    expect(firstVarint(avoidHighwaysPreferences, 2)).toBeNull();
    expect(firstVarint(avoidHighways, 7)).toBeNull();

    const avoidFerries = routeOptionsFor({ avoidFerries: true });
    const avoidFerriesPreferences = parseMessage(firstMessage(avoidFerries, 2));
    expect(firstVarint(avoidFerriesPreferences, 1)).toBeNull();
    expect(firstVarint(avoidFerriesPreferences, 2)).toBeNull();
    expect(firstVarint(avoidFerries, 7)).toBe(1);
  });

  it('normalizes numeric coordinate text before building the mobile route payload', () => {
    const built = buildGoogleMapsMobileDirectionsRequest({
      from: { lat: 35.433918, lng: 136.78207129999998 },
      to: { lat: 35.388360399999996, lng: 136.9391766 },
      options: { includeDebug: true },
    });

    expect(built.body.includes(Buffer.from('35.433918,136.7820713'))).toBe(true);
    expect(built.body.includes(Buffer.from('35.3883604,136.9391766'))).toBe(true);
    expect(built.body.includes(Buffer.from('136.78207129999998'))).toBe(false);
    expect(built.body.includes(Buffer.from('35.388360399999996'))).toBe(false);
    expect(extractMobileRouteWaypoints(built.body)).toEqual([
      { text: '35.433918,136.7820713', lat: 35.433918, lng: 136.7820713 },
      { text: '35.3883604,136.9391766', lat: 35.3883604, lng: 136.9391766 },
    ]);
  });

  it('parses optimistic/pessimistic predictions and structured ETC toll fee', () => {
    const result = parseGoogleMapsMobileDirectionsResponse(sampleMobileMmapResponse(), { includeDebug: true });

    expect(result.routes[0]).toMatchObject({
      title: 'Tomei Expressway',
      distance: { meters: 348474 },
      duration: { seconds: 16800 },
      trafficPrediction: {
        optimistic: { seconds: 15000 },
        pessimistic: { seconds: 21000 },
        text: '4 hr 10 min to 5 hr 50 min',
      },
      tollFee: {
        amount: 8620,
        text: '\u00a58620',
        currency: 'JPY',
        label: 'ETC',
      },
      overviewGeometry: [
        { lat: 35.6778606, lng: 139.763749 },
        { lat: 35.3433356, lng: 139.1565648 },
        { lat: 35.1700303, lng: 136.897241 },
      ],
      steps: [
        {
          instruction: 'Turn right at 赤池２丁目北（交差点）',
          maneuver: 'TURN',
          distance: { meters: 1996, text: null },
        },
        {
          instruction: 'Use the left lane to take the Mei-Nikan Expy ramp',
          maneuver: 'ON_RAMP',
          distance: { meters: 91, text: null },
        },
      ],
    });
    expect(result.optimisticDuration?.seconds).toBe(15000);
    expect(result.pessimisticDuration?.seconds).toBe(21000);
    expect(result.tollFee?.amount).toBe(8620);
    expect(result.debug?.gzipOffset).toBe(2);
  });

  it('deduplicates header-only route repeats and preserves parsed ETC tolls', () => {
    const result = parseGoogleMapsMobileDirectionsResponse(
      sampleMobileMmapResponse({ duplicateHeaderWithoutToll: true }),
      { includeDebug: true },
    );

    expect(result.routes).toHaveLength(1);
    expect(result.routes[0]).toMatchObject({
      title: 'Tomei Expressway',
      tollFee: {
        amount: 8620,
        text: '\u00a58620',
        currency: 'JPY',
        label: 'ETC',
      },
    });
  });

  it('parses routes from a later gzip protobuf when the response starts with metadata', () => {
    const metadata = Buffer.concat([Buffer.from([0, 1]), gzipSync(messageField(99, [varintField(1, 1)]))]);
    const response = Buffer.concat([metadata, Buffer.from([0xaa, 0xbb]), sampleMobileMmapResponse()]);
    const result = parseGoogleMapsMobileDirectionsResponse(response, { includeDebug: true });

    expect(result.routes).toHaveLength(1);
    expect(result.routes[0]?.title).toBe('Tomei Expressway');
    expect(result.debug?.gzipOffset).toBeGreaterThan(metadata.length);
  });

  it('posts the generated binary request to the mobile mmap endpoint', async () => {
    const response = sampleMobileMmapResponse();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      arrayBuffer: async () => response.buffer.slice(response.byteOffset, response.byteOffset + response.byteLength),
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await fetchGoogleMapsMobileDirections({
      from: 'Tokyo Station',
      to: 'Fushimi Station Nagoya',
      departureTime: '2026-06-23T10:40',
      options: { includeDebug: true },
    });

    expect(result.from).toBe('Tokyo Station');
    expect(result.to).toBe('Fushimi Station Nagoya');
    expect(result.tollFee?.currency).toBe('JPY');
    expect(fetchMock).toHaveBeenCalledWith(
      'https://mobilemaps.googleapis.com/glm/mmap',
      expect.objectContaining({
        method: 'POST',
        body: expect.any(Buffer),
        headers: expect.objectContaining({ 'content-type': 'application/binary' }),
      }),
    );
  });

  it('reuses cached mmap responses for identical requests', async () => {
    const response = sampleMobileMmapResponse();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      arrayBuffer: async () => response.buffer.slice(response.byteOffset, response.byteOffset + response.byteLength),
    });
    vi.stubGlobal('fetch', fetchMock);

    const request = {
      from: 'Tokyo Station',
      to: 'Fushimi Station Nagoya',
      departureTime: '2026-06-23T10:40',
    };
    await fetchGoogleMapsMobileDirections(request);
    await fetchGoogleMapsMobileDirections(request);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
