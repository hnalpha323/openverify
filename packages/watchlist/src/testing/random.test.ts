import { describe, expect, it } from 'vitest';
import { seededRandom } from './random.js';

const draws = (seed: string, count: number): number[] => {
  const random = seededRandom(seed);
  return Array.from({ length: count }, () => random.next());
};

describe('seededRandom', () => {
  it('gives the same stream for the same seed and another for another seed', () => {
    expect(draws('fixtures-6', 20)).toEqual(draws('fixtures-6', 20));
    expect(draws('fixtures-6', 20)).not.toEqual(draws('fixtures-7', 20));
    expect(seededRandom('fixtures-6').seed).toBe('fixtures-6');
  });

  it('draws floats in [0, 1) and integers within their bounds', () => {
    const random = seededRandom('bounds');
    for (let index = 0; index < 2000; index += 1) {
      const float = random.next();
      expect(float).toBeGreaterThanOrEqual(0);
      expect(float).toBeLessThan(1);
      const integer = random.int(7);
      expect(Number.isInteger(integer) && integer >= 0 && integer < 7).toBe(true);
      const between = random.between(3, 5);
      expect([3, 4, 5]).toContain(between);
    }
    const seen = new Set(Array.from({ length: 500 }, () => random.between(1, 3)));
    expect([...seen].sort()).toEqual([1, 2, 3]);
  });

  it('refuses an empty range or list', () => {
    const random = seededRandom('refusals');
    expect(() => random.int(0)).toThrow(RangeError);
    expect(() => random.between(4, 3)).toThrow(RangeError);
    expect(() => random.pick([])).toThrow(RangeError);
  });

  it('answers chance(0) never and chance(1) always', () => {
    const random = seededRandom('chance');
    const draws0 = Array.from({ length: 200 }, () => random.chance(0));
    const draws1 = Array.from({ length: 200 }, () => random.chance(1));
    expect(draws0.every((draw) => !draw)).toBe(true);
    expect(draws1.every(Boolean)).toBe(true);
    const half = Array.from({ length: 2000 }, () => random.chance(0.5)).filter(Boolean).length;
    expect(half).toBeGreaterThan(850);
    expect(half).toBeLessThan(1150);
  });

  it('picks, shuffles and samples without inventing or losing items', () => {
    const random = seededRandom('lists');
    const items = ['a', 'b', 'c', 'd', 'e', 'f'];
    expect(items).toContain(random.pick(items));
    const shuffled = random.shuffle(items);
    expect([...shuffled].sort()).toEqual(items);
    expect(items).toEqual(['a', 'b', 'c', 'd', 'e', 'f']);
    const sample = random.sample(items, 4);
    expect(sample).toHaveLength(4);
    expect(new Set(sample).size).toBe(4);
    expect(random.sample(items, 10)).toHaveLength(6);
  });

  it('draws strings from an alphabet and bytes of a length', () => {
    const random = seededRandom('strings');
    const text = random.string('XYZ', 40);
    expect(text).toMatch(/^[XYZ]{40}$/);
    const bytes = random.bytes(33);
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes).toHaveLength(33);
    expect(new Set(random.bytes(256)).size).toBeGreaterThan(100);
  });

  it('forks independent, reproducible streams', () => {
    const parent = seededRandom('parent');
    const first = parent.fork('names');
    const again = seededRandom('parent').fork('names');
    const other = parent.fork('identifiers');
    const a = Array.from({ length: 10 }, () => first.next());
    expect(Array.from({ length: 10 }, () => again.next())).toEqual(a);
    expect(Array.from({ length: 10 }, () => other.next())).not.toEqual(a);
    expect(first.seed).toBe('parent/names');
  });
});
