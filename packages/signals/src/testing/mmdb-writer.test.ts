import { Reader } from 'mmdb-lib';
import { describe, expect, it } from 'vitest';
import { mmdbValue, writeMmdb, type MmdbSpec } from './mmdb-writer.js';

const EPOCH = new Date('2026-10-01T01:36:12Z');

function reader(
  spec: Partial<MmdbSpec> & Pick<MmdbSpec, 'entries'>,
): Reader<Record<string, unknown>> {
  return new Reader<Record<string, unknown>>(
    writeMmdb({ databaseType: 'OpenVerify-Test', buildEpoch: EPOCH, ...spec }),
  );
}

describe('writeMmdb (C92.3: our own MMDB writer, read back by mmdb-lib)', () => {
  it('writes IPv4 and IPv6 prefixes that the reader finds, with the prefix length', () => {
    const db = reader({
      entries: [
        { network: '198.51.100.0/24', data: { country: { iso_code: 'ZZ' } } },
        { network: '2001:db8::/48', data: { country: { iso_code: 'ZY' } } },
      ],
    });
    expect(db.get('198.51.100.7')).toEqual({ country: { iso_code: 'ZZ' } });
    // mmdb-lib counts an IPv4 lookup's depth from the IPv4 subtree, so the IPv4 length.
    expect(db.getWithPrefixLength('198.51.100.7')[1]).toBe(24);
    expect(db.getWithPrefixLength('2001:db8::1')[1]).toBe(48);
    expect(db.get('2001:db8::1')).toEqual({ country: { iso_code: 'ZY' } });
    expect(db.get('203.0.113.1')).toBeNull();
    expect(db.get('2001:db8:1::1')).toBeNull();
  });

  it('writes the metadata the format asks for', () => {
    const db = reader({
      databaseType: 'OpenVerify-Synthetic-Country',
      languages: ['en'],
      description: { en: 'Synthetic' },
      entries: [{ network: '192.0.2.0/24', data: { a: 1 } }],
    });
    expect(db.metadata).toMatchObject({
      binaryFormatMajorVersion: 2,
      binaryFormatMinorVersion: 0,
      databaseType: 'OpenVerify-Synthetic-Country',
      ipVersion: 6,
      recordSize: 24,
      languages: ['en'],
      description: { en: 'Synthetic' },
    });
    expect(db.metadata.buildEpoch.toISOString()).toBe('2026-10-01T01:36:12.000Z');
  });

  it('lets a more specific prefix win in either order, and the later of two equal prefixes', () => {
    for (const entries of [
      [
        { network: '192.0.2.0/24', data: { v: 'broad' } },
        { network: '192.0.2.16/28', data: { v: 'narrow' } },
      ],
      [
        { network: '192.0.2.16/28', data: { v: 'narrow' } },
        { network: '192.0.2.0/24', data: { v: 'broad' } },
      ],
    ]) {
      const db = reader({ entries });
      expect(db.get('192.0.2.20')).toEqual({ v: 'narrow' });
      expect(db.get('192.0.2.200')).toEqual({ v: 'broad' });
    }
    const db = reader({
      entries: [
        { network: '192.0.2.0/24', data: { v: 'first' } },
        { network: '192.0.2.0/24', data: { v: 'second' } },
      ],
    });
    expect(db.get('192.0.2.1')).toEqual({ v: 'second' });
  });

  it('writes every record size and an IPv4-only tree', () => {
    for (const recordSize of [24, 28, 32] as const) {
      const db = reader({
        recordSize,
        entries: [{ network: '203.0.113.128/25', data: { size: recordSize } }],
      });
      expect(db.get('203.0.113.200'), String(recordSize)).toEqual({ size: recordSize });
      expect(db.metadata.recordSize).toBe(recordSize);
    }
    const v4 = reader({ ipVersion: 4, entries: [{ network: '203.0.113.0/24', data: { v: 4 } }] });
    expect(v4.metadata.ipVersion).toBe(4);
    expect(v4.get('203.0.113.9')).toEqual({ v: 4 });
    expect(() =>
      writeMmdb({
        databaseType: 'x',
        buildEpoch: EPOCH,
        ipVersion: 4,
        entries: [{ network: '2001:db8::/32', data: {} }],
      }),
    ).toThrow(RangeError);
  });

  it('encodes every data type, long strings and big maps', () => {
    const many = Object.fromEntries(
      Array.from({ length: 40 }, (_, index) => [`k${String(index)}`, index]),
    );
    const db = reader({
      entries: [
        {
          network: '192.0.2.0/24',
          data: {
            text: 'x'.repeat(300),
            long: 'y'.repeat(70_000),
            yes: true,
            no: false,
            half: 0.5,
            negative: -7,
            big: 18_446_744_073_709_551_615n,
            huge: 340_282_366_920_938_463_463_374_607_431_768_211_455n,
            small: mmdbValue.uint16(65_535),
            exact: mmdbValue.uint32(4_294_967_295),
            float: mmdbValue.float(1.5),
            double: mmdbValue.double(2),
            signed: mmdbValue.int32(123),
            blob: mmdbValue.bytes(Uint8Array.from([1, 2, 3])),
            list: ['a', 1, [true]],
            many,
            names: { en: 'Example', 'pt-BR': 'Exemplo' },
          },
        },
      ],
    });
    const record = db.get('192.0.2.1') ?? {};
    expect(record.text).toBe('x'.repeat(300));
    expect(record.long).toBe('y'.repeat(70_000));
    expect(record).toMatchObject({
      yes: true,
      no: false,
      half: 0.5,
      negative: -7,
      small: 65_535,
      exact: 4_294_967_295,
      float: 1.5,
      double: 2,
      signed: 123,
      list: ['a', 1, [true]],
      many,
      names: { en: 'Example', 'pt-BR': 'Exemplo' },
    });
    expect(String(record.big)).toBe('18446744073709551615');
    expect(String(record.huge)).toBe('340282366920938463463374607431768211455');
    expect([...(record.blob as Uint8Array)]).toEqual([1, 2, 3]);
  });

  it('writes the same bytes for the same spec, and shares identical records', () => {
    const spec: MmdbSpec = {
      databaseType: 'OpenVerify-Test',
      buildEpoch: EPOCH,
      entries: Array.from({ length: 64 }, (_, index) => ({
        network: `192.0.2.${String(index * 4)}/30`,
        data: { country: { iso_code: 'ZZ', names: { en: 'Example' } } },
      })),
    };
    const first = writeMmdb(spec);
    expect(writeMmdb(spec).equals(first)).toBe(true);
    const distinct = writeMmdb({
      ...spec,
      entries: spec.entries.map((entry, index) => ({ ...entry, data: { n: index } })),
    });
    // One shared record against 64 distinct ones, over the same tree.
    expect(first.length).toBeLessThan(distinct.length);
    expect(new Reader(first).get('192.0.2.200')).toEqual({
      country: { iso_code: 'ZZ', names: { en: 'Example' } },
    });
  });

  it('refuses what the format cannot hold', () => {
    const base = { databaseType: 'x', buildEpoch: EPOCH };
    expect(() => writeMmdb({ ...base, entries: [{ network: '192.0.2.0/0', data: {} }] })).toThrow();
    expect(() => mmdbValue.uint16(65_536)).toThrow(RangeError);
    expect(() => mmdbValue.uint32(-1)).toThrow(RangeError);
    expect(() => mmdbValue.int32(2 ** 31)).toThrow(RangeError);
    expect(() => mmdbValue.uint64(-1n)).toThrow(RangeError);
    expect(() => mmdbValue.uint128(1n << 128n)).toThrow(RangeError);
    expect(() =>
      writeMmdb({ ...base, entries: [{ network: '192.0.2.0/24', data: { n: Number.NaN } }] }),
    ).toThrow(RangeError);
  });
});
