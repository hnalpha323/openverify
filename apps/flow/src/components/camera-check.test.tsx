import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { en } from '../i18n/locales/en';
import { CAMERA_ERROR_CODES, type CameraAccess } from '../lib/camera-permission';
import { renderWithI18n } from '../test-utils';
import { CameraCheck } from './camera-check';

const ALLOW = 'Allow camera access';

function streamWithTrack(stop: () => void): MediaStream {
  return { getTracks: () => [{ stop }] } as unknown as MediaStream;
}

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

describe('CameraCheck', () => {
  it('explains why the camera is needed', () => {
    renderWithI18n(<CameraCheck requestCamera={vi.fn()} />);

    expect(screen.getByRole('heading', { level: 1, name: 'Camera access' })).toBeVisible();
    expect(screen.getByText(/take photos of your ID document and a selfie/)).toBeVisible();
    expect(screen.getByRole('button', { name: ALLOW })).toBeEnabled();
  });

  it('reports a ready camera and releases it straight away', async () => {
    const stop = vi.fn();
    const requestCamera = vi
      .fn<() => Promise<CameraAccess>>()
      .mockResolvedValue({ ok: true, stream: streamWithTrack(stop) });
    renderWithI18n(<CameraCheck requestCamera={requestCamera} />);

    await userEvent.click(screen.getByRole('button', { name: ALLOW }));

    expect(await screen.findByRole('status')).toHaveTextContent('Your camera is ready.');
    expect(requestCamera).toHaveBeenCalledTimes(1);
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it('disables the button while waiting for permission, then allows a retry', async () => {
    const pending = deferred<CameraAccess>();
    renderWithI18n(<CameraCheck requestCamera={() => pending.promise} />);
    const button = screen.getByRole('button', { name: ALLOW });

    await userEvent.click(button);

    expect(button).toBeDisabled();
    expect(screen.getByRole('status')).toHaveTextContent('Waiting for camera permission…');

    pending.resolve({ ok: false, error: { code: 'permission-denied' } });

    expect(await screen.findByRole('alert')).toBeVisible();
    expect(button).toBeEnabled();
  });

  it.each(CAMERA_ERROR_CODES)('explains the %s error', async (code) => {
    renderWithI18n(
      <CameraCheck requestCamera={() => Promise.resolve({ ok: false, error: { code } })} />,
    );

    await userEvent.click(screen.getByRole('button', { name: ALLOW }));

    expect(await screen.findByRole('alert')).toHaveTextContent(en.camera.errors[code]);
  });

  it('uses the browser camera by default', async () => {
    renderWithI18n(<CameraCheck />);

    await userEvent.click(screen.getByRole('button', { name: ALLOW }));

    // jsdom has no navigator.mediaDevices.
    expect(await screen.findByRole('alert')).toHaveTextContent(en.camera.errors.unsupported);
  });

  it('is translated', () => {
    renderWithI18n(<CameraCheck requestCamera={vi.fn()} />, 'es');

    expect(screen.getByRole('button', { name: 'Permitir acceso a la cámara' })).toBeEnabled();
  });
});
