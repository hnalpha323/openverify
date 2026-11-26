/**
 * C237.6 (Phase 11, Workflow 11A; `clients-connect`; verification V02): withdrawing an accepted share
 * consent while the flow session lives. Phase 9's renderer (`flow/flow-renderer.tsx`, one hook line)
 * renders this under every screen; it shows one affordance per entry of the session's
 * `withdrawable-share-consents` (this session's accepted, unwithdrawn records), naming the recipient,
 * so it appears on every step after an accepted `share_consent` and on the completion screen.
 *
 * Withdrawing posts the entry's step to the withdraw exit and reads the session again; the server
 * never moves the position for it. The screen then says that the agreement was withdrawn, in a
 * status that takes focus (the button is gone). A refusal is announced, and the affordance is offered
 * again. Nothing is shown while the session lists none and nothing was withdrawn here.
 */
import type { FlowWithdrawableShareConsent } from '@openverify/contracts';
import { Alert, Button, Card } from '@openverify/ui';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { errorMessageKey, type ErrorMessageKey } from '../../api/error-message';
import type { FlowApiClient } from '../../api/flow-api-client';
import { useIsolatedT } from '../../i18n/bidi';
import { WaitingStatus } from '../waiting';

export interface WithdrawableShareConsentsProps {
  /** The session's `withdrawable-share-consents`, absent while it has none. */
  readonly consents: readonly FlowWithdrawableShareConsent[] | undefined;
  readonly client: FlowApiClient;
  /** Reads the session again once the server recorded the withdrawal. */
  readonly onWithdrawn: () => Promise<void>;
}

/** The withdrawal affordance of each accepted share consent. */
export function WithdrawableShareConsents({
  consents = [],
  client,
  onWithdrawn,
}: WithdrawableShareConsentsProps) {
  const { t } = useTranslation();
  const tb = useIsolatedT();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<ErrorMessageKey | null>(null);
  // The recipient of the last withdrawal made here, said once the server recorded it.
  const [withdrawn, setWithdrawn] = useState<string | null>(null);
  const done = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (withdrawn !== null) {
      done.current?.focus();
    }
  }, [withdrawn]);

  if (consents.length === 0 && withdrawn === null) {
    return null;
  }

  const withdraw = async (consent: FlowWithdrawableShareConsent) => {
    setBusy(consent['step-id']);
    setError(null);
    try {
      await client.withdrawShareConsent(consent['step-id']);
    } catch (failure: unknown) {
      setError(errorMessageKey(failure));
      setBusy(null);
      return;
    }
    setWithdrawn(consent['recipient-name']);
    setBusy(null);
    await onWithdrawn();
  };

  return (
    <Card title={t('share.step.withdrawHeading')} headingLevel={2} className="mt-6">
      <div className="flex flex-col gap-4" aria-busy={busy !== null}>
        {withdrawn !== null && (
          <div ref={done} tabIndex={-1}>
            <Alert tone="success">{tb('share.step.withdrawn', { recipient: withdrawn })}</Alert>
          </div>
        )}
        {consents.map((consent) => (
          <div key={consent['step-id']} className="flex flex-col gap-3">
            <p>{tb('share.step.withdrawIntro', { recipient: consent['recipient-name'] })}</p>
            <Button
              variant="secondary"
              className="sm:self-start"
              data-share-consent-withdraw={consent['step-id']}
              disabled={busy !== null}
              onClick={() => {
                void withdraw(consent);
              }}
            >
              {tb('share.consent.withdraw', { recipient: consent['recipient-name'] })}
            </Button>
          </div>
        ))}
        {busy !== null && <WaitingStatus message={t('share.step.withdrawing')} />}
        {error !== null && <Alert tone="error">{t(error)}</Alert>}
      </div>
    </Card>
  );
}
