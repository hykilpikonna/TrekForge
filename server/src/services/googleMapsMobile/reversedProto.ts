import {
  encodeBytesField,
  encodeFixed64DoubleField,
  encodeMessageField,
  encodeStringField,
  encodeVarintField,
  firstProtoMessage,
  parseProtoMessage,
  replaceOrInsertProtoFields,
} from './protobuf';

export const GOOGLE_MAPS_MOBILE_PLACE_DETAILS_CHUNK_TYPE = 450;
export const GOOGLE_MAPS_MOBILE_DIRECTIONS_CHUNK_TYPE = 142;
export const GOOGLE_MAPS_MOBILE_RICH_PLACE_MEDIA_CHUNK_TYPE = 151;
export const GOOGLE_MAPS_MOBILE_MMAP_ENDPOINT = 'https://mobilemaps.googleapis.com/glm/mmap';
export const GOOGLE_MAPS_MOBILE_UGC_POSTS_ENDPOINT =
  'https://mobilemaps-pa-gz.googleapis.com/$rpc/google.internal.mothership.maps.mobilemaps.ugcpost.v1.MobileMapsUgcPostService/ListUgcPosts?frontend=boq';
export const GOOGLE_MAPS_MOBILE_API_KEY = 'AIzaSyCkzRZrDx_ICh-dev88AVfxafYxBm6Q0XA';
export const GOOGLE_MAPS_MOBILE_CLIENT_DATA_BIN =
  'GuMBrLIM6beoEsnSzyKX4PUstIX2LMqV9iyXg/csop33LNee9yzwkvgs16X4LNup+CyjtfgsrvD4LOGR+Sy0lvksp5r5LKma+Sy6pfks/6r5LJKx+SyKs/ks/7z5LMe++SzLv/ksrMb5LNbN+SzW2fksn/j5LIb/+Sy3m/osw776LKj4+izHh/ssgZD7LIK6+yyR36Mv7b6nL7j0hTCD54cw+vCHMMWliDDl+IgwvYWJMISGiTDin4kw8qeJMKnTiTCp04kwiumJMOjA4zHPteUxpZCxMrzavzLx+sYy9frGMvn6xjKjvcoy8AMCiAQAkgQSMjUuNDcuMC44MzU0MjkzMDAwoAT0A6oEAMAEAsgEDw==';
export const GOOGLE_MAPS_MOBILE_GMM_CLIENT_BIN =
  'CgJKUBIPY29tLmdvb2dsZS5NYXBzGhIyNS40Ny4wLjgzMzU0MjkzMDAiDmlvczppUGhvbmUxNiwxKgYxOC43LjIyDGlPUy1BcHBTdG9yZTgAWAKCAQIQA9IB0AE1MzI9dXJ3dFhqYThWVl91NXdDc0RyQXNRdnlKOVliUEZ0RURlZHp0RkhWY2V3UFh1Y2FuSzFBY2dvSzB4SlR5MW1UYmFWTFFROHViX3R3YW45NmpzRFprNno2VzNrYkFCdlVZeDBjM1hxMWdwRFAwbDJmT2tuZFZzRnc2YThzWVAtNWc4S3ZnenA4QkpfakFnTnZQY2JwbjNVSTVpOGw1aWZMelFvMmZFSFhadE83UTZZRnVLRWxETWVJd2xHczMtTG83SE5yaUpVTFVJTVdr6gEEMTE5MYICAkpQkAICoAIAqgISMjUuNDcuMC44MzU0MjkzMDAwuAL0A8ACAQ==';

const PLACE_DETAILS_FIELD_MASK = Buffer.from(
  '10011801200128014001480150015801800101880101980101a80101b00101ba01020801',
  'hex',
);

const MMAP_PLACE_DETAILS_CLIENT_ENVELOPE_BASE64 =
  'ABhGn1Se+1h53QAFZW4tVVMADmlvczppUGhvbmUxNiwxABIyNS40Ny4wLjgzMzU0MjkzMDAADGlPUy1BcHBTdG9yZQA+AAACJQoEMTE5MSABKg9jb20uZ29vZ2xlLk1hcHMyAkpQOAFC0AE1MzI9dVBaYU1zNS1QZVg3TDB2QmJYSkpiRThydVgzSHk1ckd3STdDZ0UzZ0tNTFlrcDJKTFBMQnlLcW50aXNZaEI3V1k4VmR4aTFUVVZOM1BWYUYyS05DNWM1dUdMUlR5YjcwdDg3TlgwUzJmc29HVTdBSGZhWWMtVVlIQmZpVnlRNnd5akRrbDhRQWNYUmNuZVYyX2NJUHBmbzJaY3V2MkpTajRndUp4ZHJxSmVxRzNkcDEzM0FRRmF6TUVuVmlIS2lFSjZILVhBdm5OYWVoqAEAsAEEwAEByAEB2gEGMTguNy4ygAIBiAIBmgMCEAPaA+cBrLIM6beoEsnSzyKX4PUstIX2LMqV9iyXg/csop33LNee9yzwkvgs16X4LNup+CyjtfgsrvD4LOGR+Sy0lvksp5r5LKma+Sy6pfks/6r5LJKx+SyKs/ks/7z5LMe++SzLv/ksrMb5LNbN+SzW2fksn/j5LIb/+Sy3m/osw776LKj4+izHh/ssgZD7LIK6+yyR36Mv7b6nL7j0hTD24Ycwg+eHMPrwhzDFpYgw5fiIML2FiTCEhokw4p+JMPKniTCp04kwiumJMOjA4zHPteUxpZCxMrzavzLx+sYy9frGMvn6xjKjvcoy8AMCiAQAkgQSMjUuNDcuMC44MzM1NDI5MzAwoAT0A6oEAMAEAsgEDw==';

