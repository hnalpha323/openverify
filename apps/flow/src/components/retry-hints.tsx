import type { RetryHint } from '@openverify/contracts';
import { Alert } from '@openverify/ui';
import { useTranslation } from 'react-i18next';
import { translateKey } from '../i18n/translate-key';

export interface RetryHintsProps {
  readonly hints: readonly RetryHint[];
  /**
   * Whether the attempt was photos (a government ID or a selfie); a code, a signature or entered
   * values are titled as an attempt (C64.1).
   */
  readonly photos?: boolean;
}

/** Why the previous attempt failed, as things the user can fix (user_behavior reasons only). */
export function RetryHints({ hints, photos = true }: RetryHintsProps) {
  const { t, i18n } = useTranslation();
  if (hints.length === 0) {
    return null;
  }

  // Reason codes come from the server: unknown ones fall back to a generic message.
  const messages = new Set(
    hints.flatMap(({ reasons }) =>
      reasons.length === 0
        ? [t('retry.generic')]
        : reasons.map(
            (reason) => translateKey(i18n, `retry.reasons.${reason}`) ?? t('retry.generic'),
          ),
    ),
  );

  return (
    <Alert tone="warning" title={t(photos ? 'retry.title' : 'retry.attemptTitle')}>
      <ul className="mt-1 list-disc space-y-1 ps-5">
        {[...messages].map((message) => (
          <li key={message}>{message}</li>
        ))}
      </ul>
    </Alert>
  );
}
