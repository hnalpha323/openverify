import { Alert, Card } from '@openverify/ui';
import { useTranslation } from 'react-i18next';

export type LinkErrorReason =
  | 'missing'
  | 'invalid'
  | 'mismatch'
  /** A one-time link the server refused: used, expired or unknown (C19). */
  | 'used'
  /** The page was reloaded after a one-time link, whose session lived in memory only. */
  | 'reloaded';

/**
 * The flow link is missing, malformed, already used, or belongs to another inquiry. None of
 * these can be retried from here: the user needs the right (or a new) link.
 */
export function LinkError({ reason }: { readonly reason: LinkErrorReason }) {
  const { t } = useTranslation();

  return (
    <Card title={t('link.title')} headingLevel={1}>
      <Alert tone="error">{t(`link.${reason}`)}</Alert>
    </Card>
  );
}