const MMAP_DIRECTIONS_CLIENT_ENVELOPE_BASE64 =
  'ABhGn1Se+1h53QAFZW4tVVMADmlvczppUGhvbmUxNiwxABIyNS40Ny4wLjgzMzU0MjkzMDAADGlPUy1BcHBTdG9yZQA+AAAGEQoEMTE5MSABKg9jb20uZ29vZ2xlLk1hcHMyAkpQOAFC0AE1MzI9T3BjNldVbVNXMVhReXJTVmpuS1pHUF96Q0l2YldTbFpYY3pJcmFIeWhIMmo1czRjR1hqdWZxZE9qZ1B2NEpmalpjYXFPMmlaemFfc3Jab3FtWEdSQ2czSm8wc0NoQUFTTk5aMzBOeVpELVdETGUwUjFab1VOeENCQ0pQblJpcTc4Tlk0OVRhdUNCaHd4dTBMbU1KQ2pvcm43ZkducEJMa2FVSXZUbWptQ2hZa0MtWVBCdUFGV0gtSjc2OHhPZmN1Sk1FU3gwNmo2VDI5qAEAsAEEwAEByAEB2gEGMTguNy4ygAIBiAIBmgMCEAPaA+wB6beoEsnSzyKX4PUstIX2LMqV9iyXg/csop33LNee9yzwkvgs16X4LNup+CyjtfgsrvD4LOGR+Sy0lvksp5r5LKma+Sy6pfks/6r5LJKx+SyKs/ks/7z5LMe++SzLv/ksrMb5LNbN+SzW2fksn/j5LIb/+Sy3m/osw776LKj4+izHh/ssgZD7LIK6+yzUyPsskd+jL+2+py+49IUw9uGHMIPnhzD68IcwxaWIMNLoiDDT6Igw5fiIML6FiTCChokw4p+JMISoiTCx04kw6MDjMc+15TGlkLEyvNq/MvH6xjL1+sYy+frGMqO9yjLwAwKCBKgHQ0FNU3R3VU54QVBrekVnRjlZY0RzWlBsRXR0TnBLVUdpU253Qlp3MDBoTFBDZ1RnQVFUWEJZd0NCTTRHQktrTUJNSUY2d2pZRHdURUR3Nm5BQVRwQm93Q0JQOEZCSVlQQkpvQ0JJTUlCSk12Qk1NWEJMY0Z3Z1FFNU15OEVRU2tEZ2I2QkFhb0JRU0VFd1NNQ3dUY0RBU3dCQVNwQUFTRUJxVVVCR2tFeHhDMkhGVUVwQUlFX2dZRTB3a0VzQThFdHcwRW9RWUVxaFFFeVFVRXloY0VFQVNpQlFTT0N3U3NEQVNoQmdTLUJnVFlBUVNhQlFTTUR3VExDN3NDQk9VREJETUVyd1lFQ0FUNUJBVGtEZ1RqQk1FTUF2QUdCTGNHQktRRzN3VUV2Z09PRHdiRkFRZmpBQVRtQXdhRUFBU29Ed1JEQk5zTkJJVUVCTEVFcUFBRWtBYTRBd1RHQ0FUMERBUWpCTDhHQkpBQkJMMEFCTDhHQkk4QkE4QUFCSzRCQkJFRTF3UUVfQjhGM2dVRThnQUVtUWEwQlFST19BTUdzQVlFQWdXX0FBYkZBQVdqQlZjRXJ3TUZKZ1VfQkxnRC1nTUZ2d1VFTFFXZUJRWFVCQVh0QkFYWkF3WHZBd1NEQlFDdUFMMERCU0VGMWdrRnR3RUFBSHNGakFNRkF3VURCUU1GQXdVREJRTUY2QVlGM1FGeEJZVUNCZE1HQllJRkFBQUE1Z1d5QmdiTURBU0pBZ09HQUFTMkJnWEVCQVV0QmFnRkJNRUZCYVVHQmFzRUJiTUVCYk1OQlh4d0JWQUZ6d0VHNVFZRkFBWE5Bd1dMRFFVREJmTUZCZjROQlZFRmxnWUZnZ1lGbkFVRkt3V3NEUVVEQmFBR0JmZ0xaZ1dSQmdkZUJhdVhpd1FGdEFNRjlRVjZCdWdHVHdYUkJRVzBBZ1hCREFVREJiZ0ZCWjBXMGdhZEJmb0NZQVhWRGFzT0JyOENCWWdCQlFYSENRVUxCY2dCcndMQkNMOFFxZ3lHRVFYTkZRT0tBUWFPRVFVVmFPNndyeFhZbmFBWHlvcWhEWnNpa2hmTGFvMGRzd2FmYy1FVmhBUEFESTA4dFNiQ0R3YVhETU1DbFFId0J2TU93QWJqQUs0QS1BelBHZUVCdHh1TUpPTS0zeENITFltaXJ3WGMyQVROc2xtNjZnYUxBdkVPelRPYmZZS20zUWJoOHdiUzNVeVJ6UW16cHdBRUJLN0ZCQT09iAQAkgQSMjUuNDcuMC44MzM1NDI5MzAwoAT0A6oEAMAEAsgED9IEOEFkSlZFYXRmSzhkbFQ0ZnY3alY2TkJ1MU80ejhmTUlTRmMtcS10YTdIcE9lYmI1bFBqenZpT0xI';

