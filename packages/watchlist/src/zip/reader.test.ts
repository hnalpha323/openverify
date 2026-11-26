/**
 * C77.2: the single-member ZIP reader. Every archive is written by the test from synthetic bytes;
 * the hostile ones lie about their sizes, names, checksums and flags, hold two members, declare a
 * 1 GiB member, or are cut short.
 */
import { mkdtemp, open, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { WatchlistParseError } from '../parsers/errors.js';
import {
  bytesSource,
  fileSource,
  openSingleMemberZip,
  type RandomAccessSource,
  type SingleMemberZipLimits,
} from './reader.js';
import { writeZip, type ZipWriterMember } from './writer.js';

const LIMITS: SingleMemberZipLimits = {
  memberName: 'SYNTHETIC_LIST.XML',
  maxCompressedBytes: 1_000_000,
  maxInflatedBytes: 10_000_000,
};

/** About 300 KB of synthetic list text, so inflating takes several output chunks. */
const CONTENT = new TextEncoder().encode(
  Array.from(
    { length: 6000 },
    (_, index) => `<entry id="${String(index)}">Synthetic</entry>\n`,
  ).join(''),
);

const member = (overrides: Partial<ZipWriterMember> = {}): ZipWriterMember => ({
  name: LIMITS.memberName,
  content: CONTENT,
  ...overrides,
});

async function inflated(source: RandomAccessSource, limits = LIMITS): Promise<Uint8Array[]> {
  const zip = await openSingleMemberZip(source, limits);
  const chunks: Uint8Array[] = [];
  for await (const chunk of zip.inflate()) {
    chunks.push(chunk);
  }
  return chunks;
}

function joined(chunks: readonly Uint8Array[]): Buffer {
  return Buffer.concat(chunks);
}

/**
 * Whether `bytes` are exactly CONTENT. `toEqual` walks a typed array of this size element by
 * element (about 0.65 s a comparison), which timed out under the full validation's load.
 */
function expectContent(bytes: Buffer): void {
  expect(bytes.length).toBe(CONTENT.length);
  expect(bytes.equals(CONTENT)).toBe(true);
}

async function refusal(run: Promise<unknown>): Promise<WatchlistParseError> {
  try {
    await run;
  } catch (error) {
    expect(error).toBeInstanceOf(WatchlistParseError);
    return error as WatchlistParseError;
  }
  throw new Error('the archive was not refused');
}

describe('openSingleMemberZip', () => {
  it('opens a deflated member and streams exactly its bytes, in several chunks', async () => {
    const archive = writeZip([member()]);
    const zip = await openSingleMemberZip(bytesSource(archive), LIMITS);
    expect(zip).toMatchObject({
      name: LIMITS.memberName,
      method: 'deflate',
      inflatedSize: CONTENT.length,
    });
    expect(zip.compressedSize).toBeLessThan(CONTENT.length);
    const chunks = await inflated(bytesSource(archive));
    expect(chunks.length).toBeGreaterThan(1);
    expectContent(joined(chunks));
  });

  it('opens a stored member, and members written with a data descriptor', async () => {
    for (const archive of [
      writeZip([member({ method: 'stored' })]),
      writeZip([member({ dataDescriptor: true })]),
      writeZip([member({ dataDescriptor: { signature: false } })]),
    ]) {
      expectContent(joined(await inflated(bytesSource(archive))));
    }
  });

  it('reads an archive from an open file', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'openverify-zip-'));
    try {
      const path = join(folder, 'list.zip');
      await writeFile(path, writeZip([member()]));
      const handle = await open(path, 'r');
      try {
        expectContent(joined(await inflated(await fileSource(handle))));
      } finally {
        await handle.close();
      }
    } finally {
      await rm(folder, { recursive: true });
    }
  });

  it('refuses anything but one expected, unencrypted, consistent stored or deflated member', async () => {
    const deflated = deflateRawSync(CONTENT);
    const archives: Record<string, Uint8Array> = {
      'not a ZIP': new TextEncoder().encode('<sanctionsData>not an archive</sanctionsData>'),
      'two members': writeZip([member(), member({ name: 'SECOND.XML' })]),
      'no member': writeZip([]),
      'another name': writeZip([member({ name: 'OTHER.XML' })]),
      'a name in another case': writeZip([member({ name: LIMITS.memberName.toLowerCase() })]),
      encrypted: writeZip([member({ flags: 0x0001 })]),
      'an unsupported method': writeZip([member({ method: 12, data: deflated })]),
      'ZIP64 sizes': writeZip([member({ central: { inflatedSize: 0xffffffff } })]),
      'a ZIP64 locator': writeZip([member()], { zip64Locator: true }),
      'end record counts that disagree': writeZip([member()], { entries: 2 }),
      'a local name that differs': writeZip([member({ local: { name: 'OTHER.XML' } })]),
      'local sizes that differ': writeZip([member({ local: { inflatedSize: 7 } })]),
      'local flags that differ': writeZip([member({ local: { flags: 0x0801 } })]),
      'a descriptor that differs': writeZip([
        member({ dataDescriptor: true, descriptor: { crc32: 1 } }),
      ]),
      'bytes before the member': writeZip([member()], { prefix: new Uint8Array(16) }),
      'bytes between the member and the directory': writeZip([member()], {
        gap: new Uint8Array(16),
      }),
      'a compressed size past the directory': writeZip([
        member({ central: { compressedSize: deflated.length + 40 } }),
      ]),
      'a stored member whose sizes differ': writeZip([
        member({ method: 'stored', central: { compressedSize: CONTENT.length - 1 } }),
      ]),
    };
    const whole = writeZip([member()]);
    archives['a truncated archive'] = whole.subarray(0, Math.floor(whole.length / 2));
    archives['an archive cut before its end record ends'] = whole.subarray(0, whole.length - 3);
    for (const [label, archive] of Object.entries(archives)) {
      const error = await refusal(openSingleMemberZip(bytesSource(archive), LIMITS));
      expect(error.code, label).toBe('zip');
    }
  });

  it('refuses an archive or a declared member over its cap before inflating anything', async () => {
    const gigabyte = writeZip([member({ central: { inflatedSize: 2 ** 30 } })]);
    const declared = await refusal(openSingleMemberZip(bytesSource(gigabyte), LIMITS));
    expect(declared.code).toBe('too_large');
    expect(declared.refusal).toBe('refused_size');
    const big = writeZip([member()]);
    const archive = await refusal(
      openSingleMemberZip(bytesSource(big), { ...LIMITS, maxCompressedBytes: big.length - 1 }),
    );
    expect(archive.code).toBe('too_large');
    const inflatedCap = await refusal(
      openSingleMemberZip(bytesSource(big), { ...LIMITS, maxInflatedBytes: CONTENT.length - 1 }),
    );
    expect(inflatedCap.code).toBe('too_large');
  });

  it('refuses, while inflating, a member that inflates past what it declared, and stops there', async () => {
    const bomb = new Uint8Array(5_000_000);
    const archive = writeZip([
      member({ content: bomb, central: { inflatedSize: 1000 }, local: { inflatedSize: 1000 } }),
    ]);
    const zip = await openSingleMemberZip(bytesSource(archive), LIMITS);
    let yielded = 0;
    const error = await refusal(
      (async () => {
        for await (const chunk of zip.inflate()) {
          yielded += chunk.length;
        }
      })(),
    );
    expect(error.code).toBe('zip');
    expect(yielded).toBeLessThanOrEqual(1000);
  });

  it('refuses, while inflating, too few bytes, a wrong CRC-32 and a corrupt or short stream', async () => {
    const deflated = deflateRawSync(CONTENT);
    const corrupt = Uint8Array.from(deflated);
    corrupt.fill(0xff, 10, 40);
    const archives = {
      'fewer bytes than declared': writeZip([
        member({
          central: { inflatedSize: CONTENT.length + 5 },
          local: { inflatedSize: CONTENT.length + 5 },
        }),
      ]),
      'another CRC-32': writeZip([member({ central: { crc32: 1 }, local: { crc32: 1 } })]),
      'a corrupt stream': writeZip([member({ data: corrupt })]),
      'a stream cut short': writeZip([member({ data: deflated.subarray(0, deflated.length - 9) })]),
      'a stream ending before its bytes do': writeZip([
        member({ data: Uint8Array.from([...deflated, 1, 2, 3, 4]) }),
      ]),
      'a stored member with another CRC-32': writeZip([
        member({ method: 'stored', central: { crc32: 1 }, local: { crc32: 1 } }),
      ]),
    };
    for (const [label, archive] of Object.entries(archives)) {
      const error = await refusal(inflated(bytesSource(archive)));
      expect(error.code, label).toBe('zip');
    }
  });
});

