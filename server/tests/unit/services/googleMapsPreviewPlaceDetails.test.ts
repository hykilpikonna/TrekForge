import { describe, expect, it } from 'vitest';

import {
  buildGoogleMapsPreviewPlaceDetailsUrls,
  parseGoogleMapsPreviewPlaceDetailsResponse,
} from '../../../src/services/googleMapsPreviewPlaceDetails';

const ftid = '0x60188d6f41f03f85:0xe25bfe624782e3c9';
const placeId = 'ChIJhT_wQW-NGGARyeOCR2L-W-I';

function baseTuple(): any[] {
  const tuple: any[] = [];
  tuple[4] = [null, null, null, ['https://reviews.example', '10,779 reviews'], null, null, null, 4.2, 10779];
  tuple[7] = ['https://sunshinecity.jp/aquarium/', 'sunshinecity.jp'];
  tuple[9] = [null, null, 35.7289, 139.7191];
  tuple[10] = ftid;
  tuple[11] = 'Sunshine Aquarium';
  tuple[18] = '3 Chome-1 Higashiikebukuro, Toshima City, Tokyo';
  tuple[78] = placeId;
  tuple[88] = ['High-rise aquarium with unique pools'];
  tuple[178] = [['+81 3-3989-3466']];
  return tuple;
}

function responseForTuple(tuple: unknown[]): string {
  const data: any[] = [];
  data[6] = tuple;
  return `)]}'\n${JSON.stringify(data)}`;
}

function weeklyRows(): unknown[] {
  return [
    ['Friday', 5, [2026, 6, 26], [['10 AM-7 PM', [[10], [19]]]], 0, 1],
    ['Saturday', 6, [2026, 6, 27], [['9:30 AM-8 PM', [[9, 30], [20]]]], 0, 1],
    ['Sunday', 7, [2026, 6, 28], [['9:30 AM-8 PM', [[9, 30], [20]]]], 0, 1],
    ['Monday', 1, [2026, 6, 29], [['10 AM-7 PM', [[10], [19]]]], 0, 1],
    ['Tuesday', 2, [2026, 6, 30], [['10 AM-7 PM', [[10], [19]]]], 0, 1],
    ['Wednesday', 3, [2026, 7, 1], [['10 AM-7 PM', [[10], [19]]]], 0, 1],
    ['Thursday', 4, [2026, 7, 2], [['10 AM-7 PM', [[10], [19]]]], 0, 1],
  ];
}

function dayRange(startDay: number, endDay: number): unknown[] {
  const value: any[] = [];
  value[5] = [null, null, null, startDay, 0];
  value[6] = [null, null, null, endDay, 0];
  return value;
}

function timeRange(startHour: number, startMinute: number, endHour: number, endMinute: number): unknown[] {
  const value: any[] = [];
  value[5] = [null, startMinute, startHour];
  value[6] = [null, endMinute, endHour];
  return value;
}

