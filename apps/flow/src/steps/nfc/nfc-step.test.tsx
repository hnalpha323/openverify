/**
 * C207.10 (Workflow 10C): the web flow dispatches an `nfc` step to `api-nfc`'s screen
 * (`steps/nfc/`), from the projection's step and from the spec-2 client view alike
 * (`contracts-10c`, Stage 1a). The screen (`api-nfc`, Stage 2) says that reading a document chip
 * needs the organisation's app and, where the step has a fallback, offers "use another way"
 * through the client-unable route with `platform_unsupported`.
 */
import { flowSchema } from '@openverify/flow-spec';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { FlowApiError, type FlowApiClient } from '../../api/flow-api-client';
import { resolveFlowPosition, type NfcStepView } from '../../flow/flow-position';
import { en } from '../../i18n/locales/en';
import { FakeFlowApi } from '../../testing/fake-flow-api';
import { flowSession } from '../../testing/flow-fixtures';
import { at, positionedSession } from '../../testing/flow-renderer';
import { nfcScript } from '../../testing/nfc';
import { renderWithI18n } from '../../test-utils';
import { NfcStep } from './nfc-step';

const chip = { id: 'chip', type: 'nfc', androidOnly: true } as const;
const view = { ...chip, maxAttempts: 3, fallbackAvailable: true } as const;

const flow = flowSchema.parse({
  metadata: { specVersion: 1, id: 'nfc-flow', version: 1, name: 'NFC flow' },
  steps: [chip, { id: 'done', type: 'completion' }],
  transitions: [],
});

describe('the nfc position (C207.10)', () => {
  it('is its own position for the projection’s step, never skipped', () => {
    expect(resolveFlowPosition(flowSession({ consent: true, flow }))).toEqual({
      kind: 'nfc',
      step: chip,
    });
  });

  it('carries the client view of a spec-2 session, with fallbackAvailable', () => {
    const session = positionedSession(
      { position: at('chip'), step: view },
      { consent: true, flow },
    );

    expect(resolveFlowPosition(session)).toEqual({ kind: 'nfc', step: view });
  });
});

const VERIFICATION_ID = 'ver_01M5CK3190XEVBM5ZXA76E1JSM';

/** A client whose calls the test scripts; only the two calls the screen may make exist. */
function scriptedClient(report: FlowApiClient['reportClientUnable'] = accepted) {
  const createVerification = vi.fn<FlowApiClient['createVerification']>(() =>
    Promise.resolve({
      type: 'verification/government-id-nfc',
      id: VERIFICATION_ID,
    } as Awaited<ReturnType<FlowApiClient['createVerification']>>),
  );
  const reportClientUnable = vi.fn<FlowApiClient['reportClientUnable']>(report);
  return {
    client: { createVerification, reportClientUnable } as unknown as FlowApiClient,
    createVerification,
    reportClientUnable,
  };
}

function accepted(verificationId: string) {
  return Promise.resolve({ 'verification-id': verificationId, status: 'canceled' as const });
}

const useAnotherWay = () => screen.getByRole('button', { name: en.nfc.useAnotherWay });

