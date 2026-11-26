/**
 * C40 on the client, against the in-memory flow API: the verification and the capture exist
 * before the first prompt, prompts come in the server's order, each pose is uploaded with the
 * capture's id, nonce and elapsed time, and submit names the capture with the device snapshot.
 */
import { CLIENT_ELAPSED_MS_MAX, problemSchema } from '@openverify/contracts';
import { describe, expect, it, vi } from 'vitest';
import { FlowApiError } from '../api/flow-api-client';
import { newSubmissionProgress } from '../flow/submit-verification';
import { FakeFlowApi } from '../testing/fake-flow-api';
import {
  GOLDEN_SELFIE_CAPTURE,
  GOLDEN_SELFIE_SUBMIT,
  flowSession,
  flowVerification,
  jpegBlob,
} from '../testing/flow-fixtures';
import { GOLDEN_PROBLEMS } from '../testing/golden-problems';
import {
  captureFailure,
  clientElapsedMs,
  openSelfieCapture,
  submitSelfieCapture,
  uploadSelfiePose,
  type OpenCapture,
} from './capture-protocol';

function consented(api = new FakeFlowApi()): FakeFlowApi {
  api.consent = { textKeys: ['consent.biometric'], locale: 'en' };
  api.selfieCaptureRequired = true;
  return api;
}

