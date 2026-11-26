/**
 * Workflow 9A (flow-renderer): the screens of the server's position that are not steps: the waiting
 * state (C150.5, C152.2: a branch waiting for facts, an action waiting for its workflow), a flow the
 * server halted at its caps (C151.2), and a person who stopped for now (a confirmed `cancel`
 * button, C148.2). None of them says why: no route, fact or workflow reaches the person.
 */
import { Card } from '@openverify/ui';
import { useTranslation } from 'react-i18next';
import { useFlowEnvironment } from '../flow/flow-environment';
import { usePolling } from '../flow/use-polling';
import { WaitProblem, WaitingStatus } from './waiting';

export interface WaitingStepProps {
  /** How long to wait between two reads: the server's `retry-after-ms`, 2 s by default. */
  readonly intervalMs: number;
  /** Reloads the session; rejects when the request fails. */
  readonly onPoll: (signal: AbortSignal) => Promise<void>;
}

/** C150.5: reads the session every `intervalMs` until the server's position moves on. */
export function WaitingStep({ intervalMs, onPoll }: WaitingStepProps) {
  const { t } = useTranslation();
  const { maxPolls } = useFlowEnvironment();
  // Each reload may change the position, which replaces this screen.
  const polling = usePolling(
    async (signal) => {
      await onPoll(signal);
      return false;
    },
    { intervalMs, maxPolls },
  );

  return (
    <Card title={t('screen.waiting.title')} headingLevel={1}>
      <div className="flex flex-col gap-4">
        <WaitingStatus message={t('screen.waiting.message')} />
        <WaitProblem polling={polling} />
      </div>
    </Card>
  );
}

/** C151.2: the flow stopped at its caps; an operator resumes or expires the inquiry. */
export function HaltedScreen() {
  const { t } = useTranslation();

  return (
    <Card title={t('screen.halted.title')} headingLevel={1}>
      <p>{t('screen.halted.message')}</p>
    </Card>
  );
}

/** C148.2: the person stopped for now; the inquiry stays resumable with the same link. */
export function StoppedScreen() {
  const { t } = useTranslation();

  return (
    <Card title={t('screen.cancel.stopped')} headingLevel={1}>
      <p>{t('screen.cancel.stoppedMessage')}</p>
    </Card>
  );
}