describe('openSingleMemberZip, archives patched at the byte level', () => {
  /** The archive with `patch` applied to a copy; offsets found from the end record. */
  function patched(
    archive: Uint8Array,
    patch: (data: DataView, at: { central: number; end: number }) => void,
  ): Uint8Array {
    const copy = Uint8Array.from(archive);
    const data = new DataView(copy.buffer);
    const end = copy.length - 22;
    patch(data, { central: data.getUint32(end + 16, true), end });
    return copy;
  }

  it('refuses each broken structure with zip', async () => {
    const good = writeZip([member()]);
    const accented = writeZip([member({ name: 'É.XML' })]);
    const archives: Record<string, Uint8Array> = {
      'shorter than an end record': good.subarray(0, 10),
      'a ZIP64 entry count': patched(good, (data, at) => {
        data.setUint16(at.end + 10, 0xffff, true);
      }),
      'another disk': patched(good, (data, at) => {
        data.setUint16(at.end + 4, 1, true);
      }),
      'no central signature': patched(good, (data, at) => {
        data.setUint32(at.central, 0, true);
      }),
      'a directory longer than one entry': writeZip([member(), member({ name: 'SECOND.XML' })], {
        entries: 1,
      }),
      'a member on another disk': patched(good, (data, at) => {
        data.setUint16(at.central + 34, 1, true);
      }),
      'an unflagged name that is not ASCII': patched(accented, (data, at) => {
        data.setUint16(6, 0, true);
        data.setUint16(at.central + 8, 0, true);
      }),
      'a flagged name that is not UTF-8': patched(accented, (data, at) => {
        data.setUint8(30, 0xff);
        data.setUint8(at.central + 46, 0xff);
      }),
      'no local signature': patched(good, (data) => {
        data.setUint32(0, 0, true);
      }),
      'a descriptor of the wrong length': writeZip([member({ dataDescriptor: true })], {
        gap: new Uint8Array(4),
      }),
      'a long descriptor without its signature': writeZip(
        [member({ dataDescriptor: { signature: false } })],
        { gap: new Uint8Array(4) },
      ),
    };
    for (const [label, archive] of Object.entries(archives)) {
      const error = await refusal(openSingleMemberZip(bytesSource(archive), LIMITS));
      expect(error.code, label).toBe('zip');
    }
  });
});
