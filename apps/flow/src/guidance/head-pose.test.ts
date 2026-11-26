/**
 * C41.1 in the browser: the guidance measures the yaw ratio exactly as the vision service does,
 * with the same direction convention (positive is a turn to the user's own left in the raw,
 * unmirrored image).
 */
import { describe, expect, it } from 'vitest';
import golden from '../../../../contracts/fixtures/vision/analyze-selfie.json';
import { yawRatio } from './head-pose';
import type { Point } from './yunet-decode';

/** A frontal face: eyes 40 px apart, the nose `offset` px to the image's right of their middle. */
function face(offset: number): Point[] {
  return [
    [100, 100],
    [140, 100],
    [120 + offset, 125],
    [105, 145],
    [135, 145],
  ];
}

function rotate([x, y]: Point, degrees: number, [cx, cy]: Point = [120, 120]): Point {
  const angle = (degrees * Math.PI) / 180;
  const [dx, dy] = [x - cx, y - cy];
  return [
    cx + dx * Math.cos(angle) - dy * Math.sin(angle),
    cy + dx * Math.sin(angle) + dy * Math.cos(angle),
  ];
}

describe('yawRatio (C41.1)', () => {
  it('is zero for a frontal face', () => {
    expect(yawRatio(face(0))).toBe(0);
  });

  it('is the nose offset over the inter-ocular distance', () => {
    expect(yawRatio(face(4))).toBeCloseTo(0.1, 10);
    expect(yawRatio(face(-6))).toBeCloseTo(-0.15, 10);
  });

  it('grows when the user turns to their own left (the nose moves to the image right)', () => {
    expect(yawRatio(face(8)) ?? Number.NaN).toBeGreaterThan(yawRatio(face(2)) ?? Number.NaN);
  });

  it('flips its sign in a mirrored image', () => {
    const original = face(6);
    const mirrored = (point: Point | undefined): Point => [
      240 - (point?.[0] ?? 0),
      point?.[1] ?? 0,
    ];
    // Mirroring swaps which eye and which mouth corner appear first.
    const flipped: Point[] = [
      mirrored(original[1]),
      mirrored(original[0]),
      mirrored(original[2]),
      mirrored(original[4]),
      mirrored(original[3]),
    ];

    expect(yawRatio(flipped)).toBeCloseTo(-(yawRatio(original) ?? Number.NaN), 10);
  });

  it('does not change when the head rolls', () => {
    const rolled = face(5).map((point) => rotate(point, 25));

    expect(yawRatio(rolled)).toBeCloseTo(0.125, 10);
  });

  it('does not depend on the frame size', () => {
    const scaled = face(5).map(([x, y]): Point => [x * 0.25, y * 0.25]);

    expect(yawRatio(scaled)).toBeCloseTo(0.125, 10);
  });

  it('is null without five points, or when the eyes coincide', () => {
    expect(yawRatio(face(0).slice(0, 4))).toBeNull();
    expect(
      yawRatio([
        [100, 100],
        [100, 100],
        [100, 120],
        [90, 140],
        [110, 140],
      ]),
    ).toBeNull();
  });

  it('reproduces the vision service yaw ratio on the golden selfie poses', () => {
    const poses = Object.values(golden.poses).filter((pose) => pose !== null);
    expect(poses.length).toBeGreaterThan(0);
    for (const pose of poses) {
      const [primary] = pose.faces;
      const landmarks = (primary?.landmarks ?? []).map(
        ([x = Number.NaN, y = Number.NaN]): Point => [x, y],
      );
      expect(yawRatio(landmarks)).toBeCloseTo(pose.head_pose.yaw_ratio, 3);
    }
  });
});
