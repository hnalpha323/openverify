import { Card } from '@openverify/ui';
import { useTranslation } from 'react-i18next';
import type { FinalOutcome } from '../api/final-outcome';
import { ExpiredScreen } from './outcome-screens';

const COPY = {
  'session-expired': 'ended.expired',
  'session-canceled': 'ended.canceled',
  redacted: 'ended.redacted',
} as const satisfies Record<Exclude<FinalOutcome, 'inquiry-expired'>, string>;

/**
 * The session can no longer be used: it expired, was canceled, or its inquiry was redacted
 * (C19). A session canceled because its inquiry expired shows the link-expired screen (C25.8).
 * Nothing here can be retried, so the screen offers no button.
 */
export function SessionEndedScreen({ outcome }: { readonly outcome: FinalOutcome }) {
  const { t } = useTranslation();

  if (outcome === 'inquiry-expired') {
    return <ExpiredScreen />;
  }
  const copy = COPY[outcome];
  return (
    <Card title={t(`${copy}.title`)} headingLevel={1}>
      <p>{t(`${copy}.message`)}</p>
    </Card>
  );
}
