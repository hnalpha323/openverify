import { describe, expect, it } from 'vitest';
import { perspectiveMap, type Point } from './geometry.js';

const close = (actual: Point, expected: Point) => {
  expect(actual[0]).toBeCloseTo(expected[0], 6);
  expect(actual[1]).toBeCloseTo(expected[1], 6);
};

describe('perspectiveMap', () => {
  it('maps a quad onto the rectified rectangle, corner to corner', () => {
    const quad: [Point, Point, Point, Point] = [
      [100, 50],
      [900, 80],
      [880, 600],
      [120, 560],
    ];
    const map = perspectiveMap(quad, [1000, 630]);
    expect(map).not.toBeNull();
    close(map?.([100, 50]) ?? [0, 0], [0, 0]);
    close(map?.([900, 80]) ?? [0, 0], [1000, 0]);
    close(map?.([880, 600]) ?? [0, 0], [1000, 630]);
    close(map?.([120, 560]) ?? [0, 0], [0, 630]);
  });

  it('scales an axis-aligned quad', () => {
    const map = perspectiveMap(
      [
        [0, 0],
        [200, 0],
        [200, 100],
        [0, 100],
      ],
      [400, 200],
    );
    close(map?.([50, 25]) ?? [0, 0], [100, 50]);
  });

  it('refuses a degenerate quad', () => {
    expect(
      perspectiveMap(
        [
          [0, 0],
          [0, 0],
          [0, 0],
          [0, 0],
        ],
        [400, 200],
      ),
    ).toBeNull();
  });
});
