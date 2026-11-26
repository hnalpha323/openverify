/**
 * Grabs the current frame of a live `<video>` as a JPEG. The image is never mirrored, even when
 * the preview is, so the server sees the scene as it is.
 */

export class CaptureFrameError extends Error {
  override readonly name = 'CaptureFrameError';
}

export interface FrameSource {
  readonly videoWidth: number;
  readonly videoHeight: number;
}

export interface CanvasLike {
  width: number;
  height: number;
  getContext(type: '2d'): Pick<CanvasRenderingContext2D, 'drawImage'> | null;
  toBlob(callback: BlobCallback, type?: string, quality?: number): void;
}

export interface CaptureFrameOptions {
  /** Injected in tests; defaults to a new `<canvas>`. */
  readonly createCanvas?: () => CanvasLike;
  readonly type?: string;
  readonly quality?: number;
}

/** The photo's encoding (C40): a JPEG at this quality, as every captured frame is. */
export const PHOTO_TYPE = 'image/jpeg';
export const PHOTO_QUALITY = 0.92;

/**
 * Encodes what `canvas` holds now: the browser copies the bitmap when this is called, so the
 * canvas may be cleared or drawn again at once (KP10-3).
 * @throws {CaptureFrameError} when the canvas cannot encode it.
 */
export function encodeCanvas(
  canvas: Pick<CanvasLike, 'toBlob'>,
  type: string = PHOTO_TYPE,
  quality: number = PHOTO_QUALITY,
): Promise<Blob> {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob === null) {
          reject(new CaptureFrameError('The browser could not encode the camera frame'));
        } else {
          resolve(blob);
        }
      },
      type,
      quality,
    );
  });
}

/**
 * @throws {CaptureFrameError} when the video has no frame yet or the canvas cannot encode it.
 */
export async function captureFrame(
  video: FrameSource & CanvasImageSource,
  {
    createCanvas = () => document.createElement('canvas'),
    type = PHOTO_TYPE,
    quality = PHOTO_QUALITY,
  }: CaptureFrameOptions = {},
): Promise<Blob> {
  const { videoWidth: width, videoHeight: height } = video;
  if (width === 0 || height === 0) {
    throw new CaptureFrameError('The camera has not delivered a frame yet');
  }
  const canvas = createCanvas();
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (context === null) {
    throw new CaptureFrameError('The browser cannot draw the camera frame');
  }
  context.drawImage(video, 0, 0, width, height);
  return encodeCanvas(canvas, type, quality);
}
