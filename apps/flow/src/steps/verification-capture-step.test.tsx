import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { FlowApiError } from '../api/flow-api-client';
import type { FlowPosition, GovernmentIdStep } from '../flow/flow-position';
import { en } from '../i18n/locales/en';
import { fakeCamera } from '../testing/fake-camera';
import { FakeFlowApi } from '../testing/fake-flow-api';
import { pngFile } from '../testing/flow-fixtures';
import { renderWithFlow } from '../test-utils';
import { VerificationCaptureStep } from './verification-capture-step';

type CapturePosition = Extract<FlowPosition, { kind: 'capture' }> & { step: GovernmentIdStep };

const GOVERNMENT_ID: GovernmentIdStep = {
  id: 'government_id',
  type: 'government_id',
  sides: 'both',
  maxAttempts: 3,
  captureMethods: ['upload', 'camera'],
};

function capture(step: GovernmentIdStep, overrides: Partial<CapturePosition> = {}) {
  return {
    kind: 'capture',
    step,
    attempt: 1,
    maxAttempts: step.maxAttempts,
    verificationId: null,
    hints: [],
    ...overrides,
  } satisfies CapturePosition;
}

function renderStep(
  position: CapturePosition,
  {
    api = new FakeFlowApi(),
    camera = fakeCamera(),
    language = 'en',
  }: {
    api?: FakeFlowApi;
    camera?: ReturnType<typeof fakeCamera>;
    language?: 'en' | 'es';
  } = {},
) {
  api.consent = { textKeys: ['consent.biometric'], locale: 'en' };
  const onSubmitted = vi.fn(() => Promise.resolve());
  renderWithFlow(
    <VerificationCaptureStep position={position} client={api.client} onSubmitted={onSubmitted} />,
    { environment: camera.environment, language },
  );
  return { api, camera, onSubmitted };
}

async function uploadAndUse(label: string) {
  await userEvent.upload(screen.getByLabelText(label), pngFile());
  await userEvent.click(await screen.findByRole('button', { name: 'Use this photo' }));
}