const BASE_DIRECTIONS_ROUTE_OPTIONS_MESSAGE_BASE64 =
  'CkFABkgBcgIIAnICCAGIAQGQAQCiARoKCggBEAEYASABKAESCggBEAEYASABKAEwAcABAcABAtABAeABAfgBAYACARI7KgQwAlACQACgAQPQAQHaAQwQARgBIAEoAjABOAHoAQH6AQQIARABkgICCADqAgIIAeoCAggC6gICCAMgAUABgAEBigGKAQgGEAQYASABKAEwADgBQABQAVgBanQKFAoSCAASBggCEAYYARIGCAMQBhgBCiQKIggDEgYIAhABGAASBggLEAEYABIGCAgQARgAEgYIBBABGAAKBAoCCAIKDAoKCAESBggLEAYYAAoECgIICAoECgIIBBAAGAAiEgoOCAAdAACAPyUAAIA/KAQQAagBAbABAMIBCggACAMIBBgBGADQAQHYAQHwAQHiAgQSAhAB6gIGCgQIARABugMICgQIARABEAHCAwIQAZAEAJgEAbgEAcAEAcgEAdAEAeAEAfIEBAgCGAGABQGIBQGaBQIIAaAFAaoFAggAugUGCAEQARgBwgUCEAHQBQE=';

