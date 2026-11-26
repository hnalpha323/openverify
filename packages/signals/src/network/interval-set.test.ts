import { describe, expect, it } from 'vitest';
import { seededRandom, type SeededRandom } from '../testing/random.js';
import { IPV4_MAPPED_START, parseNetwork } from './address.js';
import { NetworkParseError } from './errors.js';
import { IntervalSet, compareIntervalSets, type IntervalEntry } from './interval-set.js';

interface Tag {
  provider: string;
  service: string | null;
}

function entry(
  network: string,
  provider: string,
  service: string | null = null,
): IntervalEntry<Tag> {
  const { start, end } = parseNetwork(network);
  return { start, end, value: { provider, service } };
}

function key(network: string): bigint {
  return parseNetwork(network).start;
}

function parseTag(value: unknown): Tag {
  const tag = value as Tag;
  if (typeof tag.provider !== 'string') {
    throw new TypeError('not a tag');
  }
  return { provider: tag.provider, service: tag.service };
}

function formatCode(run: () => unknown): string | undefined {
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

describe('IntervalSet (C92.3)', () => {
  const aws = [
    entry('198.51.100.0/24', 'aws', 'AMAZON'),
    entry('198.51.100.0/26', 'aws', 'EC2'),
    entry('198.51.100.64/26', 'aws', 'EC2'),
    entry('2001:db8:10::/48', 'aws', 'AMAZON'),
  ];

  it('splits overlapping entries into disjoint intervals with every covering value', () => {
    const set = IntervalSet.build(aws);
    expect(set.lookup(key('198.51.100.5'))).toEqual([
      { provider: 'aws', service: 'AMAZON' },
      { provider: 'aws', service: 'EC2' },
    ]);
    expect(set.lookup(key('198.51.100.200'))).toEqual([{ provider: 'aws', service: 'AMAZON' }]);
    expect(set.lookup(key('203.0.113.1'))).toEqual([]);
    expect(set.has(key('2001:db8:10:ffff::1'))).toBe(true);
    expect(set.has(key('2001:db8:11::'))).toBe(false);
    // The two EC2 /26 halves merge: one interval for 198.51.100.0-127, one for 128-255, one IPv6.
    expect(set.size).toBe(3);
    expect([...set.intervals()].map((interval) => interval.values.length)).toEqual([2, 1, 1]);
  });

  it('counts covered addresses per family', () => {
    expect(IntervalSet.build(aws).coverage()).toEqual({ ipv4: 256n, ipv6: 1n << 80n });
    expect(IntervalSet.build<Tag>([]).coverage()).toEqual({ ipv4: 0n, ipv6: 0n });
  });

  it('writes one canonical JSON form whatever the order of its entries', () => {
    const forward = JSON.stringify(IntervalSet.build(aws));
    const backward = JSON.stringify(IntervalSet.build([...aws].reverse()));
    expect(backward).toBe(forward);
    expect(JSON.parse(forward)).toEqual({
      values: [
        { provider: 'aws', service: 'AMAZON' },
        { provider: 'aws', service: 'EC2' },
      ],
      intervals: [
        ['00000000000000000000ffffc6336400', '00000000000000000000ffffc633647f', [0, 1]],
        ['00000000000000000000ffffc6336480', '00000000000000000000ffffc63364ff', [0]],
        ['20010db8001000000000000000000000', '20010db80010ffffffffffffffffffff', [0]],
      ],
    });
  });

  it('reads back its JSON form and refuses one that is not canonical', () => {
    const json: unknown = JSON.parse(JSON.stringify(IntervalSet.build(aws)));
    const read = IntervalSet.fromJSON(json, parseTag);
    expect(JSON.stringify(read)).toBe(JSON.stringify(json));
    expect(read.lookup(key('198.51.100.1'))).toHaveLength(2);
    const base = json as { values: unknown[]; intervals: [string, string, number[]][] };
    const broken: unknown[] = [
      null,
      { values: base.values },
      { ...base, intervals: [...base.intervals].reverse() },
      { ...base, intervals: [[base.intervals[0]?.[1], base.intervals[0]?.[0], [0]]] },
      { ...base, intervals: [[base.intervals[0]?.[0], base.intervals[0]?.[1], [2]]] },
      { ...base, intervals: [[base.intervals[0]?.[0], base.intervals[0]?.[1], [1, 0]]] },
      { ...base, intervals: [[base.intervals[0]?.[0], base.intervals[0]?.[1], []]] },
      { ...base, intervals: [['zz', base.intervals[0]?.[1], [0]]] },
      { ...base, values: [...base.values].reverse() },
      // Two neighbours with the same values are one interval in the canonical form.
      {
        ...base,
        intervals: [
          ['00000000000000000000ffffc6336400', '00000000000000000000ffffc633647f', [0]],
          ['00000000000000000000ffffc6336480', '00000000000000000000ffffc63364ff', [0]],
        ],
      },
    ];
    for (const value of broken) {
      expect(
        formatCode(() => IntervalSet.fromJSON(value, parseTag)),
        JSON.stringify(value),
      ).toBe('format');
    }
    expect(
      formatCode(() => IntervalSet.fromJSON({ ...base, values: [{ provider: 7 }] }, parseTag)),
    ).toBe('format');
  });

  it('measures removals and additions per family for the mass-change guards (C92.2)', () => {
    const previous = IntervalSet.build(aws);
    const next = IntervalSet.build([
      entry('198.51.100.0/25', 'aws', 'EC2'),
      entry('203.0.113.0/24', 'aws', 'EC2'),
    ]);
    expect(compareIntervalSets(previous, next)).toEqual({
      ipv4: { previous: 256n, next: 384n, removed: 128n, added: 256n },
      ipv6: { previous: 1n << 80n, next: 0n, removed: 1n << 80n, added: 0n },
    });
  });
});

// ---------------------------------------------------------------------------------------------
// Properties, against brute force over a small key window (seeded, so a failure reproduces).

const WINDOW = IPV4_MAPPED_START + 0xc000_0200n; // 192.0.2.0

function randomEntries(random: SeededRandom): IntervalEntry<string>[] {
  return Array.from({ length: random.int(0, 12) }, () => {
    const start = WINDOW + BigInt(random.int(0, 60));
    return {
      start,
      end: start + BigInt(random.int(0, 20)),
      value: random.pick(['a', 'b', 'c', 'd']),
    };
  });
}

function bruteLookup(entries: readonly IntervalEntry<string>[], at: bigint): string[] {
  return [
    ...new Set(entries.filter((e) => e.start <= at && at <= e.end).map((e) => e.value)),
  ].sort();
}

describe('IntervalSet properties (C94.1: property tests)', () => {
  it('answers every key as brute force does, with disjoint sorted maximal intervals', () => {
    const random = seededRandom('interval-set-lookup');
    for (let round = 0; round < 300; round += 1) {
      const entries = randomEntries(random);
      const set = IntervalSet.build(random.shuffle(entries));
      for (let at = WINDOW - 2n; at <= WINDOW + 84n; at += 1n) {
        expect(set.lookup(at), `round ${String(round)}`).toEqual(bruteLookup(entries, at));
      }
      const intervals = [...set.intervals()];
      for (let i = 1; i < intervals.length; i += 1) {
        const before = intervals[i - 1];
        const after = intervals[i];
        if (before === undefined || after === undefined) {
          continue;
        }
        expect(before.end < after.start).toBe(true);
        if (before.end + 1n === after.start) {
          expect(after.values).not.toEqual(before.values);
        }
      }
      const covered = new Set<bigint>();
      for (const e of entries) {
        for (let at = e.start; at <= e.end; at += 1n) {
          covered.add(at);
        }
      }
      expect(set.coverage()).toEqual({ ipv4: BigInt(covered.size), ipv6: 0n });
    }
  });

  it('round-trips its JSON form and gives the same bytes for any order', () => {
    const random = seededRandom('interval-set-json');
    const parse = (value: unknown): string => {
      if (typeof value !== 'string') {
        throw new TypeError('not a string');
      }
      return value;
    };
    for (let round = 0; round < 200; round += 1) {
      const entries = randomEntries(random);
      const text = JSON.stringify(IntervalSet.build(entries));
      expect(JSON.stringify(IntervalSet.build(random.shuffle(entries)))).toBe(text);
      expect(JSON.stringify(IntervalSet.fromJSON(JSON.parse(text), parse))).toBe(text);
    }
  });

  it('counts removals and additions as brute force does', () => {
    const random = seededRandom('interval-set-compare');
    const keys = (entries: readonly IntervalEntry<string>[]): Set<bigint> => {
      const out = new Set<bigint>();
      for (const e of entries) {
        for (let at = e.start; at <= e.end; at += 1n) {
          out.add(at);
        }
      }
      return out;
    };
    for (let round = 0; round < 200; round += 1) {
      const before = randomEntries(random);
      const after = randomEntries(random);
      const a = keys(before);
      const b = keys(after);
      const change = compareIntervalSets(IntervalSet.build(before), IntervalSet.build(after));
      expect(change.ipv4).toEqual({
        previous: BigInt(a.size),
        next: BigInt(b.size),
        removed: BigInt([...a].filter((k) => !b.has(k)).length),
        added: BigInt([...b].filter((k) => !a.has(k)).length),
      });
    }
  });
});