function clock(start = 1_000) {
  let now = start;
  return {
    now: () => now,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

function problem409(code: string): FlowApiError {
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

describe('openSelfieCapture (C40.2)', () => {
  it('creates the verification, then the capture, before any prompt', async () => {
    const api = consented();
    const time = clock(5_000);

    const { verificationId, capture } = await openSelfieCapture({
      client: api.client,
      progress: newSubmissionProgress(null),
      method: 'camera',
      now: time.now,
    });

    expect(api.client.createVerification).toHaveBeenCalledWith({ type: 'selfie' }, undefined);
    expect(api.client.createSelfieCapture).toHaveBeenCalledWith(
      verificationId,
      { method: 'camera' },
      undefined,
    );
    expect(api.verifications.map(({ id, type }) => [id, type])).toEqual([
      [verificationId, 'selfie'],
    ]);
    expect(capture).toMatchObject({
      id: api.captures[0]?.id,
      nonce: api.captures[0]?.nonce,
      openedAt: 5_000,
    });
  });

  it('prompts in the server’s order, whatever the step says', async () => {
    const api = consented();
    api.client.createSelfieCapture.mockResolvedValueOnce(GOLDEN_SELFIE_CAPTURE);

    const { capture } = await openSelfieCapture({
      client: api.client,
      progress: newSubmissionProgress(null),
      method: 'camera',
      now: clock().now,
    });

    expect(capture).toEqual({
      id: GOLDEN_SELFIE_CAPTURE.id,
      nonce: GOLDEN_SELFIE_CAPTURE.attributes.nonce,
      prompts: ['center', 'right', 'left'],
      expiresAt: GOLDEN_SELFIE_CAPTURE.attributes['expires-at'],
      guidance: GOLDEN_SELFIE_CAPTURE.attributes.guidance,
      openedAt: 1_000,
    });
  });

  it('reuses the verification already started, and only creates a capture', async () => {
    const api = consented();
    const { id } = await api.client.createVerification({ type: 'selfie' });
    api.client.createVerification.mockClear();
    const progress = newSubmissionProgress(id);

    const opened = await openSelfieCapture({
      client: api.client,
      progress,
      method: 'upload',
      now: clock().now,
    });

    expect(opened.verificationId).toBe(id);
    expect(api.client.createVerification).not.toHaveBeenCalled();
    expect(api.captures.map(({ method }) => method)).toEqual(['upload']);
  });

  it('reads the session instead of creating a second verification after a lost create answer', async () => {
    const api = consented();
    const created = flowVerification('selfie', 'initiated');
    api.client.createVerification.mockRejectedValueOnce(new FlowApiError('timeout', 'timed out'));
    api.client.getSession.mockResolvedValueOnce(flowSession({ verifications: [created] }));
    api.client.createSelfieCapture.mockResolvedValueOnce(GOLDEN_SELFIE_CAPTURE);

    const opened = await openSelfieCapture({
      client: api.client,
      progress: newSubmissionProgress(null),
      method: 'camera',
      now: clock().now,
    });

    expect(opened.verificationId).toBe(created.id);
    expect(api.client.createVerification).toHaveBeenCalledTimes(1);
  });

  it('passes the caller’s signal to every request', async () => {
    const api = consented();
    const signal = new AbortController().signal;

    await openSelfieCapture({
      client: api.client,
      progress: newSubmissionProgress(null),
      method: 'camera',
      now: clock().now,
      signal,
    });

    expect(api.client.createVerification).toHaveBeenCalledWith({ type: 'selfie' }, signal);
    expect(api.client.createSelfieCapture).toHaveBeenCalledWith(
      expect.any(String),
      { method: 'camera' },
      signal,
    );
  });
});

describe('uploadSelfiePose (C40.3)', () => {
  it('uploads the pose as its file kind, with the capture id, the nonce and the elapsed time', async () => {
    const api = consented();
    const time = clock();
    const { verificationId, capture } = await openSelfieCapture({
      client: api.client,
      progress: newSubmissionProgress(null),
      method: 'camera',
      now: time.now,
    });
    time.advance(2_345.6);
    const photo = jpegBlob();

    await uploadSelfiePose({
      client: api.client,
      verificationId,
      capture,
      pose: 'center',
      photo,
      now: time.now,
    });

    expect(api.uploads).toEqual([
      {
        verificationId,
        kind: 'selfie-center',
        file: photo,
        capture: { captureId: capture.id, nonce: capture.nonce, clientElapsedMs: 2_346 },
      },
    ]);
  });

  // C153.2 (Workflow 9A): how the pose was taken goes with it, client-reported guidance.
  it('reports how the pose was taken', async () => {
    const api = consented();
    const { verificationId, capture } = await openSelfieCapture({
      client: api.client,
      progress: newSubmissionProgress(null),
      method: 'upload',
      now: clock().now,
    });
    const photo = jpegBlob();

    await uploadSelfiePose({
      client: api.client,
      verificationId,
      capture,
      pose: 'center',
      photo,
      now: clock().now,
      captureMethod: 'upload',
    });

    expect(api.client.uploadFile).toHaveBeenLastCalledWith(
      verificationId,
      'selfie-center',
      photo,
      undefined,
      expect.objectContaining({ captureId: capture.id }),
      'upload',
    );
  });

  it('is refused for a superseded capture, as the server refuses it', async () => {
    const api = consented();
    const progress = newSubmissionProgress(null);
    const first = await openSelfieCapture({
      client: api.client,
      progress,
      method: 'camera',
      now: clock().now,
    });
    await openSelfieCapture({ client: api.client, progress, method: 'camera', now: clock().now });

    const error = await uploadSelfiePose({
      client: api.client,
      verificationId: first.verificationId,
      capture: first.capture,
      pose: 'center',
      photo: jpegBlob(),
      now: clock().now,
    }).catch((caught: unknown) => caught);

    expect(captureFailure(error)).toBe('capture-invalid');
  });
});

describe('clientElapsedMs', () => {
  const capture = { openedAt: 1_000 } as OpenCapture;

  it('is whole milliseconds since the capture arrived, within the contract’s bounds', () => {
    expect(clientElapsedMs(capture, 1_499.5)).toBe(500);
    expect(clientElapsedMs(capture, 900)).toBe(0);
    expect(clientElapsedMs(capture, 1_000 + CLIENT_ELAPSED_MS_MAX + 5_000)).toBe(
      CLIENT_ELAPSED_MS_MAX,
    );
  });
});

describe('submitSelfieCapture (C40.4)', () => {
  it('names the capture with its nonce and the device snapshot: the golden submit body', async () => {
    const api = consented();
    const submitted = flowVerification('selfie', 'submitted');
    api.client.submitVerification.mockResolvedValueOnce(submitted);
    const golden = GOLDEN_SELFIE_SUBMIT.capture;
    const capture = {
      id: golden?.id ?? '',
      nonce: golden?.nonce ?? '',
    } as OpenCapture;
    const signal = new AbortController().signal;

    await expect(
      submitSelfieCapture({
        client: api.client,
        verificationId: submitted.id,
        capture,
        ...(golden?.device === undefined ? {} : { device: golden.device }),
        signal,
      }),
    ).resolves.toBe(submitted);
    expect(api.client.submitVerification).toHaveBeenCalledWith(
      submitted.id,
      signal,
      GOLDEN_SELFIE_SUBMIT,
    );
  });

  it('submits a capture without a device snapshot when there is none (an upload)', async () => {
    const api = consented();
    const progress = newSubmissionProgress(null);
    const { verificationId, capture } = await openSelfieCapture({
      client: api.client,
      progress,
      method: 'upload',
      now: clock().now,
    });
    for (const pose of capture.prompts) {
      await uploadSelfiePose({
        client: api.client,
        verificationId,
        capture,
        pose,
        photo: jpegBlob(),
        now: clock().now,
      });
    }

    await submitSelfieCapture({ client: api.client, verificationId, capture });

    expect(api.submits).toEqual([
      { verificationId, body: { capture: { id: capture.id, nonce: capture.nonce } } },
    ]);
  });
});

describe('captureFailure', () => {
  it.each([
    [problem409('selfie_capture_invalid'), 'capture-invalid'],
    [problem409('selfie_capture_incomplete'), 'capture-invalid'],
    [problem409('selfie_capture_limit'), 'capture-limit'],
    [problem409('selfie_capture_required'), 'conflict'],
    [new FlowApiError('http', 'POST failed with HTTP 409', { status: 409 }), 'conflict'],
    [new FlowApiError('http', 'POST failed with HTTP 503', { status: 503 }), 'other'],
    [new FlowApiError('network', 'no response'), 'other'],
    [new Error('boom'), 'other'],
  ] as const)('reads %o as %s', (error, failure) => {
    expect(captureFailure(error)).toBe(failure);
  });

  it.each([
    ['selfie-capture-invalid.json', 'capture-invalid'],
    ['selfie-capture-incomplete.json', 'capture-invalid'],
    ['selfie-capture-limit.json', 'capture-limit'],
    ['selfie-capture-required.json', 'conflict'],
  ] as const)(
    'reads the golden %s as the API sends it as %s (Workflow 4B review K202)',
    (name, failure) => {
      const golden = problemSchema.parse(GOLDEN_PROBLEMS.get(name));
      const error = new FlowApiError('http', 'POST failed with HTTP 409', {
        status: golden.status,
        problem: golden,
      });

      expect(captureFailure(error)).toBe(failure);
    },
  );

  it('never needs the problem detail', () => {
    const spy = vi.fn();
    expect(captureFailure({ toString: spy })).toBe('other');
    expect(spy).not.toHaveBeenCalled();
  });
});
