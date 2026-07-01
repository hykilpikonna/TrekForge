import {
  firstProtoMessage,
  firstProtoVarint,
  parseProtoMessage,
  protoFieldStrings,
} from '../../../src/services/googleMapsMobile/protobuf';
import {
  ListUgcPostsRequest,
  MmapDirectionsChunk,
  MmapDirectionsRequest,
  MmapPlaceDetailsChunk,
  MmapPlaceDetailsRequest,
  MmapRichPlacePhotosRequest,
} from '../../../src/services/googleMapsMobile/reversedProto';

import { describe, expect, it } from 'vitest';

const ftid = '0x60188d6f41f03f85:0xe25bfe624782e3c9';
const reviewPageToken = 'CjEIARIpCgoAP7_LAY-D____EhBm4maQDMXTEVU3ducAAAAAGgn92SwCaP3HwMoYACIA:8';

describe('googleMapsMobile reversed proto SDK', () => {
  it('encodes the place-details mmap chunk with named proto classes', () => {
    const chunk = new MmapPlaceDetailsChunk({ ftid }).encode();

    expect(chunk.toString('hex')).toBe(
      '0a290a270a253078363031383864366634316630336638353a307865323562666536323437383265336339122410011801200128014001480150015801800101880101980101a80101b00101ba010208011a05220310fd262801',
    );

    const request = new MmapPlaceDetailsRequest(new MmapPlaceDetailsChunk({ ftid })).encode();
    expect(request).toHaveLength(718);
    expect(request.subarray(622, 628).toString('hex')).toBe('01c20000005a');
    expect(request.indexOf(Buffer.from(ftid))).toBeGreaterThan(0);
  });

  it('encodes the review-list request with recovered ListUgcPosts fields', () => {
    const request = ListUgcPostsRequest.reviewsPage(ftid, reviewPageToken).encode();

    expect(request.toString('hex')).toBe(
      '0a410a253078363031383864366634316630336638353a30786532356266653632343738326533633932140a020802220208012a0208032a0208042a0208053a020803124a08081246436a45494152497043676f4150375f4c41592d445f5f5f5f4568426d346d6151444d585445565533647563414141414147676e393253774361503348774d6f59414349413a382a0238594226080010011801280138015a1a080110012202080322020804220208052202080622020807280162020800',
    );

    const fields = parseProtoMessage(request);
    const filter = firstProtoMessage(fields, 1);
    const pagination = firstProtoMessage(fields, 2);
    const dataToFetch = firstProtoMessage(fields, 8);
    const summary = firstProtoMessage(fields, 12);

    expect(filter).toBeTruthy();
    expect(pagination).toBeTruthy();
    expect(dataToFetch).toBeTruthy();
    expect(summary).toBeTruthy();
    expect(protoFieldStrings(parseProtoMessage(filter!), 1)).toEqual([ftid]);
    expect(firstProtoVarint(parseProtoMessage(pagination!), 1)).toBe(8);
    expect(protoFieldStrings(parseProtoMessage(pagination!), 2)).toEqual([reviewPageToken]);
    expect(firstProtoVarint(parseProtoMessage(summary!), 1)).toBe(0);
  });

  it('wraps the captured rich-photos mmap template behind an ftid-aware request', () => {
    const request = new MmapRichPlacePhotosRequest(ftid).encode();

    expect(request.indexOf(Buffer.from(ftid))).toBeGreaterThan(0);
    expect(request.indexOf(Buffer.from('0x351545d4efdf5d53:0xd7b655e89ee76487'))).toBe(-1);
  });

  it('encodes the generated directions mmap chunk with recovered route fields', () => {
    const chunk = new MmapDirectionsChunk({
      from: { text: '35.1,136.9', lat: 35.1, lng: 136.9 },
      to: { text: 'Gifu Castle' },
      routeOptions: {
        avoidHighways: true,
        avoidTolls: true,
        avoidFerries: true,
        departureTime: { googleMapsEpochSeconds: 1782576000, timeKindEnum: 2 },
      },
    }).encode();

    const fields = parseProtoMessage(chunk);
    const route = firstProtoMessage(fields, 1);
    expect(route).toBeTruthy();
    expect(firstProtoVarint(fields, 7)).toBe(1);
    expect(firstProtoVarint(fields, 8)).toBe(1);

    const routeFields = parseProtoMessage(route!);
    const options = firstProtoMessage(routeFields, 6);
    const optionFields = parseProtoMessage(options!);
    const preferences = firstProtoMessage(optionFields, 2);
    const departureTime = firstProtoMessage(optionFields, 23);

    expect(firstProtoVarint(parseProtoMessage(preferences!), 1)).toBe(1);
    expect(firstProtoVarint(parseProtoMessage(preferences!), 2)).toBe(1);
    expect(firstProtoVarint(optionFields, 7)).toBe(1);
    expect(firstProtoVarint(parseProtoMessage(departureTime!), 2)).toBe(2);
    expect(firstProtoVarint(parseProtoMessage(departureTime!), 3)).toBe(1782576000);

    const request = new MmapDirectionsRequest(
      new MmapDirectionsChunk({
        from: { text: '35.1,136.9', lat: 35.1, lng: 136.9 },
        to: { text: 'Gifu Castle' },
        routeOptions: {
          avoidHighways: true,
          avoidTolls: true,
          avoidFerries: true,
          departureTime: { googleMapsEpochSeconds: 1782576000, timeKindEnum: 2 },
        },
      }),
    ).encode();
    expect(request.indexOf(chunk)).toBeGreaterThan(0);
    expect(request.subarray(0, 2).toString('hex')).toBe('0018');
  });
});
