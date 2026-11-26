import type { ClientStepView } from '@openverify/flow-spec';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { FlowPosition, GovernmentIdStep } from '../flow/flow-position';
import { en } from '../i18n/locales/en';
import { captureMethodsFor, webDeviceKind } from '../lib/capture-methods';
import { fakeCamera } from '../testing/fake-camera';
import { FakeFlowApi } from '../testing/fake-flow-api';
import { pngFile } from '../testing/flow-fixtures';
import { renderWithFlow } from '../test-utils';
import { VerificationCaptureStep } from './verification-capture-step';

// C153.2 (Workflow 9A; decision 22): `captureMethodsByDevice` per device class, which the client
// applies for its own class, and the upload's client-reported `capture-method` (guidance for
// analytics, never proof of how a photo was taken).

type IdView = Extract<ClientStepView, { type: 'government_id' }>;

const BY_DEVICE: IdView = {
  id: 'id_card',
  type: 'government_id',
  sides: 'front',
  maxAttempts: 2,
  captureMethods: ['upload', 'camera'],
  captureMethodsByDevice: { 'mobile-web': ['camera'], 'desktop-web': ['upload'] },
};

describe('captureMethodsFor', () => {
  it('takes the entry of the client device class, else the step methods', () => {
    expect(captureMethodsFor(BY_DEVICE, 'mobile-web')).toEqual(['camera']);
    expect(captureMethodsFor(BY_DEVICE, 'desktop-web')).toEqual(['upload']);
    expect(
      captureMethodsFor(
        { ...BY_DEVICE, captureMethodsByDevice: { native: ['camera'] } },
        'mobile-web',
      ),
    ).toEqual(['upload', 'camera']);
    expect(
      captureMethodsFor({ ...BY_DEVICE, captureMethodsByDevice: undefined }, 'desktop-web'),
    ).toEqual(['upload', 'camera']);
  });
});

describe('webDeviceKind', () => {
  it('reads a phone or a tablet browser as mobile-web, anything else as desktop-web', () => {
    expect(
      webDeviceKind({ userAgent: 'Mozilla/5.0 (Linux; Android 15) Mobile Safari/537.36' }),
    ).toBe('mobile-web');
    expect(webDeviceKind({ userAgent: 'Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X)' })).toBe(
      'mobile-web',
    );
    expect(webDeviceKind({ userAgent: 'Mozilla/5.0 (X11; Linux x86_64) Chrome/140.0' })).toBe(
      'desktop-web',
    );
    expect(
      webDeviceKind({
        userAgent: 'Mozilla/5.0 (X11; Linux x86_64)',
        userAgentData: { mobile: true },
      }),
    ).toBe('mobile-web');
  });
});

function renderStep(step: GovernmentIdStep, deviceKind: 'desktop-web' | 'mobile-web') {
  const api = new FakeFlowApi();
  api.consent = { textKeys: ['consent.biometric'], locale: 'en' };
  const camera = fakeCamera();
  const position = {
    kind: 'capture',
    step,
    attempt: 1,
    maxAttempts: step.maxAttempts,
    verificationId: null,
    hints: [],
  } satisfies Extract<FlowPosition, { kind: 'capture' }>;
  renderWithFlow(
    <VerificationCaptureStep
      position={position}
      client={api.client}
      onSubmitted={vi.fn(() => Promise.resolve())}
    />,
    { environment: { ...camera.environment, deviceKind } },
  );
  return api;
}

describe('a government ID step by device class (C153.2)', () => {
  it('offers only the camera on a phone when the step says so', () => {
    renderStep(BY_DEVICE, 'mobile-web');

    expect(screen.getByRole('button', { name: 'Take a photo' })).toBeVisible();
    expect(screen.queryByLabelText(en.governmentId.front.upload)).not.toBeInTheDocument();
  });

  it('offers only an upload on a desktop, and reports the upload as the capture method', async () => {
    const api = renderStep(BY_DEVICE, 'desktop-web');

    expect(screen.queryByRole('button', { name: 'Take a photo' })).not.toBeInTheDocument();
    await userEvent.upload(screen.getByLabelText(en.governmentId.front.upload), pngFile());
    await userEvent.click(await screen.findByRole('button', { name: 'Use this photo' }));

    await waitFor(() => {
      expect(api.client.uploadFile).toHaveBeenCalledWith(
        expect.stringMatching(/^ver_/u),
        'front',
        expect.any(Blob),
        expect.any(AbortSignal),
        undefined,
        'upload',
      );
    });
  });
});
