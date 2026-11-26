/**
 * Phase 12A F1, F2 (Workflow 12A capture-12a): how the flow takes a photo of a document.
 *
 * - F1. The stream asks the rear camera for its largest size ([documentCameraConstraints]), then
 *   for the maximum its track reports ([maximizeResolution]). The photo is the `ImageCapture`
 *   still where the browser has one (Chrome on Android: the sensor's full resolution), else the
 *   video frame. The live test of 2026-11-22 uploaded 1080 x 1920 frames, on which the vision
 *   service found no card and no barcode.
 * - F2. Every document photo is drawn into a canvas, oriented upright (`createImageBitmap` applies
 *   the still's EXIF orientation), its long side at most [DOCUMENT_MAX_SIDE_PX], and encoded as a
 *   JPEG at [DOCUMENT_PHOTO_QUALITY]. A photo over the upload limit is encoded again at
 *   [FALLBACK_PHOTO_QUALITY], then smaller. Whatever segments the browser wrote, EXIF, XMP, IPTC
 *   and comments are cut from the bytes ([stripJpegMetadata]), so nothing such as a location
 *   leaves the device with the photo.
 * - F3. The guide region of the photo, at the uploaded size, is judged by `photo-check.ts`.
 *
 * Selfies keep their own capture (`capture-frame.ts`); files the user uploads are sent as chosen.
 */
import { MAX_UPLOAD_BYTES } from '@openverify/contracts';
import { CaptureFrameError, PHOTO_QUALITY, PHOTO_TYPE, encodeCanvas } from './capture-frame';
import {
  assessGuideCrop,
  guideInFrame,
  photoRegion,
  toGrey,
  type PhotoCheck,
  type Rect,
  type Size,
} from './photo-check';

/** The largest stream the document camera asks for (4:3, as phone sensors are). */
export const DOCUMENT_STREAM_IDEAL: Size = Object.freeze({ width: 4096, height: 3072 });

/** The long side of an uploaded document photo, at most. */
export const DOCUMENT_MAX_SIDE_PX = 4096;

/** The document photo's JPEG quality, as every captured frame's (C40). */
export const DOCUMENT_PHOTO_QUALITY = PHOTO_QUALITY;

/** The quality a photo over the upload limit is encoded at again, before it is made smaller. */
export const FALLBACK_PHOTO_QUALITY = 0.85;

/** How much each further try shrinks a photo still over the limit, and how many tries there are. */
const SHRINK_STEP = 0.8;
const MAX_SHRINKS = 4;

/**
 * The widest copy of the guide region the check reads back from the canvas: the browser scales
 * the region down to it, the check's own area averaging does the rest (`SHARPNESS_WIDTH_PX`).
 */
const CHECK_READ_WIDTH_PX = 1600;

/** The rear camera at its largest size, never the microphone. */
export function documentCameraConstraints(
  facingMode: 'user' | 'environment',
): MediaStreamConstraints {
  return {
    audio: false,
    video: {
      facingMode: { ideal: facingMode },
      width: { ideal: DOCUMENT_STREAM_IDEAL.width },
      height: { ideal: DOCUMENT_STREAM_IDEAL.height },
    },
  };
}

/**
 * Asks the stream's video track for the largest size its capabilities name. The stream stays as
 * it is when the browser names no maximum or refuses the change; it never throws.
 */
export async function maximizeResolution(
  stream: Pick<MediaStream, 'getVideoTracks'>,
): Promise<void> {
  const [track] = stream.getVideoTracks();
  // `getCapabilities` is missing from some browsers despite the DOM typings.
  const capabilities = (track as Partial<MediaStreamTrack> | undefined)?.getCapabilities?.();
  const width = capabilities?.width?.max;
  const height = capabilities?.height?.max;
  if (track === undefined || width === undefined || height === undefined) {
    return;
  }
  try {
    await track.applyConstraints({
      ...track.getConstraints(),
      width: { ideal: width },
      height: { ideal: height },
    });
  } catch {
    // The stream keeps the size it has.
  }
}

/** JPEG markers kept: what decoding needs. Every other APPn segment and comments are cut. */
const KEPT_APP_MARKERS = new Set([
  0xe0, // APP0, JFIF
  0xe2, // APP2, the ICC colour profile
  0xee, // APP14, Adobe's colour transform
]);

/** The markers of a JPEG's segments up to and including its first scan (SOS); `[]` for others. */
export function jpegMarkers(bytes: Uint8Array): number[] {
  return segmentsOf(bytes)?.map(({ marker }) => marker) ?? [];
}

interface Segment {
  readonly marker: number;
  readonly start: number;
  readonly end: number;
}