const RICH_PLACE_PHOTOS_TEMPLATE_FTID = '0x351545d4efdf5d53:0xd7b655e89ee76487';
const RICH_PLACE_PHOTOS_REQUEST_BASE64 = [
  'ABhGn1Se+1h53QAFZW4tVVMADmlvczppUGhvbmUxNiwxABIyNS40Ny4wLjgzMzU0MjkzMDAADGlPUy1BcHBTdG9yZQA+AAAC',
  'XAoEMTE5MSABKg9jb20uZ29vZ2xlLk1hcHMyAkpQOAFC0AE1MzI9dXJ3dFhqYThWVl91NXdDc0RyQXNRdnlKOVliUEZ0RURl',
  'ZHp0RkhWY2V3UFh1Y2FuSzFBY2dvSzB4SlR5MW1UYmFWTFFROHViX3R3YW45NmpzRFprNno2VzNrYkFCdlVZeDBjM1hxMWdw',
  'RFAwbDJmT2tuZFZzRnc2YThzWVAtNWc4S3ZnenA4QkpfakFnTnZQY2JwbjNVSTVpOGw1aWZMelFvMmZFSFhadE83UTZZRnVL',
  'RWxETWVJd2xHczMtTG83SE5yaUpVTFVJTVdrqAEAsAEEwAEByAEB2gEGMTguNy4ygAIBiAIBmgMCEAPaA+MBrLIM6beoEsnS',
  'zyKX4PUstIX2LMqV9iyXg/csop33LNee9yzwkvgs16X4LNup+CyjtfgsrvD4LOGR+Sy0lvksp5r5LKma+Sy6pfks/6r5LJKx',
  '+SyKs/ks/7z5LMe++SzLv/ksrMb5LNbN+SzW2fksn/j5LIb/+Sy3m/osw776LKj4+izHh/ssgZD7LIK6+yyR36Mv7b6nL7j0',
  'hTCD54cw+vCHMMWliDDl+IgwvYWJMISGiTDin4kw8qeJMKnTiTCK6Ykw6MDjMc+15TGlkLEyvNq/MvH6xjL1+sYy+frGMqO9',
  'yjLwAwKIBACSBBIyNS40Ny4wLjgzMzU0MjkzMDCgBPQDqgQAwAQCyAQP0gQ4QWRKVkVhdmZFVlgyTWxwN2dJS1VHUjZ3OE1l',
  'TmFEbko0cjcxcXRVdFA0YmhEbHRsRE1EZWw2OS0AlwAAB/UKJTB4MzUxNTQ1ZDRlZmRmNWQ1MzoweGQ3YjY1NWU4OWVlNzY0',
  'ODcSN0hhc2hpbWEgQ29hbCBNaW5lIFJ1aW5zCuerr+WztueCremJsei3oQpSZWNlbnRseSB2aWV3ZWQaRwobCTifvyZQc3ZA',
  'EQEArNedN2BAGc/7rlwnUEBAEg8NAAAAABUAAAAAHQAAAAAaBgiJAxC6BCUBAPBBMgoNAAAAABUAAAAAIAwgDSoOCAEQAVoC',
  'EAGYAQGgAQEyBAh4EHg6EhIKCJoIENACGAIgDBgDKgIIAUoJGAEiAxD9JjhZUhIRAQCs1503YEAZT1YxQzFQQEBinwsKPyAC',
  'ahEQARgBIAEwAUABSAFoAcgBAXoCCACSASMQAUABSAFwAYgBAZABAaABAbABAdABAegBAYACAagCAbACAUgBWgwIAAgDCAAI',
  'AxgBGAGIAQGiAW4SBAgBEAASBAgDEAASBAgEEAASBAgGEAASBAgKEAASBAgLEAASBAgQEAASBAgUEAASBAgBEAASBAgDEAAS',
  'BAgEEAASBAgGEAASBAgKEAASBAgLEAASBAgQEAASBAgUEAA4AUAAYggIABAAIAAoAKgBArgBAcABAMgBAdABAdgBAegBAfIB',
  'AhABoAIBqAIByAIB2AIB4AIBoAMBsgMECAEYAcIDCBgBKAE4AVAB6gMQCgIIAQoCCAQKAggBCgIIBPgDAYoEEhoQCgYKBAhu',
  'EG4KBgoECG4QbqoEBAgBEAHCBD4KNhABKAE4AWIuCAEQASICCAMiAggEIgIIBSICCAYiAggHIgIIAyICCAQiAggFIgIIBiIC',
  'CAcoASABKAFIAcoEJAgBEgcKBXRyYW1zEgYKBGJhc2USBwoFdHJhbXMSBgoEYmFzZdgEAeIEAggA8AQBggVuCmgIAQgDCAcI',
  'BQgJCAoICwgPCBIIEAgGCAEIAwgHCAUICQgKCAsIDwgSCBAIBhICCAIYARgCGAkYBxgIGAoYCxgMGA0YFhgXGBoYIBghGAEY',
  'AhgJGAcYCBgKGAsYDBgNGBYYFxgaGCAYIRICEAOgBQG6BQIQAdIFCAoCCAMKAggD6gWkBgoCCAAKAggOCgIIMQoCCD8KAghN',
  'CgIIYgoCCGkKAghwCgIIdwoCCAUKAggMCgIIEwoCCBoKAgghCgIIKAoCCDYKAghECgIISwoCCFIKAghnCgIIbgoCCHUKAgh8',
  'CgMIgwEKAwiKAQoCCAMKAggRCgIIGAoCCDsKAghCCgIISQoCCFAKAghXCgIIXgoCCHoKAwiBAQoDCIgBCgIIAQoCCAgKAggP',
  'CgIIFgoCCDIKAgg5CgIIQAoCCEcKAghOCgIIVQoCCFwKAghxCgIIeAoDCIYBCgMIjQEKAggGCgIIGwoCCCIKAgg3CgIIPgoC',
  'CEUKAghMCgIIUwoCCFoKAghhCgIIaAoCCG8KAgh2CgIIfQoDCIQBCgMIiwEKAggECgIICwoCCBkKAggnCgIIPAoCCFEKAghY',
  'CgIIXwoCCG0KAwiCAQoDCJABCgIIAgoCCB4KAgglCgIILAoCCEEKAghPCgIIVgoCCF0KAghkCgIIawoCCHIKAgh5CgMIhwEK',
  'AwiOAQoCCAAKAggOCgIIMQoCCD8KAghNCgIIYgoCCGkKAghwCgIIdwoCCAUKAggMCgIIEwoCCBoKAgghCgIIKAoCCDYKAghE',
  'CgIISwoCCFIKAghnCgIIbgoCCHUKAgh8CgMIgwEKAwiKAQoCCAMKAggRCgIIGAoCCDsKAghCCgIISQoCCFAKAghXCgIIXgoC',
  'CHoKAwiBAQoDCIgBCgIIAQoCCAgKAggPCgIIFgoCCDIKAgg5CgIIQAoCCEcKAghOCgIIVQoCCFwKAghxCgIIeAoDCIYBCgMI',
  'jQEKAggGCgIIGwoCCCIKAgg3CgIIPgoCCEUKAghMCgIIUwoCCFoKAghhCgIIaAoCCG8KAgh2CgIIfQoDCIQBCgMIiwEKAggE',
  'CgIICwoCCBkKAggnCgIIPAoCCFEKAghYCgIIXwoCCG0KAwiCAQoDCJABCgIIAgoCCB4KAgglCgIILAoCCEEKAghPCgIIVgoC',
  'CF0KAghkCgIIawoCCHIKAgh5CgMIhwEKAwiOARIECAEQARIECAoQARIECAkQARIECAEQARIECAoQARIECAkQAfIFDAgBEAEY',
  'ASABMAE4AZIGBAgBEAGyBgIIApIHBggBEgIIAbAHAdIHAggB4gcECAEYAfAHAYIIAggBmAgBoggECgIICcgIAdAIAXAAiAEB',
  'kgEQCgYImwkQkgYKBgj8ExCwA6oBhQEKTAoGCAgQABgDCgYIBBAAGAMKBggCEAAYAwoGCAEQABgDCgYIChAAGAMKBggCEAEY',
  'AgoGCAoQARgCCgYIChAAGAQKBggNEAAYARABIAESBhABEAMQDhoCGAEgASoCCAFaBAhuEG5qALoBGggBEAEiAggDIgIIBCIC',
  'CAUiAggGIgIIBygBwAEB4gEWGhIZT1YxQzFQQEAhAQCs1503YEAoAfoBCCABSAFQAWABqgI3SGFzaGltYSBDb2FsIE1pbmUg',
  'UnVpbnMK56uv5bO254Kt6Ymx6LehClJlY2VudGx5IHZpZXdlZLICKQonCiUweDM1MTU0NWQ0ZWZkZjVkNTM6MHhkN2I2NTVl',
  'ODllZTc2NDg3yAIA2gIpCiMKIQofIPvTt4Pg/v3hwAEg3KS/9t3/i9xVIPHn49DGnpmAFRICCAI=',
].join('');

