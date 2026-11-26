import { describe, expect, it } from 'vitest';
import { cpuMilliseconds } from '../document/testing.js';
import { MATCHING_INPUT_LIMITS, capDocumentLines, capText } from './limits.js';

describe('MATCHING_INPUT_LIMITS (C58.7)', () => {
  it('caps names at 200, business names at 300, addresses at 500 and pages at 600 x 300', () => {
    expect(MATCHING_INPUT_LIMITS).toEqual({
      name: 200,
      businessName: 300,
      address: 500,
      documentLinesPerPage: 600,
      documentLineLength: 300,
    });
  });
});

describe('capText', () => {
  it('keeps a value within the cap unchanged', () => {
    expect(capText('Ada Lovelace', 200)).toBe('Ada Lovelace');
  });

  it('keeps the first code points of a longer value, never splitting a surrogate pair', () => {
    expect(capText('abcdef', 3)).toBe('abc');
    expect(capText('𝒜𝒝𝒞', 2)).toBe('𝒜𝒝');
  });

  it('caps 100 KB at once', () => {
    const value = 'n'.repeat(100_000);
    expect(
      cpuMilliseconds(() => {
        expect(capText(value, MATCHING_INPUT_LIMITS.name)).toHaveLength(200);
      }),
    ).toBeLessThan(50);
  });

  it('gives an empty string for a non-positive cap', () => {
    expect(capText('abc', 0)).toBe('');
  });
});

describe('capDocumentLines', () => {
  it('keeps at most 600 lines of at most 300 code points', () => {
    const lines = Array.from({ length: 700 }, (_, index) => `${String(index)} ${'x'.repeat(400)}`);
    const capped = capDocumentLines(lines);

    expect(capped).toHaveLength(600);
    expect(capped.every((line) => Array.from(line).length <= 300)).toBe(true);
    expect(capped[0]?.startsWith('0 ')).toBe(true);
  });
});
