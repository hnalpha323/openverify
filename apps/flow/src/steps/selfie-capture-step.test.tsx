/**
 * C46.1, C40: the guided selfie step against the in-memory flow API (which enforces C40) and a
 * fake camera with an injected face detector. The camera stays open for the whole capture; the
 * verification and the capture exist before the first prompt; each pose is uploaded before the
 * next prompt; submit names the capture with the device snapshot.
 */
import type { FileResource } from '@openverify/contracts';
import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FlowApiError } from '../api/flow-api-client';
import type { FlowEnvironment } from '../flow/flow-environment';
import type { SelfieStep } from '../flow/flow-position';
import { en } from '../i18n/locales/en';
import {
  FAKE_TRACK_LABEL,
  cameraDeliversFrame,
  fakeCamera,
  fakeDetector,
  type FakeCamera,
} from '../testing/fake-camera';
import { FakeFlowApi } from '../testing/fake-flow-api';
import { pngFile } from '../testing/flow-fixtures';
import { syntheticFace } from '../testing/synthetic-faces';
import type { HeldFrame, SampledFrame } from '../lib/sample-frame';
import { renderWithFlow } from '../test-utils';
import { SelfieCaptureStep, type SelfieCapturePosition } from './selfie-capture-step';

const ACTIVE: SelfieStep = {
  id: 'selfie',
  type: 'selfie',
  poses: ['center', 'left', 'right'],
  liveness: 'active',
  maxAttempts: 3,
};

const PASSIVE: SelfieStep = { ...ACTIVE, poses: ['center'], liveness: 'passive' };

function position(
  step: SelfieStep = ACTIVE,
  overrides: Partial<SelfieCapturePosition> = {},
): SelfieCapturePosition {
  return {
    kind: 'capture',
    step,
    attempt: 1,
    maxAttempts: step.maxAttempts,
    verificationId: null,
    hints: [],
    ...overrides,
  };
}

interface RenderOptions {
  readonly api?: FakeFlowApi;
  readonly camera?: FakeCamera;
  readonly sandbox?: boolean;
  readonly language?: 'en' | 'es';
  /** Replaces parts of the camera's environment (KP10-3: a sampler that holds its frames). */
  readonly environment?: Partial<FlowEnvironment>;
}

function renderStep(at: SelfieCapturePosition = position(), options: RenderOptions = {}) {
  const api = options.api ?? new FakeFlowApi();
  api.consent = { textKeys: ['consent.biometric'], locale: 'en' };
  api.flow = {
    ...api.flow,
    steps: api.flow.steps.map((step) => (step.type === 'selfie' ? at.step : step)),
  };
  const camera = options.camera ?? fakeCamera();
  const onSubmitted = vi.fn(() => Promise.resolve());
  const view = renderWithFlow(
    <SelfieCaptureStep
      position={at}
      client={api.client}
      onSubmitted={onSubmitted}
      {...(options.sandbox === undefined ? {} : { sandbox: options.sandbox })}
    />,
    {
      environment: { ...camera.environment, ...options.environment },
      language: options.language ?? 'en',
    },
  );
  return { api, camera, onSubmitted, view };
}

function announcement(): HTMLElement {
  return screen.getByTestId('selfie-announcement');
}

function shutter(): HTMLElement {
  return screen.getByRole('button', { name: 'Capture' });
}

async function startCamera(): Promise<void> {
  await userEvent.click(screen.getByRole('button', { name: 'Start the camera' }));
  await cameraDeliversFrame();
  await waitFor(() => {
    expect(announcement()).toHaveTextContent(/^Photo 1 of \d+/);
  });
}

/** Presses the manual shutter for prompt `current` of `total`, once it is available. */
async function shoot(current: number, total = 3): Promise<void> {
  await waitFor(() => {
    expect(announcement()).toHaveTextContent(`Photo ${String(current)} of ${String(total)}:`);
    expect(shutter()).not.toHaveAttribute('aria-disabled', 'true');
  });
  await userEvent.click(shutter());
}

