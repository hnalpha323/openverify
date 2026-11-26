/**
 * Phase 12A F1, F2 (Workflow 12A capture-12a): a document photo is taken at the camera's full
 * resolution (the `ImageCapture` still where the browser has one, else the stream asked for its
 * maximum), and re-encoded through a canvas as a JPEG at 0.92, its long side at most 4096 px,
 * under the 10 MiB upload limit, with no EXIF or other metadata segment left in its bytes.
 */
import { MAX_UPLOAD_BYTES } from '@openverify/contracts';
import { describe, expect, it, vi, type Mock } from 'vitest';
import { CaptureFrameError } from './capture-frame';
import {
  DOCUMENT_MAX_SIDE_PX,
  DOCUMENT_PHOTO_QUALITY,
  DOCUMENT_STREAM_IDEAL,
  captureDocumentPhoto,
  documentCameraConstraints,
  encodeDocumentPhoto,
  jpegMarkers,
  maximizeResolution,
  stripJpegMetadata,
  type DocumentCanvas,
  type ImageCaptureLike,
} from './document-photo';

const SOI = [0xff, 0xd8];
const EOI = [0xff, 0xd9];

/** A JPEG-shaped byte string: SOI, the given segments, a scan with `scan` bytes, EOI. */
function jpeg(
  segments: readonly (readonly [number, number[]])[],
  scan = 4,
): Uint8Array<ArrayBuffer> {
  const bytes: number[] = [...SOI];
  for (const [marker, body] of segments) {
    const length = body.length + 2;
    bytes.push(0xff, marker, length >> 8, length & 0xff, ...body);
  }
  // SOS with a 2-byte header body, then entropy-coded data with a stuffed 0xFF00.
  bytes.push(0xff, 0xda, 0x00, 0x04, 0x01, 0x00);
  for (let i = 0; i < scan; i += 1) {
    bytes.push(i % 2 === 0 ? 0xff : 0x12, i % 2 === 0 ? 0x00 : 0x34);
  }
  bytes.push(...EOI);
  return Uint8Array.from(bytes);
}

const ascii = (text: string) => Array.from(new TextEncoder().encode(text));
const JFIF: readonly [number, number[]] = [0xe0, [...ascii('JFIF\0'), 1, 1, 0, 0, 1, 0, 1, 0, 0]];
const EXIF: readonly [number, number[]] = [0xe1, [...ascii('Exif\0\0'), ...ascii('MM\0*GPS')]];
const XMP: readonly [number, number[]] = [0xe1, ascii('http://ns.adobe.com/xap/1.0/\0<x/>')];
const ICC: readonly [number, number[]] = [0xe2, [...ascii('ICC_PROFILE\0'), 1, 1]];
const IPTC: readonly [number, number[]] = [0xed, ascii('Photoshop 3.0\0')];
const COMMENT: readonly [number, number[]] = [0xfe, ascii('a comment')];
const DQT: readonly [number, number[]] = [0xdb, [0, ...Array.from({ length: 64 }, () => 3)]];

async function bytesOf(blob: Blob): Promise<Uint8Array<ArrayBuffer>> {
  return new Uint8Array(await blob.arrayBuffer());
}

interface FakeCanvasOptions {
  /** The encoded size the fake reports for a canvas of this size at this quality. */
  readonly sizeOf?: (width: number, height: number, quality: number) => number;
  readonly withExif?: boolean;
  readonly context?: boolean;
  readonly pixels?: (width: number, height: number) => Uint8ClampedArray;
}

interface FakeCanvas {
  readonly canvas: DocumentCanvas;
  readonly drawImage: Mock<(...args: unknown[]) => void>;
  readonly toBlob: Mock<(callback: BlobCallback, type?: string, quality?: number) => void>;
}

/** Canvases that record each draw and "encode" a JPEG of the size `sizeOf` says. */
function fakeCanvases(options: FakeCanvasOptions = {}) {
  const canvases: FakeCanvas[] = [];
  const create = (): DocumentCanvas => {
    const drawImage = vi.fn<(...args: unknown[]) => void>();
    const context = {
      drawImage,
      getImageData: (_x: number, _y: number, width: number, height: number) => ({
        data: options.pixels?.(width, height) ?? new Uint8ClampedArray(width * height * 4),
        width,
        height,
      }),
    } as unknown as CanvasRenderingContext2D;
    const canvas: DocumentCanvas = {
      width: 0,
      height: 0,
      getContext: () => (options.context === false ? null : context),
      toBlob: (...args) => {
        toBlob(...args);
      },
    };
    const toBlob = vi.fn((callback: BlobCallback, type?: string, quality?: number) => {
      const head = jpeg(options.withExif === false ? [JFIF, DQT] : [JFIF, EXIF, DQT]);
      const size = options.sizeOf?.(canvas.width, canvas.height, quality ?? 1) ?? head.length;
      const body = new Uint8Array(Math.max(head.length, size));
      body.set(head.subarray(0, head.length - 2));
      body.set(EOI, body.length - 2);
      callback(new Blob([body], { type: type ?? 'image/png' }));
    });
    canvases.push({ canvas, drawImage, toBlob });
    return canvas;
  };
  return { canvases, create };
}

