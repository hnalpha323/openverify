import type { FlowVerificationResource } from '@openverify/contracts';
import { Card } from '@openverify/ui';
import { useTranslation } from 'react-i18next';
import type { FlowApiClient } from '../api/flow-api-client';
import { useFlowEnvironment } from '../flow/flow-environment';
import { usePolling } from '../flow/use-polling';
import { WaitProblem, WaitingStatus } from './waiting';

export interface ProcessingStepProps {
  readonly client: FlowApiClient;
  readonly verificationId: string;
  readonly attempt: number;
  readonly maxAttempts: number;
  /** Called once the verification is decided; reloads the session. */
  readonly onSettled: () => Promise<void>;
  /**
   * Whether the verification is made of photos (a government ID or a selfie); otherwise, a code,
   * a signature or entered values, the screen says the verification is being checked (C64.1).
   */
  readonly photos?: boolean;
}

type Status = FlowVerificationResource['attributes']['status'];

/** Statuses that need no more waiting: the session then says what comes next. */
const DECIDED: ReadonlySet<Status> = new Set([
  'passed',
  'failed',
  'requires_retry',
  'canceled',
  'skipped',
  // C30.6: an operator decides it; the user's part is done.
  'needs_review',
]);

/** Polls `GET /flow/verifications/:id` until the submitted verification is decided. */
export function ProcessingStep({
  client,
  verificationId,
  attempt,
  maxAttempts,
  onSettled,
  photos = true,
}: ProcessingStepProps) {
  const { t } = useTranslation();
  const { pollIntervalMs, maxPolls } = useFlowEnvironment();
  const polling = usePolling(
    async (signal) => {
      const verification = await client.getVerification(verificationId, signal);
      if (!DECIDED.has(verification.attributes.status)) {
        return false;
      }
      await onSettled();
      return true;
    },
    { intervalMs: pollIntervalMs, maxPolls },
  );

  return (
    <Card title={t(photos ? 'processing.title' : 'processing.verificationTitle')} headingLevel={1}>
      <div className="flex flex-col gap-4">
        <WaitingStatus message={t('processing.message')} />
        <p className="text-sm font-medium text-ink-muted">
          {t('attempt', { current: attempt, max: maxAttempts })}
        </p>
        <WaitProblem polling={polling} />
      </div>
    </Card>
  );
}
