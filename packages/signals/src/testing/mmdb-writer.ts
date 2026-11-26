/**
 * Our own MaxMind DB writer for fixtures (plan C92.3, C111.1): the binary search tree, the data
 * section and the metadata of the MaxMind DB format 2.0, written from a list of prefixes and
 * records. No real database is ever committed; every synthetic MMDB is built by this writer from
 * the documentation ranges. IPv4 prefixes sit in the IPv6 tree at `::a.b.c.d`, as the format's
 * readers expect (they walk 96 zero bits to the IPv4 subtree).
 */
import { IPV4_MAPPED_START, parseNetwork } from '../network/address.js';

/** A value of the format's typed kinds, for members the plain JSON mapping does not choose. */
export interface MmdbTypedValue {
  readonly mmdbType:
    'uint16' | 'uint32' | 'uint64' | 'uint128' | 'int32' | 'double' | 'float' | 'bytes';
  readonly value: number | bigint | Uint8Array;
}

/**
 * A record member: a string, a boolean, a number (`uint32` for an integer from 0 to 2^32 - 1,
 * `int32` for a negative integer, `double` otherwise), a bigint (`uint64`, or `uint128` above
 * 2^64 - 1), a typed value, an array or a map.
 */
export type MmdbValue =
  | string
  | number
  | bigint
  | boolean
  | MmdbTypedValue
  | readonly MmdbValue[]
  | { readonly [member: string]: MmdbValue };

/** One prefix and its record. */
export interface MmdbEntry {
  readonly network: string;
  readonly data: Readonly<Record<string, MmdbValue>>;
}

/** What a database holds. */
export interface MmdbSpec {
  readonly databaseType: string;
  readonly buildEpoch: Date;
  readonly entries: readonly MmdbEntry[];
  readonly ipVersion?: 4 | 6;
  readonly recordSize?: 24 | 28 | 32;
  readonly languages?: readonly string[];
  readonly description?: Readonly<Record<string, string>>;
}

const METADATA_MARKER = Buffer.from('abcdef4d61784d696e642e636f6d', 'hex');
const SEPARATOR = Buffer.alloc(16);
const UINT64_MAX = (1n << 64n) - 1n;
const UINT128_MAX = (1n << 128n) - 1n;

const TYPE = {
  utf8: 2,
  double: 3,
  bytes: 4,
  uint16: 5,
  uint32: 6,
  map: 7,
  int32: 8,
  uint64: 9,
  uint128: 10,
  array: 11,
  boolean: 14,
  float: 15,
} as const;

function typed(
  mmdbType: MmdbTypedValue['mmdbType'],
  value: MmdbTypedValue['value'],
): MmdbTypedValue {
  return Object.freeze({ mmdbType, value });
}

function integerIn(value: number, min: number, max: number, kind: string): number {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new RangeError(`${kind} holds integers from ${String(min)} to ${String(max)}`);
  }
  return value;
}

function bigintIn(value: bigint, max: bigint, kind: string): bigint {
  if (value < 0n || value > max) {
    throw new RangeError(`${kind} holds integers from 0 to ${max.toString()}`);
  }
  return value;
}

/** Typed values for {@link MmdbSpec} records. */
export const mmdbValue = Object.freeze({
  uint16: (value: number): MmdbTypedValue => typed('uint16', integerIn(value, 0, 0xffff, 'uint16')),
  uint32: (value: number): MmdbTypedValue =>
    typed('uint32', integerIn(value, 0, 0xffff_ffff, 'uint32')),
  uint64: (value: bigint): MmdbTypedValue => typed('uint64', bigintIn(value, UINT64_MAX, 'uint64')),
  uint128: (value: bigint): MmdbTypedValue =>
    typed('uint128', bigintIn(value, UINT128_MAX, 'uint128')),
  int32: (value: number): MmdbTypedValue =>
    typed('int32', integerIn(value, -(2 ** 31), 2 ** 31 - 1, 'int32')),
  double: (value: number): MmdbTypedValue => typed('double', finite(value)),
  float: (value: number): MmdbTypedValue => typed('float', finite(value)),
  bytes: (value: Uint8Array): MmdbTypedValue => typed('bytes', Uint8Array.from(value)),
});

function finite(value: number): number {
  if (!Number.isFinite(value)) {
    throw new RangeError('the format holds finite numbers only');
  }
  return value;
}