const source = (width: number, height: number) => ({
  image: {} as CanvasImageSource,
  width,
  height,
});

describe('documentCameraConstraints (F1)', () => {
  it('asks the rear camera for its largest stream, without audio', () => {
    expect(DOCUMENT_STREAM_IDEAL).toEqual({ width: 4096, height: 3072 });
    expect(documentCameraConstraints('environment')).toEqual({
      audio: false,
      video: {
        facingMode: { ideal: 'environment' },
        width: { ideal: 4096 },
        height: { ideal: 3072 },
      },
    });
  });
});

describe('maximizeResolution (F1)', () => {
  function track(capabilities: MediaTrackCapabilities | undefined, applyConstraints = vi.fn()) {
    return {
      getVideoTracks: () => [
        {
          getCapabilities: capabilities === undefined ? undefined : () => capabilities,
          getConstraints: () => ({ facingMode: { ideal: 'environment' } }),
          applyConstraints,
        },
      ],
    } as unknown as MediaStream;
  }

  it('asks the track for the largest size it says it can give', async () => {
    const applyConstraints = vi.fn(() => Promise.resolve());

    await maximizeResolution(
      track({ width: { max: 4000 }, height: { max: 3000 } }, applyConstraints),
    );

    expect(applyConstraints).toHaveBeenCalledWith({
      facingMode: { ideal: 'environment' },
      width: { ideal: 4000 },
      height: { ideal: 3000 },
    });
  });

  it('keeps the stream as it is when the track names no maximum or refuses the change', async () => {
    const applyConstraints = vi.fn(() => Promise.reject(new Error('OverconstrainedError')));

    await expect(maximizeResolution(track(undefined, applyConstraints))).resolves.toBeUndefined();
    await expect(
      maximizeResolution(track({ width: {} }, applyConstraints)),
    ).resolves.toBeUndefined();
    expect(applyConstraints).not.toHaveBeenCalled();

    await expect(
      maximizeResolution(track({ width: { max: 1920 }, height: { max: 1080 } }, applyConstraints)),
    ).resolves.toBeUndefined();
    expect(applyConstraints).toHaveBeenCalledTimes(1);
    await expect(maximizeResolution({ getVideoTracks: () => [] })).resolves.toBeUndefined();
  });
});

describe('stripJpegMetadata (F2)', () => {
  it('drops EXIF, XMP, IPTC and comments and keeps what decoding needs', () => {
    const input = jpeg([JFIF, EXIF, XMP, ICC, IPTC, COMMENT, DQT]);

    const output = stripJpegMetadata(input);

    expect(jpegMarkers(input)).toEqual([0xe0, 0xe1, 0xe1, 0xe2, 0xed, 0xfe, 0xdb, 0xda]);
    expect(jpegMarkers(output)).toEqual([0xe0, 0xe2, 0xdb, 0xda]);
    // The scan and everything after it is copied as it is.
    const scanStart = input.indexOf(0xda) - 1;
    expect(Array.from(output.subarray(output.length - (input.length - scanStart)))).toEqual(
      Array.from(input.subarray(scanStart)),
    );
  });

  it('returns bytes that are not a well-formed JPEG unchanged', () => {
    const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47]);
    const truncated = jpeg([JFIF, EXIF]).subarray(0, 12);
    const noMarker = Uint8Array.from([...SOI, 0x00, 0x01]);

    expect(stripJpegMetadata(png)).toBe(png);
    expect(stripJpegMetadata(truncated)).toBe(truncated);
    expect(stripJpegMetadata(noMarker)).toBe(noMarker);
    expect(jpegMarkers(png)).toEqual([]);
  });
});

