/**
 * C77.2: our own reader for a ZIP holding exactly one expected member (OFAC's `SDN_ENHANCED.ZIP`
 * holds `SDN_ENHANCED.XML`), over `node:zlib`'s raw inflate. It trusts nothing the archive
 * declares: one entry with the expected name, no encryption, no ZIP64, the local header and the
 * data descriptor agreeing with the central directory, declared sizes within the manifest's caps,
 * and the bytes counted and checksummed while inflating, so a member that inflates past what it
 * declared is refused before it can exhaust the worker.
 */
import type { FileHandle } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { crc32, createInflateRaw } from 'node:zlib';
import { WatchlistParseError } from '../parsers/errors.js';

/** Random access to an archive: the sync's private download file, or bytes in tests. */
export interface RandomAccessSource {
  readonly size: number;
  /** Reads up to `length` bytes at `position`; fewer only at the end of the source. */
  read(position: number, length: number): Promise<Uint8Array>;
}

/** C76.1: the manifest's caps and the member's expected name. */
export interface SingleMemberZipLimits {
  readonly memberName: string;
  /** The archive's own size, and the member's compressed size, at most. */
  readonly maxCompressedBytes: number;
  /** The member's declared and inflated size at most. */
  readonly maxInflatedBytes: number;
}

/** The one member, checked; `inflate()` streams its bytes and checks them as they come. */
export interface ZipMember {
  readonly name: string;
  readonly method: 'stored' | 'deflate';
  readonly compressedSize: number;
  readonly inflatedSize: number;
  /** The CRC-32 the central directory declares. */
  readonly crc32: number;
  /**
   * Yields the member's bytes. Refuses (`zip`) a member that inflates to more or fewer bytes than
   * it declared, whose CRC-32 differs, whose deflate stream is corrupt, ends early or ends before
   * its compressed bytes do.
   */
  inflate(): AsyncGenerator<Uint8Array, void, undefined>;
}

/** Bytes as a {@link RandomAccessSource}. */
export function bytesSource(bytes: Uint8Array): RandomAccessSource {
  return {
    size: bytes.length,
    read: (position, length) =>
      Promise.resolve(bytes.subarray(position, Math.min(bytes.length, position + length))),
  };
}

/** An open file as a {@link RandomAccessSource}; the caller keeps and closes the handle. */
export async function fileSource(handle: FileHandle): Promise<RandomAccessSource> {
  const { size } = await handle.stat();
  return {
    size,
    read: async (position, length) => {
      const buffer = new Uint8Array(Math.max(0, Math.min(length, size - position)));
      let filled = 0;
      while (filled < buffer.length) {
        const { bytesRead } = await handle.read(
          buffer,
          filled,
          buffer.length - filled,
          position + filled,
        );
        if (bytesRead === 0) {
          break;
        }
        filled += bytesRead;
      }
      return buffer.subarray(0, filled);
    },
  };
}

/**
 * Checks the archive's structure and returns its one member.
 * @throws {WatchlistParseError} `too_large` for an archive or a declared member over its cap;
 * `zip` for anything but one expected, unencrypted, self-consistent stored or deflated member.
 */
export async function openSingleMemberZip(
  source: RandomAccessSource,
  limits: SingleMemberZipLimits,
): Promise<ZipMember> {
  if (source.size > limits.maxCompressedBytes) {
    throw new WatchlistParseError(
      'too_large',
      `the archive is over ${String(limits.maxCompressedBytes)} bytes`,
    );
  }
  const end = await readEndRecord(source);
  const entry = await readCentralEntry(source, end);
  checkEntry(entry, limits);
  const dataStart = await checkLocalHeader(source, entry);
  await checkDataEnd(source, entry, dataStart, end.centralOffset);
  return {
    name: limits.memberName,
    method: entry.method === STORED ? 'stored' : 'deflate',
    compressedSize: entry.compressedSize,
    inflatedSize: entry.inflatedSize,
    crc32: entry.crc32,
    inflate: () => inflateMember(source, entry, dataStart),
  };
}

const LOCAL_SIGNATURE = 0x04034b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const END_SIGNATURE = 0x06054b50;
const DESCRIPTOR_SIGNATURE = 0x08074b50;
const ZIP64_LOCATOR_SIGNATURE = 0x07064b50;
const END_SIZE = 22;
const CENTRAL_SIZE = 46;
const LOCAL_SIZE = 30;
const MAX_COMMENT = 0xffff;
const ZIP64_MARKER = 0xffffffff;
const STORED = 0;
const DEFLATED = 8;
/** Bit 0 encrypted, bit 6 strong encryption, bit 13 a masked central directory. */
const ENCRYPTION_FLAGS = 0x0001 | 0x0040 | 0x2000;
const DATA_DESCRIPTOR_FLAG = 0x0008;
const UTF8_FLAG = 0x0800;
const READ_BYTES = 65_536;

interface EndRecord {
  readonly offset: number;
  readonly centralOffset: number;
  readonly centralSize: number;
}

