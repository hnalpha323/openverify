/**
 * C96.1, C96.3, C96.5 (Workflow 7A): the desktop's `device_handoff` step.
 *
 * - On arrival it issues a QR (when the step offers one) and shows it with its link as the text
 *   alternative, a countdown, a new-code action, the confirmation code where asked, the email and
 *   SMS options where offered, and "continue on this device" where allowed.
 * - Once the phone redeemed it waits: when and on what the phone continued, and "this was not me",
 *   which ends the phone's session and shows the step again. It reloads the session once the
 *   inquiry left its open states.
 * - Every state is announced.
 */
import { handoffUrlFragment, type CurrentHandoffResponse } from '@openverify/contracts';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { wholeText } from '../../testing/flow-renderer';
import { describe, expect, it, vi } from 'vitest';
import { FlowApiError } from '../../api/flow-api-client';
import type { HandoffStep } from '../../flow/flow-position';
import { en } from '../../i18n/locales/en';
import { FakeFlowApi, FAKE_HANDOFF_ID, FAKE_HANDOFF_TOKEN } from '../../testing/fake-flow-api';
import { AT_ISO, INQUIRY_ID } from '../../testing/flow-fixtures';
import { renderWithFlow } from '../../test-utils';
import { DeviceHandoffStep } from './device-handoff-step';

const text = en.handoff.desktop;
const NOW = Date.parse(AT_ISO);
const IN_FIVE_MINUTES = new Date(NOW + 300_000).toISOString();

function step(options: Partial<HandoffStep> = {}): HandoffStep {
  return { id: 'device_handoff', type: 'device_handoff', ...options };
}

const redeemed: CurrentHandoffResponse = {
  status: 'redeemed',
  'redeemed-at': new Date(NOW + 60_000).toISOString(),
  'os-name': 'iOS',
  'browser-name': 'Safari',
};

function setup(options: { now?: () => number } = {}) {
  const api = new FakeFlowApi();
  api.client.createHandoff.mockImplementation((body) =>
    Promise.resolve({
      id: FAKE_HANDOFF_ID,
      method: body.method,
      'expires-at': IN_FIVE_MINUTES,
      ...(body.method === 'qr'
        ? { 'url-fragment': handoffUrlFragment(INQUIRY_ID, FAKE_HANDOFF_TOKEN) }
        : {}),
    }),
  );
  const onDone = vi.fn(() => Promise.resolve());
  const environment = {
    currentTime: options.now ?? (() => NOW),
    countdownIntervalMs: 5,
  };
  return { api, onDone, environment };
}

function renderStep(
  setupResult: ReturnType<typeof setup>,
  props: {
    step?: HandoffStep;
    handoff?: {
      'step-id': string;
      state: 'pending' | 'issued' | 'rejected' | 'declined' | 'redeemed';
      'handed-off'?: boolean;
    } | null;
  } = {},
) {
  return renderWithFlow(
    <DeviceHandoffStep
      step={props.step ?? step()}
      handoff={props.handoff === undefined ? null : props.handoff}
      client={setupResult.api.client}
      onDone={setupResult.onDone}
    />,
    { environment: setupResult.environment },
  );
}

describe('DeviceHandoffStep, reloaded while the phone works (K7A-5)', () => {
  it('opens on its waiting screen, issuing nothing', async () => {
    const setupResult = setup();
    setupResult.api.client.getCurrentHandoff.mockResolvedValue(redeemed);

    renderStep(setupResult, {
      handoff: { 'step-id': 'device_handoff', state: 'redeemed', 'handed-off': true },
    });

    expect(await screen.findByRole('heading', { name: text.waitingTitle })).toBeVisible();
    // The heading shows before the first read answers; the action comes with its answer.
    expect(await screen.findByRole('button', { name: text.notMe })).toBeVisible();
    expect(setupResult.api.client.createHandoff).not.toHaveBeenCalled();
  });

  it('offers the step again when the phone left before the read', async () => {
    const setupResult = setup();
    setupResult.api.client.getCurrentHandoff.mockResolvedValue({
      status: 'rejected',
      'redeemed-at': null,
      'os-name': null,
      'browser-name': null,
    });

    renderStep(setupResult, {
      handoff: { 'step-id': 'device_handoff', state: 'redeemed', 'handed-off': true },
    });

    expect(await screen.findByRole('button', { name: text.newCode })).toBeVisible();
  });
});

