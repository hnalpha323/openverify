import { describe, expect, it } from 'vitest';
import { VIRTUAL_CAMERA_NAMES, virtualCameraOf } from './virtual-cameras.js';

describe('VIRTUAL_CAMERA_NAMES (C43)', () => {
  it('starts with OBS Virtual Camera, and every entry is verified at a pinned source', () => {
    expect(VIRTUAL_CAMERA_NAMES[0]).toMatchObject({ name: 'OBS Virtual Camera' });
    for (const entry of VIRTUAL_CAMERA_NAMES) {
      expect(entry.name.trim(), entry.name).toBe(entry.name);
      expect(entry.source, entry.name).toMatch(/@ [0-9a-f]{7}/);
    }
    const names = VIRTUAL_CAMERA_NAMES.map((entry) => entry.name.toLowerCase());
    expect(new Set(names).size).toBe(names.length);
    expect(Object.isFrozen(VIRTUAL_CAMERA_NAMES)).toBe(true);
  });

  it('lists no phone-as-webcam app (they have legitimate uses and unverified names)', () => {
    const names = VIRTUAL_CAMERA_NAMES.map((entry) => entry.name.toLowerCase()).join(' ');
    for (const app of ['droidcam', 'camo', 'continuity', 'iriun', 'epoccam']) {
      expect(names).not.toContain(app);
    }
  });
});

describe('virtualCameraOf', () => {
  it.each([
    ['OBS Virtual Camera', 'OBS Virtual Camera'],
    ['  obs virtual camera ', 'OBS Virtual Camera'],
    ['OBS Virtual Camera (2)', 'OBS Virtual Camera'],
    ['Dummy video device (0x0000)', 'Dummy video device (0x'],
  ])('matches %j', (label, name) => {
    expect(virtualCameraOf(label)?.name).toBe(name);
  });

  it.each([
    'FaceTime HD Camera (Built-in)',
    'Integrated Webcam (0bda:58f4)',
    'My OBS Virtual Camera',
    'camera 1, facing front',
    '',
  ])('does not match %j', (label) => {
    expect(virtualCameraOf(label)).toBeNull();
  });
});
