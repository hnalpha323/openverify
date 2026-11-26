import { Alert, Button, Card } from '@openverify/ui';
import { useTranslation } from 'react-i18next';
import { errorMessageKey } from '../api/error-message';

export interface ApiErrorProps {
  readonly error: unknown;
  readonly onRetry: () => void;
  /**
   * The retry is running. The screen stays, so focus stays on Try again (Workflow 2D F016): the
   * button says it is busy and ignores presses, and a status says the work is under way.
   */
  readonly retrying?: boolean;
}

/** A failed request, explained in the user's language, with a way to try again. */
export function ApiError({ error, onRetry, retrying = false }: ApiErrorProps) {
  const { t } = useTranslation();

  return (
    <Card title={t('errors.title')} headingLevel={1}>
      <div className="flex flex-col gap-6">
        <Alert tone="error">{t(errorMessageKey(error))}</Alert>
        {retrying && <p role="status">{t('loading')}</p>}
        <Button
          className="sm:self-end aria-disabled:cursor-progress"
          // Not `disabled`: a disabled button loses focus.
          aria-disabled={retrying ? true : undefined}
          onClick={() => {
            if (!retrying) {
              onRetry();
            }
          }}
        >
          {t('errors.retry')}
        </Button>
      </div>
    </Card>
  );
}
