/**
 * The guidance frame as YuNet takes it (C46.1): the camera frame scaled to the preview width
 * (`preview-width-px`, C40.11), then a float32 NCHW tensor of BGR values in 0-255, zero-padded
 * right and bottom to multiples of 32, as OpenCV's `FaceDetectorYN` pads its input.
 */

/** RGBA pixels, as `CanvasRenderingContext2D.getImageData` returns them. */
export interface RgbaFrame {
  readonly data: ArrayLike<number>;
  readonly width: number;
  readonly height: number;
}

export interface YunetInput {
  readonly data: Float32Array;
  readonly paddedWidth: number;
  readonly paddedHeight: number;
}

const ALIGNMENT = 32;

/** `size` rounded up to a multiple of 32. */
export function paddedSize(size: number): number {
  return Math.ceil(size / ALIGNMENT) * ALIGNMENT;
}

/**
 * The size of the guidance frame for a camera frame: `previewWidth` wide (never wider than the
 * camera frame), same aspect ratio.
 */
export function previewSize(
  videoWidth: number,
  videoHeight: number,
  previewWidth: number,
): { readonly width: number; readonly height: number } {
  if (videoWidth <= 0 || videoHeight <= 0) {
    return { width: 0, height: 0 };
  }
  const width = Math.min(previewWidth, videoWidth);
  return { width, height: Math.round((width * videoHeight) / videoWidth) };
}

/** The YuNet input tensor for an RGBA frame. */
export function toYunetInput(frame: RgbaFrame): YunetInput {
  const paddedWidth = paddedSize(frame.width);
  const paddedHeight = paddedSize(frame.height);
  const plane = paddedWidth * paddedHeight;
  const data = new Float32Array(3 * plane);
  for (let y = 0; y < frame.height; y += 1) {
    for (let x = 0; x < frame.width; x += 1) {
      const source = (y * frame.width + x) * 4;
      const target = y * paddedWidth + x;
      data[target] = frame.data[source + 2] ?? 0;
      data[plane + target] = frame.data[source + 1] ?? 0;
      data[2 * plane + target] = frame.data[source] ?? 0;
    }
  }
  return { data, paddedWidth, paddedHeight };
}