export enum ListUgcPostsSortCriteria {
  Unknown = 0,
  NewestFirst = 3,
  QualityScoreLanguagePromoted = 6,
  StarRatingHighThenQuality = 7,
  StarRatingLowThenQuality = 8,
  StarRatingHighThenNewest = 12,
  StarRatingLowThenNewest = 13,
  QualityScoreLanguageFree = 14,
}

export enum ListUgcPostsUserType {
  Unknown = 0,
  AnyUser = 1,
  Owner = 2,
  SpecifiedUser = 3,
}

export class GoogleMapsMobileReversedProtoError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export class MmapChunk {
  constructor(
    readonly type: number,
    readonly payload: Buffer,
  ) {}

  encode(): Buffer {
    const header = Buffer.alloc(6);
    header.writeUInt16BE(this.type, 0);
    header.writeUInt32BE(this.payload.length, 2);
    return Buffer.concat([header, this.payload]);
  }
}

export class MmapClientEnvelope {
  constructor(readonly bytes: Buffer) {}

  static placeDetails(): MmapClientEnvelope {
    return new MmapClientEnvelope(Buffer.from(MMAP_PLACE_DETAILS_CLIENT_ENVELOPE_BASE64, 'base64'));
  }

  static directions(): MmapClientEnvelope {
    return new MmapClientEnvelope(Buffer.from(MMAP_DIRECTIONS_CLIENT_ENVELOPE_BASE64, 'base64'));
  }

  encode(): Buffer {
    return Buffer.from(this.bytes);
  }
}

export class MmapPlaceDetailsFeatureId {
  constructor(readonly ftid: string) {}

  encode(): Buffer {
    return encodeStringField(1, this.ftid);
  }
}

export class MmapPlaceDetailsFeatureEnvelope {
  constructor(readonly featureId: MmapPlaceDetailsFeatureId) {}

  encode(): Buffer {
    return encodeMessageField(1, [this.featureId.encode()]);
  }
}

export class MmapPlaceDetailsSurface {
  constructor(readonly surfaceId = 4989) {}

  encode(): Buffer {
    return encodeVarintField(2, this.surfaceId);
  }
}

export class MmapPlaceDetailsRenderingContext {
  constructor(readonly surface = new MmapPlaceDetailsSurface()) {}

  encode(): Buffer {
    return encodeMessageField(4, [this.surface.encode()]);
  }
}

export interface MmapPlaceDetailsChunkOptions {
  ftid: string;
  fieldMask?: Buffer;
  renderingContext?: MmapPlaceDetailsRenderingContext;
  includePlace?: boolean;
}

export class MmapPlaceDetailsChunk {
  readonly feature: MmapPlaceDetailsFeatureEnvelope;
  readonly fieldMask: Buffer;
  readonly renderingContext: MmapPlaceDetailsRenderingContext;
  readonly includePlace: boolean;

  constructor(options: MmapPlaceDetailsChunkOptions) {
    this.feature = new MmapPlaceDetailsFeatureEnvelope(new MmapPlaceDetailsFeatureId(options.ftid));
    this.fieldMask = Buffer.from(options.fieldMask ?? PLACE_DETAILS_FIELD_MASK);
    this.renderingContext = options.renderingContext ?? new MmapPlaceDetailsRenderingContext();
    this.includePlace = options.includePlace ?? true;
  }

  encode(): Buffer {
    return Buffer.concat([
      encodeMessageField(1, [this.feature.encode()]),
      encodeBytesField(2, this.fieldMask),
      encodeMessageField(3, [this.renderingContext.encode()]),
      encodeVarintField(5, this.includePlace ? 1 : 0),
    ]);
  }
}