interface CentralEntry {
  readonly flags: number;
  readonly method: number;
  readonly crc32: number;
  readonly compressedSize: number;
  readonly inflatedSize: number;
  readonly nameBytes: Uint8Array;
  readonly localOffset: number;
}

function refuse(rule: string): never {
  throw new WatchlistParseError('zip', rule);
}

function view(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

async function readExactly(
  source: RandomAccessSource,
  position: number,
  length: number,
): Promise<Uint8Array> {
  if (position < 0 || position + length > source.size) {
    refuse('a record lies outside the archive');
  }
  const bytes = await source.read(position, length);
  if (bytes.length !== length) {
    refuse('the archive ended early');
  }
  return bytes;
}

/** The end record that ends the archive exactly; no ZIP64, one disk, one entry. */
async function readEndRecord(source: RandomAccessSource): Promise<EndRecord> {
  if (source.size < END_SIZE) {
    refuse('no end of central directory record');
  }
  const tailStart = Math.max(0, source.size - END_SIZE - MAX_COMMENT);
  const tail = await readExactly(source, tailStart, source.size - tailStart);
  const data = view(tail);
  let at = -1;
  for (let index = tail.length - END_SIZE; index >= 0; index -= 1) {
    if (
      data.getUint32(index, true) === END_SIGNATURE &&
      index + END_SIZE + data.getUint16(index + 20, true) === tail.length
    ) {
      at = index;
      break;
    }
  }
  if (at === -1) {
    refuse('no end of central directory record');
  }
  if (at >= 20 && data.getUint32(at - 20, true) === ZIP64_LOCATOR_SIGNATURE) {
    refuse('a ZIP64 archive is not read');
  }
  const disk = data.getUint16(at + 4, true);
  const centralDisk = data.getUint16(at + 6, true);
  const onDisk = data.getUint16(at + 8, true);
  const entries = data.getUint16(at + 10, true);
  const centralSize = data.getUint32(at + 12, true);
  const centralOffset = data.getUint32(at + 16, true);
  if (entries === 0xffff || centralSize === ZIP64_MARKER || centralOffset === ZIP64_MARKER) {
    refuse('a ZIP64 archive is not read');
  }
  if (disk !== 0 || centralDisk !== 0 || onDisk !== entries) {
    refuse('a split archive is not read');
  }
  if (entries !== 1) {
    refuse(`the archive holds ${String(entries)} members, not exactly one`);
  }
  const offset = tailStart + at;
  if (centralOffset + centralSize !== offset) {
    refuse('the central directory does not end where the end record starts');
  }
  return { offset, centralOffset, centralSize };
}

async function readCentralEntry(source: RandomAccessSource, end: EndRecord): Promise<CentralEntry> {
  if (end.centralSize < CENTRAL_SIZE) {
    refuse('the central directory is too short');
  }
  const bytes = await readExactly(source, end.centralOffset, end.centralSize);
  const data = view(bytes);
  if (data.getUint32(0, true) !== CENTRAL_SIGNATURE) {
    refuse('no central directory entry');
  }
  const nameLength = data.getUint16(28, true);
  const extraLength = data.getUint16(30, true);
  const commentLength = data.getUint16(32, true);
  if (CENTRAL_SIZE + nameLength + extraLength + commentLength !== end.centralSize) {
    refuse('the central directory holds more than one entry');
  }
  if (data.getUint16(34, true) !== 0) {
    refuse('a split archive is not read');
  }
  return {
    flags: data.getUint16(8, true),
    method: data.getUint16(10, true),
    crc32: data.getUint32(16, true),
    compressedSize: data.getUint32(20, true),
    inflatedSize: data.getUint32(24, true),
    nameBytes: bytes.subarray(CENTRAL_SIZE, CENTRAL_SIZE + nameLength),
    localOffset: data.getUint32(42, true),
  };
}

function memberName(entry: CentralEntry): string {
  if ((entry.flags & UTF8_FLAG) === 0 && entry.nameBytes.some((byte) => byte > 0x7f)) {
    refuse('the member name is neither ASCII nor flagged UTF-8');
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(entry.nameBytes);
  } catch {
    return refuse('the member name is not UTF-8');
  }
}

function checkEntry(entry: CentralEntry, limits: SingleMemberZipLimits): void {
  if (
    entry.compressedSize === ZIP64_MARKER ||
    entry.inflatedSize === ZIP64_MARKER ||
    entry.localOffset === ZIP64_MARKER
  ) {
    refuse('a ZIP64 member is not read');
  }
  if ((entry.flags & ENCRYPTION_FLAGS) !== 0) {
    refuse('an encrypted member is not read');
  }
  if (entry.method !== STORED && entry.method !== DEFLATED) {
    refuse('the member is neither stored nor deflated');
  }
  if (memberName(entry) !== limits.memberName) {
    refuse('the member is not the expected one');
  }
  if (entry.inflatedSize > limits.maxInflatedBytes) {
    throw new WatchlistParseError(
      'too_large',
      `the member declares more than ${String(limits.maxInflatedBytes)} bytes`,
    );
  }
  if (entry.method === STORED && entry.compressedSize !== entry.inflatedSize) {
    refuse('a stored member declares two sizes');
  }
}

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  return left.length === right.length && left.every((byte, index) => byte === right[index]);
}

