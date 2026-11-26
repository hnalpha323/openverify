import { Alert, Button, Card } from '@openverify/ui';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { errorMessageKey } from '../api/error-message';
import type { FlowApiClient } from '../api/flow-api-client';
import { isConflict } from '../api/problem-members';

export interface ConfirmedStepProps {
  /** The `confirmed` phone or email verification (C50.7). */
  readonly verificationId: string;
  readonly client: FlowApiClient;
  /** Reloads the session once the verification is submitted, or moved on at the server. */
  readonly onSubmitted: () => Promise<void>;
}

type Phase =
  | { readonly name: 'submitting' }
  /** While Try again runs (`retrying`), this screen stays, so focus stays on Try again. */
  | { readonly name: 'failed'; readonly error: unknown; readonly retrying: boolean };

/**
 * C64.1: a confirmed code is submitted at once, whether it was just confirmed or the session
 * resumed on it, so a confirmed verification is never left waiting for the user. The submit runs
 * once per screen; it is not aborted when the screen goes away, because the server takes a
 * repeated submit as the same one (C3).
 */
export function ConfirmedStep({ verificationId, client, onSubmitted }: ConfirmedStepProps) {
  const { t } = useTranslation();
  const [phase, setPhase] = useState<Phase>({ name: 'submitting' });
  const started = useRef(false);
  const mounted = useRef(true);

  const submit = async (retryOf?: unknown) => {
    setPhase(
      retryOf === undefined
        ? { name: 'submitting' }
        : { name: 'failed', error: retryOf, retrying: true },
    );
    try {
      await client.submitVerification(verificationId);
    } catch (error: unknown) {
      if (mounted.current && isConflict(error)) {
        // Submitted already, or moved on: the session says where the user is now.
        await onSubmitted();
      }
      if (mounted.current) {
        setPhase({ name: 'failed', error, retrying: false });
      }
      return;
    }
    if (mounted.current) {
      await onSubmitted();
    }
  };

  // The submit starts once, when the screen first mounts, with the props of that render.
  const first = useRef(submit);
  useEffect(() => {
    mounted.current = true;
    if (!started.current) {
      started.current = true;
      void first.current();
    }
    return () => {
      mounted.current = false;
    };
  }, []);

  return (
    <Card title={t('otp.confirmed.title')} headingLevel={1}>
      {phase.name === 'submitting' && <p role="status">{t('otp.confirmed.submitting')}</p>}
      {phase.name === 'failed' && (
        <div className="flex flex-col gap-4">
          <Alert tone="error">{t(errorMessageKey(phase.error))}</Alert>
          {phase.retrying && <p role="status">{t('otp.confirmed.submitting')}</p>}
          <Button
            className="aria-disabled:cursor-progress sm:self-end"
            // Not `disabled`: a disabled button loses focus.
            aria-disabled={phase.retrying ? true : undefined}
            onClick={() => {
              if (!phase.retrying) {
                void submit(phase.error);
              }
            }}
          >
            {t('errors.retry')}
          </Button>
        </div>
      )}
    </Card>
  );
}
