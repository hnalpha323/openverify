import { Card } from '@openverify/ui';
import { useTranslation } from 'react-i18next';
import { useFlowEnvironment } from '../flow/flow-environment';
import type { AamvaStep } from '../flow/flow-position';
import { usePolling } from '../flow/use-polling';
import { WaitProblem, WaitingStatus } from './waiting';

export interface SilentStepProps {
  /** An AAMVA step with `source: government_id`: the server creates and decides it (C59.6). */
  readonly step: AamvaStep;
  /** Reloads the session; rejects when the request fails. */
  readonly onPoll: (signal: AbortSignal) => Promise<void>;
}

/**
 * C59.6, C64.1: a silent AAMVA step has no form. The server creates its attempt from the
 * inquiry's government ID, checks it with the issuer and decides it, or skips it; the client never
 * creates or submits it, and waits here, reading the session, until the server has moved on.
 */
export function SilentStep({ step, onPoll }: SilentStepProps) {
  const { t } = useTranslation();
  const { pollIntervalMs, maxPolls } = useFlowEnvironment();
  // Each reload may change the flow position, which replaces this screen.
  const polling = usePolling(
    async (signal) => {
      await onPoll(signal);
      return false;
    },
    { intervalMs: pollIntervalMs, maxPolls },
  );

  return (
    <Card title={t('forms.silent.title')} headingLevel={1}>
      <div className="flex flex-col gap-4" data-step={step.id}>
        <WaitingStatus message={t('forms.silent.message')} />
        <WaitProblem polling={polling} />
      </div>
    </Card>
  );
}