describe('encodeDocumentPhoto (F2)', () => {
  it('encodes a JPEG at 0.92, at the source size when it is within the cap, with no EXIF', async () => {
    const { canvases, create } = fakeCanvases();

    const encoded = await encodeDocumentPhoto(source(4032, 3024), { createCanvas: create });

    expect(DOCUMENT_PHOTO_QUALITY).toBe(0.92);
    expect(encoded.blob.type).toBe('image/jpeg');
    expect(encoded).toMatchObject({ width: 4032, height: 3024, quality: 0.92 });
    const [canvas] = canvases;
    expect(canvas?.toBlob).toHaveBeenCalledWith(expect.any(Function), 'image/jpeg', 0.92);
    expect(canvas?.drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0, 4032, 3024);
    expect(jpegMarkers(await bytesOf(encoded.blob))).not.toContain(0xe1);
  });

  it('caps the long side at 4096 px, keeping the aspect ratio', async () => {
    const { create } = fakeCanvases();

    const landscape = await encodeDocumentPhoto(source(8160, 6120), { createCanvas: create });
    const portrait = await encodeDocumentPhoto(source(3000, 6000), { createCanvas: create });

    expect(DOCUMENT_MAX_SIDE_PX).toBe(4096);
    expect([landscape.width, landscape.height]).toEqual([4096, 3072]);
    expect([portrait.width, portrait.height]).toEqual([2048, 4096]);
  });

  it('steps the quality down to 0.85, then the size, until the photo fits the upload limit', async () => {
    // Too big at 0.92; at 0.85 too big until the photo is under 3000 px wide.
    const { canvases, create } = fakeCanvases({
      sizeOf: (width, _height, quality) =>
        quality > 0.9 || width >= 3000 ? MAX_UPLOAD_BYTES + 1024 : MAX_UPLOAD_BYTES - 1024,
    });

    const encoded = await encodeDocumentPhoto(source(4000, 3000), { createCanvas: create });

    expect(encoded.quality).toBe(0.85);
    expect(encoded.width).toBeLessThan(3000);
    expect(encoded.blob.size).toBeLessThanOrEqual(MAX_UPLOAD_BYTES);
    expect(canvases.flatMap((canvas) => canvas.toBlob.mock.calls.map((call) => call[2]))).toEqual([
      0.92, 0.85, 0.85, 0.85,
    ]);
    expect(jpegMarkers(await bytesOf(encoded.blob))).not.toContain(0xe1);
  });

  it('gives up with a capture error when no size fits', async () => {
    const { create } = fakeCanvases({ sizeOf: () => MAX_UPLOAD_BYTES + 1024 });

    await expect(encodeDocumentPhoto(source(4000, 3000), { createCanvas: create })).rejects.toThrow(
      CaptureFrameError,
    );
  });

  it('fails when the browser gives no 2D context or the photo has no size', async () => {
    await expect(
      encodeDocumentPhoto(source(40, 30), {
        createCanvas: fakeCanvases({ context: false }).create,
      }),
    ).rejects.toThrow(CaptureFrameError);
    await expect(
      encodeDocumentPhoto(source(0, 0), { createCanvas: fakeCanvases().create }),
    ).rejects.toThrow(CaptureFrameError);
  });
});

