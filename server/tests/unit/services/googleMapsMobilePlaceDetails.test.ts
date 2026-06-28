import { gzipSync } from 'node:zlib';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  buildGoogleMapsMobilePlaceDetailsRequest,
  fetchGoogleMapsMobilePlaceDetails,
  parseGoogleMapsMobileRichPlaceDetailsResponse,
  parseGoogleMapsMobilePlacePhotosResponse,
  parseGoogleMapsMobilePlaceDetailsResponse,
} from '../../../src/services/googleMapsMobilePlaceDetails';

const ftid = '0x60188d6f41f03f85:0xe25bfe624782e3c9';

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

function tag(field: number, wire: number): Buffer {
  return varint(field * 8 + wire);
}

function varintField(field: number, value: number): Buffer {
  return Buffer.concat([tag(field, 0), varint(value)]);
}

function bytesField(field: number, bytes: Buffer): Buffer {
  return Buffer.concat([tag(field, 2), varint(bytes.length), bytes]);
}

function stringField(field: number, value: string): Buffer {
  return bytesField(field, Buffer.from(value, 'utf8'));
}

function messageField(field: number, parts: Buffer[]): Buffer {
  const payload = Buffer.concat(parts);
  return bytesField(field, payload);
}

function fixed64Field(field: number, value: number): Buffer {
  const buffer = Buffer.alloc(8);
  buffer.writeDoubleLE(value, 0);
  return Buffer.concat([tag(field, 1), buffer]);
}

function fixed32Field(field: number, value: number): Buffer {
  const buffer = Buffer.alloc(4);
  buffer.writeFloatLE(value, 0);
  return Buffer.concat([tag(field, 5), buffer]);
}

function timePoint(hour: number, minute = 0): Buffer {
  return messageField(1, [
    varintField(1, hour),
    ...(minute ? [varintField(2, minute)] : []),
  ]);
}

function timeRange(openHour: number, openMinute: number, closeHour: number, closeMinute: number): Buffer {
  return messageField(2, [
    timePoint(openHour, openMinute),
    bytesField(2, Buffer.concat([
      varintField(1, closeHour),
      ...(closeMinute ? [varintField(2, closeMinute)] : []),
    ])),
  ]);
}

function dateMessage(year: number, month: number, day: number): Buffer {
  return messageField(3, [varintField(1, year), varintField(2, month), varintField(3, day)]);
}

function hoursRange(label: string, openHour: number, openMinute: number, closeHour: number, closeMinute: number): Buffer {
  return messageField(4, [
    stringField(1, label),
    timeRange(openHour, openMinute, closeHour, closeMinute),
  ]);
}

function dayRow(
  label: string,
  googleDay: number,
  date: [number, number, number],
  openHour: number,
  openMinute: number,
  closeHour: number,
  closeMinute: number,
): Buffer {
  return messageField(1, [
    stringField(1, label),
    varintField(2, googleDay),
    dateMessage(...date),
    hoursRange(
      openMinute ? `${openHour}:${String(openMinute).padStart(2, '0')} AM-${closeHour} PM` : `${openHour} AM-${closeHour} PM`,
      openHour,
      openMinute,
      closeHour + 12,
      closeMinute,
    ),
    varintField(5, 0),
    varintField(6, 1),
  ]);
}

function sampleMobilePlaceResponse(): Buffer {
  const phone = messageField(17, [
    stringField(1, '+81 3-3989-3466'),
    stringField(4, '+81339893466'),
  ]);
  const hours = messageField(19, [
    dayRow('Friday', 5, [2026, 6, 26], 10, 0, 7, 0),
    dayRow('Saturday', 6, [2026, 6, 27], 9, 30, 8, 0),
    dayRow('Sunday', 7, [2026, 6, 28], 9, 30, 8, 0),
    dayRow('Monday', 1, [2026, 6, 29], 10, 0, 7, 0),
    dayRow('Tuesday', 2, [2026, 6, 30], 10, 0, 7, 0),
    dayRow('Wednesday', 3, [2026, 7, 1], 10, 0, 7, 0),
    dayRow('Thursday', 4, [2026, 7, 2], 10, 0, 7, 0),
    messageField(2, [
      messageField(5, [stringField(1, 'Closed \\u00b7 Opens 10:00')]),
    ]),
  ]);
  const place = messageField(1, [
    stringField(3, ftid),
    messageField(4, [fixed64Field(3, 35.7289254), fixed64Field(4, 139.7201573)]),
    stringField(5, 'Sunshine Aquarium'),
    stringField(6, '3 Chome-1-1 Higashiikebukuro, Toshima City, Tokyo'),
    fixed32Field(8, 4.2),
    varintField(9, 10779),
    phone,
    hours,
    stringField(21, 'Asia/Tokyo'),
  ]);
  return Buffer.concat([Buffer.from([0, 24]), gzipSync(Buffer.concat([place, varintField(3, 2)]))]);
}

