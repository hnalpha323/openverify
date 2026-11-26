import { describe, expect, it, vi } from 'vitest';
import { createFrameSampler, type PhotoCanvas, type SamplingCanvas } from './sample-frame';

function fakeVideo(width: number, height: number) {
  return { videoWidth: width, videoHeight: height } as HTMLVideoElement;
}

function fakeCanvas(options: { context?: boolean } = {}) {
  const drawImage = vi.fn();
  const getImageData = vi.fn(
    (_x: number, _y: number, width: number, height: number) =>
      ({ data: new Uint8ClampedArray(width * height * 4), width, height }) as ImageData,
  );
  const getContext = vi.fn(() => (options.context === false ? null : { drawImage, getImageData }));
  const canvas: SamplingCanvas = { width: 0, height: 0, getContext };
  return { canvas, drawImage, getImageData, getContext };
}

describe('createFrameSampler (C46.1)', () => {
  it('draws the raw camera frame at the preview width and reads its pixels back', () => {
    const video = fakeVideo(1280, 720);
    const { canvas, drawImage, getImageData } = fakeCanvas();

    const frame = createFrameSampler({ createCanvas: () => canvas })(video, 320);

    expect(canvas.width).toBe(320);
    expect(canvas.height).toBe(180);
    expect(drawImage).toHaveBeenCalledWith(video, 0, 0, 320, 180);
    expect(getImageData).toHaveBeenCalledWith(0, 0, 320, 180);
    expect(frame).toMatchObject({ width: 320, height: 180 });
  });

  it('asks for a canvas made for reading back, and reuses it for every frame', () => {
    const { canvas, getContext } = fakeCanvas();
    const createCanvas = vi.fn(() => canvas);
    const sample = createFrameSampler({ createCanvas });

    sample(fakeVideo(640, 480), 320);
    sample(fakeVideo(640, 480), 320);

    expect(createCanvas).toHaveBeenCalledTimes(1);
    expect(getContext).toHaveBeenCalledWith('2d', { willReadFrequently: true });
  });

  it('is null before the camera has a frame', () => {
    const { canvas, drawImage } = fakeCanvas();

    expect(createFrameSampler({ createCanvas: () => canvas })(fakeVideo(0, 0), 320)).toBeNull();
    expect(drawImage).not.toHaveBeenCalled();
  });

  it('is null when the browser cannot draw the frame', () => {
    const { canvas } = fakeCanvas({ context: false });

    expect(createFrameSampler({ createCanvas: () => canvas })(fakeVideo(640, 480), 320)).toBeNull();
  });
});

function fakePhotoCanvas(options: { context?: boolean } = {}) {
  const calls: string[] = [];
  const drawImage = vi.fn(() => {
    calls.push('draw');
  });
  const clearRect = vi.fn(() => {
    calls.push('clear');
  });
  const toBlob = vi.fn((callback: BlobCallback) => {
    calls.push('encode');
    callback(new Blob(['full-resolution copy'], { type: 'image/jpeg' }));
  });
  const canvas: PhotoCanvas = {
    width: 0,
    height: 0,
    getContext: () => (options.context === false ? null : { drawImage, clearRect }),
    toBlob,
  };
  return { canvas, calls, drawImage, clearRect, toBlob };
}

function samplerWithPhoto(photo = fakePhotoCanvas()) {
  const preview = fakeCanvas();
  const createPhotoCanvas = vi.fn(() => photo.canvas);
  const sample = createFrameSampler({ createCanvas: () => preview.canvas, createPhotoCanvas });
  return {
    sample: (video: HTMLVideoElement) => sample(video, 320),
    preview,
    photo,
    createPhotoCanvas,
  };
}

describe('createFrameSampler: the full-resolution copy of each sampled frame (KP10-3)', () => {
  it('draws the same camera frame at full resolution, unmirrored, in the call that samples it', () => {
    const video = fakeVideo(1280, 720);
    const { sample, preview, photo } = samplerWithPhoto();

    const frame = sample(video);

    expect(photo.canvas.width).toBe(1280);
    expect(photo.canvas.height).toBe(720);
    expect(photo.drawImage).toHaveBeenCalledWith(video, 0, 0, 1280, 720);
    expect(preview.drawImage).toHaveBeenCalledWith(video, 0, 0, 320, 180);
    expect(frame?.held).not.toBeNull();
    expect(photo.toBlob).not.toHaveBeenCalled();
  });

  it('encodes the copy as captureFrame does when taken, then clears it: it is taken once', async () => {
    const { sample, photo } = samplerWithPhoto();
    const frame = sample(fakeVideo(1280, 720));

    const taken = frame?.held?.take();

    expect(photo.toBlob).toHaveBeenCalledWith(expect.any(Function), 'image/jpeg', 0.92);
    expect(photo.calls).toEqual(['draw', 'encode', 'clear']);
    expect(photo.clearRect).toHaveBeenCalledWith(0, 0, 1280, 720);
    await expect(taken?.then((blob) => blob.text())).resolves.toBe('full-resolution copy');
    expect(frame?.held?.take()).toBeNull();
  });

  it('a later sample replaces the copy: the earlier frame is never taken for it', () => {
    const { sample, photo } = samplerWithPhoto();
    const first = sample(fakeVideo(1280, 720));
    const second = sample(fakeVideo(1280, 720));

    expect(first?.held?.take()).toBeNull();
    expect(photo.toBlob).not.toHaveBeenCalled();
    expect(second?.held?.take()).not.toBeNull();
  });

  it('release clears the copy without encoding it, and leaves a newer copy alone', () => {
    const { sample, photo } = samplerWithPhoto();
    const first = sample(fakeVideo(640, 480));
    first?.held?.release();

    expect(photo.clearRect).toHaveBeenCalledWith(0, 0, 640, 480);
    expect(photo.toBlob).not.toHaveBeenCalled();
    expect(first?.held?.take()).toBeNull();

    const second = sample(fakeVideo(640, 480));
    first?.held?.release();
    expect(photo.clearRect).toHaveBeenCalledTimes(1);
    expect(second?.held?.take()).not.toBeNull();
  });

  it('reuses one photo canvas for every frame, resizing it only when the camera size changes', () => {
    const { sample, photo, createPhotoCanvas } = samplerWithPhoto();
    let resized = 0;
    let width = 0;
    Object.defineProperty(photo.canvas, 'width', {
      get: () => width,
      set: (value: number) => {
        resized += 1;
        width = value;
      },
    });

    sample(fakeVideo(1280, 720));
    sample(fakeVideo(1280, 720));

    expect(createPhotoCanvas).toHaveBeenCalledTimes(1);
    expect(resized).toBe(1);
  });

  it('still samples the guidance frame, with no copy, when the photo canvas cannot be drawn', () => {
    const { sample } = samplerWithPhoto(fakePhotoCanvas({ context: false }));

    const frame = sample(fakeVideo(1280, 720));

    expect(frame).toMatchObject({ width: 320, height: 180, held: null });
  });
});
