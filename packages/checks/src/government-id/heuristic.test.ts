import { describe, expect, it } from 'vitest';
import { marginConfidence } from './heuristic.js';

describe('marginConfidence', () => {
  it.each([
    [0.5, 0.5, 0],
    [1, 0.5, 1],
    [0, 0.5, 1],
    [0.75, 0.5, 0.5],
    [0.25, 0.5, 0.5],
    [0.1, 0.3, 0.6667],
    [0, 0, 1],
    [1, 1, 0],
    [1.2, 0.5, 1],
    [-0.2, 0.5, 1],
  ])('gives a score of %d against %d a confidence of %d', (score, threshold, expected) => {
    expect(marginConfidence(score, threshold)).toBe(expected);
  });
});
