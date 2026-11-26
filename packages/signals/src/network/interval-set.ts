/**
 * Sorted interval sets over 128-bit keys (plan C92.3): the normalised form of every range and
 * relay source. Entries may overlap and carry different values (AWS's `AMAZON` ranges hold every
 * service's); the set splits them into disjoint, sorted intervals, each with the sorted, distinct
 * values of every entry that covers it, and merges neighbours that carry the same values. A
 * lookup is a binary search. The JSON form is canonical: one input gives one byte sequence,
 * whatever the order of its entries.
 */
import { IPV4_MAPPED_END, IPV4_MAPPED_START, MAX_KEY, hexToKey, keyToHex } from './address.js';
import { canonicalJson } from './canonical.js';
import { NetworkParseError } from './errors.js';

/** One input interval: a closed range of keys and its value. */
export interface IntervalEntry<T> {
  readonly start: bigint;
  readonly end: bigint;
  readonly value: T;
}

/** Addresses covered, per family. */
export interface IntervalCoverage {
  readonly ipv4: bigint;
  readonly ipv6: bigint;
}

/** The canonical JSON form of a set. */
export interface IntervalSetJson<T> {
  readonly values: readonly T[];
  /** `[start hex, end hex, value indexes]`, sorted and disjoint. */
  readonly intervals: readonly (readonly [string, string, readonly number[]])[];
}

/** What changed between two sets, per family (the mass-removal and mass-addition guards). */
export interface FamilyChange {
  readonly previous: bigint;
  readonly next: bigint;
  /** Addresses covered before and not now. */
  readonly removed: bigint;
  /** Addresses covered now and not before. */
  readonly added: bigint;
}

/** The item at an index the caller has checked. */
function itemAt<T>(items: readonly T[], index: number): T {
  const item = items[index];
  if (item === undefined) {
    throw new RangeError('index out of range');
  }
  return item;
}

function refuse(message: string, cause?: unknown): never {
  throw new NetworkParseError('format', `interval set: ${message}`, { cause });
}

/** Addresses of a closed key range in each family. */
function familySizes(start: bigint, end: bigint): { ipv4: bigint; ipv6: bigint } {
  const low = start > IPV4_MAPPED_START ? start : IPV4_MAPPED_START;
  const high = end < IPV4_MAPPED_END ? end : IPV4_MAPPED_END;
  const ipv4 = high >= low ? high - low + 1n : 0n;
  return { ipv4, ipv6: end - start + 1n - ipv4 };
}