export class MmapPlaceDetailsRequest {
  constructor(readonly chunk: MmapPlaceDetailsChunk) {}

  encode(): Buffer {
    return Buffer.concat([
      MmapClientEnvelope.placeDetails().encode(),
      new MmapChunk(GOOGLE_MAPS_MOBILE_PLACE_DETAILS_CHUNK_TYPE, this.chunk.encode()).encode(),
    ]);
  }
}

export interface MmapDirectionsLocationInput {
  text: string;
  lat?: number;
  lng?: number;
  placeId?: string;
  dataId?: string;
}

export interface MmapDirectionsDepartureTimeInput {
  googleMapsEpochSeconds: number;
  timeKindEnum: number;
}

export interface MmapDirectionsRouteOptionsInput {
  avoidTolls?: boolean;
  avoidHighways?: boolean;
  avoidFerries?: boolean;
  departureTime?: MmapDirectionsDepartureTimeInput | null;
}

export class MmapDirectionsWaypoint {
  constructor(readonly location: MmapDirectionsLocationInput) {}

  encode(): Buffer {
    const parts = [
      encodeStringField(1, this.location.text),
      ...(this.location.dataId ? [encodeStringField(2, this.location.dataId)] : []),
      ...(Number.isFinite(this.location.lat) && Number.isFinite(this.location.lng)
        ? [
            encodeMessageField(3, [
              encodeFixed64DoubleField(3, this.location.lat!),
              encodeFixed64DoubleField(4, this.location.lng!),
            ]),
          ]
        : []),
      encodeStringField(4, this.location.text),
      encodeVarintField(6, 0),
      ...(this.location.placeId ? [encodeStringField(19, this.location.placeId)] : []),
    ];
    return encodeMessageField(1, parts);
  }
}

export class MmapDirectionsRouteOptions {
  constructor(readonly input: MmapDirectionsRouteOptionsInput = {}) {}

  encode(): Buffer {
    const base = Buffer.from(BASE_DIRECTIONS_ROUTE_OPTIONS_MESSAGE_BASE64, 'base64');
    const replacements = new Map<number, Buffer>();

    if (this.input.avoidHighways || this.input.avoidTolls) {
      const routePreferenceField = firstProtoMessage(parseProtoMessage(base), 2);
      if (!routePreferenceField) {
        throw new Error('Base mobile route options are missing route preferences');
      }
      replacements.set(2, encodeBytesField(2, this.routePreferenceOptionsWithAvoids(routePreferenceField)));
    }

    if (this.input.avoidFerries) {
      replacements.set(7, encodeVarintField(7, 1));
    }

    if (this.input.departureTime) {
      replacements.set(
        23,
        encodeMessageField(23, [
          encodeVarintField(1, 0),
          encodeVarintField(2, this.input.departureTime.timeKindEnum),
          encodeVarintField(3, this.input.departureTime.googleMapsEpochSeconds),
        ]),
      );
    }

    return replaceOrInsertProtoFields(base, replacements);
  }

  private routePreferenceOptionsWithAvoids(base: Buffer): Buffer {
    const replacements = new Map<number, Buffer>();
    if (this.input.avoidHighways) replacements.set(1, encodeVarintField(1, 1));
    if (this.input.avoidTolls) replacements.set(2, encodeVarintField(2, 1));
    return replaceOrInsertProtoFields(base, replacements);
  }
}

function smallVarintPairField(field: number, first: number, second: number): Buffer {
  return encodeMessageField(field, [encodeVarintField(1, first), encodeVarintField(2, second)]);
}

export interface MmapDirectionsChunkInput {
  from: MmapDirectionsLocationInput;
  to: MmapDirectionsLocationInput;
  routeOptions?: MmapDirectionsRouteOptionsInput;
}

export class MmapDirectionsChunk {
  constructor(readonly input: MmapDirectionsChunkInput) {}

  encode(): Buffer {
    const route = encodeMessageField(1, [
      new MmapDirectionsWaypoint(this.input.from).encode(),
      new MmapDirectionsWaypoint(this.input.to).encode(),
      encodeVarintField(5, 5),
      encodeMessageField(6, [new MmapDirectionsRouteOptions(this.input.routeOptions).encode()]),
      encodeVarintField(7, 0),
      encodeVarintField(14, 1),
      encodeMessageField(15, [encodeVarintField(3, 0)]),
      encodeVarintField(16, 1),
      encodeVarintField(25, 0),
      smallVarintPairField(34, 10, 2),
      smallVarintPairField(37, 3, 4),
      smallVarintPairField(37, 4, 6),
    ]);

    return Buffer.concat([
      route,
      encodeVarintField(2, 18),
      encodeVarintField(2, 12),
      encodeVarintField(2, 13),
      encodeVarintField(4, 1),
      encodeVarintField(4, 3),
      encodeVarintField(7, 1),
      encodeVarintField(8, 1),
    ]);
  }
}

