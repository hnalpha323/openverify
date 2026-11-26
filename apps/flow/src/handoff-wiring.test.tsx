/**
 * Workflow 7A Stage 1b (H) (C96.1, C96.3, C96.5; F01, P15): the flow's wiring of device handoff.
 * `flow-handoff`'s two screens are replaced here by spies, so only the wiring is under test:
 *
 * - a handoff link (`App` with a `handoff` bootstrap, then `FlowRoutes`) renders
 *   `HandoffRedeemFlow` with the inquiry, the token (in memory only), the transport for the
 *   unauthenticated preview, decline and redeem, and `connect` for the redeemed session; nothing
 *   is sent at boot;
 * - `FlowRenderer` renders `DeviceHandoffStep` in the slot of a handoff step that is not done, with
 *   the step, its state, the client and `onDone`, which reloads the session; a done step moves on.
 */
import { render, screen, waitFor } from '@testing-library/react';
import { act } from 'react';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './app';
import { FlowRenderer } from './flow/flow-renderer';
import type { HandoffRedeemFlowProps } from './handoff';
import { createI18n } from './i18n/create-i18n';
import { FlowRoutes } from './routes';
import type { DeviceHandoffStepProps } from './steps/device-handoff/device-handoff-step';
import { FakeFlowApi } from './testing/fake-flow-api';
import { INQUIRY_ID } from './testing/flow-fixtures';
import { renderWithFlow } from './test-utils';

const seen = vi.hoisted(() => ({
  redeem: [] as HandoffRedeemFlowProps[],
  step: [] as DeviceHandoffStepProps[],
}));

vi.mock('./handoff/handoff-redeem-flow', () => ({
  HandoffRedeemFlow: (props: HandoffRedeemFlowProps) => {
    seen.redeem.push(props);
    return <p>handoff redeem screen</p>;
  },
}));

vi.mock('./steps/device-handoff/device-handoff-step', () => ({
  DeviceHandoffStep: (props: DeviceHandoffStepProps) => {
    seen.step.push(props);
    return <p>handoff step screen</p>;
  },
}));

beforeEach(() => {
  seen.redeem.length = 0;
  seen.step.length = 0;
});

const HANDOFF_TOKEN = `ovh_${'E'.repeat(43)}`;

describe('a handoff link (C96.3, P15)', () => {
  it('renders HandoffRedeemFlow from FlowRoutes with its inquiry, token, transport and connect', async () => {
    const connect = vi.fn();
    const transport = { baseUrl: 'https://api.example.com' };
    render(
      <I18nextProvider i18n={createI18n('en')}>
        <MemoryRouter initialEntries={['/']}>
          <FlowRoutes
            start={{
              status: 'handoff',
              inquiryId: INQUIRY_ID,
              handoffToken: HANDOFF_TOKEN,
              transport,
              connect,
            }}
          />
        </MemoryRouter>
      </I18nextProvider>,
    );

    expect(await screen.findByText('handoff redeem screen')).toBeVisible();
    expect(seen.redeem.at(-1)).toMatchObject({
      inquiryId: INQUIRY_ID,
      handoffToken: HANDOFF_TOKEN,
      transport,
      connect,
    });
  });

  it('is started by App from a handoff bootstrap, sending nothing at boot', async () => {
    window.history.replaceState(null, '', '/');
    const fetchStub = vi.fn<typeof fetch>();
    render(
      <App
        i18n={createI18n('en')}
        bootstrap={{
          status: 'handoff',
          handoff: { inquiryId: INQUIRY_ID, handoffToken: HANDOFF_TOKEN },
        }}
        apiBaseUrl="https://api.example.com"
        fetch={fetchStub}
      />,
    );

    expect(await screen.findByText('handoff redeem screen')).toBeVisible();
    const props = seen.redeem.at(-1);
    expect(props).toMatchObject({
      inquiryId: INQUIRY_ID,
      handoffToken: HANDOFF_TOKEN,
      transport: { baseUrl: 'https://api.example.com', fetch: fetchStub },
    });
    expect(typeof props?.connect).toBe('function');
    expect(fetchStub).not.toHaveBeenCalled();
  });
});

describe('FlowRenderer: the device_handoff slot (C96.1, C96.3, F01)', () => {
  const handoffFlow = () => {
    const api = new FakeFlowApi();
    api.flow = {
      ...api.flow,
      steps: [
        ...api.flow.steps.filter((step) => step.type === 'consent'),
        { id: 'move_to_phone', type: 'device_handoff' },
        ...api.flow.steps.filter((step) => step.type !== 'consent'),
      ],
    };
    api.consent = { textKeys: ['consent.biometric'], locale: 'en' };
    return api;
  };

  it('renders DeviceHandoffStep for a step not done, with its step, state, client and onDone', async () => {
    const api = handoffFlow();
    api.handoff = { 'step-id': 'move_to_phone', state: 'pending' };

    renderWithFlow(<FlowRenderer client={api.client} inquiryId={INQUIRY_ID} />);

    expect(await screen.findByText('handoff step screen')).toBeVisible();
    const props = seen.step.at(-1);
    expect(props).toMatchObject({
      step: { id: 'move_to_phone', type: 'device_handoff' },
      handoff: { 'step-id': 'move_to_phone', state: 'pending' },
    });
    expect(typeof props?.client.createHandoff).toBe('function');
    const reads = api.client.getSession.mock.calls.length;
    api.handoff = { 'step-id': 'move_to_phone', state: 'continued_here' };

    await act(async () => {
      await props?.onDone();
    });

    await waitFor(() => {
      expect(api.client.getSession.mock.calls.length).toBeGreaterThan(reads);
    });
    expect(await screen.findByRole('heading', { level: 1 })).not.toHaveTextContent(
      'handoff step screen',
    );
  });

  it('moves past a step that is done', async () => {
    const api = handoffFlow();
    api.handoff = { 'step-id': 'move_to_phone', state: 'skipped' };

    renderWithFlow(<FlowRenderer client={api.client} inquiryId={INQUIRY_ID} />);

    expect(await screen.findByRole('heading', { level: 1 })).toBeVisible();
    expect(screen.queryByText('handoff step screen')).toBeNull();
    expect(seen.step).toEqual([]);
  });
});