function sampleMobilePlacePhotosResponse(): Buffer {
  const body = Buffer.from([
    'https://gz0.googleusercontent.com/gps-cs-s/PHOTO_ONE=w203-h100-k-no-pi0-ya5.1-ro-0-fo100:6',
    'https://gz0.googleusercontent.com/gps-cs-s/PHOTO_ONE=w393-h524-k-no',
    'https://gz0.googleusercontent.com/a-/AVATAR=s100-p-k-no-mo',
    'https://gz0.googleusercontent.com/gpms-cs-s/PHOTO_TWO=w203-h114-k-no2',
    'https://gz0.googleusercontent.com/gpms-cs-s/VIDEO=mm,hls?ibw=750000',
  ].join('\0'), 'utf8');
  return Buffer.concat([Buffer.from([0, 24]), gzipSync(body)]);
}

function sampleMultiMemberMobileResponse(): Buffer {
  const metadata = gzipSync(Buffer.from('metadata-only', 'utf8'));
  const richPayload = sampleMobileRichPlaceResponse().subarray(2);
  return Buffer.concat([Buffer.from([0, 24]), metadata, Buffer.from([0]), richPayload]);
}

function popularHour(hour: number, percent: number, label = 'Usually not too busy'): Buffer {
  return messageField(2, [
    varintField(1, hour),
    varintField(2, percent),
    stringField(3, label),
    stringField(5, `${hour}:00`),
  ]);
}

function popularDay(day: number, hours: Buffer[]): Buffer {
  return messageField(1, [
    varintField(1, day),
    ...hours,
  ]);
}

function reviewAuthor(name: string): Buffer {
  return messageField(1, [
    stringField(1, 'https://www.google.com/maps/contrib/123?hl=en-US'),
    stringField(2, name),
    stringField(3, 'https://gz0.googleusercontent.com/a-/avatar=s120-c-rp-mo-ba12-br100'),
  ]);
}

function review(text: string, rating: number, author: string): Buffer {
  return messageField(1, [
    reviewAuthor(author),
    stringField(2, '2 weeks ago'),
    stringField(4, text),
    varintField(5, rating),
    stringField(19, 'https://www.google.com/maps/reviews/data=!4m8!example'),
    varintField(58, Date.UTC(2026, 5, 27)),
    stringField(33, 'en'),
  ]);
}

