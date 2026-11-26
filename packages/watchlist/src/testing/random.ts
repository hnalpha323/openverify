/**
 * A seeded pseudo-random stream for the synthetic fixtures (C77.5, C78.8, C89.1): the same seed
 * always gives the same lists, cases and answers, so every fixture is reproducible from its seed
 * and nothing generated needs committing. Never use it for anything secret.
 *
 * The generator is sfc32 (Chris Doty-Humphrey's Small Fast Counter, public domain), its 128-bit
 * state taken from the SHA-256 of the seed, with the first draws discarded as its author advises.
 */
import { createHash } from 'node:crypto';

/** A deterministic stream of choices. */
export interface SeededRandom {
  /** The seed this stream was made from. */
  readonly seed: string;
  /** A float in [0, 1). */
  next(): number;
  /** An integer in [0, max). */
  int(max: number): number;
  /** An integer in [min, max], both included. */
  between(min: number, max: number): number;
  /** `true` with probability `probability`. */
  chance(probability: number): boolean;
  /** One item of a non-empty list. */
  pick<Item>(items: readonly Item[]): Item;
  /** A shuffled copy of a list. */
  shuffle<Item>(items: readonly Item[]): Item[];
  /** `count` distinct positions of a list, in random order (the whole list when it is shorter). */
  sample<Item>(items: readonly Item[], count: number): Item[];
  /** `length` characters drawn from `alphabet`. */
  string(alphabet: string, length: number): string;
  /** `length` bytes. */
  bytes(length: number): Uint8Array;
  /** An independent stream derived from this seed and a label. */
  fork(label: string): SeededRandom;
}

/** Draws discarded after seeding, so nearby seeds diverge at once. */
const WARM_UP_DRAWS = 15;

function sfc32(state: Uint32Array): () => number {
  let [a = 0, b = 0, c = 0, d = 0] = state;
  return () => {
    const t = (((a + b) | 0) + d) | 0;
    d = (d + 1) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    c = (c + t) | 0;
    return (t >>> 0) / 4294967296;
  };
}

/** The stream of a seed. */
export function seededRandom(seed: string): SeededRandom {
  const digest = createHash('sha256').update(`openverify/fixtures/${seed}`, 'utf8').digest();
  const state = new Uint32Array(4);
  for (let index = 0; index < 4; index += 1) {
    state[index] = digest.readUInt32LE(index * 4);
  }
  const draw = sfc32(state);
  for (let index = 0; index < WARM_UP_DRAWS; index += 1) {
    draw();
  }

  const int = (max: number): number => {
    if (!Number.isInteger(max) || max < 1) {
      throw new RangeError('the range is empty');
    }
    return Math.floor(draw() * max);
  };
  const shuffle = <Item>(items: readonly Item[]): Item[] => {
    const copy = [...items];
    for (let index = copy.length - 1; index > 0; index -= 1) {
      const other = int(index + 1);
      const held = copy[index] as Item;
      copy[index] = copy[other] as Item;
      copy[other] = held;
    }
    return copy;
  };

  return {
    seed,
    next: draw,
    int,
    between(min, max) {
      if (max < min) {
        throw new RangeError('the range is empty');
      }
      return min + int(max - min + 1);
    },
    chance(probability) {
      return draw() < probability;
    },
    pick<Item>(items: readonly Item[]): Item {
      if (items.length === 0) {
        throw new RangeError('nothing to pick from');
      }
      return items[int(items.length)] as Item;
    },
    shuffle,
    sample(items, count) {
      return shuffle(items).slice(0, count);
    },
    string(alphabet, length) {
      let text = '';
      for (let index = 0; index < length; index += 1) {
        text += alphabet.charAt(int(alphabet.length));
      }
      return text;
    },
    bytes(length) {
      return Uint8Array.from({ length }, () => int(256));
    },
    fork(label) {
      return seededRandom(`${seed}/${label}`);
    },
  };
}
