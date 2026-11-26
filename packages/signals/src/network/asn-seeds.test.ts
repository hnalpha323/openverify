import { describe, expect, it } from 'vitest';
import { buildAsnSets, parseBadAsnList, parseX4bnetAsnList } from './asn-seeds.js';
import { NetworkParseError } from './errors.js';

function codeOf(run: () => unknown): string | undefined {
  try {
    run();
  } catch (error) {
    if (error instanceof NetworkParseError) {
      return error.code;
    }
    throw error;
  }
  return undefined;
}

describe('parseX4bnetAsnList (C92.6)', () => {
  it('reads AS numbers with their comments, drops repeats and reports the distinct count', () => {
    const seed = parseX4bnetAsnList(
      Buffer.from(
        'AS64500 # Example Hosting\nAS64501\t# Example # with a hash\nAS64500  # repeated\n\n# a note\nAS65536\n',
      ),
    );
    expect(seed).toEqual({ asns: [64500, 64501, 65536], entries: 4, duplicates: 1 });
  });

  it('refuses anything else, naming the line and no value', () => {
    for (const text of [
      'AS0\n',
      'AS4294967296\n',
      'ASX\n',
      '64500\n',
      'AS64500 trailing\n',
      'as64500\n',
    ]) {
      const code = codeOf(() => parseX4bnetAsnList(text));
      expect(['format', 'asn'], text).toContain(code);
    }
    expect(codeOf(() => parseX4bnetAsnList('AS0\n'))).toBe('asn');
    expect(codeOf(() => parseX4bnetAsnList(Uint8Array.from([0x41, 0x53, 0xff])))).toBe('encoding');
    try {
      parseX4bnetAsnList('AS64500\nAS64501 junk\n');
      expect.unreachable();
    } catch (error) {
      expect(String(error)).toContain('line 2');
      expect(String(error)).not.toContain('64501');
    }
  });
});

describe('parseBadAsnList (C92.6)', () => {
  it('reads the CSV with RFC 4180 quoting and drops repeats', () => {
    const seed = parseBadAsnList(
      'ASN,Entity\n64500,"Example, Hosting ""Quoted"""\n64501,Example Plain\n64500,Again\n',
    );
    expect(seed).toEqual({ asns: [64500, 64501], entries: 3, duplicates: 1 });
  });

  it('refuses a changed header, a third column, an open quote or a bad number', () => {
    for (const text of [
      '64500,Example\n',
      'ASN,Entity,Country\n64500,Example,ZZ\n',
      'ASN,Entity\n64500,Example,ZZ\n',
      'ASN,Entity\n64500,"Example\n',
      'ASN,Entity\nAS64500,Example\n',
      'ASN,Entity\n0,Example\n',
    ]) {
      expect(['format', 'asn'], text).toContain(codeOf(() => parseBadAsnList(text)));
    }
  });
});

describe('buildAsnSets (C93.3)', () => {
  it('unites the hosting seeds less the overrides, and the VPN seed with the overrides', () => {
    const sets = buildAsnSets({
      hosting: [
        { asns: [64500, 64503], entries: 2, duplicates: 0 },
        { asns: [64503, 64504], entries: 2, duplicates: 0 },
      ],
      vpn: [{ asns: [64505], entries: 1, duplicates: 0 }],
      overrides: [
        { asn: 64504, list: 'hosting', action: 'remove' },
        { asn: 65536, list: 'vpn', action: 'add' },
        { asn: 65537, list: 'hosting', action: 'add' },
        { asn: 64505, list: 'vpn', action: 'remove' },
      ],
    });
    expect([...sets.hosting].sort((a, b) => a - b)).toEqual([64500, 64503, 65537]);
    expect([...sets.vpn].sort((a, b) => a - b)).toEqual([65536]);
    expect(buildAsnSets({ hosting: [], vpn: [] })).toEqual({ hosting: new Set(), vpn: new Set() });
  });
});
