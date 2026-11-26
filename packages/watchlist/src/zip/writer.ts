/**
 * A minimal ZIP writer for synthetic archives: the OFAC parser's tests zip a synthetic enhanced
 * XML file with it, and the ZIP reader's hostile tests use its overrides to write archives that
 * lie (sizes, CRC-32, names, flags) or break the format. Not exported from the package entry: no
 * production path writes a ZIP. Times and dates are zero; nothing else is written.
 */
import { crc32, deflateRawSync } from 'node:zlib';

const LOCAL_SIGNATURE = 0x04034b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const END_SIGNATURE = 0x06054b50;
const DESCRIPTOR_SIGNATURE = 0x08074b50;
const ZIP64_LOCATOR_SIGNATURE = 0x07064b50;
const DATA_DESCRIPTOR_FLAG = 0x0008;
const UTF8_FLAG = 0x0800;

/** Values a member's headers state, each overridable to write a lying archive. */
export interface ZipWriterFields {
  readonly crc32?: number;
  readonly compressedSize?: number;
  readonly inflatedSize?: number;
}

export interface ZipWriterMember {
  readonly name: string;
  readonly content: Uint8Array;
  /** `deflate` by default; a number writes that method id as is. */
  readonly method?: 'stored' | 'deflate' | number;
  /** Extra general-purpose flags (bit 0 marks the member encrypted). */
  readonly flags?: number;
  /** Writes bit 3 with zero sizes in the local header and a descriptor after the data. */
  readonly dataDescriptor?: boolean | { readonly signature: boolean };
  /** The bytes written as the member's data instead of the compressed content. */
  readonly data?: Uint8Array;
  /** Overrides of what the central directory states. */
  readonly central?: ZipWriterFields;
  /** Overrides of what the local header states. */
  readonly local?: ZipWriterFields & { readonly name?: string; readonly flags?: number };
  /** Overrides of what the data descriptor states. */
  readonly descriptor?: ZipWriterFields;
}

export interface ZipWriterOptions {
  /** Bytes before the first local header (a self-extracting stub, say). */
  readonly prefix?: Uint8Array;
  /** Bytes between the last member and the central directory. */
  readonly gap?: Uint8Array;
  /** Writes a ZIP64 end-of-central-directory locator before the end record. */
  readonly zip64Locator?: boolean;
  readonly comment?: string;
  /** Overrides the end record's entry counts. */
  readonly entries?: number;
}

class Bytes {
  private readonly parts: Uint8Array[] = [];
  length = 0;

  u16(value: number): this {
    const part = new Uint8Array(2);
    new DataView(part.buffer).setUint16(0, value, true);
    return this.add(part);
  }

  u32(value: number): this {
    const part = new Uint8Array(4);
    new DataView(part.buffer).setUint32(0, value >>> 0, true);
    return this.add(part);
  }

  add(part: Uint8Array): this {
    this.parts.push(part);
    this.length += part.length;
    return this;
  }

  concat(): Uint8Array {
    const out = new Uint8Array(this.length);
    let offset = 0;
    for (const part of this.parts) {
      out.set(part, offset);
      offset += part.length;
    }
    return out;
  }
}

const METHOD_IDS = { stored: 0, deflate: 8 } as const;

/** Writes a ZIP archive of `members`, in order. */
export function writeZip(
  members: readonly ZipWriterMember[],
  options: ZipWriterOptions = {},
): Uint8Array {
  const encoder = new TextEncoder();
  const out = new Bytes();
  const central = new Bytes();
  if (options.prefix !== undefined) {
    out.add(options.prefix);
  }
  for (const member of members) {
    const method =
      typeof member.method === 'number' ? member.method : METHOD_IDS[member.method ?? 'deflate'];
    const data = member.data ?? (method === 0 ? member.content : deflateRawSync(member.content));
    const actual = {
      crc32: crc32(member.content),
      compressedSize: data.length,
      inflatedSize: member.content.length,
    };
    const descriptor = member.dataDescriptor ?? false;
    const flags =
      UTF8_FLAG | (member.flags ?? 0) | (descriptor === false ? 0 : DATA_DESCRIPTOR_FLAG);
    const name = encoder.encode(member.name);
    const declared = { ...actual, ...member.central };
    const localFields =
      descriptor === false ? declared : { crc32: 0, compressedSize: 0, inflatedSize: 0 };
    const local = { ...localFields, ...member.local };
    const localName = encoder.encode(member.local?.name ?? member.name);
    const offset = out.length;
    out
      .u32(LOCAL_SIGNATURE)
      .u16(20)
      .u16(member.local?.flags ?? flags)
      .u16(method)
      .u16(0)
      .u16(0)
      .u32(local.crc32)
      .u32(local.compressedSize)
      .u32(local.inflatedSize)
      .u16(localName.length)
      .u16(0)
      .add(localName)
      .add(data);
    if (descriptor !== false) {
      const stated = { ...declared, ...member.descriptor };
      if (descriptor === true || descriptor.signature) {
        out.u32(DESCRIPTOR_SIGNATURE);
      }
      out.u32(stated.crc32).u32(stated.compressedSize).u32(stated.inflatedSize);
    }
    central
      .u32(CENTRAL_SIGNATURE)
      .u16(20)
      .u16(20)
      .u16(flags)
      .u16(method)
      .u16(0)
      .u16(0)
      .u32(declared.crc32)
      .u32(declared.compressedSize)
      .u32(declared.inflatedSize)
      .u16(name.length)
      .u16(0)
      .u16(0)
      .u16(0)
      .u16(0)
      .u32(0)
      .u32(offset)
      .add(name);
  }
  if (options.gap !== undefined) {
    out.add(options.gap);
  }
  const centralOffset = out.length;
  out.add(central.concat());
  if (options.zip64Locator === true) {
    out.u32(ZIP64_LOCATOR_SIGNATURE).u32(0).u32(0).u32(0).u32(1);
  }
  const comment = encoder.encode(options.comment ?? '');
  const entries = options.entries ?? members.length;
  out
    .u32(END_SIGNATURE)
    .u16(0)
    .u16(0)
    .u16(entries)
    .u16(entries)
    .u32(central.length)
    .u32(centralOffset)
    .u16(comment.length)
    .add(comment);
  return out.concat();
}
