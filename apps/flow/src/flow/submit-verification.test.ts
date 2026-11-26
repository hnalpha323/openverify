import { describe, expect, it, vi, type Mock } from 'vitest';
import type { FlowApiClient } from '../api/flow-api-client';
import { FlowApiError } from '../api/flow-api-client';
import {
  VERIFICATION_IDS,
  fileResource,
  flowSession,
  flowVerification,
  jpegBlob,
  pngFile,
} from '../testing/flow-fixtures';
import { newSubmissionProgress, submitVerification } from './submit-verification';

const ID = VERIFICATION_IDS.governmentId;

type MockClient = { [Method in keyof FlowApiClient]: Mock<FlowApiClient[Method]> };

function fakeClient(overrides: Partial<MockClient> = {}): MockClient {
  return {
    getSession: vi.fn<FlowApiClient['getSession']>(() => Promise.resolve(flowSession())),
    acceptConsent: vi.fn<FlowApiClient['acceptConsent']>(() =>
      Promise.resolve({ acceptedAt: '2026-10-20T12:00:00.000Z' }),
    ),
    createVerification: vi.fn<FlowApiClient['createVerification']>(() =>
      Promise.resolve(flowVerification('government_id', 'initiated')),
    ),
    // C40.2: a government ID never creates a selfie capture.
    createSelfieCapture: vi.fn<FlowApiClient['createSelfieCapture']>(() =>
      Promise.reject(new Error('not a selfie')),
    ),
    uploadFile: vi.fn<FlowApiClient['uploadFile']>((verificationId, kind) =>
      Promise.resolve(fileResource(verificationId, kind)),
    ),
    submitVerification: vi.fn<FlowApiClient['submitVerification']>(() =>
      Promise.resolve(flowVerification('government_id', 'submitted')),
    ),
    getVerification: vi.fn<FlowApiClient['getVerification']>(() =>
      Promise.resolve(flowVerification('government_id', 'submitted')),
    ),
    // C64.1: an image step never sends a code, values or a wallet challenge.
    sendOtp: vi.fn<FlowApiClient['sendOtp']>(() => Promise.reject(new Error('not an OTP step'))),
    confirmOtp: vi.fn<FlowApiClient['confirmOtp']>(() =>
      Promise.reject(new Error('not an OTP step')),
    ),
    enterInputs: vi.fn<FlowApiClient['enterInputs']>(() =>
      Promise.reject(new Error('not a form step')),
    ),
    createCryptoChallenge: vi.fn<FlowApiClient['createCryptoChallenge']>(() =>
      Promise.reject(new Error('not a wallet step')),
    ),
    // C94.2 (Workflow 7A): no signal body is part of a submission.
    sendSignals: vi.fn<FlowApiClient['sendSignals']>(() => Promise.resolve()),
    // C96.3 (Workflow 7A): no handoff call is part of a submission.
    createHandoff: vi.fn<FlowApiClient['createHandoff']>(() =>
      Promise.reject(new Error('not a handoff step')),
    ),
    continueHandoffHere: vi.fn<FlowApiClient['continueHandoffHere']>(() =>
      Promise.reject(new Error('not a handoff step')),
    ),
    getCurrentHandoff: vi.fn<FlowApiClient['getCurrentHandoff']>(() =>
      Promise.reject(new Error('not a handoff step')),
    ),
    rejectHandoff: vi.fn<FlowApiClient['rejectHandoff']>(() =>
      Promise.reject(new Error('not a handoff step')),
    ),
    // Workflow 10C: an image step never reports that it cannot read a chip.
    reportClientUnable: vi.fn<FlowApiClient['reportClientUnable']>(() =>
      Promise.reject(new Error('not an nfc step')),
    ),
    // Workflow 9B: a verification step never reads a theme asset.
    getThemeAsset: vi.fn<FlowApiClient['getThemeAsset']>(() =>
      Promise.reject(new Error('not a theme asset')),
    ),
    // Workflow 9A: a verification step never submits a screen or extends a selfie capture.
    submitScreen: vi.fn<FlowApiClient['submitScreen']>(() =>
      Promise.reject(new Error('not a screen')),
    ),
    extendSelfieCapture: vi.fn<FlowApiClient['extendSelfieCapture']>(() =>
      Promise.reject(new Error('not a selfie capture')),
    ),
    // Workflow 11A: a verification step never answers a share-consent step.
    acceptShareConsent: vi.fn<FlowApiClient['acceptShareConsent']>(() =>
      Promise.reject(new Error('not a share-consent step')),
    ),
    declineShareConsent: vi.fn<FlowApiClient['declineShareConsent']>(() =>
      Promise.reject(new Error('not a share-consent step')),
    ),
    withdrawShareConsent: vi.fn<FlowApiClient['withdrawShareConsent']>(() =>
      Promise.reject(new Error('not a share-consent step')),
    ),
    ...overrides,
  };
}

const FRONT = pngFile('front.png');
const BACK = jpegBlob();