function sampleMobileRichPlaceResponse(): Buffer {
  const richPlace = messageField(1, [
    stringField(2, ftid),
    stringField(3, 'Inuyama Castle'),
    messageField(57, [
      popularDay(1, [popularHour(9, 30), popularHour(10, 65, 'Usually a little busy')]),
      popularDay(7, [popularHour(11, 80, 'Usually as busy as it gets')]),
      stringField(2, 'Now: Usually not too busy'),
    ]),
    messageField(81, [
      review('Great view over the river.', 5, 'Mika'),
    ]),
    stringField(97, 'https://gz0.googleusercontent.com/gps-cs-s/PHOTO_ONE=w203-h100-k-no-pi0-ya5.1-ro-0-fo100:6'),
  ]);
  return Buffer.concat([Buffer.from([0, 24]), gzipSync(richPlace)]);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('googleMapsMobilePlaceDetails helper', () => {
  it('builds a mobile mmap place-details request without session headers', () => {
    const built = buildGoogleMapsMobilePlaceDetailsRequest({ ftid, language: 'en-US,en;q=0.9' });

    expect(built.endpoint).toBe('https://mobilemaps.googleapis.com/glm/mmap');
    expect(built.body).toHaveLength(718);
    expect(built.body.indexOf(Buffer.from(ftid))).toBeGreaterThan(0);
    expect(built.body.indexOf(Buffer.from([0x01, 0xc2]))).toBeGreaterThan(0);
    expect(built.body.subarray(622, 631).toString('hex')).toBe('01c20000005a0a290a');
    expect(built.headers.cookie).toBeUndefined();
    expect(built.headers.authorization).toBeUndefined();
    expect(built.headers['x-geo']).toBeUndefined();
  });

  it('parses weekly mobile hours into opening periods', () => {
    const result = parseGoogleMapsMobilePlaceDetailsResponse(sampleMobilePlaceResponse(), { ftid });

    expect(result.name).toBe('Sunshine Aquarium');
    expect(result.google_ftid).toBe(ftid);
    expect(result.rating).toBeCloseTo(4.2);
    expect(result.rating_count).toBe(10779);
    expect(result.phone).toBe('+81 3-3989-3466');
    expect(result.open_now).toBe(false);
    expect(result.opening_hours).toHaveLength(7);
    expect(result.opening_periods).toContainEqual({
      open: { day: 5, hour: 10, minute: 0 },
      close: { day: 5, hour: 19, minute: 0 },
    });
    expect(result.opening_periods).toContainEqual({
      open: { day: 0, hour: 9, minute: 30 },
      close: { day: 0, hour: 20, minute: 0 },
    });
  });

  it('extracts and normalizes place photos from rich mobile responses', () => {
    const photos = parseGoogleMapsMobilePlacePhotosResponse(sampleMobilePlacePhotosResponse());

    expect(photos).toEqual([
      {
        url: 'https://gz0.googleusercontent.com/gps-cs-s/PHOTO_ONE=w640-h426-k-no',
        width: 640,
        height: 426,
        attribution: null,
        source: 'google_maps_mobile',
      },
      {
        url: 'https://gz0.googleusercontent.com/gpms-cs-s/PHOTO_TWO=w640-h426-k-no',
        width: 640,
        height: 426,
        attribution: null,
        source: 'google_maps_mobile',
      },
    ]);
  });

  it('extracts popular times, reviews, and photos from rich mobile responses', () => {
    const details = parseGoogleMapsMobileRichPlaceDetailsResponse(sampleMobileRichPlaceResponse());

    expect(details.popular_times).toEqual([
      { day: 1, hour: 9, occupancy_percent: 30 },
      { day: 1, hour: 10, occupancy_percent: 65 },
      { day: 0, hour: 11, occupancy_percent: 80 },
    ]);
    expect(details.popular_status).toBe('Now: Usually not too busy');
    expect(details.reviews).toEqual([{
      author: 'Mika',
      rating: 5,
      text: 'Great view over the river.',
      time: '2 weeks ago',
      published_at: '2026-06-27T00:00:00.000Z',
      photo: 'https://gz0.googleusercontent.com/a-/avatar=s120-c-rp-mo-ba12-br100',
      uri: 'https://www.google.com/maps/reviews/data=!4m8!example',
      language: 'en',
    }]);
    expect(details.photos[0]).toEqual({
      url: 'https://gz0.googleusercontent.com/gps-cs-s/PHOTO_ONE=w640-h426-k-no',
      width: 640,
      height: 426,
      attribution: null,
      source: 'google_maps_mobile',
    });
  });

  it('parses the rich payload when mmap responses contain multiple gzip members', () => {
    const details = parseGoogleMapsMobileRichPlaceDetailsResponse(sampleMultiMemberMobileResponse());

    expect(details.photos).toHaveLength(1);
    expect(details.popular_times).toHaveLength(3);
    expect(details.reviews).toHaveLength(1);
  });

  it('posts the generated request and parses the binary response', async () => {
    const response = sampleMobilePlaceResponse();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      arrayBuffer: async () => response.buffer.slice(response.byteOffset, response.byteOffset + response.byteLength),
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await fetchGoogleMapsMobilePlaceDetails({ ftid, language: 'en-US,en;q=0.9' });

    expect(result.opening_periods).toHaveLength(7);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://mobilemaps.googleapis.com/glm/mmap',
      expect.objectContaining({
        method: 'POST',
        body: expect.any(Buffer),
        headers: expect.objectContaining({
          'content-type': 'application/binary',
          'user-agent': expect.stringContaining('com.google.Maps/25.47.0'),
        }),
      }),
    );
    const init = fetchMock.mock.calls[0][1] as { headers: Record<string, string> };
    expect(init.headers.cookie).toBeUndefined();
    expect(init.headers.authorization).toBeUndefined();
    expect(init.headers['x-geo']).toBeUndefined();
  });
});