describe('VerificationCaptureStep: government ID', () => {
  it('explains the step and counts the attempt', () => {
    renderStep(capture(GOVERNMENT_ID));

    expect(screen.getByRole('heading', { level: 1, name: 'Photograph your ID' })).toBeVisible();
    expect(screen.getByText(en.governmentId.intro)).toBeVisible();
    expect(screen.getByText('Attempt 1 of 3')).toBeVisible();
    expect(screen.getByRole('heading', { level: 2, name: 'Front of your ID' })).toBeVisible();
  });

  it('uploads the front and back by kind, then submits the verification', async () => {
    const { api, onSubmitted } = renderStep(capture(GOVERNMENT_ID));

    await uploadAndUse(en.governmentId.front.upload);
    await uploadAndUse(en.governmentId.back.upload);

    await waitFor(() => {
      expect(onSubmitted).toHaveBeenCalledTimes(1);
    });
    expect(api.client.createVerification).toHaveBeenCalledWith(
      { type: 'government-id' },
      expect.any(AbortSignal),
    );
    expect(api.uploadedKinds()).toEqual(['front', 'back']);
    expect(api.client.submitVerification).toHaveBeenCalledTimes(1);
    expect(api.verifications.map((v) => v.status)).toEqual(['submitted']);
  });

  it('announces the upload while it runs', async () => {
    const api = new FakeFlowApi();
    api.client.submitVerification.mockReturnValue(new Promise(() => undefined));
    renderStep(capture(GOVERNMENT_ID, { step: { ...GOVERNMENT_ID, sides: 'front' } }), { api });

    await uploadAndUse(en.governmentId.front.upload);

    expect(await screen.findByRole('status')).toHaveTextContent('Uploading your photos…');
  });

  it('asks only for the sides the step needs', async () => {
    const { api } = renderStep(capture({ ...GOVERNMENT_ID, sides: 'back' }));

    expect(screen.getByRole('heading', { level: 2, name: 'Back of your ID' })).toBeVisible();
    await uploadAndUse(en.governmentId.back.upload);

    await waitFor(() => {
      expect(api.uploadedKinds()).toEqual(['back']);
    });
  });

  it('offers only the capture methods the step allows', () => {
    renderStep(capture({ ...GOVERNMENT_ID, captureMethods: ['camera'] }));

    expect(screen.getByRole('button', { name: 'Take a photo' })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Upload a photo' })).not.toBeInTheDocument();
  });

  it('uses the rear camera with a card-shaped guide', async () => {
    const { camera } = renderStep(capture(GOVERNMENT_ID));

    await userEvent.click(screen.getByRole('button', { name: 'Take a photo' }));

    expect(await screen.findByLabelText('Camera preview')).toHaveAttribute(
      'data-mirrored',
      'false',
    );
    expect(document.querySelector('[data-guide="document"]')).toBeInTheDocument();
    expect(camera.requestCamera).toHaveBeenCalledWith({
      constraints: expect.objectContaining({
        video: expect.objectContaining({ facingMode: { ideal: 'environment' } }) as unknown,
      }) as unknown,
    });
  });

  it('frames the barcode on the back only (Phase 12A F4)', async () => {
    renderStep(capture(GOVERNMENT_ID));

    await userEvent.click(screen.getByRole('button', { name: 'Take a photo' }));
    await screen.findByLabelText('Camera preview');
    expect(screen.queryByText(en.capture.barcodeHint)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await uploadAndUse('Choose a photo of the front of your ID');
    await userEvent.click(screen.getByRole('button', { name: 'Take a photo' }));

    await screen.findByLabelText('Camera preview');
    expect(screen.getByText(en.capture.barcodeHint)).toBeVisible();
    expect(document.querySelector('[data-guide-band="barcode"]')).toBeInTheDocument();
  });

  it('shows why the last attempt failed', () => {
    renderStep(
      capture(GOVERNMENT_ID, {
        attempt: 2,
        hints: [{ name: 'id_glare_detection', reasons: ['glare_present'] }],
      }),
    );

    expect(screen.getByText('Attempt 2 of 3')).toBeVisible();
    expect(screen.getByRole('alert')).toHaveTextContent(en.retry.reasons.glare_present);
  });

  it('fills the verification already started instead of using another attempt', async () => {
    const api = new FakeFlowApi();
    const { client } = api;
    await client.createVerification({ type: 'government-id' });
    const [started] = api.verifications;
    client.createVerification.mockClear();
    renderStep(capture(GOVERNMENT_ID, { verificationId: started?.id ?? null }), { api });

    await uploadAndUse(en.governmentId.front.upload);
    await uploadAndUse(en.governmentId.back.upload);

    await waitFor(() => {
      expect(client.submitVerification).toHaveBeenCalledWith(started?.id, expect.any(AbortSignal));
    });
    expect(client.createVerification).not.toHaveBeenCalled();
  });

  it('retries a failed upload without starting over', async () => {
    const api = new FakeFlowApi();
    api.client.uploadFile.mockRejectedValueOnce(
      new FlowApiError('http', 'POST failed with HTTP 503', { status: 503 }),
    );
    const { onSubmitted } = renderStep(capture({ ...GOVERNMENT_ID, sides: 'front' }), { api });
    await uploadAndUse(en.governmentId.front.upload);

    expect(await screen.findByRole('alert')).toHaveTextContent(en.errors.server);

    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));

    await waitFor(() => {
      expect(onSubmitted).toHaveBeenCalledTimes(1);
    });
    expect(api.client.createVerification).toHaveBeenCalledTimes(1);
    expect(api.uploadedKinds()).toEqual(['front']);
  });

  it('reloads the session when a retried submit answers 409, instead of looping (F017)', async () => {
    // The first submit reached the server but its answer was lost; by the retry the
    // verification has moved on, so only the session can say where the user is now.
    const api = new FakeFlowApi();
    api.client.submitVerification
      .mockRejectedValueOnce(new FlowApiError('network', 'POST failed: network error'))
      .mockRejectedValueOnce(
        new FlowApiError('http', 'POST failed with HTTP 409', { status: 409 }),
      );
    const { onSubmitted } = renderStep(capture({ ...GOVERNMENT_ID, sides: 'front' }), { api });
    await uploadAndUse(en.governmentId.front.upload);
    expect(await screen.findByRole('alert')).toHaveTextContent(en.errors.network);

    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));

    await waitFor(() => {
      expect(onSubmitted).toHaveBeenCalledTimes(1);
    });
    expect(api.client.submitVerification).toHaveBeenCalledTimes(2);
    expect(api.uploadedKinds()).toEqual(['front']);
  });

  it('keeps focus on Try again while the retried upload runs (WCAG 2.4.3, 3B follow-up)', async () => {
    const api = new FakeFlowApi();
    api.client.uploadFile
      .mockRejectedValueOnce(new FlowApiError('http', 'POST failed with HTTP 503', { status: 503 }))
      .mockImplementationOnce(() => new Promise(() => undefined));
    renderStep(capture({ ...GOVERNMENT_ID, sides: 'front' }), { api });
    await uploadAndUse(en.governmentId.front.upload);
    expect(await screen.findByRole('alert')).toHaveTextContent(en.errors.server);
    const retry = screen.getByRole('button', { name: 'Try again' });

    await userEvent.click(retry);

    expect(document.activeElement).toBe(retry);
    expect(retry).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByRole('status')).toHaveTextContent('Uploading your photos…');
  });

  it('keeps focus on Try again when the retry fails too', async () => {
    const api = new FakeFlowApi();
    const unavailable = new FlowApiError('http', 'POST failed with HTTP 503', { status: 503 });
    api.client.uploadFile.mockRejectedValueOnce(unavailable).mockRejectedValueOnce(unavailable);
    renderStep(capture({ ...GOVERNMENT_ID, sides: 'front' }), { api });
    await uploadAndUse(en.governmentId.front.upload);
    const retry = await screen.findByRole('button', { name: 'Try again' });

    await userEvent.click(retry);

    await waitFor(() => {
      expect(retry).not.toHaveAttribute('aria-disabled');
    });
    expect(document.activeElement).toBe(retry);
    expect(screen.getByRole('alert')).toHaveTextContent(en.errors.server);
  });

  it('lets the user retake the photos after a failed upload', async () => {
    const api = new FakeFlowApi();
    api.client.uploadFile.mockRejectedValueOnce(
      new FlowApiError('http', 'POST failed with HTTP 422', { status: 422 }),
    );
    renderStep(capture({ ...GOVERNMENT_ID, sides: 'front' }), { api });
    await uploadAndUse(en.governmentId.front.upload);
    expect(await screen.findByRole('alert')).toHaveTextContent(en.errors.unsupportedImage);

    await userEvent.click(screen.getByRole('button', { name: 'Retake photos' }));
    await uploadAndUse(en.governmentId.front.upload);

    await waitFor(() => {
      expect(api.uploadedKinds()).toEqual(['front']);
    });
    expect(api.client.createVerification).toHaveBeenCalledTimes(1);
  });
});