describe('submitVerification', () => {
  it('creates the verification, uploads each image in order, then submits', async () => {
    const client = fakeClient();
    const progress = newSubmissionProgress(null);

    const result = await submitVerification({
      client,
      type: 'government-id',
      files: [
        ['front', FRONT],
        ['back', BACK],
      ],
      progress,
    });

    expect(result).toEqual(flowVerification('government_id', 'submitted'));
    expect(client.createVerification).toHaveBeenCalledWith({ type: 'government-id' }, undefined);
    expect(client.uploadFile.mock.calls).toEqual([
      [ID, 'front', FRONT, undefined],
      [ID, 'back', BACK, undefined],
    ]);
    expect(client.submitVerification).toHaveBeenCalledWith(ID, undefined);
    expect(progress).toEqual({ verificationId: ID, uploaded: new Set(['front', 'back']) });
  });

  it('reuses an initiated verification instead of using up another attempt', async () => {
    const client = fakeClient();

    await submitVerification({
      client,
      type: 'government-id',
      files: [['front', FRONT]],
      progress: newSubmissionProgress(VERIFICATION_IDS.governmentIdRetry),
    });

    expect(client.createVerification).not.toHaveBeenCalled();
    expect(client.uploadFile).toHaveBeenCalledWith(
      VERIFICATION_IDS.governmentIdRetry,
      'front',
      FRONT,
      undefined,
    );
  });

  it('resumes after a failed upload without re-creating or re-uploading', async () => {
    const failure = new FlowApiError('network', 'POST failed');
    const client = fakeClient({
      uploadFile: vi
        .fn<FlowApiClient['uploadFile']>()
        .mockResolvedValueOnce(fileResource(ID, 'front'))
        .mockRejectedValueOnce(failure)
        .mockResolvedValueOnce(fileResource(ID, 'back')),
    });
    const progress = newSubmissionProgress(null);
    const options = {
      client,
      type: 'government-id' as const,
      files: [
        ['front', FRONT],
        ['back', BACK],
      ] as const,
      progress,
    };

    await expect(submitVerification(options)).rejects.toBe(failure);
    expect(progress).toEqual({ verificationId: ID, uploaded: new Set(['front']) });

    await submitVerification(options);

    expect(client.createVerification).toHaveBeenCalledTimes(1);
    expect(client.uploadFile.mock.calls.map(([, kind]) => kind)).toEqual(['front', 'back', 'back']);
    expect(client.submitVerification).toHaveBeenCalledTimes(1);
  });

  it('passes the abort signal to every request', async () => {
    const client = fakeClient({
      createVerification: vi.fn<FlowApiClient['createVerification']>(() =>
        Promise.resolve(flowVerification('selfie', 'initiated')),
      ),
    });
    const { signal } = new AbortController();

    await submitVerification({
      client,
      type: 'selfie',
      files: [['selfie-center', BACK]],
      progress: newSubmissionProgress(null),
      signal,
    });

    expect(client.createVerification).toHaveBeenCalledWith({ type: 'selfie' }, signal);
    expect(client.uploadFile).toHaveBeenCalledWith(
      VERIFICATION_IDS.selfie,
      'selfie-center',
      BACK,
      signal,
    );
    expect(client.submitVerification).toHaveBeenCalledWith(VERIFICATION_IDS.selfie, signal);
  });
});

describe('submitVerification after a lost create answer (Workflow 2D F018)', () => {
  const lost = (kind: 'timeout' | 'network') =>
    new FlowApiError(kind, 'POST /api/v1/flow/verifications: no answer');

  it.each(['timeout', 'network'] as const)(
    'reuses the initiated verification the server created when the answer to the create was lost (%s)',
    async (kind) => {
      const client = fakeClient({
        createVerification: vi.fn<FlowApiClient['createVerification']>(() =>
          Promise.reject(lost(kind)),
        ),
        getSession: vi.fn<FlowApiClient['getSession']>(() =>
          Promise.resolve(
            flowSession({
              verifications: [
                flowVerification('government_id', 'failed', {
                  id: VERIFICATION_IDS.governmentIdRetry,
                }),
                flowVerification('government_id', 'initiated', {
                  id: VERIFICATION_IDS.governmentIdThird,
                }),
              ],
            }),
          ),
        ),
      });
      const progress = newSubmissionProgress(null);

      await submitVerification({
        client,
        type: 'government-id',
        files: [['front', FRONT]],
        progress,
      });

      expect(client.createVerification).toHaveBeenCalledOnce();
      expect(client.uploadFile).toHaveBeenCalledWith(
        VERIFICATION_IDS.governmentIdThird,
        'front',
        FRONT,
        undefined,
      );
      expect(progress.verificationId).toBe(VERIFICATION_IDS.governmentIdThird);
    },
  );

  it('fails with the lost answer when the server has no initiated verification of the type, so a retry creates one', async () => {
    const error = lost('timeout');
    const client = fakeClient({
      createVerification: vi.fn<FlowApiClient['createVerification']>(() => Promise.reject(error)),
      getSession: vi.fn<FlowApiClient['getSession']>(() =>
        Promise.resolve(flowSession({ verifications: [flowVerification('selfie', 'initiated')] })),
      ),
    });
    const progress = newSubmissionProgress(null);

    await expect(
      submitVerification({ client, type: 'government-id', files: [['front', FRONT]], progress }),
    ).rejects.toBe(error);
    expect(progress.verificationId).toBeNull();
    expect(client.uploadFile).not.toHaveBeenCalled();
  });

  it('does not reload the session after an answered refusal of the create', async () => {
    const refused = new FlowApiError('http', 'POST /api/v1/flow/verifications: 409', {
      status: 409,
    });
    const client = fakeClient({
      createVerification: vi.fn<FlowApiClient['createVerification']>(() => Promise.reject(refused)),
    });

    await expect(
      submitVerification({
        client,
        type: 'government-id',
        files: [['front', FRONT]],
        progress: newSubmissionProgress(null),
      }),
    ).rejects.toBe(refused);
    expect(client.getSession).not.toHaveBeenCalled();
  });
});

