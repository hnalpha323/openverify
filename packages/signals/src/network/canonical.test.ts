import { describe, expect, it } from 'vitest';
import { canonicalJson } from './canonical.js';

describe('canonicalJson (C92.3)', () => {
  it('sorts members at every depth and writes no whitespace', () => {
    expect(canonicalJson({ b: [{ z: 1, a: null }], a: 'x', c: true })).toBe(
      '{"a":"x","b":[{"a":null,"z":1}],"c":true}',
    );
    expect(canonicalJson({ skipped: undefined, kept: 0 })).toBe('{"kept":0}');
  });

  it('refuses what JSON cannot hold', () => {
    for (const value of [
      Number.NaN,
      Number.POSITIVE_INFINITY,
      1n,
      () => 1,
      undefined,
      Symbol('x'),
    ]) {
      expect(() => canonicalJson(value), typeof value).toThrow(TypeError);
    }
  });
});
