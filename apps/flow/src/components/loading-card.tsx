import { Card } from '@openverify/ui';
import { useTranslation } from 'react-i18next';

/** Shown while the verification is being opened or loaded, announced as a status. */
export function LoadingCard() {
  const { t } = useTranslation();

  return (
    <Card>
      <p role="status">{t('loading')}</p>
    </Card>
  );
}
