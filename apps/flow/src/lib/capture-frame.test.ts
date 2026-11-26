import { describe, expect, it, vi } from 'vitest';
import { CaptureFrameError, captureFrame, type CanvasLike } from './capture-frame';

function fakeVideo(width: number, height: number) {
  return { videoWidth: width, videoHeight: height } as HTMLVideoElement;
}

function fakeCanvas(options: { context?: boolean; blob?: Blob | null } = {}) {
  const drawImage = vi.fn();
  const toBlob = vi.fn((callback: BlobCallback) => {
    callback(
      options.blob === undefined ? new Blob(['jpeg'], { type: 'image/jpeg' }) : options.blob,
    );
  });
  const canvas: CanvasLike = {
    width: 0,
    height: 0,
    getContext: () => (options.context === false ? null : { drawImage }),
    toBlob,
  };
  return { canvas, drawImage, toBlob };
}

describe('captureFrame', () => {
  it('draws the full video frame and encodes it as a JPEG', async () => {
    const video = fakeVideo(1280, 720);
    const { canvas, drawImage, toBlob } = fakeCanvas();

    const blob = await captureFrame(video, { createCanvas: () => canvas });

    expect(blob.type).toBe('image/jpeg');
    expect(canvas.width).toBe(1280);
    expect(canvas.height).toBe(720);
    expect(drawImage).toHaveBeenCalledWith(video, 0, 0, 1280, 720);
    expect(toBlob).toHaveBeenCalledWith(expect.any(Function), 'image/jpeg', 0.92);
  });

  it('honours another type and quality', async () => {
    const { canvas, toBlob } = fakeCanvas();

    await captureFrame(fakeVideo(10, 10), {
      createCanvas: () => canvas,
      type: 'image/png',
      quality: 1,
    });

    expect(toBlob).toHaveBeenCalledWith(expect.any(Function), 'image/png', 1);
  });

  it('fails when the camera has not delivered a frame yet', async () => {
    await expect(
      captureFrame(fakeVideo(0, 0), { createCanvas: () => fakeCanvas().canvas }),
    ).rejects.toThrow(CaptureFrameError);
  });

  it('fails when the browser gives no 2D context', async () => {
    await expect(
      captureFrame(fakeVideo(10, 10), {
        createCanvas: () => fakeCanvas({ context: false }).canvas,
      }),
    ).rejects.toThrow(CaptureFrameError);
  });

  it('fails when the canvas cannot encode the frame', async () => {
    await expect(
      captureFrame(fakeVideo(10, 10), { createCanvas: () => fakeCanvas({ blob: null }).canvas }),
    ).rejects.toThrow(CaptureFrameError);
  });

  it('uses a real canvas by default', async () => {
    const getContext = vi
      .spyOn(HTMLCanvasElement.prototype, 'getContext')
      .mockReturnValue({ drawImage: vi.fn() } as unknown as CanvasRenderingContext2D);
    const toBlob = vi
      .spyOn(HTMLCanvasElement.prototype, 'toBlob')
      .mockImplementation((callback) => {
        callback(new Blob(['x'], { type: 'image/jpeg' }));
      });
    try {
      await expect(captureFrame(fakeVideo(4, 3))).resolves.toBeInstanceOf(Blob);
    } finally {
      getContext.mockRestore();
      toBlob.mockRestore();
    }
  });
});