function sameIndexes(a: readonly number[], b: readonly number[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

export class IntervalSet<T> {
  readonly #values: readonly T[];
  readonly #starts: readonly bigint[];
  readonly #ends: readonly bigint[];
  readonly #indexes: readonly (readonly number[])[];
  /** Each interval's values, shared between intervals with the same indexes. */
  readonly #answers: readonly (readonly T[])[];

  private constructor(
    values: readonly T[],
    starts: readonly bigint[],
    ends: readonly bigint[],
    indexes: readonly (readonly number[])[],
  ) {
    this.#values = Object.freeze([...values]);
    this.#starts = starts;
    this.#ends = ends;
    this.#indexes = indexes;
    const interned = new Map<string, readonly T[]>();
    this.#answers = indexes.map((list) => {
      const name = list.join(',');
      let answer = interned.get(name);
      if (answer === undefined) {
        answer = Object.freeze(list.map((index) => this.#values[index] as T));
        interned.set(name, answer);
      }
      return answer;
    });
  }

  /** Builds a set from entries in any order. */
  static build<T>(entries: Iterable<IntervalEntry<T>>): IntervalSet<T> {
    const byText = new Map<string, T>();
    const list: { start: bigint; end: bigint; text: string }[] = [];
    for (const entry of entries) {
      if (entry.start < 0n || entry.end > MAX_KEY || entry.end < entry.start) {
        throw new RangeError('an interval is a non-empty range of 128-bit keys');
      }
      const text = canonicalJson(entry.value);
      if (!byText.has(text)) {
        byText.set(text, JSON.parse(text) as T);
      }
      list.push({ start: entry.start, end: entry.end, text });
    }
    const texts = [...byText.keys()].sort();
    const indexOf = new Map(texts.map((text, index) => [text, index]));
    const values = texts.map((text) => byText.get(text) as T);

    // A sweep over the boundaries: +index where an entry starts, -index past where it ends.
    const events = new Map<bigint, { add: number[]; remove: number[] }>();
    const eventAt = (at: bigint) => {
      let event = events.get(at);
      if (event === undefined) {
        event = { add: [], remove: [] };
        events.set(at, event);
      }
      return event;
    };
    for (const { start, end, text } of list) {
      const index = indexOf.get(text) ?? -1;
      eventAt(start).add.push(index);
      if (end < MAX_KEY) {
        eventAt(end + 1n).remove.push(index);
      }
    }
    const boundaries = [...events.keys()].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    const counts = new Map<number, number>();
    const starts: bigint[] = [];
    const ends: bigint[] = [];
    const indexes: number[][] = [];
    boundaries.forEach((at, position) => {
      const event = events.get(at) as { add: number[]; remove: number[] };
      for (const index of event.remove) {
        const count = (counts.get(index) ?? 0) - 1;
        if (count === 0) {
          counts.delete(index);
        } else {
          counts.set(index, count);
        }
      }
      for (const index of event.add) {
        counts.set(index, (counts.get(index) ?? 0) + 1);
      }
      if (counts.size === 0) {
        return;
      }
      const next = boundaries[position + 1];
      const end = next === undefined ? MAX_KEY : next - 1n;
      const active = [...counts.keys()].sort((a, b) => a - b);
      const last = starts.length - 1;
      const lastEnd = ends[last];
      const lastIndexes = indexes[last];
      if (
        lastEnd !== undefined &&
        lastIndexes !== undefined &&
        lastEnd + 1n === at &&
        sameIndexes(lastIndexes, active)
      ) {
        ends[last] = end;
      } else {
        starts.push(at);
        ends.push(end);
        indexes.push(active);
      }
    });
    return new IntervalSet(values, starts, ends, indexes);
  }

  /**
   * Reads a set's JSON form, refusing anything that is not canonical.
   * @throws {NetworkParseError} `format` for an unsorted, overlapping or malformed form.
   */
  static fromJSON<T>(json: unknown, parseValue: (value: unknown) => T): IntervalSet<T> {
    if (typeof json !== 'object' || json === null) {
      refuse('not an object');
    }
    const { values: rawValues, intervals: rawIntervals } = json as Record<string, unknown>;
    if (!Array.isArray(rawValues) || !Array.isArray(rawIntervals)) {
      refuse('values and intervals must be arrays');
    }
    const values: T[] = [];
    let previousText: string | null = null;
    rawValues.forEach((raw: unknown, position) => {
      let text: string;
      let value: T;
      try {
        text = canonicalJson(raw);
        // Kept in its canonical form, as `build` keeps it, so both write the same JSON.
        value = JSON.parse(canonicalJson(parseValue(raw))) as T;
      } catch (error) {
        refuse(`value ${String(position)} is not valid`, error);
      }
      if (previousText !== null && text <= previousText) {
        refuse(`value ${String(position)} is out of canonical order`);
      }
      previousText = text;
      values.push(value);
    });
    const starts: bigint[] = [];
    const ends: bigint[] = [];
    const indexes: number[][] = [];
    const used = new Set<number>();
    rawIntervals.forEach((raw: unknown, position) => {
      const where = `interval ${String(position)}`;
      if (!Array.isArray(raw) || raw.length !== 3) {
        refuse(`${where} is not [start, end, indexes]`);
      }
      const [startHex, endHex, list] = raw as [unknown, unknown, unknown];
      if (typeof startHex !== 'string' || typeof endHex !== 'string' || !Array.isArray(list)) {
        refuse(`${where} is not [start, end, indexes]`);
      }
      const start = hexToKey(startHex);
      const end = hexToKey(endHex);
      if (end < start) {
        refuse(`${where} ends before it starts`);
      }
      const previousEnd = ends[ends.length - 1];
      if (previousEnd !== undefined && start <= previousEnd) {
        refuse(`${where} is out of order or overlaps`);
      }
      if (list.length === 0) {
        refuse(`${where} has no value`);
      }
      const own: number[] = [];
      for (const index of list as unknown[]) {
        const last = own[own.length - 1];
        if (
          !Number.isInteger(index) ||
          (index as number) < 0 ||
          (index as number) >= values.length
        ) {
          refuse(`${where} names no value`);
        }
        if (last !== undefined && (index as number) <= last) {
          refuse(`${where} indexes are not increasing`);
        }
        own.push(index as number);
        used.add(index as number);
      }
      const previousIndexes = indexes[indexes.length - 1];
      if (
        previousEnd !== undefined &&
        previousIndexes !== undefined &&
        previousEnd + 1n === start &&
        sameIndexes(previousIndexes, own)
      ) {
        refuse(`${where} should be merged with its neighbour`);
      }
      starts.push(start);
      ends.push(end);
      indexes.push(own);
    });
    if (used.size !== values.length) {
      refuse('a value is used by no interval');
    }
    return new IntervalSet(values, starts, ends, indexes);
  }

  /** The number of disjoint intervals. */
  get size(): number {
    return this.#starts.length;
  }

  #find(key: bigint): number {
    let low = 0;
    let high = this.#starts.length - 1;
    let found = -1;
    while (low <= high) {
      const middle = (low + high) >>> 1;
      if (itemAt(this.#starts, middle) <= key) {
        found = middle;
        low = middle + 1;
      } else {
        high = middle - 1;
      }
    }
    return found >= 0 && key <= itemAt(this.#ends, found) ? found : -1;
  }

  /** The values of every entry covering the key; empty when none does. */
  lookup(key: bigint): readonly T[] {
    const found = this.#find(key);
    return found < 0 ? EMPTY : itemAt(this.#answers, found);
  }

  /** Whether any entry covers the key. */
  has(key: bigint): boolean {
    return this.#find(key) >= 0;
  }

  /** The disjoint intervals in key order. */
  *intervals(): IterableIterator<{ start: bigint; end: bigint; values: readonly T[] }> {
    for (let index = 0; index < this.#starts.length; index += 1) {
      yield {
        start: itemAt(this.#starts, index),
        end: itemAt(this.#ends, index),
        values: itemAt(this.#answers, index),
      };
    }
  }

  /** Addresses covered, per family. */
  coverage(): IntervalCoverage {
    let ipv4 = 0n;
    let ipv6 = 0n;
    for (let index = 0; index < this.#starts.length; index += 1) {
      const sizes = familySizes(itemAt(this.#starts, index), itemAt(this.#ends, index));
      ipv4 += sizes.ipv4;
      ipv6 += sizes.ipv6;
    }
    return { ipv4, ipv6 };
  }

  toJSON(): IntervalSetJson<T> {
    return {
      values: this.#values,
      intervals: this.#starts.map(
        (start, index) =>
          [
            keyToHex(start),
            keyToHex(itemAt(this.#ends, index)),
            itemAt(this.#indexes, index),
          ] as const,
      ),
    };
  }
}

const EMPTY: readonly never[] = Object.freeze([]);

/** The covered addresses removed and added between two sets, per family. */
export function compareIntervalSets(
  previous: IntervalSet<unknown>,
  next: IntervalSet<unknown>,
): { readonly ipv4: FamilyChange; readonly ipv6: FamilyChange } {
  const before = [...previous.intervals()];
  const after = [...next.intervals()];
  let sharedIpv4 = 0n;
  let sharedIpv6 = 0n;
  let i = 0;
  let j = 0;
  while (i < before.length && j < after.length) {
    const a = before[i] as { start: bigint; end: bigint };
    const b = after[j] as { start: bigint; end: bigint };
    const low = a.start > b.start ? a.start : b.start;
    const high = a.end < b.end ? a.end : b.end;
    if (low <= high) {
      const sizes = familySizes(low, high);
      sharedIpv4 += sizes.ipv4;
      sharedIpv6 += sizes.ipv6;
    }
    if (a.end < b.end) {
      i += 1;
    } else {
      j += 1;
    }
  }
  const was = previous.coverage();
  const now = next.coverage();
  return {
    ipv4: {
      previous: was.ipv4,
      next: now.ipv4,
      removed: was.ipv4 - sharedIpv4,
      added: now.ipv4 - sharedIpv4,
    },
    ipv6: {
      previous: was.ipv6,
      next: now.ipv6,
      removed: was.ipv6 - sharedIpv6,
      added: now.ipv6 - sharedIpv6,
    },
  };
}
