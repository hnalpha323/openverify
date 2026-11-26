import { describe, expect, it } from 'vitest';
import { parseAddress } from './address.js';
import { NetworkParseError } from './errors.js';
import { TorExitSet, compareExitSets, parseTorExitList } from './tor-exit-list.js';

const FINGERPRINT_A = 'A'.repeat(40);
const FINGERPRINT_B = '0123456789ABCDEF0123456789ABCDEF01234567';

function key(text: string): bigint {
  const parsed = parseAddress(text);
  if (parsed === null) {
    throw new Error('test address does not parse');
  }
  return parsed.key;
}

/** One TorDNSEL record, written as the format lays it out. */
function record(
  fingerprint: string,
  published: string,
  lastStatus: string,
  ...exits: string[]
): string {
  return [
    `ExitNode ${fingerprint}`,
    `Published ${published}`,
    `LastStatus ${lastStatus}`,
    ...exits.map((exit) => `ExitAddress ${exit}`),
  ].join('\n');
}

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

const LIST = `${[
  record(
    FINGERPRINT_A,
    '2026-10-27 09:39:26',
    '2026-10-27 16:00:00',
    '192.0.2.10 2026-10-27 16:06:37',
    '198.51.100.7 2026-10-25 08:00:00',
  ),
  record(
    FINGERPRINT_B,
    '2026-10-27 10:00:00',
    '2026-10-27 15:00:00',
    '192.0.2.10 2026-10-26 11:00:00',
  ),
].join('\n')}\n`;

describe('parseTorExitList (C92.3: TorDNSEL exit-addresses)', () => {
  it('reads every record, keeps each address once at its newest sighting, and dates the list', () => {
    const publication = parseTorExitList(Buffer.from(LIST));
    expect(publication.publishedAt?.toISOString()).toBe('2026-10-27T16:00:00.000Z');
    expect(publication.stats).toEqual({ relays: 2, addresses: 3, ignoredIpv6: 0 });
    expect(publication.exits.size).toBe(2);
    expect(publication.exits.publishedAt?.toISOString()).toBe('2026-10-27T16:00:00.000Z');
    expect(publication.exits.seenAt(key('192.0.2.10'))?.toISOString()).toBe(
      '2026-10-27T16:06:37.000Z',
    );
    expect(publication.exits.seenAt(key('203.0.113.1'))).toBeNull();
    expect([...publication.exits.keys()]).toEqual([key('192.0.2.10'), key('198.51.100.7')]);
  });

  it('lists an address only within the window before the publication time (C93.3: 24 h)', () => {
    const { exits } = parseTorExitList(LIST);
    expect(exits.listed(key('192.0.2.10'), 24)).toBe(true);
    // Seen 2026-10-25 08:00, 56 h before the newest LastStatus.
    expect(exits.listed(key('198.51.100.7'), 24)).toBe(false);
    expect(exits.listed(key('198.51.100.7'), 56)).toBe(true);
    expect(exits.listed(key('203.0.113.1'), 24)).toBe(false);
  });

  it("accepts CollecTor's header lines and CRLF line ends", () => {
    const archived = `@type tordnsel 1.0\nDownloaded 2026-10-27 16:12:01\n${LIST}`.replaceAll(
      '\n',
      '\r\n',
    );
    expect(parseTorExitList(archived).stats.relays).toBe(2);
  });

  it('counts an IPv6 exit and keeps it out, because IPv6 is never covered (C93.3)', () => {
    const list = record(
      FINGERPRINT_A,
      '2026-10-27 09:39:26',
      '2026-10-27 16:00:00',
      '2001:db8::1 2026-10-27 16:00:01',
    );
    const publication = parseTorExitList(list);
    expect(publication.stats).toEqual({ relays: 1, addresses: 1, ignoredIpv6: 1 });
    expect(publication.exits.size).toBe(0);
  });

  it('dates an empty list null', () => {
    const publication = parseTorExitList('');
    expect(publication.publishedAt).toBeNull();
    expect(publication.exits.publishedAt).toBeNull();
    expect(publication.exits.size).toBe(0);
  });

  it('refuses anything that is not the format, naming no value', () => {
    const cases: [string, string | Uint8Array][] = [
      ['format', 'ExitAddress 192.0.2.10 2026-10-27 16:06:37\n'],
      [
        'format',
        `${record(FINGERPRINT_A, '2026-10-27 09:39:26', '2026-10-27 16:00:00')}\nNickname relay\n`,
      ],
      [
        'format',
        record(
          'A'.repeat(39),
          '2026-10-27 09:39:26',
          '2026-10-27 16:00:00',
          '192.0.2.10 2026-10-27 16:06:37',
        ),
      ],
      [
        'format',
        `ExitNode ${FINGERPRINT_A}\nPublished 2026-10-27 09:39:26\nExitAddress 192.0.2.10 2026-10-27 16:06:37\n`,
      ],
      [
        'format',
        `${record(FINGERPRINT_A, '2026-10-27 09:39:26', '2026-10-27 16:00:00')}\nLastStatus 2026-10-27 16:00:00\n`,
      ],
      ['format', record(FINGERPRINT_A, '2026-10-27 09:39:26', '2026-10-27 16:00:00', '192.0.2.10')],
      [
        'time',
        record(
          FINGERPRINT_A,
          '2026-02-30 09:39:26',
          '2026-10-27 16:00:00',
          '192.0.2.10 2026-10-27 16:06:37',
        ),
      ],
      [
        'time',
        record(
          FINGERPRINT_A,
          '2026-10-27 09:39',
          '2026-10-27 16:00:00',
          '192.0.2.10 2026-10-27 16:06:37',
        ),
      ],
      [
        'address',
        record(
          FINGERPRINT_A,
          '2026-10-27 09:39:26',
          '2026-10-27 16:00:00',
          '192.0.2.300 2026-10-27 16:06:37',
        ),
      ],
      ['encoding', Uint8Array.from([0x45, 0x78, 0xff, 0xfe])],
    ];
    for (const [code, input] of cases) {
      expect(
        codeOf(() => parseTorExitList(input)),
        String(input),
      ).toBe(code);
    }
    try {
      parseTorExitList(
        record(FINGERPRINT_A, '2026-10-27 09:39:26', '2026-10-27 16:00:00', '203.0.113.300 x'),
      );
      expect.unreachable();
    } catch (error) {
      expect(String(error)).not.toContain('203.0.113');
      expect(String(error)).toContain('line 4');
    }
  });
});