describe('submitVerification after a create answered with an unexpected body (2E follow-up)', () => {
  /** A 2xx answer to the create whose body the contract does not describe. */
  const unreadable = () =>
    new FlowApiError(
      'invalid-response',
      'POST /api/v1/flow/verifications returned an unexpected body',
      { status: 201 },
    );

  it('takes the verification as created but unreadable, and reuses the one the session shows', async () => {
    const client = fakeClient({
      createVerification: vi.fn<FlowApiClient['createVerification']>(() =>
        Promise.reject(unreadable()),
      ),
      getSession: vi.fn<FlowApiClient['getSession']>(() =>
        Promise.resolve(
          flowSession({
            verifications: [
              flowVerification('government_id', 'initiated', {
                id: VERIFICATION_IDS.governmentIdRetry,
              }),
            ],
          }),
        ),
      ),
    });
    const progress = newSubmissionProgress(null);

    await submitVerification({
      client,
      type: 'government-id',
      files: [['front', FRONT]],
      progress,
    });

    expect(client.createVerification).toHaveBeenCalledOnce();
    expect(client.uploadFile).toHaveBeenCalledWith(
      VERIFICATION_IDS.governmentIdRetry,
      'front',
      FRONT,
      undefined,
    );
    expect(progress.verificationId).toBe(VERIFICATION_IDS.governmentIdRetry);
  });

  it('never creates a second verification when the session cannot be read after it either', async () => {
    const error = unreadable();
    const getSession = vi
      .fn<FlowApiClient['getSession']>()
      .mockRejectedValueOnce(new FlowApiError('network', 'GET /api/v1/flow/session: no answer'))
      .mockResolvedValue(
        flowSession({ verifications: [flowVerification('government_id', 'initiated')] }),
      );
    const client = fakeClient({
      createVerification: vi.fn<FlowApiClient['createVerification']>(() => Promise.reject(error)),
      getSession,
    });
    const progress = newSubmissionProgress(null);
    const attempt = () =>
      submitVerification({ client, type: 'government-id', files: [['front', FRONT]], progress });

    await expect(attempt()).rejects.toBe(error);
    await attempt();

    expect(client.createVerification).toHaveBeenCalledOnce();
    expect(progress.verificationId).toBe(ID);
  });

  it('fails with the unexpected answer when the session shows no initiated verification of the type', async () => {
    const error = unreadable();
    const client = fakeClient({
      createVerification: vi.fn<FlowApiClient['createVerification']>(() => Promise.reject(error)),
    });
    const progress = newSubmissionProgress(null);

    await expect(
      submitVerification({ client, type: 'government-id', files: [['front', FRONT]], progress }),
    ).rejects.toBe(error);
    expect(client.getSession).toHaveBeenCalledOnce();
    expect(progress.verificationId).toBeNull();
  });
});

describe('submitVerification when the session cannot be read either (Workflow 2D F018)', () => {
  it('asks the session first on the next attempt, so it never creates a second verification', async () => {
    const offline = new FlowApiError('network', 'GET /api/v1/flow/session: no answer');
    const getSession = vi
      .fn<FlowApiClient['getSession']>()
      .mockRejectedValueOnce(offline)
      .mockResolvedValue(
        flowSession({ verifications: [flowVerification('government_id', 'initiated')] }),
      );
    const createError = new FlowApiError('timeout', 'POST /api/v1/flow/verifications: late');
    const client = fakeClient({
      createVerification: vi.fn<FlowApiClient['createVerification']>(() =>
        Promise.reject(createError),
      ),
      getSession,
    });
    const progress = newSubmissionProgress(null);
    const attempt = () =>
      submitVerification({ client, type: 'government-id', files: [['front', FRONT]], progress });

    await expect(attempt()).rejects.toBe(createError);
    await attempt();

    expect(client.createVerification).toHaveBeenCalledOnce();
    expect(progress.verificationId).toBe(ID);
  });
});
