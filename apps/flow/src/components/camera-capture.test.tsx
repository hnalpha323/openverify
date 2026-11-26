import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { en } from '../i18n/locales/en';
import { CaptureFrameError } from '../lib/capture-frame';
import { CAMERA_ERROR_CODES, type CameraAccess } from '../lib/camera-permission';
import { cameraDeliversFrame, fakeCamera } from '../testing/fake-camera';
import { jpegBlob } from '../testing/flow-fixtures';
import { renderWithFlow } from '../test-utils';
import { CameraCapture, type CameraCaptureProps } from './camera-capture';

function renderCamera(
  camera = fakeCamera(),
  props: Partial<CameraCaptureProps> = {},
  language: 'en' | 'es' = 'en',
) {
  const onCapture = vi.fn();
  const onCancel = vi.fn();
  const result = renderWithFlow(
    <CameraCapture
      facingMode="environment"
      guide="document"
      mirrored={false}
      onCapture={onCapture}
      onCancel={onCancel}
      {...props}
    />,
    { environment: camera.environment, language },
  );
  return { ...result, onCapture, onCancel, camera };
}

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

describe('CameraCapture', () => {
  it('asks the rear camera for its largest stream for a document, without audio (Phase 12A F1)', async () => {
    const { camera } = renderCamera();

    await screen.findByLabelText('Camera preview');
    expect(camera.requestCamera).toHaveBeenCalledWith({
      constraints: {
        audio: false,
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 4096 },
          height: { ideal: 3072 },
        },
      },
    });
    // Then the largest size the track says it can give.
    await waitFor(() => {
      expect(camera.applyConstraints).toHaveBeenCalledWith(
        expect.objectContaining({ width: { ideal: 1920 }, height: { ideal: 1080 } }),
      );
    });
  });

  it('keeps a face camera at up to 1080p, as it was', async () => {
    const { camera } = renderCamera(fakeCamera(), {
      facingMode: 'user',
      guide: 'face',
      mirrored: true,
    });

    await screen.findByLabelText('Camera preview');
    expect(camera.requestCamera).toHaveBeenCalledWith({
      constraints: {
        audio: false,
        video: { facingMode: { ideal: 'user' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
      },
    });
    expect(camera.applyConstraints).not.toHaveBeenCalled();
  });

  it('announces that the camera is starting, then that it is ready (F016)', async () => {
    const pending = deferred<CameraAccess>();
    const camera = fakeCamera();
    camera.requestCamera.mockReturnValue(pending.promise);
    renderCamera(camera);
    // One status region that stays mounted, so screen readers hear every change.
    const status = screen.getByRole('status');

    expect(status).toHaveTextContent('Starting your camera…');
    expect(screen.getByRole('button', { name: 'Capture' })).toBeDisabled();

    pending.resolve({ ok: true, stream: camera.stream });
    await cameraDeliversFrame();

    await waitFor(() => {
      expect(screen.getByRole('status')).toBe(status);
      expect(status).toHaveTextContent(en.capture.cameraReady);
    });
  });

  it('shows the live stream and enables Capture once a frame has arrived', async () => {
    const { camera } = renderCamera();
    const video = await screen.findByLabelText<HTMLVideoElement>('Camera preview');

    await waitFor(() => {
      expect(video.srcObject).toBe(camera.stream);
    });
    expect(screen.getByRole('button', { name: 'Capture' })).toBeDisabled();

    await cameraDeliversFrame();

    expect(screen.getByRole('button', { name: 'Capture' })).toBeEnabled();
  });

  it('takes a document photo with its check, from the live stream and the preview’s size (Phase 12A F1, F3)', async () => {
    const photo = jpegBlob();
    const check = { guideWidthPx: 2550, sharpness: 0.9, problem: null };
    const camera = fakeCamera();
    camera.captureDocument.mockResolvedValue({ photo, width: 3000, height: 4000, check });
    const { onCapture } = renderCamera(camera);
    await cameraDeliversFrame();

    await userEvent.click(screen.getByRole('button', { name: 'Capture' }));

    expect(camera.captureDocument).toHaveBeenCalledWith(
      screen.getByLabelText('Camera preview'),
      camera.stream,
      { width: 0, height: 0 },
    );
    expect(camera.captureFrame).not.toHaveBeenCalled();
    expect(onCapture).toHaveBeenCalledWith(photo, check);
  });

  it('captures the current frame for a face and hands the photo over unchecked', async () => {
    const photo = jpegBlob();
    const camera = fakeCamera();
    camera.captureFrame.mockResolvedValue(photo);
    const { onCapture } = renderCamera(camera, {
      facingMode: 'user',
      guide: 'face',
      mirrored: true,
    });
    await cameraDeliversFrame();

    await userEvent.click(screen.getByRole('button', { name: 'Capture' }));

    expect(camera.captureFrame).toHaveBeenCalledWith(screen.getByLabelText('Camera preview'));
    expect(camera.captureDocument).not.toHaveBeenCalled();
    expect(onCapture).toHaveBeenCalledWith(photo, null);
  });

  it('frames the barcode on an ID’s back: a band inside the card and a hint (Phase 12A F4)', async () => {
    renderCamera(fakeCamera(), { barcode: true });
    await screen.findByLabelText('Camera preview');

    expect(screen.getByText(en.capture.barcodeHint)).toBeVisible();
    expect(
      document.querySelector('[data-guide="document"] [data-guide-band="barcode"]'),
    ).toHaveAttribute('aria-hidden', 'true');
  });

  it('shows no barcode band or hint on a front', async () => {
    renderCamera();
    await screen.findByLabelText('Camera preview');

    expect(screen.queryByText(en.capture.barcodeHint)).not.toBeInTheDocument();
    expect(document.querySelector('[data-guide-band]')).not.toBeInTheDocument();
  });

  it('explains a failed capture and lets the user try again', async () => {
    const camera = fakeCamera();
    camera.captureDocument.mockRejectedValueOnce(new CaptureFrameError('no frame'));
    const { onCapture } = renderCamera(camera);
    await cameraDeliversFrame();

    await userEvent.click(screen.getByRole('button', { name: 'Capture' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(en.capture.captureFailed);
    expect(onCapture).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: 'Capture' }));

    expect(onCapture).toHaveBeenCalledTimes(1);
  });

  it('frames a document with a card-shaped guide and does not mirror the rear camera', async () => {
    renderCamera();
    const video = await screen.findByLabelText('Camera preview');

    expect(document.querySelector('[data-guide="document"]')).toHaveAttribute(
      'aria-hidden',
      'true',
    );
    expect(video).toHaveAttribute('data-mirrored', 'false');
  });

  it('frames a face with an oval guide and mirrors the front camera preview', async () => {
    const { camera } = renderCamera(fakeCamera(), {
      facingMode: 'user',
      guide: 'face',
      mirrored: true,
    });
    const video = await screen.findByLabelText('Camera preview');

    expect(document.querySelector('[data-guide="face"]')).toBeInTheDocument();
    expect(video).toHaveAttribute('data-mirrored', 'true');
    expect(camera.requestCamera).toHaveBeenCalledWith({
      constraints: expect.objectContaining({
        video: expect.objectContaining({ facingMode: { ideal: 'user' } }) as unknown,
      }) as unknown,
    });
  });

  it.each(CAMERA_ERROR_CODES)('explains the %s camera error', async (code) => {
    renderCamera(fakeCamera({ ok: false, error: { code } }));

    expect(await screen.findByRole('alert')).toHaveTextContent(en.camera.errors[code]);
    expect(screen.queryByLabelText('Camera preview')).not.toBeInTheDocument();
  });

  it('asks for the camera again after an error', async () => {
    const camera = fakeCamera();
    camera.requestCamera.mockResolvedValueOnce({ ok: false, error: { code: 'camera-in-use' } });
    renderCamera(camera);

    await userEvent.click(await screen.findByRole('button', { name: 'Try again' }));

    expect(await screen.findByLabelText('Camera preview')).toBeInTheDocument();
    expect(camera.requestCamera).toHaveBeenCalledTimes(2);
  });

  it('goes back from an error or from the live camera', async () => {
    const failing = renderCamera(fakeCamera({ ok: false, error: { code: 'no-camera' } }));
    await userEvent.click(await screen.findByRole('button', { name: 'Back' }));
    expect(failing.onCancel).toHaveBeenCalledTimes(1);
    failing.unmount();

    const live = renderCamera();
    await screen.findByLabelText('Camera preview');
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(live.onCancel).toHaveBeenCalledTimes(1);
  });

  it('turns the camera off when it is no longer shown', async () => {
    const { camera, unmount } = renderCamera();
    await screen.findByLabelText('Camera preview');

    unmount();

    expect(camera.stop).toHaveBeenCalledTimes(1);
  });

  it('turns off a camera that is granted after it was no longer needed', async () => {
    const pending = deferred<CameraAccess>();
    const camera = fakeCamera();
    camera.requestCamera.mockReturnValue(pending.promise);
    const { unmount } = renderCamera(camera);

    unmount();
    pending.resolve({ ok: true, stream: camera.stream });

    await waitFor(() => {
      expect(camera.stop).toHaveBeenCalledTimes(1);
    });
  });

  it('is translated', async () => {
    renderCamera(fakeCamera(), {}, 'es');

    expect(await screen.findByLabelText('Vista previa de la cámara')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Capturar' })).toBeDisabled();
  });
});
