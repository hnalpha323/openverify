import { renderHook, waitFor } from '@testing-library/react';
import { StrictMode, type ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import { FlowApiError } from '../api/flow-api-client';
import { FakeFlowApi } from '../testing/fake-flow-api';
import { flowVerification } from '../testing/flow-fixtures';
import type { DocumentStep } from './flow-position';
import { newSubmissionProgress } from './submit-verification';
import { useVerificationGuidance } from './use-verification-guidance';

const PROOF: DocumentStep = {
  id: 'proof',
  type: 'document',
  documentTypes: ['utility_bill'],
  captureMethods: ['upload'],
};

function documentApi(): FakeFlowApi {
  const api = new FakeFlowApi();
  api.consent = { textKeys: ['consent.biometric'], locale: 'en' };
  api.flow = {
    metadata: { specVersion: 1, id: 'proof', version: 1, name: 'Proof' },
    steps: [
      { id: 'consent', type: 'consent', textKeys: ['consent.biometric'], required: true },
      PROOF,
      { id: 'done', type: 'completion' },
    ],
    transitions: [],
  };
  return api;
}

/** React's development double-run of effects, which the hook must survive (C64.1). */
function strict({ children }: { children: ReactNode }) {
  return <StrictMode>{children}</StrictMode>;
}

describe('useVerificationGuidance (C52.2, C64.1)', () => {
  it('uses a resumed attempt as it is, making nothing', () => {
    const api = documentApi();
    const resumed = flowVerification('document', 'initiated');

    const { result } = renderHook(
      () =>
        useVerificationGuidance({
          client: api.client,
          type: 'document',
          progress: newSubmissionProgress(resumed.id),
          verification: resumed,
        }),
      { wrapper: strict },
    );

    expect(result.current.verification).toBe(resumed);
    expect(api.client.createVerification).not.toHaveBeenCalled();
    expect(api.client.getVerification).not.toHaveBeenCalled();
  });

  it('makes the attempt’s verification once when the screen opens and reads its guidance back', async () => {
    const api = documentApi();
    const progress = newSubmissionProgress(null);

    const { result } = renderHook(
      () =>
        useVerificationGuidance({
          client: api.client,
          type: 'document',
          progress,
          verification: undefined,
        }),
      { wrapper: strict },
    );

    await waitFor(() => {
      expect(result.current.verification?.attributes).toMatchObject({
        guidance: { 'accepted-types': ['utility_bill'], 'max-age-days': 90 },
      });
    });
    expect(api.client.createVerification).toHaveBeenCalledTimes(1);
    expect(api.client.createVerification).toHaveBeenCalledWith({ type: 'document' }, undefined);
    expect(progress.verificationId).toBe(api.verifications[0]?.id);
    await expect(result.current.verificationId()).resolves.toBe(api.verifications[0]?.id);
    expect(api.client.createVerification).toHaveBeenCalledTimes(1);
  });

  it('makes nothing on opening for a screen that needs no guidance before the user acts', async () => {
    const api = documentApi();
    const progress = newSubmissionProgress(null);
    const { result } = renderHook(
      () =>
        useVerificationGuidance({
          client: api.client,
          type: 'document',
          progress,
          verification: undefined,
          eager: false,
        }),
      { wrapper: strict },
    );

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(api.client.createVerification).not.toHaveBeenCalled();
    await expect(result.current.verificationId()).resolves.toBe(api.verifications[0]?.id);
    expect(api.client.createVerification).toHaveBeenCalledTimes(1);
    expect(api.client.getVerification).not.toHaveBeenCalled();
  });

  it('shares the verification being made with a request the screen sends meanwhile', async () => {
    const api = documentApi();
    const progress = newSubmissionProgress(null);
    const { result } = renderHook(() =>
      useVerificationGuidance({
        client: api.client,
        type: 'document',
        progress,
        verification: undefined,
      }),
    );

    const [first, second] = await Promise.all([
      result.current.verificationId(),
      result.current.verificationId(),
    ]);

    expect(first).toBe(second);
    expect(api.verifications).toHaveLength(1);
  });

  it('says nothing when the background request fails, and makes it on the screen’s request', async () => {
    const api = documentApi();
    api.failures.createVerification = [
      new FlowApiError('http', 'POST /verifications failed with HTTP 503', { status: 503 }),
    ];
    const progress = newSubmissionProgress(null);
    const { result } = renderHook(() =>
      useVerificationGuidance({
        client: api.client,
        type: 'document',
        progress,
        verification: undefined,
      }),
    );

    await waitFor(() => {
      expect(api.client.createVerification).toHaveBeenCalledTimes(1);
    });
    expect(result.current.verification).toBeUndefined();

    await expect(result.current.verificationId()).resolves.toBe(api.verifications[0]?.id);
    expect(api.client.createVerification).toHaveBeenCalledTimes(2);
  });
});
