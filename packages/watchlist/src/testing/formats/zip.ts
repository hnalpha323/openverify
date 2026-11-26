/**
 * A ZIP writer for the publisher-format fixtures (C77.2, C77.5): OFAC serves its SDN list as a
 * single-member ZIP. Besides well-formed archives it writes the shapes the single-member reader's
 * guards must refuse (two members, a declared size that lies, a data descriptor, the encryption
 * flag); a truncated archive is any prefix of a good one. Members are deflated with `node:zlib`, and
 * every time stamp is fixed, so an archive is byte-for-byte reproducible.
 */
import { deflateRawSync } from 'node:zlib';

/** How one member is written; every option except `method` makes a hostile member. */
export interface ZipMemberOptions {
  /** `deflate` (default) or `store`. */
  readonly method?: 'deflate' | 'store';
  /** Declare this uncompressed size instead of the true one (both headers). */
  readonly declaredUncompressedSize?: number;
  /** Declare this compressed size instead of the true one (both headers). */
  readonly declaredCompressedSize?: number;
  /** Set general-purpose flag bit 3 and write the sizes in a data descriptor after the data. */
  readonly dataDescriptor?: boolean;
  /** Set general-purpose flag bit 0 (encrypted), with the data left as it is. */
  readonly encryptedFlag?: boolean;
}

export interface ZipMember {
  readonly name: string;
  readonly data: Uint8Array;
  readonly options?: ZipMemberOptions;
}

/** 2026-01-01 00:00 in MS-DOS time and date fields. */
const DOS_TIME = 0;
const DOS_DATE = ((2026 - 1980) << 9) | (1 << 5) | 1;

const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = (value & 1) === 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  return value >>> 0;
});

/** CRC-32 (IEEE 802.3, the ZIP checksum) of `bytes`. */
export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc = ((CRC_TABLE[(crc ^ byte) & 0xff] ?? 0) ^ (crc >>> 8)) >>> 0;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** A ZIP archive of `members`, in order. */
export function zipArchive(members: readonly ZipMember[]): Uint8Array {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const member of members) {
    const options = member.options ?? {};
    const name = Buffer.from(member.name, 'utf8');
    const method = options.method === 'store' ? 0 : 8;
    const body = method === 8 ? deflateRawSync(member.data) : Buffer.from(member.data);
    const crc = crc32(member.data);
    const compressed = options.declaredCompressedSize ?? body.length;
    const size = options.declaredUncompressedSize ?? member.data.length;
    const descriptor = options.dataDescriptor === true;
    const flags = (descriptor ? 0x08 : 0) | (options.encryptedFlag === true ? 0x01 : 0);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(descriptor ? 0 : crc, 14);
    local.writeUInt32LE(descriptor ? 0 : compressed, 18);
    local.writeUInt32LE(descriptor ? 0 : size, 22);
    local.writeUInt16LE(name.length, 26);
    const trailer = Buffer.alloc(descriptor ? 16 : 0);
    if (descriptor) {
      trailer.writeUInt32LE(0x08074b50, 0);
      trailer.writeUInt32LE(crc, 4);
      trailer.writeUInt32LE(compressed, 8);
      trailer.writeUInt32LE(size, 12);
    }
    locals.push(local, name, body, trailer);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(flags, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(DOS_TIME, 12);
    central.writeUInt16LE(DOS_DATE, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(compressed, 20);
    central.writeUInt32LE(size, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);
    offset += local.length + name.length + body.length + trailer.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(members.length, 8);
  end.writeUInt16LE(members.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...locals, directory, end]));
}

/** A ZIP archive of one member. */
export function singleMemberZip(
  name: string,
  data: Uint8Array,
  options: ZipMemberOptions = {},
): Uint8Array {
  return zipArchive([{ name, data, options }]);
}
