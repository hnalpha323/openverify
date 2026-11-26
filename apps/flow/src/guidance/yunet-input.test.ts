import { describe, expect, it } from 'vitest';
import { paddedSize, previewSize, toYunetInput } from './yunet-input';

describe('paddedSize', () => {
  it('rounds up to a multiple of 32, as FaceDetectorYN pads its input', () => {
    expect(paddedSize(120)).toBe(128);
    expect(paddedSize(160)).toBe(160);
    expect(paddedSize(240)).toBe(256);
    expect(paddedSize(1)).toBe(32);
  });
});

describe('previewSize (C40.11 preview-width-px)', () => {
  it('scales the camera frame to the preview width, keeping its aspect ratio', () => {
    expect(previewSize(1280, 720, 320)).toEqual({ width: 320, height: 180 });
    expect(previewSize(640, 480, 320)).toEqual({ width: 320, height: 240 });
    expect(previewSize(720, 1280, 320)).toEqual({ width: 320, height: 569 });
  });

  it('never scales a smaller frame up', () => {
    expect(previewSize(160, 120, 320)).toEqual({ width: 160, height: 120 });
  });

  it('is empty before the camera has a frame', () => {
    expect(previewSize(0, 0, 320)).toEqual({ width: 0, height: 0 });
  });
});

describe('toYunetInput', () => {
  // A 2 x 1 frame: one red pixel, one (10, 20, 30) pixel, both opaque.
  const frame = { data: [255, 0, 0, 255, 10, 20, 30, 255], width: 2, height: 1 };

  it('pads the frame right and bottom to multiples of 32', () => {
    const input = toYunetInput(frame);

    expect(input.paddedWidth).toBe(32);
    expect(input.paddedHeight).toBe(32);
    expect(input.data).toHaveLength(3 * 32 * 32);
  });

  it('lays the pixels out as NCHW planes in BGR order, 0-255, with zero padding', () => {
    const { data } = toYunetInput(frame);
    const plane = 32 * 32;

    // Blue, green and red planes; pixel (x, y) at y * 32 + x.
    expect([data[0], data[plane], data[2 * plane]]).toEqual([0, 0, 255]);
    expect([data[1], data[plane + 1], data[2 * plane + 1]]).toEqual([30, 20, 10]);
    expect(data[2]).toBe(0);
    expect(data[32]).toBe(0);
    expect(data.reduce((sum, value) => sum + value, 0)).toBe(255 + 10 + 20 + 30);
  });
});