describe('NfcStep in a browser (C207.10)', () => {
  it('says that reading a document chip needs the organisation’s app', () => {
    const { client } = scriptedClient();

    renderWithI18n(<NfcStep step={view} client={client} onDone={vi.fn()} />);

    expect(screen.getByRole('heading', { level: 1, name: en.nfc.title })).toBeVisible();
    expect(screen.getByText(en.nfc.needsApp)).toBeVisible();
    expect(en.nfc.needsApp).toBe(
      'Reading a document chip needs the organization’s app; a browser cannot read it.',
    );
  });

  it('never sends the person to another phone, and never says where the other way leads', () => {
    const { client } = scriptedClient();

    const { container } = renderWithI18n(<NfcStep step={view} client={client} onDone={vi.fn()} />);

    expect(container.textContent).not.toMatch(/phone with NFC/i);
    expect(container.textContent).not.toMatch(/review|manual|checked by/i);
    for (const words of Object.values(en.nfc)) {
      expect(words).not.toMatch(/NFC|review|verified|authentic|genuine/i);
    }
  });

  it('offers "use another way" only where the step has a fallback', () => {
    const { client } = scriptedClient();

    const withFallback = renderWithI18n(<NfcStep step={view} client={client} onDone={vi.fn()} />);
    expect(useAnotherWay()).toBeEnabled();
    expect(screen.getByText(en.nfc.otherWay)).toBeVisible();
    expect(screen.queryByText(en.nfc.noOtherWay)).toBeNull();
    withFallback.unmount();

    for (const step of [{ ...view, fallbackAvailable: false }, chip] satisfies NfcStepView[]) {
      const rendered = renderWithI18n(<NfcStep step={step} client={client} onDone={vi.fn()} />);

      expect(screen.queryByRole('button', { name: en.nfc.useAnotherWay })).toBeNull();
      expect(screen.getByText(en.nfc.noOtherWay)).toBeVisible();
      rendered.unmount();
    }
  });

  it('asks nothing of the server until the person chooses', () => {
    const { client, createVerification, reportClientUnable } = scriptedClient();
    const onDone = vi.fn(() => Promise.resolve());

    renderWithI18n(<NfcStep step={view} client={client} onDone={onDone} />);

    expect(createVerification).not.toHaveBeenCalled();
    expect(reportClientUnable).not.toHaveBeenCalled();
    expect(onDone).not.toHaveBeenCalled();
  });

  it('reports platform_unsupported for the step’s verification, then reads the session', async () => {
    const user = userEvent.setup();
    const { client, createVerification, reportClientUnable } = scriptedClient();
    const onDone = vi.fn(() => Promise.resolve());
    renderWithI18n(<NfcStep step={view} client={client} onDone={onDone} />);

    await user.click(useAnotherWay());

    await waitFor(() => {
      expect(onDone).toHaveBeenCalledTimes(1);
    });
    expect(createVerification.mock.calls.map(([body]) => body)).toEqual([
      { type: 'government-id-nfc' },
    ]);
    expect(reportClientUnable.mock.calls.map(([id, reason]) => [id, reason])).toEqual([
      [VERIFICATION_ID, 'platform_unsupported'],
    ]);
  });

  it('says it is switching, with the action disabled, while the report is out', async () => {
    const user = userEvent.setup();
    let answer: (() => void) | undefined;
    const { client } = scriptedClient(
      (verificationId) =>
        new Promise((resolve) => {
          answer = () => {
            resolve({ 'verification-id': verificationId, status: 'canceled' });
          };
        }),
    );
    const onDone = vi.fn(() => Promise.resolve());
    renderWithI18n(<NfcStep step={view} client={client} onDone={onDone} />);

    await user.click(useAnotherWay());

    expect(await screen.findByRole('status')).toHaveTextContent(en.nfc.switching);
    expect(useAnotherWay()).toBeDisabled();
    answer?.();
    await waitFor(() => {
      expect(onDone).toHaveBeenCalledTimes(1);
    });
  });

  it('shows a refused report as an error and lets the person try again with the same verification', async () => {
    const user = userEvent.setup();
    const refusals: unknown[] = [new FlowApiError('http', 'conflict', { status: 409 })];
    const { client, createVerification, reportClientUnable } = scriptedClient((verificationId) =>
      refusals.length > 0
        ? // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- the queued error, as given
          Promise.reject(refusals.shift())
        : accepted(verificationId),
    );
    const onDone = vi.fn(() => Promise.resolve());
    renderWithI18n(<NfcStep step={view} client={client} onDone={onDone} />);

    await user.click(useAnotherWay());

    expect(await screen.findByRole('alert')).toHaveTextContent(en.errors.conflict);
    expect(onDone).not.toHaveBeenCalled();
    expect(useAnotherWay()).toBeEnabled();

    await user.click(useAnotherWay());

    await waitFor(() => {
      expect(onDone).toHaveBeenCalledTimes(1);
    });
    expect(createVerification).toHaveBeenCalledTimes(1);
    expect(reportClientUnable).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('shows an error when the verification cannot be created, and reports nothing', async () => {
    const user = userEvent.setup();
    const { client, createVerification, reportClientUnable } = scriptedClient();
    createVerification.mockRejectedValueOnce(new FlowApiError('network', 'offline'));
    renderWithI18n(<NfcStep step={view} client={client} onDone={vi.fn()} />);

    await user.click(useAnotherWay());

    expect(await screen.findByRole('alert')).toHaveTextContent(en.errors.network);
    expect(reportClientUnable).not.toHaveBeenCalled();
  });
});

describe('the fake flow API’s nfc answers (C207.10)', () => {
  it('records each report and answers canceled, or rejects with a queued error', async () => {
    const fake = new FakeFlowApi();
    const script = nfcScript(fake);

    await expect(
      fake.client.reportClientUnable(VERIFICATION_ID, 'platform_unsupported'),
    ).resolves.toEqual({ 'verification-id': VERIFICATION_ID, status: 'canceled' });
    script.failures.push(new FlowApiError('http', 'conflict', { status: 409 }));
    await expect(
      fake.client.reportClientUnable(VERIFICATION_ID, 'platform_unsupported'),
    ).rejects.toMatchObject({ status: 409 });

    expect(script.reports).toEqual([
      { verificationId: VERIFICATION_ID, reason: 'platform_unsupported' },
    ]);
  });
});