/** The segments from SOI to SOS (SOS's header included), or `null` if the bytes are not that. */
function segmentsOf(bytes: Uint8Array): Segment[] | null {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) {
    return null;
  }
  const segments: Segment[] = [];
  let offset = 2;
  while (offset + 4 <= bytes.length) {
    const marker = bytes[offset + 1] ?? 0;
    if (bytes[offset] !== 0xff || marker === 0x00 || marker === 0xff) {
      return null;
    }
    const end = offset + 2 + (((bytes[offset + 2] ?? 0) << 8) | (bytes[offset + 3] ?? 0));
    if (end > bytes.length) {
      return null;
    }
    segments.push({ marker, start: offset, end });
    if (marker === 0xda) {
      return segments;
    }
    offset = end;
  }
  return null;
}

/**
 * The JPEG without its metadata segments (APP1 EXIF and XMP, APP3 to APP13, APP15, comments),
 * everything from the scan on copied as it is. Bytes that are not a well-formed JPEG up to its
 * first scan come back unchanged.
 */
export function stripJpegMetadata(bytes: Uint8Array<ArrayBuffer>): Uint8Array<ArrayBuffer> {
  const segments = segmentsOf(bytes);
  if (segments === null) {
    return bytes;
  }
  const metadata = (marker: number) =>
    marker === 0xfe || (marker >= 0xe0 && marker <= 0xef && !KEPT_APP_MARKERS.has(marker));
  const kept = segments.filter(({ marker }) => !metadata(marker));
  const scanStart = segments.at(-1)?.end ?? bytes.length;
  const parts = [
    bytes.subarray(0, 2),
    ...kept.map(({ start, end }) => bytes.subarray(start, end)),
    bytes.subarray(scanStart),
  ];
  const out = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

/** A canvas the document photo is drawn into, encoded from and read back from. */
export interface DocumentCanvas {
  width: number;
  height: number;
  getContext(
    type: '2d',
  ):
    | (Pick<CanvasRenderingContext2D, 'drawImage'> &
        Partial<Pick<CanvasRenderingContext2D, 'getImageData'>>)
    | null;
  toBlob(callback: BlobCallback, type?: string, quality?: number): void;
}

/** An image to encode: a decoded still, or the video element at its frame's size. */
export interface PhotoSource extends Size {
  readonly image: CanvasImageSource;
}

export interface EncodedPhoto extends Size {
  readonly blob: Blob;
  readonly quality: number;
}

export interface EncodeOptions {
  /** Injected in tests; defaults to a new `<canvas>`. */
  readonly createCanvas?: () => DocumentCanvas;
  readonly maxBytes?: number;
}

const browserCanvas = (): DocumentCanvas => document.createElement('canvas');

async function encodeAt(
  canvas: DocumentCanvas,
  photo: PhotoSource,
  size: Size,
  quality: number,
): Promise<Blob> {
  canvas.width = size.width;
  canvas.height = size.height;
  const context = canvas.getContext('2d');
  if (context === null) {
    throw new CaptureFrameError('The browser cannot draw the photo');
  }
  context.drawImage(photo.image, 0, 0, size.width, size.height);
  const encoded = await encodeCanvas(canvas, PHOTO_TYPE, quality);
  const bytes = stripJpegMetadata(new Uint8Array(await encoded.arrayBuffer()));
  return new Blob([bytes], { type: PHOTO_TYPE });
}

/**
 * F2: the photo as the JPEG the flow uploads: long side at most [DOCUMENT_MAX_SIDE_PX], quality
 * [DOCUMENT_PHOTO_QUALITY], no metadata, at most `maxBytes`.
 * @throws {CaptureFrameError} when the photo has no size, cannot be drawn or encoded, or fits the
 *   limit at no size tried.
 */
export async function encodeDocumentPhoto(
  photo: PhotoSource,
  { createCanvas = browserCanvas, maxBytes = MAX_UPLOAD_BYTES }: EncodeOptions = {},
): Promise<EncodedPhoto> {
  if (photo.width <= 0 || photo.height <= 0) {
    throw new CaptureFrameError('The photo has no size');
  }
  const canvas = createCanvas();
  const cap = Math.min(1, DOCUMENT_MAX_SIDE_PX / Math.max(photo.width, photo.height));
  let scale = cap;
  let quality = DOCUMENT_PHOTO_QUALITY;
  for (let shrinks = 0; shrinks <= MAX_SHRINKS;) {
    const size = {
      width: Math.max(1, Math.round(photo.width * scale)),
      height: Math.max(1, Math.round(photo.height * scale)),
    };
    const blob = await encodeAt(canvas, photo, size, quality);
    if (blob.size <= maxBytes) {
      return { blob, ...size, quality };
    }
    if (quality > FALLBACK_PHOTO_QUALITY) {
      quality = FALLBACK_PHOTO_QUALITY;
    } else {
      scale *= SHRINK_STEP;
      shrinks += 1;
    }
  }
  throw new CaptureFrameError('The photo does not fit the upload limit');
}

/** The part of `ImageCapture` the flow uses (Chrome; not in TypeScript's DOM typings). */
export interface ImageCaptureLike {
  takePhoto(): Promise<Blob>;
}

/** A decoded still: its pixels as a canvas source, released by `close`. */
export interface DecodedImage extends PhotoSource {
  close(): void;
}

export interface CaptureDocumentOptions {
  readonly createCanvas?: () => DocumentCanvas;
  /** The track's `ImageCapture`, or `null` when the browser has none. */
  readonly imageCaptureOf?: (track: MediaStreamTrack) => ImageCaptureLike | null;
  /** Decodes a still upright (its EXIF orientation applied). */
  readonly decode?: (blob: Blob) => Promise<DecodedImage>;
}

export interface DocumentCapture extends Size {
  readonly photo: Blob;
  /** F3: the guide region's check, at the uploaded size. */
  readonly check: PhotoCheck;
}

function browserImageCapture(track: MediaStreamTrack): ImageCaptureLike | null {
  const constructor = (
    globalThis as { ImageCapture?: new (track: MediaStreamTrack) => ImageCaptureLike }
  ).ImageCapture;
  return constructor === undefined ? null : new constructor(track);
}

async function browserDecode(blob: Blob): Promise<DecodedImage> {
  const bitmap = await createImageBitmap(blob, { imageOrientation: 'from-image' });
  return {
    image: bitmap,
    width: bitmap.width,
    height: bitmap.height,
    close: () => {
      bitmap.close();
    },
  };
}

/** The `ImageCapture` still of the stream's video track, or `null` when there is none. */
async function takeStill(
  stream: Pick<MediaStream, 'getVideoTracks'>,
  imageCaptureOf: (track: MediaStreamTrack) => ImageCaptureLike | null,
  decode: (blob: Blob) => Promise<DecodedImage>,
): Promise<DecodedImage | null> {
  const [track] = stream.getVideoTracks();
  if (track === undefined) {
    return null;
  }
  try {
    const capture = imageCaptureOf(track);
    return capture === null ? null : await decode(await capture.takePhoto());
  } catch {
    // The camera or the browser refused the still: the video frame is the photo.
    return null;
  }
}

/** F3: reads the guide `region` of `photo` back at most [CHECK_READ_WIDTH_PX] wide and judges it. */
function checkRegion(
  photo: PhotoSource,
  region: Rect,
  uploadScale: number,
  createCanvas: () => DocumentCanvas,
): PhotoCheck {
  const guideWidthPx = Math.round(region.width * uploadScale);
  const width = Math.max(1, Math.min(guideWidthPx, CHECK_READ_WIDTH_PX));
  const height = Math.max(1, Math.round((region.height * width) / Math.max(1, region.width)));
  const canvas = createCanvas();
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (context?.getImageData === undefined) {
    throw new CaptureFrameError('The browser cannot read the photo back');
  }
  context.drawImage(
    photo.image,
    region.x,
    region.y,
    region.width,
    region.height,
    0,
    0,
    width,
    height,
  );
  const pixels = context.getImageData(0, 0, width, height);
  return assessGuideCrop(toGrey(pixels.data, width, height), guideWidthPx);
}

/**
 * F1 to F3: takes the document photo, encodes it for upload and judges its guide region. `view`
 * is the preview's size in CSS pixels, over which the card guide is drawn.
 * @throws {CaptureFrameError} when the video has no frame yet, or the photo cannot be drawn,
 *   encoded or read back.
 */
export async function captureDocumentPhoto(
  video: HTMLVideoElement,
  stream: Pick<MediaStream, 'getVideoTracks'>,
  view: Size,
  {
    createCanvas = browserCanvas,
    imageCaptureOf = browserImageCapture,
    decode = browserDecode,
  }: CaptureDocumentOptions = {},
): Promise<DocumentCapture> {
  const frame = { width: video.videoWidth, height: video.videoHeight };
  if (frame.width === 0 || frame.height === 0) {
    throw new CaptureFrameError('The camera has not delivered a frame yet');
  }
  const guide = guideInFrame(view, frame);
  const still = await takeStill(stream, imageCaptureOf, decode);
  const photo: PhotoSource = still ?? { image: video, ...frame };
  try {
    const encoded = await encodeDocumentPhoto(photo, { createCanvas });
    const region = still === null ? guide : photoRegion(guide, frame, still);
    const check = checkRegion(photo, region, encoded.width / photo.width, createCanvas);
    return { photo: encoded.blob, width: encoded.width, height: encoded.height, check };
  } finally {
    still?.close();
  }
}
