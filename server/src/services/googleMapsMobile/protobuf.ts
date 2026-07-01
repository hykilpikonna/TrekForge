export interface ProtoField {
  field: number;
  wire: number;
  value: number | Buffer;
  tagPos: number;
  end: number;
}

export function encodeVarint(value: number): Buffer {
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

export function readVarint(buffer: Buffer, pos: number, end = buffer.length): [number, number] {
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

export function protoTag(field: number, wire: number): Buffer {
  return encodeVarint(field * 8 + wire);
}

export function encodeDelimited(buffer: Buffer): Buffer {
  return Buffer.concat([encodeVarint(buffer.length), buffer]);
}

export function encodeVarintField(field: number, value: number): Buffer {
  return Buffer.concat([protoTag(field, 0), encodeVarint(value)]);
}

export function encodeBytesField(field: number, value: Buffer): Buffer {
  return Buffer.concat([protoTag(field, 2), encodeDelimited(value)]);
}

export function encodeStringField(field: number, value: string): Buffer {
  return encodeBytesField(field, Buffer.from(value, 'utf8'));
}

export function encodeMessageField(field: number, parts: Buffer[]): Buffer {
  return encodeBytesField(field, Buffer.concat(parts));
}

export function encodeFixed64DoubleField(field: number, value: number): Buffer {
  const buffer = Buffer.alloc(8);
  buffer.writeDoubleLE(value, 0);
  return Buffer.concat([protoTag(field, 1), buffer]);
}

export function encodeFixed32FloatField(field: number, value: number): Buffer {
  const buffer = Buffer.alloc(4);
  buffer.writeFloatLE(value, 0);
  return Buffer.concat([protoTag(field, 5), buffer]);
}

export function skipProtoField(buffer: Buffer, pos: number, end: number, wire: number): number {
  if (wire === 0) return readVarint(buffer, pos, end)[1];
  if (wire === 1) return pos + 8 <= end ? pos + 8 : Infinity;
  if (wire === 2) {
    const [length, valuePos] = readVarint(buffer, pos, end);
    return valuePos + length <= end ? valuePos + length : Infinity;
  }
  if (wire === 5) return pos + 4 <= end ? pos + 4 : Infinity;
  return Infinity;
}

export function parseProtoMessage(buffer: Buffer, start = 0, end = buffer.length): ProtoField[] {
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
      const next = skipProtoField(buffer, pos, end, wire);
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

export function tryParseProtoMessage(buffer: Buffer): ProtoField[] | null {
  try {
    return parseProtoMessage(buffer);
  } catch {
    return null;
  }
}

export function isProtoText(buffer: Buffer): boolean {
  if (buffer.length === 0) return false;
  const text = buffer.toString('utf8');
  if (text.includes('\uFFFD')) return false;
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    if (code !== 9 && code !== 10 && code !== 13 && code < 32) return false;
  }
  return true;
}

export function protoFieldStrings(fields: ProtoField[], field: number): string[] {
  return fields
    .filter(
      (entry) => entry.field === field && entry.wire === 2 && Buffer.isBuffer(entry.value) && isProtoText(entry.value),
    )
    .map((entry) => (entry.value as Buffer).toString('utf8'));
}

export function firstProtoVarint(fields: ProtoField[], field: number): number | null {
  const found = fields.find((entry) => entry.field === field && entry.wire === 0 && typeof entry.value === 'number');
  return typeof found?.value === 'number' ? found.value : null;
}

export function firstProtoMessage(fields: ProtoField[], field: number): Buffer | null {
  const found = fields.find((entry) => entry.field === field && entry.wire === 2 && Buffer.isBuffer(entry.value));
  return Buffer.isBuffer(found?.value) ? found.value : null;
}

export function allProtoMessages(fields: ProtoField[], field: number): Buffer[] {
  return fields
    .filter((entry) => entry.field === field && entry.wire === 2 && Buffer.isBuffer(entry.value))
    .map((entry) => entry.value as Buffer);
}

export function protoFixed64Double(fields: ProtoField[], field: number): number | null {
  const found = fields.find((entry) => entry.field === field && entry.wire === 1 && Buffer.isBuffer(entry.value));
  return Buffer.isBuffer(found?.value) && found.value.length === 8 ? found.value.readDoubleLE(0) : null;
}

export function protoFixed32Float(fields: ProtoField[], field: number): number | null {
  const found = fields.find((entry) => entry.field === field && entry.wire === 5 && Buffer.isBuffer(entry.value));
  return Buffer.isBuffer(found?.value) && found.value.length === 4 ? found.value.readFloatLE(0) : null;
}

export function encodeParsedProtoField(message: Buffer, field: ProtoField): Buffer {
  return message.subarray(field.tagPos, field.end);
}

export function replaceOrInsertProtoFields(message: Buffer, replacements: Map<number, Buffer>): Buffer {
  if (!replacements.size) return message;
  const fields = parseProtoMessage(message);
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
    parts.push(encodeParsedProtoField(message, field));
  }

  for (const fieldNumber of replacementNumbers) {
    if (!inserted.has(fieldNumber)) parts.push(replacements.get(fieldNumber)!);
  }
  return Buffer.concat(parts);
}
