import { describe, expect, it } from 'vitest';
import { CREATED_AT, cameraCapture } from '../testing/selfie.js';
import {
  CAPTURE_TIMING_FLAGS,
  CAPTURE_TIMING_RULES,
  captureDeviceFlags,
  captureTimingFlags,
  isFilePathLabel,
  orientedYawRatio,
  promptOrderFollowed,
} from './capture-signals.js';
import type { SelfiePromptTimingInput } from './inputs.js';

const at = (ms: number) => new Date(CREATED_AT.getTime() + ms);

describe('isFilePathLabel', () => {
  it.each([
    '/home/ci/fixtures/generated/selfie-a.y4m',
    '/tmp/clip.mjpeg',
    'C:\\clips\\selfie.mjpeg',
    'd:/clips/selfie.y4m',
    '\\\\server\\share\\clip.y4m',
    'file:///tmp/clip.y4m',
    '~/clips/selfie.mjpg',
    'selfie-a.y4m',
  ])('treats %j as a file path', (label) => {
    expect(isFilePathLabel(label)).toBe(true);
  });

  it.each([
    'FaceTime HD Camera (Built-in)',
    'Integrated Webcam (0bda:58f4)',
    'OBS Virtual Camera',
    'camera 1, facing front',
    '0',
    'fake_device_0',
    'HD Pro Webcam C920/C922',
    '',
  ])('does not treat %j as a file path', (label) => {
    expect(isFilePathLabel(label)).toBe(false);
  });
});

describe('captureDeviceFlags', () => {
  it('is null without a snapshot (integrity is then not executed)', () => {
    expect(captureDeviceFlags(null)).toBeNull();
    expect(captureDeviceFlags(undefined)).toBeNull();
  });

  it('reads an empty snapshot as no signal', () => {
    expect(captureDeviceFlags({})).toEqual({
      labelIsFilePath: false,
      virtualCamera: false,
      webdriver: false,
      imageMirrored: false,
    });
  });

  it('flags a file-path label, a virtual camera, webdriver and a mirrored image, keeping no label', () => {
    const fileBacked = captureDeviceFlags({
      label: '/home/ci/fixtures/generated/selfie-a.y4m',
      webdriver: true,
      'image-mirrored': true,
    });
    expect(fileBacked).toEqual({
      labelIsFilePath: true,
      virtualCamera: false,
      webdriver: true,
      imageMirrored: true,
    });
    expect(captureDeviceFlags({ label: 'OBS Virtual Camera' })).toMatchObject({
      labelIsFilePath: false,
      virtualCamera: true,
    });
    expect(Object.values(fileBacked ?? {}).every((value) => typeof value === 'boolean')).toBe(true);
  });
});

describe('orientedYawRatio', () => {
  it('keeps the unmirrored sign and flips a mirrored one (C41.1)', () => {
    expect(orientedYawRatio(0.12, false)).toBe(0.12);
    expect(orientedYawRatio(0.12, true)).toBe(-0.12);
    expect(orientedYawRatio(-0.05, true)).toBe(0.05);
    expect(Object.is(orientedYawRatio(0, true), 0)).toBe(true);
  });
});

describe('promptOrderFollowed', () => {
  const timing = (pose: 'center' | 'left' | 'right', ms: number): SelfiePromptTimingInput => ({
    pose,
    clientElapsedMs: ms,
    receivedAt: at(ms + 300),
  });

  it('is true when the files arrived in prompt order', () => {
    expect(
      promptOrderFollowed(
        ['center', 'right', 'left'],
        [timing('left', 9000), timing('center', 2000), timing('right', 5000)],
      ),
    ).toBe(true);
  });

  it('is false when a later prompt arrived first, or two arrived at once', () => {
    expect(
      promptOrderFollowed(
        ['center', 'right', 'left'],
        [timing('center', 2000), timing('left', 4000), timing('right', 6000)],
      ),
    ).toBe(false);
    expect(
      promptOrderFollowed(['center', 'left'], [timing('center', 2000), timing('left', 2000)]),
    ).toBe(false);
  });

  it('judges the prompted poses that have a timing, and is null without any', () => {
    expect(
      promptOrderFollowed(['center', 'left', 'right'], [timing('center', 1), timing('right', 9)]),
    ).toBe(true);
    expect(promptOrderFollowed(['center'], [timing('left', 5)])).toBeNull();
    expect(promptOrderFollowed(['center', 'left'], [])).toBeNull();
  });
});

