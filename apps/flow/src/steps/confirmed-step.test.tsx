import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { FlowApiError } from '../api/flow-api-client';
import { FakeFlowApi } from '../testing/fake-flow-api';
import { renderWithFlow } from '../test-utils';
import { ConfirmedStep } from './confirmed-step';

async function confirmedVerification(api: FakeFlowApi): Promise<string> {
  api.consent = { textKeys: ['consent.biometric'], locale: 'en' };
  const { id } = await api.client.createVerification({ type: 'email-address' });
  api.verification(id).status = 'confirmed';
  return id;
}

function renderStep(api: FakeFlowApi, verificationId: string, language: 'en' | 'es' = 'en') {
  const onSubmitted = vi.fn(() => Promise.resolve());
  renderWithFlow(
    <ConfirmedStep verificationId={verificationId} client={api.client} onSubmitted={onSubmitted} />,
    { language },
  );
  return { onSubmitted };
}

describe('ConfirmedStep (C64.1 resume)', () => {
  it('submits a confirmed code at once, then reloads the session', async () => {
    const api = new FakeFlowApi();
    const id = await confirmedVerification(api);
    const { onSubmitted } = renderStep(api, id);

    expect(
      screen.getByRole('heading', { level: 1, name: 'Your code was confirmed' }),
    ).toBeVisible();
    expect(screen.getByRole('status')).toHaveTextContent('Sending your verification…');
    await waitFor(() => {
      expect(onSubmitted).toHaveBeenCalledTimes(1);
    });
    expect(api.submits).toEqual([{ verificationId: id, body: undefined }]);
  });

  it('explains a submit that failed, and submits again on request', async () => {
    const api = new FakeFlowApi();
    const id = await confirmedVerification(api);
    api.failures.submitVerification = [new FlowApiError('timeout', 'POST /submit timed out')];
    const { onSubmitted } = renderStep(api, id);

    expect(
      await screen.findByText(
        'The verification service took too long to answer. Check your connection and try again.',
      ),
    ).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));

    await waitFor(() => {
      expect(onSubmitted).toHaveBeenCalledTimes(1);
    });
    expect(api.submits).toHaveLength(1);
  });

  it('reloads the session when the verification has already moved on', async () => {
    const api = new FakeFlowApi();
    const id = await confirmedVerification(api);
    api.failures.submitVerification = [
      new FlowApiError('http', 'POST /submit failed', { status: 409 }),
    ];
    const { onSubmitted } = renderStep(api, id);

    await waitFor(() => {
      expect(onSubmitted).toHaveBeenCalledTimes(1);
    });
  });

  it('submits once, however often it renders', async () => {
    const api = new FakeFlowApi();
    const id = await confirmedVerification(api);
    const { onSubmitted } = renderStep(api, id);

    await waitFor(() => {
      expect(onSubmitted).toHaveBeenCalledTimes(1);
    });
    expect(api.client.submitVerification).toHaveBeenCalledTimes(1);
  });

  it('speaks Spanish', async () => {
    const api = new FakeFlowApi();
    const id = await confirmedVerification(api);
    renderStep(api, id, 'es');

    expect(
      screen.getByRole('heading', { level: 1, name: 'Tu código está confirmado' }),
    ).toBeVisible();
  });
});