/** Holds `mock`'s next call until `release` is called, then runs its own implementation. */
function gate<Args extends unknown[], Result>(mock: {
  getMockImplementation(): ((...args: Args) => Promise<Result>) | undefined;
  mockImplementationOnce(fn: (...args: Args) => Promise<Result>): unknown;
}): () => void {
  const original = mock.getMockImplementation();
  const releases: (() => void)[] = [];
  const opened = new Promise<void>((resolve) => {
    releases.push(resolve);
  });
  mock.mockImplementationOnce(async (...args: Args) => {
    await opened;
    if (original === undefined) {
      throw new Error('no implementation to run');
    }
    return original(...args);
  });
  return () => {
    for (const release of releases) {
      release();
    }
  };
}

function captureProblem(code: string): FlowApiError {
  return new FlowApiError('http', 'POST failed with HTTP 409', {
    status: 409,
    problem: {
      type: 'about:blank',
      title: 'Conflict',
      status: 409,
      detail: 'Conflict.',
      instance: '/api/v1/flow/verifications/ver_x/submit',
      requestId: 'req-1',
      code,
    },
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('SelfieCaptureStep: before the camera starts', () => {
  it('explains the step and asks nothing of the API or the camera yet', () => {
    const { api, camera } = renderStep();

    expect(screen.getByRole('heading', { level: 1, name: 'Take a selfie' })).toBeVisible();
    expect(screen.getByText(en.selfie.intro)).toBeVisible();
    expect(screen.getByText(en.selfie.howItWorks)).toBeVisible();
    expect(screen.getByText('Attempt 1 of 3')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Start the camera' })).toBeVisible();
    expect(api.client.createVerification).not.toHaveBeenCalled();
    expect(api.client.createSelfieCapture).not.toHaveBeenCalled();
    expect(camera.requestCamera).not.toHaveBeenCalled();
  });

  it('says a centre-only step takes one photo', () => {
    renderStep(position(PASSIVE));

    expect(screen.getByText(en.selfie.howItWorksCenter)).toBeVisible();
  });

  it('shows why the last attempt failed', () => {
    renderStep(
      position(ACTIVE, {
        attempt: 2,
        hints: [{ name: 'selfie_pose_detection', reasons: ['pose_not_left'] }],
      }),
    );

    expect(screen.getByRole('alert')).toHaveTextContent(en.retry.reasons.pose_not_left);
  });

  it('offers no upload in production', () => {
    renderStep(position(), { sandbox: false });

    expect(screen.queryByRole('button', { name: 'Upload photos' })).not.toBeInTheDocument();
  });

  it('is translated', () => {
    renderStep(position(), { language: 'es' });

    expect(screen.getByRole('heading', { level: 1, name: 'Hazte un selfi' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Abrir la cámara' })).toBeVisible();
  });
});

describe('SelfieCaptureStep: the capture protocol (C40)', () => {
  it('opens the front camera, then creates the verification and the capture before the first prompt', async () => {
    const { api, camera } = renderStep();

    await userEvent.click(screen.getByRole('button', { name: 'Start the camera' }));

    expect(await screen.findByLabelText('Camera preview')).toHaveAttribute('data-mirrored', 'true');
    expect(document.querySelector('[data-guide="face"]')).toBeInTheDocument();
    expect(camera.requestCamera).toHaveBeenCalledWith({
      constraints: expect.objectContaining({
        audio: false,
        video: expect.objectContaining({ facingMode: { ideal: 'user' } }) as unknown,
      }) as unknown,
    });
    expect(api.client.createSelfieCapture).not.toHaveBeenCalled();

    await cameraDeliversFrame();

    await waitFor(() => {
      expect(api.client.createSelfieCapture).toHaveBeenCalledWith(
        api.verifications[0]?.id,
        { method: 'camera' },
        expect.any(AbortSignal),
      );
    });
    expect(api.verifications.map(({ type }) => type)).toEqual(['selfie']);
    expect(
      await screen.findByRole('heading', { level: 2, name: 'Look straight ahead' }),
    ).toBeVisible();
  });

  it('prompts in the server’s order and announces each prompt', async () => {
    const api = new FakeFlowApi();
    api.capturePrompts = ['center', 'right', 'left'];
    renderStep(position(), { api });

    await startCamera();
    expect(announcement()).toHaveTextContent('Photo 1 of 3: Look straight ahead');
    await shoot(1);
    await waitFor(() => {
      expect(announcement()).toHaveTextContent('Photo 2 of 3: Turn your head to the right');
    });
    expect(
      screen.getByRole('heading', { level: 2, name: 'Turn your head to the right' }),
    ).toBeVisible();
    await shoot(2);
    await waitFor(() => {
      expect(announcement()).toHaveTextContent('Photo 3 of 3: Turn your head to the left');
    });
  });

  it('uploads each pose before the next prompt, with the capture id, nonce and elapsed time', async () => {
    const api = new FakeFlowApi();
    const release = gate<Parameters<FakeFlowApi['client']['uploadFile']>, FileResource>(
      api.client.uploadFile,
    );
    const { camera } = renderStep(position(), { api });
    await startCamera();
    camera.clock.advance(1_500);

    await shoot(1);

    await waitFor(() => {
      expect(announcement()).toHaveTextContent('Uploading photo 1 of 3…');
    });
    expect(screen.getByRole('heading', { level: 2, name: 'Look straight ahead' })).toBeVisible();
    expect(shutter()).toHaveAttribute('aria-disabled', 'true');
    release();
    await waitFor(() => {
      expect(announcement()).toHaveTextContent('Photo 2 of 3: Turn your head to the left');
    });
    const [capture] = api.captures;
    expect(api.uploads).toEqual([
      {
        verificationId: capture?.verificationId,
        kind: 'selfie-center',
        file: expect.any(Blob) as unknown,
        capture: { captureId: capture?.id, nonce: capture?.nonce, clientElapsedMs: 1_500 },
      },
    ]);
  });

  it('submits naming the capture, with the camera’s snapshot and image-mirrored false', async () => {
    const { api, onSubmitted } = renderStep();
    await startCamera();

    await shoot(1);
    await shoot(2);
    await shoot(3);

    await waitFor(() => {
      expect(onSubmitted).toHaveBeenCalledTimes(1);
    });
    expect(api.uploadedKinds()).toEqual(['selfie-center', 'selfie-left', 'selfie-right']);
    const [capture] = api.captures;
    expect(api.submits).toEqual([
      {
        verificationId: capture?.verificationId,
        body: {
          capture: {
            id: capture?.id,
            nonce: capture?.nonce,
            device: {
              label: FAKE_TRACK_LABEL,
              settings: {
                width: 1280,
                height: 720,
                'frame-rate': 30,
                'facing-mode': 'user',
                'resize-mode': 'none',
              },
              capabilities: { 'width-max': 1920, 'height-max': 1080, 'facing-modes': ['user'] },
              webdriver: false,
              'image-mirrored': false,
            },
          },
        },
      },
    ]);
  });

  it('keeps the camera open for the whole capture, and closes it when the step goes away', async () => {
    const { camera, onSubmitted, view } = renderStep();
    await startCamera();

    await shoot(1);
    await shoot(2);
    await shoot(3);
    await waitFor(() => {
      expect(onSubmitted).toHaveBeenCalled();
    });

    expect(camera.requestCamera).toHaveBeenCalledTimes(1);
    expect(camera.captureFrame).toHaveBeenCalledTimes(3);
    view.unmount();
    expect(camera.stop).toHaveBeenCalled();
  });

  it('retries a failed upload for that pose, with the same photo, before moving on', async () => {
    const api = new FakeFlowApi();
    api.client.uploadFile.mockRejectedValueOnce(
      new FlowApiError('http', 'POST failed with HTTP 503', { status: 503 }),
    );
    const { camera } = renderStep(position(), { api });
    await startCamera();
    await shoot(1);

    expect(await screen.findByRole('alert')).toHaveTextContent(en.errors.server);
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));

    await waitFor(() => {
      expect(announcement()).toHaveTextContent('Photo 2 of 3');
    });
    expect(api.uploadedKinds()).toEqual(['selfie-center']);
    expect(camera.captureFrame).toHaveBeenCalledTimes(1);
    expect(api.client.uploadFile).toHaveBeenCalledTimes(2);
    expect(api.client.uploadFile.mock.calls[1]?.[2]).toBe(api.client.uploadFile.mock.calls[0]?.[2]);
  });

  it('lets the user retake a pose whose upload failed', async () => {
    const api = new FakeFlowApi();
    api.client.uploadFile.mockRejectedValueOnce(
      new FlowApiError('http', 'POST failed with HTTP 422', { status: 422 }),
    );
    const { camera } = renderStep(position(), { api });
    await startCamera();
    await shoot(1);
    expect(await screen.findByRole('alert')).toHaveTextContent(en.errors.unsupportedImage);

    await userEvent.click(screen.getByRole('button', { name: 'Retake this photo' }));
    await shoot(1);

    await waitFor(() => {
      expect(api.uploadedKinds()).toEqual(['selfie-center']);
    });
    expect(camera.captureFrame).toHaveBeenCalledTimes(2);
  });

  it('starts again with a new capture after 409 selfie_capture_invalid, without reopening the camera', async () => {
    const api = new FakeFlowApi();
    api.client.submitVerification.mockRejectedValueOnce(captureProblem('selfie_capture_invalid'));
    const { camera, onSubmitted } = renderStep(position(), { api });
    await startCamera();
    await shoot(1);
    await shoot(2);
    await shoot(3);

    await waitFor(() => {
      expect(announcement()).toHaveTextContent(en.selfie.restarted);
    });
    expect(announcement()).toHaveTextContent('Photo 1 of 3: Look straight ahead');
    expect(api.client.createSelfieCapture).toHaveBeenCalledTimes(2);
    expect(api.captures.map(({ status }) => status)).toEqual(['errored', 'initiated']);

    await shoot(1);
    await shoot(2);
    await shoot(3);
    await waitFor(() => {
      expect(onSubmitted).toHaveBeenCalledTimes(1);
    });
    expect(camera.requestCamera).toHaveBeenCalledTimes(1);
    expect(api.submits.at(-1)?.body?.capture?.id).toBe(api.captures[1]?.id);
  });

  it('starts again when an upload finds the capture no longer valid', async () => {
    const api = new FakeFlowApi();
    api.client.uploadFile.mockRejectedValueOnce(captureProblem('selfie_capture_invalid'));
    renderStep(position(), { api });
    await startCamera();

    await shoot(1);

    await waitFor(() => {
      expect(announcement()).toHaveTextContent(en.selfie.restarted);
    });
    expect(api.client.createSelfieCapture).toHaveBeenCalledTimes(2);
  });

  it('hands over to the session when the capture limit canceled the verification', async () => {
    const api = new FakeFlowApi();
    api.client.createSelfieCapture.mockRejectedValueOnce(captureProblem('selfie_capture_limit'));
    const { onSubmitted } = renderStep(position(), { api });

    await userEvent.click(screen.getByRole('button', { name: 'Start the camera' }));
    await cameraDeliversFrame();

    await waitFor(() => {
      expect(onSubmitted).toHaveBeenCalledTimes(1);
    });
  });

  it('explains a capture that could not be created, and tries again on request', async () => {
    const api = new FakeFlowApi();
    api.client.createSelfieCapture.mockRejectedValueOnce(
      new FlowApiError('network', 'POST failed: no response'),
    );
    renderStep(position(), { api });
    await userEvent.click(screen.getByRole('button', { name: 'Start the camera' }));
    await cameraDeliversFrame();

    expect(await screen.findByRole('alert')).toHaveTextContent(en.errors.network);
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));

    await waitFor(() => {
      expect(announcement()).toHaveTextContent('Photo 1 of 3');
    });
    expect(api.verifications).toHaveLength(1);
  });

  it('fills the verification already started instead of using another attempt', async () => {
    const api = new FakeFlowApi();
    api.consent = { textKeys: ['consent.biometric'], locale: 'en' };
    const { id } = await api.client.createVerification({ type: 'selfie' });
    api.client.createVerification.mockClear();
    renderStep(position(ACTIVE, { verificationId: id }), { api });

    await startCamera();

    expect(api.client.createVerification).not.toHaveBeenCalled();
    expect(api.captures[0]?.verificationId).toBe(id);
  });

  it('closes the camera on Cancel and returns to the start, with focus on Start the camera', async () => {
    const { camera } = renderStep();
    await startCamera();

    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(camera.stop).toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Start the camera' })).toHaveFocus();
  });

  it('explains a camera that cannot start, and creates nothing', async () => {
    const camera = fakeCamera({ ok: false, error: { code: 'permission-denied' } });
    const { api } = renderStep(position(), { camera });

    await userEvent.click(screen.getByRole('button', { name: 'Start the camera' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      en.camera.errors['permission-denied'],
    );
    expect(screen.getByRole('button', { name: 'Try again' })).toBeVisible();
    expect(api.client.createVerification).not.toHaveBeenCalled();
  });
});

describe('SelfieCaptureStep: a camera that stops mid-capture (Workflow 4B review H013)', () => {
  it.each([
    [
      'ends',
      (camera: FakeCamera) => {
        camera.endTrack();
      },
    ],
    [
      'is muted',
      (camera: FakeCamera) => {
        camera.muteTrack();
      },
    ],
  ])(
    'when the video track %s, says so, never takes the frozen frame, and goes on after Try again',
    async (_label, stopCamera) => {
      const { api, camera } = renderStep();
      await startCamera();
      await waitFor(() => {
        expect(shutter()).not.toHaveAttribute('aria-disabled', 'true');
      });

      act(() => {
        stopCamera(camera);
      });

      expect(await screen.findByRole('alert')).toHaveTextContent(en.camera.errors['camera-in-use']);
      expect(screen.queryByRole('button', { name: 'Capture' })).toBeNull();
      expect(screen.queryByLabelText('Camera preview')).toBeNull();
      expect(camera.stop).toHaveBeenCalled();
      expect(camera.captureFrame).not.toHaveBeenCalled();

      await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
      await cameraDeliversFrame();
      await shoot(1);
      await waitFor(() => {
        expect(api.uploadedKinds()).toEqual(['selfie-center']);
      });
      expect(camera.requestCamera).toHaveBeenCalledTimes(2);
      // The same capture goes on: the camera restarted, the protocol did not.
      expect(api.captures).toHaveLength(1);
    },
  );

  it('reads a track that is already over when the camera is granted as a stopped camera', async () => {
    const camera = fakeCamera();
    camera.requestCamera.mockImplementationOnce(() => {
      camera.endTrack();
      return Promise.resolve({ ok: true, stream: camera.stream });
    });
    const { api } = renderStep(position(), { camera });

    await userEvent.click(screen.getByRole('button', { name: 'Start the camera' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(en.camera.errors['camera-in-use']);
    expect(camera.stop).toHaveBeenCalled();
    expect(api.client.createVerification).not.toHaveBeenCalled();
  });

  it('lets the guidance take no photo while the camera is stopped, and auto-captures once it is back', async () => {
    const detector = fakeDetector([syntheticFace()]);
    const camera = fakeCamera({ detector });
    const { api } = renderStep(position(), { camera });
    await startCamera();
    await waitFor(() => {
      expect(screen.getByText(en.selfie.guidance['hold-still'])).toBeVisible();
    });

    act(() => {
      camera.endTrack();
    });
    await screen.findByRole('alert');
    camera.clock.advance(500);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(camera.captureFrame).not.toHaveBeenCalled();
    expect(api.uploadedKinds()).toEqual([]);

    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await cameraDeliversFrame();
    await waitFor(() => {
      expect(screen.getByText(en.selfie.guidance['hold-still'])).toBeVisible();
    });
    camera.clock.advance(500);
    await waitFor(() => {
      expect(api.uploadedKinds()).toEqual(['selfie-center']);
    });
  });
});

describe('SelfieCaptureStep: focus (WCAG 2.4.3)', () => {
  it('moves focus to the prompt when the camera starts', async () => {
    renderStep();

    await startCamera();

    expect(screen.getByRole('heading', { level: 2, name: 'Look straight ahead' })).toHaveFocus();
  });

  it('keeps focus on the shutter while the photo uploads, and into the next prompt', async () => {
    const api = new FakeFlowApi();
    const release = gate<Parameters<FakeFlowApi['client']['uploadFile']>, FileResource>(
      api.client.uploadFile,
    );
    renderStep(position(), { api });
    await startCamera();

    await shoot(1);

    expect(shutter()).toHaveFocus();
    expect(shutter()).toHaveAttribute('aria-disabled', 'true');
    release();
    await waitFor(() => {
      expect(announcement()).toHaveTextContent('Photo 2 of 3');
    });
    expect(shutter()).toHaveFocus();
  });

  it('keeps focus on Try again while the retried upload runs', async () => {
    const api = new FakeFlowApi();
    api.client.uploadFile.mockRejectedValueOnce(
      new FlowApiError('http', 'POST failed with HTTP 503', { status: 503 }),
    );
    gate<Parameters<FakeFlowApi['client']['uploadFile']>, FileResource>(api.client.uploadFile);
    renderStep(position(), { api });
    await startCamera();
    await shoot(1);
    const retry = await screen.findByRole('button', { name: 'Try again' });

    await userEvent.click(retry);

    expect(document.activeElement).toBe(retry);
    expect(retry).toHaveAttribute('aria-disabled', 'true');
  });
});

describe('SelfieCaptureStep: guidance (C46.1)', () => {
  it('takes the centre automatically once a frontal face has been held for hold-ms', async () => {
    const detector = fakeDetector([syntheticFace()]);
    const camera = fakeCamera({ detector });
    const { api } = renderStep(position(), { camera });
    await startCamera();
    await waitFor(() => {
      expect(screen.getByText(en.selfie.guidance['hold-still'])).toBeVisible();
    });
    expect(shutter()).toHaveAttribute('aria-disabled', 'true');

    camera.clock.advance(500);

    await waitFor(() => {
      expect(api.uploadedKinds()).toEqual(['selfie-center']);
    });
  });

  it('takes each side pose once the head turned from the user’s own centre frame', async () => {
    const detector = fakeDetector([syntheticFace({ yaw: 0.01 })]);
    const camera = fakeCamera({ detector });
    const { api, onSubmitted } = renderStep(position(), { camera });
    await startCamera();
    await waitFor(() => {
      expect(screen.getByText(en.selfie.guidance['hold-still'])).toBeVisible();
    });
    camera.clock.advance(500);
    await waitFor(() => {
      expect(announcement()).toHaveTextContent('Photo 2 of 3: Turn your head to the left');
    });

    // Not yet turned far enough: 1.25 x the server minimum is 0.096 from the centre frame.
    detector.faces = [syntheticFace({ yaw: 0.01 + 0.08 })];
    camera.clock.advance(1_000);
    await waitFor(() => {
      expect(screen.getByText(en.selfie.guidance['turn-left'])).toBeVisible();
    });
    detector.faces = [syntheticFace({ yaw: 0.01 + 0.1 })];
    await waitFor(() => {
      expect(screen.getByText(en.selfie.guidance['hold-still'])).toBeVisible();
    });
    camera.clock.advance(500);
    await waitFor(() => {
      expect(announcement()).toHaveTextContent('Photo 3 of 3: Turn your head to the right');
    });

    detector.faces = [syntheticFace({ yaw: 0.01 - 0.1 })];
    await waitFor(() => {
      expect(screen.getByText(en.selfie.guidance['hold-still'])).toBeVisible();
    });
    camera.clock.advance(500);

    await waitFor(() => {
      expect(onSubmitted).toHaveBeenCalledTimes(1);
    });
    expect(api.uploadedKinds()).toEqual(['selfie-center', 'selfie-left', 'selfie-right']);
  });

  it('asks the user to fix the framing, and offers the manual shutter after 10 s', async () => {
    const detector = fakeDetector([]);
    const camera = fakeCamera({ detector });
    renderStep(position(), { camera });
    await startCamera();

    await waitFor(() => {
      expect(screen.getByText(en.selfie.guidance['no-face'])).toBeVisible();
    });
    expect(shutter()).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByText(en.selfie.shutterSoon)).toBeVisible();

    camera.clock.advance(10_000);

    await waitFor(() => {
      expect(shutter()).not.toHaveAttribute('aria-disabled', 'true');
    });
    expect(screen.getByText(en.selfie.shutterReady)).toBeVisible();
  });

  it('announces a guidance message once it has stayed on screen', async () => {
    const detector = fakeDetector([syntheticFace({ height: 0.15 })]);
    const camera = fakeCamera({ detector });
    renderStep(position(), { camera });
    await startCamera();
    await waitFor(() => {
      expect(screen.getByText(en.selfie.guidance['too-far'])).toBeVisible();
    });
    expect(screen.getByTestId('guidance-announcement')).toBeEmptyDOMElement();

    camera.clock.advance(1_500);

    await waitFor(() => {
      expect(screen.getByTestId('guidance-announcement')).toHaveTextContent(
        en.selfie.guidance['too-far'],
      );
    });
  });

  it('offers the manual shutter at once, logging nothing, when the detector cannot load', async () => {
    const error = vi.spyOn(console, 'error');
    const camera = fakeCamera({ detector: null });
    renderStep(position(), { camera });

    await startCamera();

    // The guidance state follows the prompt's render in a passive effect, so it is awaited; the
    // fake clock never moves, so only "at once" can satisfy it, never the 10 s fallback.
    await waitFor(() => {
      expect(shutter()).not.toHaveAttribute('aria-disabled', 'true');
    });
    expect(camera.clock.now()).toBe(0);
    expect(screen.getByText(en.selfie.guidance.manual)).toBeVisible();
    expect(error).not.toHaveBeenCalled();
  });

  it('falls back to the manual shutter when a detection fails', async () => {
    const detector = fakeDetector([]);
    detector.fail = true;
    renderStep(position(), { camera: fakeCamera({ detector }) });

    await startCamera();

    await waitFor(() => {
      expect(shutter()).not.toHaveAttribute('aria-disabled', 'true');
    });
  });
});

describe('SelfieCaptureStep: the sandbox upload fallback (C19, C46.1)', () => {
  it('creates an upload capture and uploads each prompted pose in the server’s order', async () => {
    const api = new FakeFlowApi();
    api.capturePrompts = ['center', 'right', 'left'];
    const { camera, onSubmitted } = renderStep(position(), { api, sandbox: true });

    await userEvent.click(screen.getByRole('button', { name: 'Upload photos' }));
    for (const pose of ['center', 'right', 'left'] as const) {
      await userEvent.upload(await screen.findByLabelText(en.selfie[pose].upload), pngFile());
      expect(await screen.findByRole('img', { name: en.selfie[pose].alt })).toBeVisible();
      await userEvent.click(screen.getByRole('button', { name: 'Use this photo' }));
    }

    await waitFor(() => {
      expect(onSubmitted).toHaveBeenCalledTimes(1);
    });
    expect(api.captures.map(({ method }) => method)).toEqual(['upload']);
    expect(api.uploadedKinds()).toEqual(['selfie-center', 'selfie-right', 'selfie-left']);
    expect(api.submits[0]?.body).toEqual({
      capture: { id: api.captures[0]?.id, nonce: api.captures[0]?.nonce },
    });
    expect(camera.requestCamera).not.toHaveBeenCalled();
  });

  it('moves focus to each new prompt', async () => {
    renderStep(position(), { sandbox: true });

    await userEvent.click(screen.getByRole('button', { name: 'Upload photos' }));
    expect(
      await screen.findByRole('heading', { level: 2, name: 'Look straight ahead' }),
    ).toHaveFocus();
    await userEvent.upload(screen.getByLabelText(en.selfie.center.upload), pngFile());
    await userEvent.click(await screen.findByRole('button', { name: 'Use this photo' }));

    expect(
      await screen.findByRole('heading', { level: 2, name: 'Turn your head to the left' }),
    ).toHaveFocus();
  });
});

/**
 * KP10-3: a sampler whose every guidance frame holds its own full-resolution copy, "judged frame
 * <n>", while the camera's live frame has moved on ("live frame"). `taken` names each copy taken.
 */
function holdingSampler(options: { readonly gone?: boolean } = {}) {
  let sampled = 0;
  const taken: number[] = [];
  const helds: HeldFrame[] = [];
  const sampleFrame = vi.fn<FlowEnvironment['sampleFrame']>((): SampledFrame => {
    sampled += 1;
    const n = sampled;
    const held: HeldFrame = {
      take: vi.fn(() => {
        if (options.gone === true) {
          return null;
        }
        taken.push(n);
        return Promise.resolve(new Blob([`judged frame ${String(n)}`], { type: 'image/jpeg' }));
      }),
      release: vi.fn(),
    };
    helds.push(held);
    return { width: 320, height: 240, data: new Uint8ClampedArray(320 * 240 * 4), held };
  });
  return { sampleFrame, taken, helds };
}

describe('SelfieCaptureStep: the photo is the frame the guidance judged (KP10-3)', () => {
  it('uploads, on an auto-capture, the copy of the frame whose faces were held, never the camera’s later frame', async () => {
    const detector = fakeDetector([syntheticFace()]);
    const camera = fakeCamera({ detector });
    camera.captureFrame.mockImplementation(() =>
      Promise.resolve(new Blob(['live frame'], { type: 'image/jpeg' })),
    );
    const sampler = holdingSampler();
    const { api } = renderStep(position(PASSIVE), {
      camera,
      environment: { sampleFrame: sampler.sampleFrame },
    });
    await startCamera();
    await waitFor(() => {
      expect(screen.getByText(en.selfie.guidance['hold-still'])).toBeVisible();
    });

    camera.clock.advance(500);

    await waitFor(() => {
      expect(api.uploadedKinds()).toEqual(['selfie-center']);
    });
    expect(sampler.taken).toHaveLength(1);
    await expect(api.uploads[0]?.file.text()).resolves.toBe(
      `judged frame ${String(sampler.taken[0])}`,
    );
    expect(camera.captureFrame).not.toHaveBeenCalled();
  });

  it('takes the live frame for the manual shutter, while the guidance holds its frames', async () => {
    const detector = fakeDetector([]);
    const camera = fakeCamera({ detector });
    camera.captureFrame.mockImplementation(() =>
      Promise.resolve(new Blob(['live frame'], { type: 'image/jpeg' })),
    );
    const sampler = holdingSampler();
    const { api } = renderStep(position(PASSIVE), {
      camera,
      environment: { sampleFrame: sampler.sampleFrame },
    });
    await startCamera();
    await waitFor(() => {
      expect(sampler.sampleFrame).toHaveBeenCalled();
    });

    camera.clock.advance(10_000);
    await shoot(1, 1);

    await waitFor(() => {
      expect(api.uploadedKinds()).toEqual(['selfie-center']);
    });
    await expect(api.uploads[0]?.file.text()).resolves.toBe('live frame');
    expect(sampler.taken).toEqual([]);
  });

  it('never uploads a later frame for a judged frame that is gone: it asks for another try', async () => {
    const detector = fakeDetector([syntheticFace()]);
    const camera = fakeCamera({ detector });
    const sampler = holdingSampler({ gone: true });
    const { api } = renderStep(position(PASSIVE), {
      camera,
      environment: { sampleFrame: sampler.sampleFrame },
    });
    await startCamera();
    await waitFor(() => {
      expect(screen.getByText(en.selfie.guidance['hold-still'])).toBeVisible();
    });

    camera.clock.advance(500);

    await waitFor(() => {
      expect(screen.getByText(en.capture.captureFailed)).toBeVisible();
    });
    expect(sampler.helds.some((held) => vi.mocked(held.take).mock.calls.length > 0)).toBe(true);
    expect(camera.captureFrame).not.toHaveBeenCalled();
    expect(api.uploads).toEqual([]);
  });
});
