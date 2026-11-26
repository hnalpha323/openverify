import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { FlowApiError } from '../api/flow-api-client';
import { en } from '../i18n/locales/en';
import { FakeFlowApi, type Decision } from '../testing/fake-flow-api';
import { flowVerification } from '../testing/flow-fixtures';
import { renderWithFlow } from '../test-utils';
import { ProcessingStep } from './processing-step';

async function submittedVerification(api: FakeFlowApi): Promise<string> {
  const { id } = await api.client.createVerification({ type: 'government-id' });
  await api.client.submitVerification(id);
  api.client.getVerification.mockClear();
  return id;
}

async function renderStep(api = new FakeFlowApi(), maxPolls = 50) {
  const verificationId = await submittedVerification(api);
  const onSettled = vi.fn(() => Promise.resolve());
  renderWithFlow(
    <ProcessingStep
      client={api.client}
      verificationId={verificationId}
      attempt={2}
      maxAttempts={3}
      onSettled={onSettled}
    />,
    { environment: { maxPolls } },
  );
  return { api, onSettled, verificationId };
}

describe('ProcessingStep', () => {
  it('tells the user their photos are being checked', async () => {
    const api = new FakeFlowApi();
    api.pendingPolls = 1000;
    await renderStep(api);

    expect(screen.getByRole('heading', { level: 1, name: 'Checking your photos' })).toBeVisible();
    expect(screen.getByRole('status')).toHaveTextContent(en.processing.message);
    expect(screen.getByText('Attempt 2 of 3')).toBeVisible();
  });

  it('polls the verification until it is decided, then moves on once', async () => {
    const api = new FakeFlowApi();
    api.pendingPolls = 2;
    const { onSettled, verificationId } = await renderStep(api);

    await waitFor(() => {
      expect(onSettled).toHaveBeenCalledTimes(1);
    });
    expect(api.client.getVerification).toHaveBeenCalledTimes(3);
    expect(api.client.getVerification).toHaveBeenCalledWith(
      verificationId,
      expect.any(AbortSignal),
    );
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(onSettled).toHaveBeenCalledTimes(1);
  });

  it.each<[Decision]>([
    [{ status: 'passed' }],
    // C30.6: a verification an operator reviews counts as done.
    [{ status: 'needs_review' }],
    [{ status: 'failed', hints: [{ name: 'id_blur_detection', reasons: ['image_blurry'] }] }],
  ])('moves on for a %o decision', async (decision) => {
    const api = new FakeFlowApi();
    api.decisions.push(decision);
    const { onSettled } = await renderStep(api);

    await waitFor(() => {
      expect(onSettled).toHaveBeenCalledTimes(1);
    });
  });

  it('says when checking takes longer than usual, and checks again on request', async () => {
    const api = new FakeFlowApi();
    api.pendingPolls = 3;
    const { onSettled } = await renderStep(api, 2);

    expect(await screen.findByRole('alert')).toHaveTextContent(en.processing.slow);
    expect(onSettled).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: 'Check again' }));

    await waitFor(() => {
      expect(onSettled).toHaveBeenCalledTimes(1);
    });
  });

  it('explains when the status cannot be fetched, and tries again on request', async () => {
    const api = new FakeFlowApi();
    api.client.getVerification.mockRejectedValue(new FlowApiError('network', 'no response'));
    const { onSettled, verificationId } = await renderStep(api);

    expect(await screen.findByRole('alert')).toHaveTextContent(en.errors.network);
    expect(onSettled).not.toHaveBeenCalled();

    api.client.getVerification.mockResolvedValue(
      flowVerification('government_id', 'passed', { id: verificationId }),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));

    await waitFor(() => {
      expect(onSettled).toHaveBeenCalledTimes(1);
    });
  });
});
