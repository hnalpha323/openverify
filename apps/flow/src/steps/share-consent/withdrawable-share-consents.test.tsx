/**
 * C237.6 (Phase 11, Workflow 11A; `clients-connect`; verification V02): one "withdraw" affordance
 * per entry of the session's `withdrawable-share-consents`, naming its recipient. Withdrawing posts
 * the step to the withdraw exit and reads the session again; it never moves the flow, and the
 * screen says that the agreement was withdrawn. Nothing is shown while the list is empty.
 */
import type { FlowWithdrawableShareConsent } from '@openverify/contracts';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { FlowApiError, type FlowApiClient } from '../../api/flow-api-client';
import { en } from '../../i18n/locales/en';
import { shareConsentEn } from './locales/en';
import { renderWithI18n } from '../../test-utils';
import { WithdrawableShareConsents } from './withdrawable-share-consents';

const SESSION = {} as Awaited<ReturnType<FlowApiClient['getSession']>>;
const PARTNER: FlowWithdrawableShareConsent = {
  'step-id': 'share_back',
  side: 'source',
  'recipient-name': 'Example Partner',
};
const OTHER: FlowWithdrawableShareConsent = {
  'step-id': 'share_other',
  side: 'destination',
  'recipient-name': 'Example Other',
};

function scriptedClient() {
  const withdrawShareConsent = vi.fn<FlowApiClient['withdrawShareConsent']>(() =>
    Promise.resolve(SESSION),
  );
  return { client: { withdrawShareConsent } as unknown as FlowApiClient, withdrawShareConsent };
}

const withdrawLabel = (recipient: string) =>
  shareConsentEn.consent.withdraw.replace('{{recipient}}', recipient);

describe('WithdrawableShareConsents (C237.6)', () => {
  it.each([undefined, []])('shows nothing while the session lists none (%j)', (consents) => {
    const { client } = scriptedClient();
    const { container } = renderWithI18n(
      <WithdrawableShareConsents consents={consents} client={client} onWithdrawn={vi.fn()} />,
    );

    expect(container).toBeEmptyDOMElement();
  });

  it('offers one withdrawal per agreement, naming its recipient', () => {
    const { client } = scriptedClient();
    renderWithI18n(
      <WithdrawableShareConsents
        consents={[PARTNER, OTHER]}
        client={client}
        onWithdrawn={vi.fn()}
      />,
    );

    expect(
      screen.getByRole('heading', { name: shareConsentEn.step.withdrawHeading }),
    ).toBeVisible();
    expect(screen.getByRole('button', { name: withdrawLabel('Example Partner') })).toBeEnabled();
    expect(screen.getByRole('button', { name: withdrawLabel('Example Other') })).toBeEnabled();
  });

  it('withdraws the step’s agreement, reads the session and says it was withdrawn', async () => {
    const { client, withdrawShareConsent } = scriptedClient();
    const onWithdrawn = vi.fn(() => Promise.resolve());
    renderWithI18n(
      <WithdrawableShareConsents consents={[PARTNER]} client={client} onWithdrawn={onWithdrawn} />,
    );

    await userEvent.click(screen.getByRole('button', { name: withdrawLabel('Example Partner') }));

    await waitFor(() => {
      expect(onWithdrawn).toHaveBeenCalledTimes(1);
    });
    expect(withdrawShareConsent).toHaveBeenCalledWith('share_back');
    expect(await screen.findByRole('status')).toHaveTextContent(
      shareConsentEn.step.withdrawn.replace('{{recipient}}', 'Example Partner'),
    );
  });

  it('shows a refusal and offers the withdrawal again', async () => {
    const { client, withdrawShareConsent } = scriptedClient();
    withdrawShareConsent.mockRejectedValueOnce(new FlowApiError('network', 'offline'));
    const onWithdrawn = vi.fn(() => Promise.resolve());
    renderWithI18n(
      <WithdrawableShareConsents consents={[PARTNER]} client={client} onWithdrawn={onWithdrawn} />,
    );

    await userEvent.click(screen.getByRole('button', { name: withdrawLabel('Example Partner') }));

    expect(await screen.findByRole('alert')).toHaveTextContent(en.errors.network);
    expect(screen.getByRole('button', { name: withdrawLabel('Example Partner') })).toBeEnabled();
    expect(onWithdrawn).not.toHaveBeenCalled();
  });
});
