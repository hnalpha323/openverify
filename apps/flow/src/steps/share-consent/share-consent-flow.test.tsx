/**
 * C238.6, C237.6 (Phase 11, Workflow 11A; `clients-connect`): the web flow at the server's position
 * on a `share_consent` step, and the withdrawal affordance on every later screen and on the
 * completion screen. The screen and the affordance are dispatched by Phase 9's renderer
 * (`flow/flow-position.ts`, `flow/flow-renderer.tsx`); the "server" here is the in-memory fake,
 * whose answers decide where the flow goes.
 */
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { resolveFlowPosition } from '../../flow/flow-position';
import { FlowRenderer } from '../../flow/flow-renderer';
import { shareConsentEn } from './locales/en';
import { FakeFlowApi } from '../../testing/fake-flow-api';
import { INQUIRY_ID } from '../../testing/flow-fixtures';
import { at, positionedSession, serve, type ServedPosition } from '../../testing/flow-renderer';
import { renderWithFlow } from '../../test-utils';
import { SYNTHETIC_BIOMETRIC, shareConsentScript, shareConsentView } from './testing';

const VIEW = shareConsentView();
const ON_SHARE: ServedPosition = { position: at('share_back', 'active', 'consent'), step: VIEW };
const ON_SCREEN: ServedPosition = {
  position: at('more', 'active', 'share_back'),
  step: {
    id: 'more',
    type: 'screen',
    components: [
      { id: 'title', kind: 'text', variant: 'title', copyKey: 'screen.heading' },
      { id: 'go', kind: 'button', labelKey: 'screen.continue', action: 'submit' },
    ],
  },
};
const DONE: ServedPosition = {
  position: at('done', 'ended', 'more'),
  step: { id: 'done', type: 'completion' },
};
const WITHDRAWABLE = {
  'step-id': 'share_back',
  side: 'source',
  'recipient-name': 'Example Partner',
} as const;

function fakeAt(served: ServedPosition): FakeFlowApi {
  const api = new FakeFlowApi();
  api.consent = { textKeys: ['consent.biometric'], locale: 'en' };
  serve(api, served);
  return api;
}

const renderFlow = (api: FakeFlowApi) =>
  renderWithFlow(<FlowRenderer client={api.client} inquiryId={INQUIRY_ID} />);
const withdrawButton = () =>
  screen.getByRole('button', {
    name: shareConsentEn.consent.withdraw.replace('{{recipient}}', 'Example Partner'),
  });

describe('the share-consent position (C238.6)', () => {
  it('is the share-consent screen for the served client view', () => {
    const session = positionedSession(ON_SHARE, { consent: true });

    expect(resolveFlowPosition(session)).toEqual({ kind: 'share-consent', step: VIEW });
  });
});

describe('the share-consent step in the flow (C238.6)', () => {
  it('accepts, then shows the position the server moved to', async () => {
    const api = fakeAt(ON_SHARE);
    shareConsentScript(api).next = ON_SCREEN;
    renderFlow(api);

    await userEvent.click(await screen.findByRole('checkbox', { name: SYNTHETIC_BIOMETRIC }));
    await userEvent.click(screen.getByRole('button', { name: shareConsentEn.consent.accept }));

    expect(await screen.findByRole('heading', { level: 1, name: 'Your details' })).toBeVisible();
    expect(shareConsentScript(api).exits.map((exit) => [exit.stepId, exit.exit])).toEqual([
      ['share_back', 'accept'],
    ]);
  });

  it('declines, and the flow goes on', async () => {
    const api = fakeAt(ON_SHARE);
    shareConsentScript(api).next = ON_SCREEN;
    renderFlow(api);

    await userEvent.click(
      await screen.findByRole('button', { name: shareConsentEn.consent.decline }),
    );

    expect(await screen.findByRole('heading', { level: 1, name: 'Your details' })).toBeVisible();
    expect(shareConsentScript(api).exits.map((exit) => exit.exit)).toEqual(['decline']);
  });
});

describe('the withdrawal affordance (C237.6, V02)', () => {
  it('is offered on a later step, and withdrawing keeps the person where they are', async () => {
    const api = fakeAt(ON_SCREEN);
    shareConsentScript(api).withdrawable = [WITHDRAWABLE];
    renderFlow(api);

    expect(await screen.findByRole('heading', { level: 1, name: 'Your details' })).toBeVisible();
    await userEvent.click(withdrawButton());

    expect(await screen.findByRole('status')).toHaveTextContent(
      shareConsentEn.step.withdrawn.replace('{{recipient}}', 'Example Partner'),
    );
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /Withdraw/ })).toBeNull();
    });
    expect(screen.getByRole('heading', { level: 1, name: 'Your details' })).toBeVisible();
    expect(shareConsentScript(api).exits).toEqual([{ stepId: 'share_back', exit: 'withdraw' }]);
  });

  it('is offered on the completion screen', async () => {
    const api = fakeAt({ ...DONE });
    shareConsentScript(api).withdrawable = [WITHDRAWABLE];
    renderFlow(api);

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Verification submitted' }),
    ).toBeVisible();
    expect(withdrawButton()).toBeEnabled();
  });

  it('is not offered while the session lists none', async () => {
    const api = fakeAt(ON_SCREEN);
    renderFlow(api);

    expect(await screen.findByRole('heading', { level: 1, name: 'Your details' })).toBeVisible();
    expect(screen.queryByRole('heading', { name: shareConsentEn.step.withdrawHeading })).toBeNull();
  });
});