export class MmapDirectionsRequest {
  constructor(readonly chunk: MmapDirectionsChunk) {}

  encode(): Buffer {
    return Buffer.concat([
      MmapClientEnvelope.directions().encode(),
      new MmapChunk(GOOGLE_MAPS_MOBILE_DIRECTIONS_CHUNK_TYPE, this.chunk.encode()).encode(),
    ]);
  }
}

export class MmapRichPlacePhotosRequest {
  constructor(readonly ftid: string) {}

  encode(): Buffer {
    const templateFtid = Buffer.from(RICH_PLACE_PHOTOS_TEMPLATE_FTID, 'utf8');
    const targetFtid = Buffer.from(this.ftid, 'utf8');
    if (targetFtid.length !== templateFtid.length) {
      throw new GoogleMapsMobileReversedProtoError(
        400,
        'Google Maps mobile place photos require a standard-length feature ID',
      );
    }

    const template = Buffer.from(RICH_PLACE_PHOTOS_REQUEST_BASE64, 'base64');
    const clientEnvelope = template.subarray(0, 677);
    const mediaChunk = template.subarray(683);
    const replacements = new Map<number, Buffer>([
      [1, encodeStringField(1, this.ftid)],
      [38, encodeMessageField(38, [encodeMessageField(1, [encodeStringField(1, this.ftid)])])],
    ]);
    const payload = replaceOrInsertProtoFields(mediaChunk, replacements);

    return Buffer.concat([
      clientEnvelope,
      new MmapChunk(GOOGLE_MAPS_MOBILE_RICH_PLACE_MEDIA_CHUNK_TYPE, payload).encode(),
    ]);
  }
}

export class UgcPostFormatValue {
  constructor(readonly value: number) {}

  encode(): Buffer {
    return encodeVarintField(1, this.value);
  }
}

export class PostFormatPredicate {
  constructor(
    readonly mustHave: UgcPostFormatValue[] = [],
    readonly postType: UgcPostFormatValue[] = [],
    readonly matchAny: UgcPostFormatValue[] = [],
  ) {}

  encode(): Buffer {
    return Buffer.concat([
      ...this.mustHave.map((value) => encodeMessageField(1, [value.encode()])),
      ...this.postType.map((value) => encodeMessageField(4, [value.encode()])),
      ...this.matchAny.map((value) => encodeMessageField(5, [value.encode()])),
    ]);
  }
}

export class UserPredicate {
  constructor(
    readonly userType = ListUgcPostsUserType.Unknown,
    readonly specifiedUserObfuscatedGaiaId?: string,
  ) {}

  encode(): Buffer {
    return Buffer.concat([
      encodeVarintField(1, this.userType),
      ...(this.specifiedUserObfuscatedGaiaId ? [encodeStringField(3, this.specifiedUserObfuscatedGaiaId)] : []),
    ]);
  }
}

export interface FilterOptionsInput {
  featureIds?: string[];
  filterText?: string;
  allowedPostFormat?: PostFormatPredicate;
  user?: UserPredicate;
  associatedTopicId?: string;
  associatedUgcPostFilterLogic?: number;
}

export class FilterOptions {
  constructor(readonly input: FilterOptionsInput) {}

  encode(): Buffer {
    return Buffer.concat([
      ...(this.input.featureIds ?? []).map((featureId) => encodeStringField(1, featureId)),
      ...(this.input.filterText ? [encodeStringField(3, this.input.filterText)] : []),
      ...(this.input.associatedTopicId
        ? [encodeMessageField(5, [encodeStringField(1, this.input.associatedTopicId)])]
        : []),
      ...(this.input.allowedPostFormat ? [encodeMessageField(6, [this.input.allowedPostFormat.encode()])] : []),
      ...(this.input.user ? [encodeMessageField(7, [this.input.user.encode()])] : []),
      ...(this.input.associatedUgcPostFilterLogic !== undefined
        ? [encodeMessageField(13, [encodeVarintField(1, this.input.associatedUgcPostFilterLogic)])]
        : []),
    ]);
  }
}

export class PaginationOptions {
  constructor(
    readonly pageSize: number,
    readonly continuationToken?: string,
  ) {}

  encode(): Buffer {
    return Buffer.concat([
      encodeVarintField(1, this.pageSize),
      ...(this.continuationToken ? [encodeStringField(2, this.continuationToken)] : []),
    ]);
  }
}

export class ReviewDataToFetchOptions {
  constructor(
    readonly includeRating: boolean,
    readonly includeText: boolean,
    readonly postFormat: UgcPostFormatValue[] = [],
    readonly includeSummary = true,
  ) {}

  encode(): Buffer {
    return Buffer.concat([
      encodeVarintField(1, this.includeRating ? 1 : 0),
      encodeVarintField(2, this.includeText ? 1 : 0),
      ...this.postFormat.map((value) => encodeMessageField(4, [value.encode()])),
      encodeVarintField(5, this.includeSummary ? 1 : 0),
    ]);
  }
}

