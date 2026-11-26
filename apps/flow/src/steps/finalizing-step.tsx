import { Card } from '@openverify/ui';
import { useTranslation } from 'react-i18next';
import { useFlowEnvironment } from '../flow/flow-environment';
import { usePolling } from '../flow/use-polling';
import { WaitProblem, WaitingStatus } from './waiting';

export interface FinalizingStepProps {
  /** Reloads the session; rejects when the request fails. */
  readonly onPoll: (signal: AbortSignal) => Promise<void>;
}

/** The last attempt failed: waits for the server to decide the inquiry. */
export function FinalizingStep({ onPoll }: FinalizingStepProps) {
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
    <Card title={t('finalizing.title')} headingLevel={1}>
      <div className="flex flex-col gap-4">
        <WaitingStatus message={t('finalizing.message')} />
        <WaitProblem polling={polling} />
      </div>
    </Card>
  );
}
