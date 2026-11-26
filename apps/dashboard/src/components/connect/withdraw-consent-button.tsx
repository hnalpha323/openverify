'use client';

import { CONSENT_WITHDRAWAL_REASONS } from '@openverify/contracts';
import { ConfirmActionButton } from '../confirm-action-button';
import { FormField } from '../form-field';
import type { ConnectAction } from './connection-actions';
import { CONSENT_WITHDRAWAL_REASON_WORDS } from './connect-words';

export interface WithdrawConsentButtonProps {
  readonly recordId: string;
  readonly recipientName: string;
  readonly action: ConnectAction;
}

const SELECT_CLASS =
  'rounded-lg border border-line bg-surface px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus';

/**
 * C237.1, C242.3: the console's withdrawal (`withdrawn-via: operator`), with a confirmation that says
 * what it does and what it cannot undo, and an optional reason from the closed list.
 */
export function WithdrawConsentButton({
  recordId,
  recipientName,
  action,
}: WithdrawConsentButtonProps) {
  return (
    <ConfirmActionButton
      label="Withdraw"
      accessibleLabel={`Withdraw the consent naming ${recipientName}`}
      title="Withdraw this consent"
      description={`Nothing can cite it again. A share token not redeemed yet expires at once, and a redemption still running fails. A copy already made is not recalled: ${recipientName} is told, so its operator can act.`}
      confirmLabel="Withdraw"
      pendingLabel="Withdrawing…"
      action={action}
      fields={{ 'consent-record-id': recordId }}
      successMessage="The consent is withdrawn."
    >
      <FormField label="Reason (optional)">
        {(control) => (
          <select {...control} name="withdrawal-reason" defaultValue="" className={SELECT_CLASS}>
            <option value="">No reason given</option>
            {CONSENT_WITHDRAWAL_REASONS.map((reason) => (
              <option key={reason} value={reason}>
                {CONSENT_WITHDRAWAL_REASON_WORDS[reason]}
              </option>
            ))}
          </select>
        )}
      </FormField>
    </ConfirmActionButton>
  );
}