describe('captureDocumentPhoto (F1, F2, F3)', () => {
  const view = { width: 360, height: 480 };

  function streamWith(track: object = {}) {
    return { getVideoTracks: () => [track] } as unknown as MediaStream;
  }

  function video(width: number, height: number) {
    return { videoWidth: width, videoHeight: height } as HTMLVideoElement;
  }

  it('takes the ImageCapture still, at its own size, when the browser has one', async () => {
    const { canvases, create } = fakeCanvases();
    const still = new Blob(['still'], { type: 'image/jpeg' });
    const takePhoto = vi.fn(() => Promise.resolve(still));
    const close = vi.fn();
    const decode = vi.fn(() =>
      Promise.resolve({ image: {} as CanvasImageSource, width: 4032, height: 3024, close }),
    );
    const track = { kind: 'video' };

    const captured = await captureDocumentPhoto(video(1920, 1080), streamWith(track), view, {
      createCanvas: create,
      imageCaptureOf: (given) =>
        given === track ? ({ takePhoto } satisfies ImageCaptureLike) : null,
      decode,
    });

    expect(takePhoto).toHaveBeenCalledTimes(1);
    expect(decode).toHaveBeenCalledWith(still);
    expect(captured.width).toBe(4032);
    expect(captured.height).toBe(3024);
    expect(canvases[0]?.drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0, 4032, 3024);
    expect(close).toHaveBeenCalledTimes(1);
    // The guide of a 360 x 480 view over a 16:9 stream (306 / 0.1875 = 1632 stream px), on the
    // 4:3 still whose full width the stream spans (x 2.1).
    expect(captured.check.guideWidthPx).toBe(3427);
  });

  it('draws the video frame when there is no ImageCapture, or when the still fails', async () => {
    for (const imageCaptureOf of [
      () => null,
      () => ({ takePhoto: () => Promise.reject(new Error('NotSupportedError')) }),
    ]) {
      const { canvases, create } = fakeCanvases();
      const frame = video(3000, 4000);

      const captured = await captureDocumentPhoto(frame, streamWith(), view, {
        createCanvas: create,
        imageCaptureOf,
        decode: () => Promise.reject(new Error('unused')),
      });

      expect([captured.width, captured.height]).toEqual([3000, 4000]);
      expect(canvases[0]?.drawImage).toHaveBeenCalledWith(frame, 0, 0, 3000, 4000);
    }
  });

  it('judges the guide region at the uploaded size: a flat grey region is blurry, a small one too small', async () => {
    const { create } = fakeCanvases();

    const large = await captureDocumentPhoto(video(3000, 4000), streamWith(), view, {
      createCanvas: create,
      imageCaptureOf: () => null,
    });
    const small = await captureDocumentPhoto(video(480, 640), streamWith(), view, {
      createCanvas: create,
      imageCaptureOf: () => null,
    });

    expect(large.check.problem).toBe('blurry');
    expect(large.check.sharpness).toBe(0);
    expect(small.check.problem).toBe('too-small');
    expect(small.check.guideWidthPx).toBe(408);
  });

  it('passes a sharp guide region', async () => {
    // Black and white stripes four pixels wide: sharp edges on both axes.
    const { create } = fakeCanvases({
      pixels: (width, height) => {
        const data = new Uint8ClampedArray(width * height * 4);
        for (let y = 0; y < height; y += 1) {
          for (let x = 0; x < width; x += 1) {
            const value = (Math.floor(x / 4) + Math.floor(y / 4)) % 2 === 0 ? 20 : 230;
            data.fill(value, (y * width + x) * 4, (y * width + x) * 4 + 3);
          }
        }
        return data;
      },
    });

    const captured = await captureDocumentPhoto(video(1080, 1440), streamWith(), view, {
      createCanvas: create,
      imageCaptureOf: () => null,
    });

    expect(captured.check.problem).toBeNull();
    expect(captured.photo.type).toBe('image/jpeg');
  });

  it('uses the browser’s ImageCapture and decodes the still upright by default', async () => {
    const still = new Blob(['still'], { type: 'image/jpeg' });
    const tracks: unknown[] = [];
    const close = vi.fn();
    const createImageBitmap = vi.fn(() => Promise.resolve({ width: 4000, height: 3000, close }));
    vi.stubGlobal(
      'ImageCapture',
      class {
        constructor(track: unknown) {
          tracks.push(track);
        }

        takePhoto() {
          return Promise.resolve(still);
        }
      },
    );
    vi.stubGlobal('createImageBitmap', createImageBitmap);
    const track = { kind: 'video' };
    try {
      const captured = await captureDocumentPhoto(video(1920, 1080), streamWith(track), view, {
        createCanvas: fakeCanvases().create,
      });

      expect(tracks).toEqual([track]);
      expect(createImageBitmap).toHaveBeenCalledWith(still, { imageOrientation: 'from-image' });
      expect([captured.width, captured.height]).toEqual([4000, 3000]);
      expect(close).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('draws the video frame when the stream has no video track', async () => {
    const imageCaptureOf = vi.fn(() => null);

    const captured = await captureDocumentPhoto(
      video(1080, 1440),
      { getVideoTracks: () => [] },
      view,
      { createCanvas: fakeCanvases().create, imageCaptureOf },
    );

    expect(imageCaptureOf).not.toHaveBeenCalled();
    expect([captured.width, captured.height]).toEqual([1080, 1440]);
  });

  it('fails when the browser cannot read the photo back', async () => {
    const { create } = fakeCanvases();
    const withoutReadBack = (): DocumentCanvas => {
      const canvas = create();
      const getContext = canvas.getContext.bind(canvas);
      canvas.getContext = (type) => {
        const context = getContext(type);
        return context === null ? null : { drawImage: context.drawImage.bind(context) };
      };
      return canvas;
    };

    await expect(
      captureDocumentPhoto(video(1080, 1440), streamWith(), view, {
        createCanvas: withoutReadBack,
        imageCaptureOf: () => null,
      }),
    ).rejects.toThrow('The browser cannot read the photo back');
  });

  it('fails when the camera has not delivered a frame yet', async () => {
    await expect(
      captureDocumentPhoto(video(0, 0), streamWith(), view, {
        createCanvas: fakeCanvases().create,
        imageCaptureOf: () => null,
      }),
    ).rejects.toThrow(CaptureFrameError);
  });
});