describe('DeviceHandoffStep (C96.5)', () => {
  it('issues a QR on arrival and shows it with its link, its countdown and the other ways', async () => {
    const setupResult = setup();
    renderStep(setupResult);

    expect(await screen.findByRole('img', { name: text.qrLabel })).toBeVisible();
    expect(setupResult.api.client.createHandoff).toHaveBeenCalledWith(
      { method: 'qr' },
      expect.anything(),
    );
    expect(screen.getByRole('heading', { level: 1, name: text.title })).toBeVisible();
    const link = screen.getByRole('textbox', { name: text.linkLabel });
    expect((link as HTMLInputElement).value).toContain(
      handoffUrlFragment(INQUIRY_ID, FAKE_HANDOFF_TOKEN),
    );
    expect(screen.getByText('This code expires in 5:00.')).toBeVisible();
    expect(screen.getByRole('button', { name: text.newCode })).toBeVisible();
    expect(screen.getByRole('button', { name: text.continueHere })).toBeVisible();
    expect(screen.queryByRole('button', { name: text.emailOption })).toBeNull();
  });

  it('shows the confirmation code the phone will ask for', async () => {
    const setupResult = setup();
    setupResult.api.client.createHandoff.mockResolvedValueOnce({
      id: FAKE_HANDOFF_ID,
      method: 'qr',
      'expires-at': IN_FIVE_MINUTES,
      'url-fragment': handoffUrlFragment(INQUIRY_ID, FAKE_HANDOFF_TOKEN),
      'confirmation-code': '482913',
    });
    renderStep(setupResult, { step: step({ confirmationCode: true }) });

    expect(await screen.findByText('When your phone asks for a code, enter: 482913')).toBeVisible();
  });

  it('says when the code has expired, and gets a new one', async () => {
    let now = NOW;
    const setupResult = setup({ now: () => now });
    renderStep(setupResult);
    await screen.findByRole('img', { name: text.qrLabel });

    now = NOW + 301_000;
    expect(await screen.findByText(text.expired)).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: text.newCode }));

    await waitFor(() => {
      expect(setupResult.api.client.createHandoff).toHaveBeenCalledTimes(2);
    });
  });

  it('waits once the phone redeemed, then "this was not me" ends the phone’s session and shows the step again', async () => {
    const setupResult = setup();
    setupResult.api.client.getCurrentHandoff.mockResolvedValue(redeemed);
    renderStep(setupResult);

    expect(await screen.findByRole('heading', { level: 1, name: text.waitingTitle })).toBeVisible();
    expect(screen.getByRole('status')).toHaveTextContent(/You continued on your phone at/);
    expect(screen.getByText(wholeText('Your phone: iOS, Safari'))).toBeVisible();

    setupResult.api.client.getCurrentHandoff.mockResolvedValue({
      status: 'rejected',
      'redeemed-at': null,
      'os-name': null,
      'browser-name': null,
    });
    await userEvent.click(screen.getByRole('button', { name: text.notMe }));

    expect(await screen.findByText(text.rejected)).toBeVisible();
    expect(setupResult.api.client.rejectHandoff).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: text.newCode })).toBeVisible();
  });

  it('reloads the session once the inquiry finished on the phone', async () => {
    const setupResult = setup();
    setupResult.api.client.getCurrentHandoff.mockResolvedValue(redeemed);
    renderStep(setupResult);
    await screen.findByRole('heading', { level: 1, name: text.waitingTitle });

    setupResult.api.inquiryStatus = 'completed';

    await waitFor(() => {
      expect(setupResult.onDone).toHaveBeenCalled();
    });
  });

  it('continues on this device where the step allows it, and offers it only then', async () => {
    const setupResult = setup();
    const { unmount } = renderStep(setupResult);
    await screen.findByRole('img', { name: text.qrLabel });

    await userEvent.click(screen.getByRole('button', { name: text.continueHere }));

    await waitFor(() => {
      expect(setupResult.onDone).toHaveBeenCalled();
    });
    expect(setupResult.api.client.continueHandoffHere).toHaveBeenCalledTimes(1);
    unmount();

    renderStep(setup(), { step: step({ allowContinueHere: false }) });
    await screen.findByRole('img', { name: text.qrLabel });
    expect(screen.queryByRole('button', { name: text.continueHere })).toBeNull();
  });

  it('sends a link by email where the step offers it, and says where it went', async () => {
    const setupResult = setup();
    renderStep(setupResult, { step: step({ methods: ['qr', 'email'] }) });
    await screen.findByRole('img', { name: text.qrLabel });

    await userEvent.click(screen.getByRole('button', { name: text.emailOption }));
    await userEvent.type(
      screen.getByRole('textbox', { name: text.emailLabel }),
      'person@example.com',
    );
    await userEvent.click(screen.getByRole('button', { name: text.send }));

    expect(
      await screen.findByText(
        'We sent a link to your email address. Open it on your phone within 5 minutes.',
      ),
    ).toBeVisible();
    expect(setupResult.api.client.createHandoff).toHaveBeenLastCalledWith(
      { method: 'email', destination: 'person@example.com' },
      expect.anything(),
    );
  });

  it('starts with the email form for a step without a QR, and says when the address was not confirmed', async () => {
    const setupResult = setup();
    setupResult.api.client.createHandoff.mockRejectedValueOnce(
      new FlowApiError('http', 'POST /api/v1/flow/handoffs failed with HTTP 422', {
        status: 422,
        problem: {
          type: 'about:blank',
          title: 'Unprocessable Content',
          status: 422,
          code: 'destination_not_confirmed',
          detail: 'Refused.',
          instance: '/api/v1/flow/handoffs',
          requestId: 'req-1',
        },
      }),
    );
    renderStep(setupResult, { step: step({ methods: ['email'] }) });

    await userEvent.type(
      await screen.findByRole('textbox', { name: text.emailLabel }),
      'other@example.com',
    );
    await userEvent.click(screen.getByRole('button', { name: text.send }));

    expect(await screen.findByText(text.errors.destinationNotConfirmed)).toBeVisible();
    expect(screen.queryByRole('img', { name: text.qrLabel })).toBeNull();
  });

  it('says that the phone declined, and shows a new code', async () => {
    const setupResult = setup();
    renderStep(setupResult, { handoff: { 'step-id': 'device_handoff', state: 'declined' } });

    expect(await screen.findByText(text.declined)).toBeVisible();
    expect(await screen.findByRole('img', { name: text.qrLabel })).toBeVisible();
  });

  it('reloads the session when the server has no handoff waiting', async () => {
    const setupResult = setup();
    setupResult.api.client.createHandoff.mockRejectedValueOnce(
      new FlowApiError('http', 'POST /api/v1/flow/handoffs failed with HTTP 409', {
        status: 409,
        problem: {
          type: 'about:blank',
          title: 'Conflict',
          status: 409,
          code: 'handoff_not_available',
          detail: 'Refused.',
          instance: '/api/v1/flow/handoffs',
          requestId: 'req-1',
        },
      }),
    );
    renderStep(setupResult);

    await waitFor(() => {
      expect(setupResult.onDone).toHaveBeenCalled();
    });
  });
});
