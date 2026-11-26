/**
 * The Tor exit list (plan C92.1, C92.2, C93.3): TorDNSEL's `exit-addresses` format, as published
 * at `check.torproject.org/exit-addresses` and archived hourly by CollecTor (CC0, Tor Metrics).
 * The live format, as the research recorded it on 2026-10-27 (`docs/research/phase7-network-data.md`
 * §3.1-§3.2) and this parser reads it, is one record per relay:
 *
 * ```
 * ExitNode <40 hex digits: the relay fingerprint>
 * Published <YYYY-MM-DD HH:MM:SS: the relay descriptor's publication, UTC>
 * LastStatus <YYYY-MM-DD HH:MM:SS: the last consensus that listed the relay, UTC>
 * ExitAddress <address> <YYYY-MM-DD HH:MM:SS: when TorDNSEL saw the relay exit from it, UTC>
 * ```
 *
 * with one or more `ExitAddress` lines. CollecTor's archived files open with `@type tordnsel 1.0`
 * and `Downloaded <time>`. The publication time is the newest `LastStatus` (C92.2 step 6). The
 * list holds IPv4 exits only; an IPv6 `ExitAddress`, should one appear, is counted and not kept,
 * because the lookup answers `ipv6_not_covered` for every IPv6 address (C93.3).
 */
import { familyOfKey, hexToKey, keyToHex, parseAddress } from './address.js';
import { NetworkParseError } from './errors.js';
import { decodeText, spaceSeparatedUtc, splitLines } from './text.js';

/** The canonical JSON form of an exit set. */
export interface TorExitSetJson {
  readonly format: 'openverify-tor-exits';
  readonly version: 1;
  readonly 'published-at': string | null;
  /** `[key hex, seen at]`, sorted by key. */
  readonly exits: readonly (readonly [string, string])[];
}

const FINGERPRINT = /^[0-9A-Fa-f]{40}$/;
const HOUR_MS = 3_600_000;

function refuseJson(message: string): never {
  throw new NetworkParseError('format', `exit set: ${message}`);
}

/** An ISO time as `toISOString` writes it, or a refusal. */
function canonicalInstant(value: unknown, where: string): Date {
  if (typeof value !== 'string') {
    refuseJson(`${where} is not a time`);
  }
  const at = new Date(value);
  if (Number.isNaN(at.getTime()) || at.toISOString() !== value) {
    refuseJson(`${where} is not a canonical time`);
  }
  return at;
}

/** The exit addresses of one publication, each with the newest time it was seen. */
export class TorExitSet {
  readonly kind = 'tor-exits' as const;
  readonly #keys: readonly bigint[];
  readonly #seen: readonly number[];
  readonly #publishedAt: Date | null;

  private constructor(keys: readonly bigint[], seen: readonly number[], publishedAt: Date | null) {
    this.#keys = keys;
    this.#seen = seen;
    this.#publishedAt = publishedAt;
  }

  /** Builds a set; a key seen twice keeps its newest time. */
  static build(
    entries: Iterable<{ key: bigint; seenAt: Date }>,
    publishedAt: Date | null,
  ): TorExitSet {
    const newest = new Map<bigint, number>();
    for (const { key, seenAt } of entries) {
      if (familyOfKey(key) !== 4) {
        throw new RangeError('the exit set holds IPv4 keys only');
      }
      const at = seenAt.getTime();
      if (Number.isNaN(at)) {
        throw new RangeError('an exit sighting needs a valid time');
      }
      newest.set(key, Math.max(at, newest.get(key) ?? at));
    }
    const keys = [...newest.keys()].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    const seen = keys.map((key) => newest.get(key) ?? 0);
    const dated = publishedAt ?? (seen.length === 0 ? null : new Date(Math.max(...seen)));
    return new TorExitSet(keys, seen, dated);
  }

