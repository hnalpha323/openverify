import { describe, expect, it, vi } from 'vitest';
import {
  CAMERA_ERROR_CODES,
  DEFAULT_CAMERA_CONSTRAINTS,
  requestCamera,
  stopStream,
  toCameraError,
  type MediaDevicesLike,
} from './camera-permission';

/** A stand-in for Chromium's OverconstrainedError, which jsdom does not implement. */
class FakeOverconstrainedError extends Error {
  override readonly name = 'OverconstrainedError';

  constructor(readonly constraint: string) {
    super(`Constraint not satisfied: ${constraint}`);
  }
}

function fakeStream(): MediaStream {
  return { id: 'stream-1', getTracks: () => [] } as unknown as MediaStream;
}

function devicesResolving(
  stream: MediaStream,
): MediaDevicesLike & { getUserMedia: ReturnType<typeof vi.fn> } {
  return { getUserMedia: vi.fn().mockResolvedValue(stream) };
}

function devicesRejecting(error: unknown): MediaDevicesLike {
  return { getUserMedia: vi.fn().mockRejectedValue(error) };
}

describe('requestCamera', () => {
  it('returns the stream when the camera is granted', async () => {
    const stream = fakeStream();
    const mediaDevices = devicesResolving(stream);

    const result = await requestCamera({ mediaDevices });

    expect(result).toEqual({ ok: true, stream });
  });

  it('asks for the front camera without audio by default', async () => {
    const mediaDevices = devicesResolving(fakeStream());

    await requestCamera({ mediaDevices });

    expect(mediaDevices.getUserMedia).toHaveBeenCalledWith(DEFAULT_CAMERA_CONSTRAINTS);
    expect(DEFAULT_CAMERA_CONSTRAINTS).toMatchObject({
      audio: false,
      video: { facingMode: 'user' },
    });
  });

  it('passes caller constraints through', async () => {
    const mediaDevices = devicesResolving(fakeStream());
    const constraints = { audio: false, video: { facingMode: { exact: 'environment' } } };

    await requestCamera({ mediaDevices, constraints });

    expect(mediaDevices.getUserMedia).toHaveBeenCalledWith(constraints);
  });

  it('maps a denied permission to a typed error and keeps the cause', async () => {
    const denied = new DOMException('Permission denied', 'NotAllowedError');

    const result = await requestCamera({ mediaDevices: devicesRejecting(denied) });

    expect(result).toEqual({ ok: false, error: { code: 'permission-denied', cause: denied } });
  });

  it('maps a missing camera to no-camera', async () => {
    const missing = new DOMException('Requested device not found', 'NotFoundError');

    const result = await requestCamera({ mediaDevices: devicesRejecting(missing) });

    expect(result).toEqual({ ok: false, error: { code: 'no-camera', cause: missing } });
  });

  it('maps unsatisfiable constraints and reports which constraint failed', async () => {
    const overconstrained = new FakeOverconstrainedError('facingMode');

    const result = await requestCamera({ mediaDevices: devicesRejecting(overconstrained) });

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'constraints-not-satisfied',
        constraint: 'facingMode',
        cause: overconstrained,
      },
    });
  });

  it('reports unsupported when the browser has no media devices in a secure context', async () => {
    const result = await requestCamera({ mediaDevices: null, isSecureContext: true });

    expect(result).toEqual({ ok: false, error: { code: 'unsupported' } });
  });

  it('reports an insecure context when media devices are hidden because the page is not https', async () => {
    const result = await requestCamera({ mediaDevices: null, isSecureContext: false });

    expect(result).toEqual({ ok: false, error: { code: 'insecure-context' } });
  });

  it('falls back to the browser media devices, which jsdom does not provide', async () => {
    const result = await requestCamera();

    expect(result).toMatchObject({ ok: false, error: { code: 'unsupported' } });
  });
});

describe('toCameraError', () => {
  it.each([
    ['NotAllowedError', 'permission-denied'],
    ['PermissionDeniedError', 'permission-denied'],
    ['SecurityError', 'permission-denied'],
    ['NotFoundError', 'no-camera'],
    ['DevicesNotFoundError', 'no-camera'],
    ['OverconstrainedError', 'constraints-not-satisfied'],
    ['ConstraintNotSatisfiedError', 'constraints-not-satisfied'],
    ['NotReadableError', 'camera-in-use'],
    ['TrackStartError', 'camera-in-use'],
    ['AbortError', 'unknown'],
  ] as const)('maps %s to %s', (name, code) => {
    expect(toCameraError(new DOMException('message', name)).code).toBe(code);
  });

  it('omits the constraint when the browser does not name one', () => {
    expect(toCameraError(new FakeOverconstrainedError(''))).not.toHaveProperty('constraint');
  });

  it.each([
    ['a TypeError', new TypeError('bad constraints')],
    ['a string', 'boom'],
    ['null', null],
    ['an object named after an Object.prototype key', { name: 'constructor' }],
  ])('maps %s to unknown', (_label, error) => {
    expect(toCameraError(error)).toEqual({ code: 'unknown', cause: error });
  });

  it('lists every code it can produce', () => {
    expect([...CAMERA_ERROR_CODES].sort()).toEqual([
      'camera-in-use',
      'constraints-not-satisfied',
      'insecure-context',
      'no-camera',
      'permission-denied',
      'unknown',
      'unsupported',
    ]);
  });
});

describe('stopStream', () => {
  it('stops every track so the camera light turns off', () => {
    const tracks = [{ stop: vi.fn() }, { stop: vi.fn() }];
    const stream = { getTracks: () => tracks } as unknown as MediaStream;

    stopStream(stream);

    for (const track of tracks) {
      expect(track.stop).toHaveBeenCalledTimes(1);
    }
  });
});
