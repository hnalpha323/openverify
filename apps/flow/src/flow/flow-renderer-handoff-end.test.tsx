/**
 * K7A-4 (C96.8): the phone completes while the desktop waits on its handoff step. The completion
 * ends every session of the inquiry, but a finished inquiry's session may still read (C25.8), so
 * the desktop's poll reaches the template's completion screen. Closing the waiting screen then
 * sends its signal body, which a canceled session is refused; that refusal must not replace the
 * completion with "this verification session has ended". Synthetic values only.
 */
import type { Problem } from '@openverify/contracts';
import { act, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { FlowApiError } from '../api/flow-api-client';
import { en } from '../i18n/locales/en';
import { FakeFlowApi } from '../testing/fake-flow-api';
import { INQUIRY_ID, defaultFlow } from '../testing/flow-fixtures';
import { renderWithFlow } from '../test-utils';
import { FlowRenderer } from './flow-renderer';

const problem: Problem = {
  type: 'about:blank',
  title: 'Unauthorized',
  status: 401,
  detail: 'The session is no longer active.',
  instance: '/api/v1/flow/signals',
  requestId: 'req-1',
  code: 'session_canceled',
  reason: 'inquiry_finished',
};

function desktopOnHandoff(): FakeFlowApi {
  const api = new FakeFlowApi();
  const [consent, ...rest] = defaultFlow().steps;
  api.flow = {
    ...defaultFlow(),
    steps: [
      ...(consent === undefined ? [] : [consent]),
      { id: 'device_handoff', type: 'device_handoff' },
      ...rest,
    ],
  };
  api.handoff = { 'step-id': 'device_handoff', state: 'pending' };
  api.signalTiers = { integrity: true, recognition: false };
  api.client.getCurrentHandoff.mockResolvedValue({
    status: 'redeemed',
    'redeemed-at': '2026-10-20T12:05:00.000Z',
    'os-name': 'iOS',
    'browser-name': 'Safari',
  });
  return api;
}

describe('the desktop after the phone completes (K7A-4, C96.8)', () => {
  it('shows the template’s completion screen, even though its last signal body is refused', async () => {
    const api = desktopOnHandoff();
    api.client.sendSignals.mockImplementation(() =>
      api.inquiryStatus === 'completed'
        ? Promise.reject(new FlowApiError('http', 'failed with HTTP 401', { status: 401, problem }))
        : Promise.resolve(),
    );
    renderWithFlow(<FlowRenderer client={api.client} inquiryId={INQUIRY_ID} />);

    await userEvent.click(await screen.findByRole('checkbox', { name: /^I agree/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await screen.findByRole('heading', { level: 1, name: en.handoff.desktop.waitingTitle });

    const sent = api.client.sendSignals.mock.calls.length;
    act(() => {
      api.inquiryStatus = 'completed';
    });

    await screen.findByRole('heading', { level: 1, name: en.completion.title });
    // Long enough for a refused body to come back and replace the screen.
    await act(() => new Promise((resolve) => setTimeout(resolve, 20)));
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(en.completion.title);
    expect(api.client.sendSignals.mock.calls).toHaveLength(sent);
  });

  it('still ends the flow on a refused body while the person is on an open step', async () => {
    const api = desktopOnHandoff();
    api.client.getCurrentHandoff.mockResolvedValue({
      status: 'issued',
      'redeemed-at': null,
      'os-name': null,
      'browser-name': null,
    });
    api.client.sendSignals.mockRejectedValue(
      new FlowApiError('http', 'failed with HTTP 401', { status: 401, problem }),
    );
    renderWithFlow(<FlowRenderer client={api.client} inquiryId={INQUIRY_ID} />);

    await userEvent.click(await screen.findByRole('checkbox', { name: /^I agree/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await screen.findByRole('heading', { level: 1, name: en.handoff.desktop.title });
    await userEvent.click(screen.getByRole('button', { name: en.handoff.desktop.continueHere }));

    await screen.findByRole('heading', { level: 1, name: en.ended.canceled.title });
  });
});