  /**
   * Reads the canonical JSON form.
   * @throws {NetworkParseError} `format` for anything else.
   */
  static fromJSON(json: unknown): TorExitSet {
    if (typeof json !== 'object' || json === null || Array.isArray(json)) {
      refuseJson('not an object');
    }
    const value = json as Record<string, unknown>;
    if (value.format !== 'openverify-tor-exits' || value.version !== 1) {
      refuseJson('not format openverify-tor-exits version 1');
    }
    const publishedRaw = value['published-at'];
    const publishedAt =
      publishedRaw === null ? null : canonicalInstant(publishedRaw, 'published-at');
    if (!Array.isArray(value.exits)) {
      refuseJson('exits is not an array');
    }
    const keys: bigint[] = [];
    const seen: number[] = [];
    (value.exits as unknown[]).forEach((raw, position) => {
      const where = `exit ${String(position)}`;
      if (!Array.isArray(raw) || raw.length !== 2 || typeof raw[0] !== 'string') {
        refuseJson(`${where} is not [key, seen at]`);
      }
      const [hex, at] = raw as [string, unknown];
      const key = hexToKey(hex);
      if (familyOfKey(key) !== 4) {
        refuseJson(`${where} is not an IPv4 key`);
      }
      const previous = keys[keys.length - 1];
      if (previous !== undefined && key <= previous) {
        refuseJson(`${where} is out of order or repeated`);
      }
      keys.push(key);
      seen.push(canonicalInstant(at, where).getTime());
    });
    return new TorExitSet(keys, seen, publishedAt);
  }

  /** The newest `LastStatus`, else the newest sighting, else `null` for an empty list. */
  get publishedAt(): Date | null {
    return this.#publishedAt === null ? null : new Date(this.#publishedAt.getTime());
  }

  get size(): number {
    return this.#keys.length;
  }