/** The local header agrees with the central directory; returns where the data starts. */
async function checkLocalHeader(source: RandomAccessSource, entry: CentralEntry): Promise<number> {
  if (entry.localOffset !== 0) {
    refuse('bytes precede the member');
  }
  const header = view(await readExactly(source, 0, LOCAL_SIZE));
  if (header.getUint32(0, true) !== LOCAL_SIGNATURE) {
    refuse('no local header');
  }
  if (header.getUint16(6, true) !== entry.flags || header.getUint16(8, true) !== entry.method) {
    refuse('the local header and the central directory disagree');
  }
  const nameLength = header.getUint16(26, true);
  const extraLength = header.getUint16(28, true);
  const name = await readExactly(source, LOCAL_SIZE, nameLength);
  if (!sameBytes(name, entry.nameBytes)) {
    refuse('the local header and the central directory disagree');
  }
  const stated = [
    header.getUint32(14, true),
    header.getUint32(18, true),
    header.getUint32(22, true),
  ];
  const declared = [entry.crc32, entry.compressedSize, entry.inflatedSize];
  const deferred = (entry.flags & DATA_DESCRIPTOR_FLAG) !== 0;
  const agrees = stated.every(
    (value, index) => value === declared[index] || (deferred && value === 0),
  );
  if (!agrees) {
    refuse('the local header and the central directory disagree');
  }
  return LOCAL_SIZE + nameLength + extraLength;
}

/** The data, and its descriptor when bit 3 is set, end exactly where the directory starts. */
async function checkDataEnd(
  source: RandomAccessSource,
  entry: CentralEntry,
  dataStart: number,
  centralOffset: number,
): Promise<void> {
  const dataEnd = dataStart + entry.compressedSize;
  if ((entry.flags & DATA_DESCRIPTOR_FLAG) === 0) {
    if (dataEnd !== centralOffset) {
      refuse('the member data does not end where the central directory starts');
    }
    return;
  }
  const length = centralOffset - dataEnd;
  if (length !== 12 && length !== 16) {
    refuse('the data descriptor does not end where the central directory starts');
  }
  const descriptor = view(await readExactly(source, dataEnd, length));
  const at = length === 16 ? 4 : 0;
  if (length === 16 && descriptor.getUint32(0, true) !== DESCRIPTOR_SIGNATURE) {
    refuse('the data descriptor has no signature');
  }
  if (
    descriptor.getUint32(at, true) !== entry.crc32 ||
    descriptor.getUint32(at + 4, true) !== entry.compressedSize ||
    descriptor.getUint32(at + 8, true) !== entry.inflatedSize
  ) {
    refuse('the data descriptor and the central directory disagree');
  }
}

async function* compressedBytes(
  source: RandomAccessSource,
  start: number,
  length: number,
): AsyncGenerator<Uint8Array, void, undefined> {
  for (let offset = 0; offset < length; offset += READ_BYTES) {
    yield await readExactly(source, start + offset, Math.min(READ_BYTES, length - offset));
  }
}

/** Streams the member, counting bytes against what it declared and checking its CRC-32. */
async function* inflateMember(
  source: RandomAccessSource,
  entry: CentralEntry,
  dataStart: number,
): AsyncGenerator<Uint8Array, void, undefined> {
  const input = compressedBytes(source, dataStart, entry.compressedSize);
  let total = 0;
  let checksum = 0;
  const count = (chunk: Uint8Array): Uint8Array => {
    total += chunk.length;
    if (total > entry.inflatedSize) {
      refuse('the member inflates past the size it declared');
    }
    checksum = crc32(chunk, checksum);
    return chunk;
  };
  if (entry.method === STORED) {
    for await (const chunk of input) {
      yield count(chunk);
    }
  } else {
    const inflater = createInflateRaw();
    const readable = Readable.from(input);
    readable.on('error', (error) => inflater.destroy(error));
    readable.pipe(inflater);
    try {
      for await (const chunk of inflater) {
        yield count(chunk as Uint8Array);
      }
    } catch (error) {
      if (error instanceof WatchlistParseError) {
        throw error;
      }
      refuse('the deflate stream is corrupt or cut short');
    } finally {
      readable.destroy();
      inflater.destroy();
    }
    if (inflater.bytesWritten !== entry.compressedSize) {
      refuse('the deflate stream ends before the member data does');
    }
  }
  if (total !== entry.inflatedSize) {
    refuse('the member inflates to fewer bytes than it declared');
  }
  if (checksum >>> 0 !== entry.crc32) {
    refuse('the member CRC-32 differs from the one declared');
  }
}