export interface DataToFetchOptionsInput {
  unknown1?: number;
  includeAuthor?: boolean;
  includeContent?: boolean;
  includeReactions?: boolean;
  includePlaceContext?: boolean;
  reviewDataToFetchOptions?: ReviewDataToFetchOptions;
  includeUnknown12?: boolean;
}

export class DataToFetchOptions {
  constructor(readonly input: DataToFetchOptionsInput) {}

  encode(): Buffer {
    return Buffer.concat([
      ...(this.input.unknown1 !== undefined ? [encodeVarintField(1, this.input.unknown1)] : []),
      ...(this.input.includeAuthor !== undefined ? [encodeVarintField(2, this.input.includeAuthor ? 1 : 0)] : []),
      ...(this.input.includeContent !== undefined ? [encodeVarintField(3, this.input.includeContent ? 1 : 0)] : []),
      ...(this.input.includeReactions !== undefined ? [encodeVarintField(5, this.input.includeReactions ? 1 : 0)] : []),
      ...(this.input.includePlaceContext !== undefined
        ? [encodeVarintField(7, this.input.includePlaceContext ? 1 : 0)]
        : []),
      ...(this.input.reviewDataToFetchOptions
        ? [encodeMessageField(11, [this.input.reviewDataToFetchOptions.encode()])]
        : []),
      ...(this.input.includeUnknown12 !== undefined
        ? [encodeVarintField(12, this.input.includeUnknown12 ? 1 : 0)]
        : []),
    ]);
  }
}

export class SummaryOptions {
  constructor(readonly enableTopicSummary: boolean) {}

  encode(): Buffer {
    return encodeVarintField(1, this.enableTopicSummary ? 1 : 0);
  }
}

export interface ListUgcPostsRequestInput {
  filter?: FilterOptions;
  pagination?: PaginationOptions;
  sortCriteria?: ListUgcPostsSortCriteria;
  loggingParams?: Buffer | string;
  dataToFetchOptions?: DataToFetchOptions;
  summaryOptions?: SummaryOptions;
}

export class ListUgcPostsRequest {
  constructor(readonly input: ListUgcPostsRequestInput) {}

  static reviewsPage(ftid: string, continuationToken: string): ListUgcPostsRequest {
    return new ListUgcPostsRequest({
      filter: new FilterOptions({
        featureIds: [ftid],
        allowedPostFormat: new PostFormatPredicate(
          [new UgcPostFormatValue(2)],
          [new UgcPostFormatValue(1)],
          [new UgcPostFormatValue(3), new UgcPostFormatValue(4), new UgcPostFormatValue(5)],
        ),
        user: new UserPredicate(ListUgcPostsUserType.SpecifiedUser),
      }),
      pagination: new PaginationOptions(8, continuationToken),
      loggingParams: '8Y',
      dataToFetchOptions: new DataToFetchOptions({
        unknown1: 0,
        includeAuthor: true,
        includeContent: true,
        includeReactions: true,
        includePlaceContext: true,
        reviewDataToFetchOptions: new ReviewDataToFetchOptions(
          true,
          true,
          [
            new UgcPostFormatValue(3),
            new UgcPostFormatValue(4),
            new UgcPostFormatValue(5),
            new UgcPostFormatValue(6),
            new UgcPostFormatValue(7),
          ],
          true,
        ),
      }),
      summaryOptions: new SummaryOptions(false),
    });
  }

  encode(): Buffer {
    const loggingParams =
      typeof this.input.loggingParams === 'string'
        ? Buffer.from(this.input.loggingParams, 'utf8')
        : this.input.loggingParams;

    return Buffer.concat([
      ...(this.input.filter ? [encodeMessageField(1, [this.input.filter.encode()])] : []),
      ...(this.input.pagination ? [encodeMessageField(2, [this.input.pagination.encode()])] : []),
      ...(this.input.sortCriteria !== undefined ? [encodeVarintField(3, this.input.sortCriteria)] : []),
      ...(loggingParams ? [encodeBytesField(5, loggingParams)] : []),
      ...(this.input.dataToFetchOptions ? [encodeMessageField(8, [this.input.dataToFetchOptions.encode()])] : []),
      ...(this.input.summaryOptions ? [encodeMessageField(12, [this.input.summaryOptions.encode()])] : []),
    ]);
  }
}

export function buildMmapPlaceDetailsRequestBody(ftid: string): Buffer {
  return new MmapPlaceDetailsRequest(new MmapPlaceDetailsChunk({ ftid })).encode();
}

export function buildMmapRichPlacePhotosRequestBody(ftid: string): Buffer {
  return new MmapRichPlacePhotosRequest(ftid).encode();
}

export function buildMmapDirectionsRequestBody(input: MmapDirectionsChunkInput): Buffer {
  return new MmapDirectionsRequest(new MmapDirectionsChunk(input)).encode();
}

export function buildListUgcPostsReviewsPageBody(ftid: string, continuationToken: string): Buffer {
  return ListUgcPostsRequest.reviewsPage(ftid, continuationToken).encode();
}
