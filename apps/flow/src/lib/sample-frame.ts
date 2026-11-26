/**
 * The guidance frame (C46.1): the live camera frame drawn, unmirrored, into a small canvas
 * `preview-width-px` wide (C40.11), read back as RGBA pixels for the face detector. One canvas is
 * reused for every frame. KP10-3 (Workflow 10A): the same call draws the same frame at full
 * resolution into a second reused canvas, the copy an auto-capture uploads, so the photo is the
 * frame the guidance judged and not the camera's frame of after the detection.
 */
import { previewSize, type RgbaFrame } from '../guidance/yunet-input';
import { encodeCanvas, type CanvasLike, type FrameSource } from './capture-frame';

/** KP10-3: the canvas a full-resolution copy is drawn into, cleared once taken or released. */
export interface PhotoCanvas extends Omit<CanvasLike, 'getContext'> {
  getContext(type: '2d'): Pick<CanvasRenderingContext2D, 'drawImage' | 'clearRect'> | null;
}

/**
 * KP10-3 (Workflow 10A): the full-resolution copy of one sampled frame, the photo an auto-capture
 * uploads, so the photo is the frame the guidance judged and not the camera's frame of later.
 */
export interface HeldFrame {
  /**
   * Encodes the copy as `captureFrame` does (JPEG, never mirrored) and clears it; `null` once a
   * later sample replaced it, or it was taken or released.
   */
  readonly take: () => Promise<Blob> | null;
  /** Clears the copy without encoding it (nothing is kept once the guidance moves on). */
  readonly release: () => void;
}

/** A guidance frame with its full-resolution copy, or `null` when none could be drawn. */
export interface SampledFrame extends RgbaFrame {
  readonly held: HeldFrame | null;
}

export interface SamplingCanvas {
  width: number;
  height: number;
  getContext(
    type: '2d',
    options: { readonly willReadFrequently: boolean },
  ): Pick<CanvasRenderingContext2D, 'drawImage' | 'getImageData'> | null;
}

export interface FrameSamplerOptions {
  /** Injected in tests; defaults to a new `<canvas>`. */
  readonly createCanvas?: () => SamplingCanvas;
  /** KP10-3: the full-resolution copy's canvas. Injected in tests; defaults to a new `<canvas>`. */
  readonly createPhotoCanvas?: () => PhotoCanvas;
}

export type FrameSampler = (
  video: FrameSource & CanvasImageSource,
  width: number,
) => SampledFrame | null;

/** The full-resolution copy a guidance frame holds, or `null` from a sampler that holds none. */
export function heldFrameOf(frame: RgbaFrame): HeldFrame | null {
  return 'held' in frame ? (frame as SampledFrame).held : null;
}

/** A sampler that reads the current frame of a video at most `width` pixels wide. */
export function createFrameSampler({
  createCanvas = () => document.createElement('canvas'),
  createPhotoCanvas = () => document.createElement('canvas'),
}: FrameSamplerOptions = {}): FrameSampler {
  let canvas: SamplingCanvas | null = null;
  let photo: PhotoCanvas | null = null;
  /** Counts the copies drawn; `holding` names the one the photo canvas holds now (0: none). */
  let drawn = 0;
  let holding = 0;

  /** Draws the frame at full resolution and answers its handle, or `null` if it cannot. */
  const hold = (video: FrameSource & CanvasImageSource): HeldFrame | null => {
    photo ??= createPhotoCanvas();
    const target = photo;
    const context = target.getContext('2d');
    if (context === null) {
      return null;
    }
    const { videoWidth: width, videoHeight: height } = video;
    // A canvas reallocates its bitmap on every size write: only a new camera size writes one.
    if (target.width !== width) {
      target.width = width;
    }
    if (target.height !== height) {
      target.height = height;
    }
    context.drawImage(video, 0, 0, width, height);
    drawn += 1;
    const copy = drawn;
    holding = copy;
    const clear = () => {
      context.clearRect(0, 0, width, height);
      holding = 0;
    };
    return {
      take: () => {
        if (holding !== copy) {
          return null;
        }
        const blob = encodeCanvas(target);
        clear();
        return blob;
      },
      release: () => {
        if (holding === copy) {
          clear();
        }
      },
    };
  };

  return (video, width) => {
    const size = previewSize(video.videoWidth, video.videoHeight, width);
    if (size.width === 0 || size.height === 0) {
      return null;
    }
    canvas ??= createCanvas();
    canvas.width = size.width;
    canvas.height = size.height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (context === null) {
      return null;
    }
    // Both canvases draw in this one synchronous call, so both hold the same camera frame.
    const held = hold(video);
    // The raw frame: the preview's mirroring is CSS only, so YuNet sees what the server sees.
    context.drawImage(video, 0, 0, size.width, size.height);
    const pixels = context.getImageData(0, 0, size.width, size.height);
    return { data: pixels.data, width: pixels.width, height: pixels.height, held };
  };
}