/** The control bytes of a field: type, then (for an extended type) its byte, then the size. */
function control(type: number, size: number): Buffer {
  const head = type <= 7 ? type << 5 : 0;
  const extended = type <= 7 ? [] : [type - 7];
  let sizeBits: number;
  let sizeBytes: number[];
  if (size < 29) {
    sizeBits = size;
    sizeBytes = [];
  } else if (size < 29 + 256) {
    sizeBits = 29;
    sizeBytes = [size - 29];
  } else if (size < 285 + 65_536) {
    sizeBits = 30;
    const rest = size - 285;
    sizeBytes = [rest >> 8, rest & 0xff];
  } else if (size < 65_821 + 16_777_216) {
    sizeBits = 31;
    const rest = size - 65_821;
    sizeBytes = [(rest >> 16) & 0xff, (rest >> 8) & 0xff, rest & 0xff];
  } else {
    throw new RangeError('a field larger than the format holds');
  }
  return Buffer.from([head | sizeBits, ...extended, ...sizeBytes]);
}

/** Big-endian bytes of an unsigned integer, without leading zero bytes. */
function unsignedBytes(value: bigint): Buffer {
  const bytes: number[] = [];
  for (let rest = value; rest > 0n; rest >>= 8n) {
    bytes.unshift(Number(rest & 0xffn));
  }
  return Buffer.from(bytes);
}

function field(type: number, payload: Buffer): Buffer {
  return Buffer.concat([control(type, payload.length), payload]);
}

function encodeTyped(value: MmdbTypedValue): Buffer {
  switch (value.mmdbType) {
    case 'uint16':
    case 'uint32':
      return field(TYPE[value.mmdbType], unsignedBytes(BigInt(value.value as number)));
    case 'uint64':
    case 'uint128':
      return field(TYPE[value.mmdbType], unsignedBytes(value.value as bigint));
    case 'int32': {
      const payload = Buffer.alloc(4);
      payload.writeInt32BE(value.value as number);
      return field(
        TYPE.int32,
        (value.value as number) < 0 ? payload : unsignedBytes(BigInt(value.value as number)),
      );
    }
    case 'double': {
      const payload = Buffer.alloc(8);
      payload.writeDoubleBE(value.value as number);
      return field(TYPE.double, payload);
    }
    case 'float': {
      const payload = Buffer.alloc(4);
      payload.writeFloatBE(value.value as number);
      return field(TYPE.float, payload);
    }
    case 'bytes':
      return field(TYPE.bytes, Buffer.from(value.value as Uint8Array));
  }
}

function isTyped(value: object): value is MmdbTypedValue {
  return 'mmdbType' in value && 'value' in value;
}

/** Encodes one value of the data section. */
function encode(value: MmdbValue): Buffer {
  if (typeof value === 'string') {
    return field(TYPE.utf8, Buffer.from(value, 'utf8'));
  }
  if (typeof value === 'boolean') {
    return control(TYPE.boolean, value ? 1 : 0);
  }
  if (typeof value === 'bigint') {
    return value > UINT64_MAX
      ? encodeTyped(mmdbValue.uint128(value))
      : encodeTyped(mmdbValue.uint64(value));
  }
  if (typeof value === 'number') {
    if (Number.isInteger(value) && value >= 0 && value <= 0xffff_ffff) {
      return encodeTyped(mmdbValue.uint32(value));
    }
    if (Number.isInteger(value) && value < 0 && value >= -(2 ** 31)) {
      return encodeTyped(mmdbValue.int32(value));
    }
    return encodeTyped(mmdbValue.double(value));
  }
  if (Array.isArray(value)) {
    const items = value as readonly MmdbValue[];
    return Buffer.concat([control(TYPE.array, items.length), ...items.map((item) => encode(item))]);
  }
  if (isTyped(value)) {
    return encodeTyped(value);
  }
  const members = Object.entries(value as Readonly<Record<string, MmdbValue>>).sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0,
  );
  return Buffer.concat([
    control(TYPE.map, members.length),
    ...members.flatMap(([name, member]) => [encode(name), encode(member)]),
  ]);
}

interface TreeNode {
  children: [TreeChild, TreeChild];
}
type TreeChild = TreeNode | { data: number } | null;

function isNode(child: TreeChild): child is TreeNode {
  return child !== null && 'children' in child;
}

/** The bits of a prefix in the tree: IPv4 at `::a.b.c.d` (or bare in an IPv4 tree). */
function treePrefix(
  network: string,
  ipVersion: 4 | 6,
): { bits: bigint; length: number; width: number } {
  const parsed = parseNetwork(network);
  if (parsed.family === 4) {
    const bits = parsed.start - IPV4_MAPPED_START;
    return ipVersion === 4
      ? { bits, length: parsed.prefixLength, width: 32 }
      : { bits, length: parsed.prefixLength + 96, width: 128 };
  }
  if (ipVersion === 4) {
    throw new RangeError('an IPv4 tree holds IPv4 prefixes only');
  }
  return { bits: parsed.start, length: parsed.prefixLength, width: 128 };
}

