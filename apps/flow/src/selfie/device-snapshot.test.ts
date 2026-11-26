/**
 * C40.4: the device snapshot maps what the browser says about the camera onto the contract's
 * bounded members, and never claims a mirrored image (captures never are).
 */
import { DEVICE_LABEL_MAX_LENGTH, selfieDeviceSnapshotSchema } from '@openverify/contracts';
import { describe, expect, it } from 'vitest';
import { GOLDEN_SELFIE_SUBMIT } from '../testing/flow-fixtures';
import { deviceSnapshot, type CameraTrackLike } from './device-snapshot';

/** The synthetic camera of `contracts/fixtures/flow/selfie-capture-submit.json`. */
function syntheticCamera(overrides: Partial<CameraTrackLike> = {}): CameraTrackLike {
  return {
    label: 'Synthetic Test Camera',
    getSettings: () => ({
      width: 640,
      height: 480,
      frameRate: 30,
      facingMode: 'user',
      resizeMode: 'none',
      deviceId: 'a-device-id-the-snapshot-never-sends',
      groupId: 'a-group-id-the-snapshot-never-sends',
      aspectRatio: 4 / 3,
    }),
    getCapabilities: () => ({
      width: { min: 1, max: 1280 },
      height: { min: 1, max: 720 },
      frameRate: { min: 0, max: 30 },
      facingMode: ['user'],
      deviceId: 'a-device-id-the-snapshot-never-sends',
    }),
    stats: { deliveredFrames: 240, discardedFrames: 2, totalFrames: 242 },
    ...overrides,
  };
}

describe('deviceSnapshot (C40.4)', () => {
  it('maps the camera onto the contract: the golden submit fixture', () => {
    expect(deviceSnapshot(syntheticCamera(), { webdriver: false })).toEqual(
      GOLDEN_SELFIE_SUBMIT.capture?.device,
    );
  });

  it('never claims a mirrored image, and reports webdriver as the browser does', () => {
    const snapshot = deviceSnapshot(syntheticCamera(), { webdriver: true });

    expect(snapshot['image-mirrored']).toBe(false);
    expect(snapshot.webdriver).toBe(true);
    expect(deviceSnapshot(syntheticCamera(), {}).webdriver).toBe(false);
  });

  it('cleans the label as the server does, and leaves out an empty one', () => {
    // A bell, then a right-to-left override around a word: never part of the kept label.
    const bell = String.fromCodePoint(0x07);
    const override = String.fromCodePoint(0x202e);
    const pop = String.fromCodePoint(0x202c);
    const label = `Camera${bell} ${override}evil${pop} ${'x'.repeat(300)}`;

    const cleaned = deviceSnapshot(syntheticCamera({ label }), {}).label ?? '';
    expect(cleaned.startsWith('Camera evil ')).toBe(true);
    expect(Array.from(cleaned)).toHaveLength(DEVICE_LABEL_MAX_LENGTH);
    expect(deviceSnapshot(syntheticCamera({ label: '' }), {})).not.toHaveProperty('label');
  });

  it('leaves out what the browser does not say, or says out of the contract’s bounds', () => {
    const snapshot = deviceSnapshot(
      {
        label: 'Camera',
        getSettings: () => ({
          width: 0,
          height: Number.NaN,
          frameRate: Number.POSITIVE_INFINITY,
          facingMode: 'sideways',
          resizeMode: 'stretch',
        }),
      },
      {},
    );

    expect(snapshot).toEqual({ label: 'Camera', webdriver: false, 'image-mirrored': false });
  });

  it('rounds sizes to whole pixels, and keeps at most four known facing modes', () => {
    const snapshot = deviceSnapshot(
      syntheticCamera({
        getSettings: () => ({ width: 1279.6, height: 720.2, frameRate: 29.97 }),
        getCapabilities: () => ({
          width: { max: 1920.4 },
          facingMode: ['user', 'environment', 'other', 'left', 'right', 'user'],
        }),
        stats: { deliveredFrames: 10.5, discardedFrames: -1, totalFrames: 'many' },
      }),
      {},
    );

    expect(snapshot.settings).toEqual({ width: 1280, height: 720, 'frame-rate': 29.97 });
    expect(snapshot.capabilities).toEqual({
      'width-max': 1920,
      'facing-modes': ['user', 'environment', 'left', 'right'],
    });
    expect(snapshot['frame-stats']).toEqual({ delivered: 11 });
  });

  it('always fits the contract schema', () => {
    const odd: CameraTrackLike[] = [
      { label: '', getSettings: () => ({}) },
      syntheticCamera({ getCapabilities: () => ({}), stats: null }),
      syntheticCamera({ getSettings: () => ({ width: 99_999, frameRate: 5_000 }) }),
    ];

    for (const track of odd) {
      expect(() => selfieDeviceSnapshotSchema.parse(deviceSnapshot(track, {}))).not.toThrow();
    }
  });
});
