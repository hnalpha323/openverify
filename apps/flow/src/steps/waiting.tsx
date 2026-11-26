import { Alert, Button } from '@openverify/ui';
import { useTranslation } from 'react-i18next';
import { errorMessageKey } from '../api/error-message';
import type { Polling } from '../flow/use-polling';

/** A spinner beside a live-region message, for screens that wait on the server. */
export function WaitingStatus({ message }: { readonly message: string }) {
  return (
    <div className="flex items-center gap-3">
      <span
        aria-hidden="true"
        className="size-5 shrink-0 animate-spin rounded-full border-2 border-line border-t-primary"
      />
      <p role="status">{message}</p>
    </div>
  );
}

/** What went wrong while waiting (too slow, or requests failing), with a way to check again. */
export function WaitProblem({ polling }: { readonly polling: Polling }) {
  const { t } = useTranslation();
  if (polling.status === 'polling') {
    return null;
  }
  const slow = polling.status === 'timed-out';

  return (
    <div className="flex flex-col gap-4">
      <Alert tone={slow ? 'warning' : 'error'}>
        {slow ? t('processing.slow') : t(errorMessageKey(polling.error))}
      </Alert>
      <Button className="sm:self-end" onClick={polling.restart}>
        {slow ? t('processing.checkAgain') : t('errors.retry')}
      </Button>
    </div>
  );
}