  #find(key: bigint): number {
    let low = 0;
    let high = this.#keys.length - 1;
    while (low <= high) {
      const middle = (low + high) >>> 1;
      const found = this.#keys[middle] ?? 0n;
      if (found === key) {
        return middle;
      }
      if (found < key) {
        low = middle + 1;
      } else {
        high = middle - 1;
      }
    }
    return -1;
  }

  /** When the address was last seen exiting, or `null`. */
  seenAt(key: bigint): Date | null {
    const found = this.#find(key);
    return found < 0 ? null : new Date(this.#seen[found] ?? 0);
  }

  /** C93.3: whether the address was seen within `windowHours` before the publication time. */
  listed(key: bigint, windowHours: number): boolean {
    const found = this.#find(key);
    if (found < 0 || this.#publishedAt === null) {
      return false;
    }
    return (this.#seen[found] ?? 0) >= this.#publishedAt.getTime() - windowHours * HOUR_MS;
  }

  /** Every key, sorted. */
  *keys(): IterableIterator<bigint> {
    yield* this.#keys;
  }

  toJSON(): TorExitSetJson {
    return {
      format: 'openverify-tor-exits',
      version: 1,
      'published-at': this.#publishedAt === null ? null : this.#publishedAt.toISOString(),
      exits: this.#keys.map(
        (key, index) => [keyToHex(key), new Date(this.#seen[index] ?? 0).toISOString()] as const,
      ),
    };
  }
}

/** A parsed exit list. */
export interface TorExitPublication {
  readonly publishedAt: Date | null;
  readonly exits: TorExitSet;
  readonly stats: {
    readonly relays: number;
    readonly addresses: number;
    readonly ignoredIpv6: number;
  };
}

interface RelayRecord {
  published: Date | null;
  lastStatus: Date | null;
  line: number;
}

/**
 * Parses TorDNSEL `exit-addresses`.
 * @throws {NetworkParseError} for anything that is not that format.
 */
export function parseTorExitList(bytes: Uint8Array | string): TorExitPublication {
  const lines = splitLines(decodeText(bytes));
  const sightings: { key: bigint; seenAt: Date }[] = [];
  let relay: RelayRecord | null = null;
  let relays = 0;
  let addresses = 0;
  let ignoredIpv6 = 0;
  let newestStatus: number | null = null;

  const finish = (record: RelayRecord | null) => {
    if (record !== null && (record.published === null || record.lastStatus === null)) {
      throw new NetworkParseError(
        'format',
        `line ${String(record.line)}: a relay without Published or LastStatus`,
      );
    }
  };

  for (const [index, line] of lines.entries()) {
    const where = `line ${String(index + 1)}`;
    if (line === '') {
      continue;
    }
    const space = line.indexOf(' ');
    const keyword = space < 0 ? line : line.slice(0, space);
    const rest = space < 0 ? '' : line.slice(space + 1);
    switch (keyword) {
      case '@type':
      case 'Downloaded': {
        if (relays > 0) {
          throw new NetworkParseError('format', `${where}: a header line after the first relay`);
        }
        if (keyword === '@type' && !/^tordnsel 1\.[0-9]+$/.test(rest)) {
          throw new NetworkParseError('format', `${where}: not a TorDNSEL 1.x file`);
        }
        if (keyword === 'Downloaded') {
          spaceSeparatedUtc(rest, where);
        }
        continue;
      }
      case 'ExitNode': {
        finish(relay);
        if (!FINGERPRINT.test(rest)) {
          throw new NetworkParseError('format', `${where}: not a 40-digit relay fingerprint`);
        }
        relay = { published: null, lastStatus: null, line: index + 1 };
        relays += 1;
        continue;
      }
      case 'Published':
      case 'LastStatus': {
        if (relay === null) {
          throw new NetworkParseError('format', `${where}: ${keyword} outside a relay`);
        }
        const field = keyword === 'Published' ? 'published' : 'lastStatus';
        if (relay[field] !== null) {
          throw new NetworkParseError('format', `${where}: ${keyword} repeated`);
        }
        const at = spaceSeparatedUtc(rest, where);
        relay[field] = at;
        if (field === 'lastStatus') {
          newestStatus = Math.max(newestStatus ?? at.getTime(), at.getTime());
        }
        continue;
      }
      case 'ExitAddress': {
        if (relay?.published == null || relay.lastStatus === null) {
          throw new NetworkParseError(
            'format',
            `${where}: ExitAddress before its relay's Published and LastStatus`,
          );
        }
        const parts = rest.split(' ');
        if (parts.length !== 3) {
          throw new NetworkParseError(
            'format',
            `${where}: not ExitAddress <address> <date> <time>`,
          );
        }
        const [address = '', date = '', time = ''] = parts;
        const parsed = parseAddress(address);
        if (parsed === null) {
          throw new NetworkParseError('address', `${where}: not an address`);
        }
        const seenAt = spaceSeparatedUtc(`${date} ${time}`, where);
        addresses += 1;
        if (parsed.family === 6) {
          ignoredIpv6 += 1;
          continue;
        }
        sightings.push({ key: parsed.key, seenAt });
        continue;
      }
      default:
        throw new NetworkParseError('format', `${where}: an unknown keyword`);
    }
  }
  finish(relay);
  const publishedAt = newestStatus === null ? null : new Date(newestStatus);
  return {
    publishedAt,
    exits: TorExitSet.build(sightings, publishedAt),
    stats: { relays, addresses, ignoredIpv6 },
  };
}

/** The exit addresses removed and added between two sets (the mass-removal guard, C92.2). */
export function compareExitSets(
  previous: TorExitSet,
  next: TorExitSet,
): {
  readonly previous: number;
  readonly next: number;
  readonly removed: number;
  readonly added: number;
} {
  const before = [...previous.keys()];
  const after = [...next.keys()];
  let shared = 0;
  let i = 0;
  let j = 0;
  while (i < before.length && j < after.length) {
    const a = before[i] ?? 0n;
    const b = after[j] ?? 0n;
    if (a === b) {
      shared += 1;
      i += 1;
      j += 1;
    } else if (a < b) {
      i += 1;
    } else {
      j += 1;
    }
  }
  return {
    previous: before.length,
    next: after.length,
    removed: before.length - shared,
    added: after.length - shared,
  };
}
