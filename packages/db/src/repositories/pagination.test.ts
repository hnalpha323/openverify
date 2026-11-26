import { describe, expect, it } from 'vitest';
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE, pageSize } from './pagination.js';

describe('pageSize', () => {
  it('defaults to 10 and caps at 100, as C1 allows', () => {
    expect(DEFAULT_PAGE_SIZE).toBe(10);
    expect(MAX_PAGE_SIZE).toBe(100);
    expect(pageSize(undefined)).toBe(10);
  });

  it.each([
    [1, 1],
    [25, 25],
    [100, 100],
    [101, 100],
    [0, 1],
    [-5, 1],
    [7.9, 7],
    [Number.NaN, 10],
  ])('maps %d to %d', (input, expected) => {
    expect(pageSize(input)).toBe(expected);
  });
});