describe('googleMapsPreviewPlaceDetails parser', () => {
  it('parses full p203 weekly rows into Google-style opening periods', () => {
    const tuple = baseTuple();
    tuple[203] = [weeklyRows()];

    const result = parseGoogleMapsPreviewPlaceDetailsResponse(responseForTuple(tuple), { ftid });

    expect(result.name).toBe('Sunshine Aquarium');
    expect(result.google_place_id).toBe(placeId);
    expect(result.google_ftid).toBe(ftid);
    expect(result.opening_periods).toContainEqual({
      open: { day: 5, hour: 10, minute: 0 },
      close: { day: 5, hour: 19, minute: 0 },
    });
    expect(result.opening_periods).toContainEqual({
      open: { day: 0, hour: 9, minute: 30 },
      close: { day: 0, hour: 20, minute: 0 },
    });
    expect(result.opening_hours).toHaveLength(7);
  });

  it('parses localized type, country, and accessibility metadata', () => {
    const tuple = baseTuple();
    tuple[13] = ['Aquarium', 'Tourist attraction'];
    tuple[88] = [null, 'SearchResult.TYPE_AQUARIUM', ['SearchResult.TYPE_AQUARIUM', 'JP']];
    tuple[100] = [null, [[
      'accessibility',
      'Accessibility',
      [
        [
          '/geo/type/establishment_poi/has_wheelchair_accessible_entrance',
          'Wheelchair-accessible entrance',
          [1, [[1, 'Wheelchair-accessible entrance']]],
        ],
        [
          '/geo/type/establishment_poi/has_wheelchair_accessible_parking',
          'Wheelchair-accessible car park',
          [1, [[0, 'No wheelchair-accessible car park']]],
        ],
      ],
    ]]];

    const result = parseGoogleMapsPreviewPlaceDetailsResponse(responseForTuple(tuple), { ftid, language: 'en' });

    expect(result.type).toBe('Aquarium');
    expect(result.types).toEqual(['Aquarium', 'Tourist attraction']);
    expect(result.primary_type).toBe('SearchResult.TYPE_AQUARIUM');
    expect(result.country_code).toBe('JP');
    expect(result.accessible).toBe(true);
    expect(result.accessibility).toContainEqual({
      key: 'wheelchair_accessible_entrance',
      label: 'Wheelchair-accessible entrance',
      value: true,
      text: 'Wheelchair-accessible entrance',
    });
    expect(result.name_translated).toBe('Sunshine Aquarium');
    expect(result.written_address).toBe('3 Chome-1 Higashiikebukuro, Toshima City, Tokyo');
  });

  it('parses hourly popular-times rows when Google includes them', () => {
    const tuple = baseTuple();
    tuple[84] = [[
      ['Monday', 1, [[9, 15], [10, 56], [11, 91]]],
      ['Sunday', 7, [[12, 33]]],
    ]];

    const result = parseGoogleMapsPreviewPlaceDetailsResponse(responseForTuple(tuple), { ftid });

    expect(result.popular_times).toEqual([
      { day: 1, hour: 9, occupancy_percent: 15 },
      { day: 1, hour: 10, occupancy_percent: 56 },
      { day: 1, hour: 11, occupancy_percent: 91 },
      { day: 0, hour: 12, occupancy_percent: 33 },
    ]);
  });

  it('parses Google editorial summary text from the preview tuple', () => {
    const tuple = baseTuple();
    tuple[32] = [
      [null, 'Elegant 16th-century riverside castle', null, null, null, 1],
      [null, 'Imposing Sengoku-period castle built on a defensible hilltop overlooking the Kiso River.', null, null, null, 1],
    ];

    const result = parseGoogleMapsPreviewPlaceDetailsResponse(responseForTuple(tuple), { ftid });

    expect(result.summary).toBe('Imposing Sengoku-period castle built on a defensible hilltop overlooking the Kiso River.');
  });

  it('does not treat reduced one-day p203 rows as a full weekly schedule', () => {
    const tuple = baseTuple();
    tuple[203] = [[weeklyRows()[0]]];

    const result = parseGoogleMapsPreviewPlaceDetailsResponse(responseForTuple(tuple), { ftid });

    expect(result.opening_periods).toBeNull();
    expect(result.opening_hours).toBeNull();
  });

  it('falls back to legacy p24 weekly hours when available', () => {
    const tuple = baseTuple();
    tuple[24] = [[
      [[dayRange(0, 1), timeRange(9, 30, 20, 0)]],
      [[dayRange(1, 6), timeRange(10, 0, 19, 0)]],
      [[dayRange(6, 7), timeRange(9, 30, 20, 0)]],
    ]];

    const result = parseGoogleMapsPreviewPlaceDetailsResponse(responseForTuple(tuple), { ftid });

    expect(result.opening_periods).toHaveLength(7);
    expect(result.opening_periods).toContainEqual({
      open: { day: 1, hour: 10, minute: 0 },
      close: { day: 1, hour: 19, minute: 0 },
    });
    expect(result.opening_periods).toContainEqual({
      open: { day: 6, hour: 9, minute: 30 },
      close: { day: 6, hour: 20, minute: 0 },
    });
  });

  it('parses wrapped map-search responses and maps CLOSED to permanently closed', () => {
    const tuple = baseTuple();
    tuple[10] = '0x60188d09067bf06f:0x7c5a897208e083d3';
    tuple[11] = 'Mixalive TOKYO';
    tuple[78] = 'ChIJb_B7BgmNGGAR04PgCHKJWnw';
    tuple[88] = ['CLOSED', 'SearchResult.TYPE_EVENT_VENUE'];
    const searchItem: any[] = [];
    searchItem[14] = tuple;
    const wrapped = JSON.stringify({ c: 0, d: `)]}'\n${JSON.stringify([['mixalive', [searchItem]]])}` }) + '/*""*/';

    const result = parseGoogleMapsPreviewPlaceDetailsResponse(wrapped, { query: 'mixalive' });

    expect(result.name).toBe('Mixalive TOKYO');
    expect(result.business_status).toBe('CLOSED_PERMANENTLY');
  });

  it('maps temporary closure status text to business status', () => {
    const tuple = baseTuple();
    const statusRow: any[] = [];
    statusRow[8] = ['Temporarily closed'];
    tuple[88] = [];
    tuple[203] = [weeklyRows(), statusRow];

    const result = parseGoogleMapsPreviewPlaceDetailsResponse(responseForTuple(tuple), { ftid });

    expect(result.open_now).toBe(false);
    expect(result.business_status).toBe('CLOSED_TEMPORARILY');
  });

  it('maps local-language renovation closure notices before provider status', () => {
    const tuple = baseTuple();
    tuple[88] = ['OPERATIONAL', 'SearchResult.TYPE_CASTLE'];
    tuple[154] = [[['改修工事のため2027年10月31日まで休館しています。']]];

    const result = parseGoogleMapsPreviewPlaceDetailsResponse(responseForTuple(tuple), { ftid });

    expect(result.open_now).toBe(false);
    expect(result.business_status).toBe('CLOSED_TEMPORARILY');
  });

  it('builds direct preview and search fallback URLs', () => {
    const urls = buildGoogleMapsPreviewPlaceDetailsUrls({ ftid, query: 'Sunshine Aquarium', language: 'ja', region: 'jp' });

    expect(urls[0]).toContain('google.com/maps/preview/place');
    expect(urls[0]).toContain('hl=ja');
    expect(urls[0]).toContain(encodeURIComponent(ftid));
    expect(urls[1]).toContain('google.com/search');
    expect(urls[1]).toContain('q=Sunshine+Aquarium');
  });
});