describe('TorExitSet (C92.3: the normalised snapshot)', () => {
  it('writes one canonical JSON form whatever the order, and reads it back', () => {
    const at = new Date('2026-10-27T16:00:00Z');
    const entries = [
      { key: key('198.51.100.7'), seenAt: new Date('2026-10-27T10:00:00Z') },
      { key: key('192.0.2.10'), seenAt: new Date('2026-10-27T09:00:00Z') },
      { key: key('192.0.2.10'), seenAt: new Date('2026-10-27T11:00:00Z') },
    ];
    const forward = JSON.stringify(TorExitSet.build(entries, at));
    expect(JSON.stringify(TorExitSet.build([...entries].reverse(), at))).toBe(forward);
    expect(JSON.parse(forward)).toEqual({
      format: 'openverify-tor-exits',
      version: 1,
      'published-at': '2026-10-27T16:00:00.000Z',
      exits: [
        ['00000000000000000000ffffc000020a', '2026-10-27T11:00:00.000Z'],
        ['00000000000000000000ffffc6336407', '2026-10-27T10:00:00.000Z'],
      ],
    });
    const read = TorExitSet.fromJSON(JSON.parse(forward));
    expect(JSON.stringify(read)).toBe(forward);
    expect(read.listed(key('192.0.2.10'), 24)).toBe(true);
  });

  it('dates a set without a publication time by its newest sighting', () => {
    const set = TorExitSet.build(
      [{ key: key('192.0.2.10'), seenAt: new Date('2026-10-27T11:00:00Z') }],
      null,
    );
    expect(set.publishedAt?.toISOString()).toBe('2026-10-27T11:00:00.000Z');
  });

  it('refuses a JSON form that is not canonical', () => {
    const good = JSON.parse(
      JSON.stringify(
        TorExitSet.build(
          [
            { key: key('192.0.2.10'), seenAt: new Date('2026-10-27T11:00:00Z') },
            { key: key('192.0.2.11'), seenAt: new Date('2026-10-27T11:00:00Z') },
          ],
          new Date('2026-10-27T12:00:00Z'),
        ),
      ),
    ) as { exits: unknown[] };
    for (const bad of [
      null,
      { ...good, format: 'other' },
      { ...good, version: 2 },
      { ...good, exits: [...good.exits].reverse() },
      { ...good, exits: [good.exits[0], good.exits[0]] },
      { ...good, exits: [['zz', '2026-10-27T11:00:00.000Z']] },
      { ...good, exits: [['00000000000000000000ffffc000020a', 'yesterday']] },
      { ...good, 'published-at': 'soon' },
      // An IPv6 key: the set holds IPv4 only.
      { ...good, exits: [['20010db8000000000000000000000001', '2026-10-27T11:00:00.000Z']] },
    ]) {
      expect(
        codeOf(() => TorExitSet.fromJSON(bad)),
        JSON.stringify(bad),
      ).toBe('format');
    }
  });

  it('counts removals and additions for the mass-removal guard (C92.2)', () => {
    const seen = new Date('2026-10-27T11:00:00Z');
    const before = TorExitSet.build(
      ['192.0.2.1', '192.0.2.2', '192.0.2.3', '192.0.2.4'].map((text) => ({
        key: key(text),
        seenAt: seen,
      })),
      seen,
    );
    const after = TorExitSet.build(
      ['192.0.2.3', '192.0.2.4', '192.0.2.5'].map((text) => ({ key: key(text), seenAt: seen })),
      seen,
    );
    expect(compareExitSets(before, after)).toEqual({ previous: 4, next: 3, removed: 2, added: 1 });
  });
});