describe('captureTimingFlags', () => {
  it('raises nothing for a capture uploaded pose by pose', () => {
    expect(captureTimingFlags(cameraCapture())).toEqual([]);
  });

  it('names a prompted pose without a timing, and a timing without the client clock', () => {
    const capture = cameraCapture();
    expect(
      captureTimingFlags({ ...capture, promptTimings: capture.promptTimings.slice(0, 2) }),
    ).toEqual(['timing-missing']);
    expect(
      captureTimingFlags({
        ...capture,
        promptTimings: capture.promptTimings.map((entry, index) =>
          index === 1 ? { ...entry, clientElapsedMs: null } : entry,
        ),
      }),
    ).toEqual(['client-elapsed-missing']);
  });

  it('flags a client clock that does not increase in prompt order', () => {
    const capture = cameraCapture();
    expect(
      captureTimingFlags({
        ...capture,
        promptTimings: [
          { pose: 'center', clientElapsedMs: 2100, receivedAt: at(2400) },
          { pose: 'right', clientElapsedMs: 1900, receivedAt: at(5700) },
          { pose: 'left', clientElapsedMs: 8800, receivedAt: at(9100) },
        ],
      }),
    ).toEqual(['client-elapsed-not-increasing']);
  });

  it('flags uploads closer together than a person can turn and hold, from the capture on', () => {
    const fast = CAPTURE_TIMING_RULES.minPoseIntervalMs - 1;
    const capture = cameraCapture({
      promptTimings: [
        { pose: 'center', clientElapsedMs: 10, receivedAt: at(fast) },
        { pose: 'right', clientElapsedMs: 3000, receivedAt: at(3000) },
        { pose: 'left', clientElapsedMs: 6000, receivedAt: at(6000) },
      ],
    });
    expect(captureTimingFlags(capture)).toEqual(['uploads-batched']);
    expect(
      captureTimingFlags(
        cameraCapture({
          promptTimings: [
            { pose: 'center', clientElapsedMs: 2000, receivedAt: at(2000) },
            { pose: 'right', clientElapsedMs: 2100, receivedAt: at(2000 + fast) },
            { pose: 'left', clientElapsedMs: 6000, receivedAt: at(6000) },
          ],
        }),
      ),
    ).toEqual(['uploads-batched']);
  });

  it('flags a client interval the server clock contradicts beyond upload latency', () => {
    const skew = CAPTURE_TIMING_RULES.maxClockSkewMs + 1;
    expect(
      captureTimingFlags(
        cameraCapture({
          promptTimings: [
            { pose: 'center', clientElapsedMs: 2000, receivedAt: at(2000) },
            { pose: 'right', clientElapsedMs: 3000 + skew, receivedAt: at(3000) },
            { pose: 'left', clientElapsedMs: 9000 + skew, receivedAt: at(9000) },
          ],
        }),
      ),
    ).toEqual(['client-server-skew']);
  });

  it('flags a file received outside the capture window', () => {
    const capture = cameraCapture();
    expect(
      captureTimingFlags({
        ...capture,
        promptTimings: capture.promptTimings.map((entry, index) =>
          index === 2 ? { ...entry, receivedAt: new Date(capture.expiresAt.getTime() + 1) } : entry,
        ),
      }),
    ).toContain('received-outside-window');
  });

  it('lists each flag once, in CAPTURE_TIMING_FLAGS order', () => {
    const flags = captureTimingFlags(
      cameraCapture({
        promptTimings: [
          { pose: 'center', clientElapsedMs: null, receivedAt: at(10) },
          { pose: 'right', clientElapsedMs: null, receivedAt: at(20) },
        ],
      }),
    );
    expect(flags).toEqual(['timing-missing', 'client-elapsed-missing', 'uploads-batched']);
    expect(
      [...flags].sort((a, b) => CAPTURE_TIMING_FLAGS.indexOf(a) - CAPTURE_TIMING_FLAGS.indexOf(b)),
    ).toEqual(flags);
  });
});