function writeRecord(
  out: Buffer,
  offset: number,
  recordSize: 24 | 28 | 32,
  left: number,
  right: number,
): void {
  if (recordSize === 24) {
    out.writeUIntBE(left, offset, 3);
    out.writeUIntBE(right, offset + 3, 3);
  } else if (recordSize === 28) {
    out.writeUIntBE(left & 0xff_ffff, offset, 3);
    out[offset + 3] = (((left >>> 24) & 0x0f) << 4) | ((right >>> 24) & 0x0f);
    out.writeUIntBE(right & 0xff_ffff, offset + 4, 3);
  } else {
    out.writeUInt32BE(left, offset);
    out.writeUInt32BE(right, offset + 4);
  }
}

/**
 * Writes a MaxMind DB file. A more specific prefix wins over a broader one; of two equal
 * prefixes, the later wins.
 */
export function writeMmdb(spec: MmdbSpec): Buffer {
  const ipVersion = spec.ipVersion ?? 6;
  const recordSize = spec.recordSize ?? 24;

  // The data section: each distinct record once.
  const records: Buffer[] = [];
  const offsets = new Map<string, number>();
  let dataSize = 0;
  const prefixes = spec.entries.map((entry, order) => {
    const encoded = encode(entry.data);
    const name = encoded.toString('hex');
    let offset = offsets.get(name);
    if (offset === undefined) {
      offset = dataSize;
      offsets.set(name, offset);
      records.push(encoded);
      dataSize += encoded.length;
    }
    const prefix = treePrefix(entry.network, ipVersion);
    if (prefix.length === 0) {
      throw new RangeError('the tree root cannot hold a record');
    }
    return { ...prefix, offset, order };
  });

  // The tree: shorter prefixes first, so a longer one splits the record it lands in.
  const root: TreeNode = { children: [null, null] };
  prefixes
    .sort((a, b) => a.length - b.length || a.order - b.order)
    .forEach(({ bits, length, width, offset }) => {
      let node = root;
      for (let depth = 0; depth < length; depth += 1) {
        const bit = Number((bits >> BigInt(width - 1 - depth)) & 1n);
        if (depth === length - 1) {
          node.children[bit] = { data: offset };
          return;
        }
        const child = node.children[bit] ?? null;
        if (isNode(child)) {
          node = child;
        } else {
          const next: TreeNode = { children: [child, child] };
          node.children[bit] = next;
          node = next;
        }
      }
    });

  // Number the nodes breadth first, then write their records.
  const nodes: TreeNode[] = [root];
  const numbers = new Map<TreeNode, number>([[root, 0]]);
  // The loop reads the nodes it appends, so it walks the whole tree level by level.
  for (const node of nodes) {
    for (const child of node.children) {
      if (isNode(child) && !numbers.has(child)) {
        numbers.set(child, nodes.length);
        nodes.push(child);
      }
    }
  }
  const nodeCount = nodes.length;
  const limit = 2 ** recordSize;
  const value = (child: TreeChild): number => {
    const number =
      child === null
        ? nodeCount
        : isNode(child)
          ? (numbers.get(child) ?? 0)
          : nodeCount + 16 + child.data;
    if (number >= limit) {
      throw new RangeError(`the file needs a record size above ${String(recordSize)}`);
    }
    return number;
  };
  const nodeBytes = recordSize / 4;
  const tree = Buffer.alloc(nodeCount * nodeBytes);
  nodes.forEach((node, index) => {
    writeRecord(
      tree,
      index * nodeBytes,
      recordSize,
      value(node.children[0]),
      value(node.children[1]),
    );
  });

  const metadata = encode({
    binary_format_major_version: mmdbValue.uint16(2),
    binary_format_minor_version: mmdbValue.uint16(0),
    build_epoch: mmdbValue.uint64(BigInt(Math.floor(spec.buildEpoch.getTime() / 1000))),
    database_type: spec.databaseType,
    description: spec.description ?? { en: spec.databaseType },
    ip_version: mmdbValue.uint16(ipVersion),
    languages: spec.languages ?? ['en'],
    node_count: mmdbValue.uint32(nodeCount),
    record_size: mmdbValue.uint16(recordSize),
  });
  return Buffer.concat([tree, SEPARATOR, ...records, METADATA_MARKER, metadata]);
}
