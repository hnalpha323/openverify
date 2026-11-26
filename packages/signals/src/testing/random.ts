/**
 * A seeded pseudo-random source for the synthetic publisher files and the property tests: the
 * same seed always gives the same sequence, so every fixture is reproducible from its seed
 * (C111.1). It is sfc32 seeded from the SHA-256 of the seed. Not for anything secret.
 */
import { createHash } from 'node:crypto';

/** A deterministic random source. */
export interface SeededRandom {
  /** A float in [0, 1). */
  next(): number;
  /** An integer in [min, max], both inclusive. */
  int(min: number, max: number): number;
  /** A 128-bit integer in [min, max], both inclusive. */
  bigint(min: bigint, max: bigint): bigint;
  /** One element of a non-empty list. */
  pick<T>(items: readonly T[]): T;
  /** A copy of the list in a random order. */
  shuffle<T>(items: readonly T[]): T[];
  /** `count` lowercase hex digits. */
  hex(count: number): string;
}

/** The random source of a seed. */
export function seededRandom(seed: string): SeededRandom {
  const digest = createHash('sha256').update(seed, 'utf8').digest();
  let a = digest.readUInt32BE(0);
  let b = digest.readUInt32BE(4);
  let c = digest.readUInt32BE(8);
  let d = digest.readUInt32BE(12);

  function uint32(): number {
    const t = (((a + b) | 0) + d) | 0;
    d = (d + 1) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    c = (c + t) | 0;
    return t >>> 0;
  }
  // Warm up, as sfc32's authors advise, so near seeds diverge at once.
  for (let i = 0; i < 12; i += 1) {
    uint32();
  }

  function bigint(min: bigint, max: bigint): bigint {
    if (max < min) {
      throw new RangeError('max is below min');
    }
    const span = max - min + 1n;
    const bits = span.toString(2).length;
    // Rejection sampling over the smallest power of two that holds the span: no modulo bias.
    for (;;) {
      let value = 0n;
      for (let drawn = 0; drawn < bits; drawn += 32) {
        value = (value << 32n) | BigInt(uint32());
      }
      value &= (1n << BigInt(bits)) - 1n;
      if (value < span) {
        return min + value;
      }
    }
  }

  return {
    next: () => uint32() / 0x1_0000_0000,
    int(min, max) {
      if (!Number.isSafeInteger(min) || !Number.isSafeInteger(max) || max < min) {
        throw new RangeError('int needs safe integers with min <= max');
      }
      return Number(bigint(BigInt(min), BigInt(max)));
    },
    bigint,
    pick(items) {
      if (items.length === 0) {
        throw new RangeError('cannot pick from an empty list');
      }
      return items[Number(bigint(0n, BigInt(items.length - 1)))] as (typeof items)[number];
    },
    shuffle(items) {
      const out = [...items];
      for (let i = out.length - 1; i > 0; i -= 1) {
        const j = Number(bigint(0n, BigInt(i)));
        [out[i], out[j]] = [out[j] as (typeof out)[number], out[i] as (typeof out)[number]];
      }
      return out;
    },
    hex(count) {
      let out = '';
      while (out.length < count) {
        out += uint32().toString(16).padStart(8, '0');
      }
      return out.slice(0, count);
    },
  };
}
