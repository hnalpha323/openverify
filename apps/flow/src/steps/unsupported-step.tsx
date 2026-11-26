import { Alert, Card } from '@openverify/ui';
import { useTranslation } from 'react-i18next';
import type { ClientStep, SessionFlowStep, UnsupportedReason } from '../flow/flow-position';

export interface UnsupportedStepProps {
  /** A step of the projection, or (Workflow 9A) the server's client view. */
  readonly step: SessionFlowStep | ClientStep;
  readonly reason: UnsupportedReason;
}

const STEP_NAMES = {
  form: 'unsupported.steps.form',
  document: 'unsupported.steps.document',
  phone_otp: 'unsupported.steps.phone_otp',
  email_otp: 'unsupported.steps.email_otp',
  database: 'unsupported.steps.database',
  aamva: 'unsupported.steps.aamva',
  nfc: 'unsupported.steps.nfc',
  crypto_wallet: 'unsupported.steps.crypto_wallet',
  database_business: 'unsupported.steps.database_business',
  business_website: 'unsupported.steps.business_website',
} as const;

function hasName(type: string): type is keyof typeof STEP_NAMES {
  return Object.hasOwn(STEP_NAMES, type);
}

/** A step this version cannot run: said plainly, never skipped. */
export function UnsupportedStep({ step, reason }: UnsupportedStepProps) {
  const { t } = useTranslation();
  const message = hasName(step.type)
    ? t('unsupported.step', { step: t(STEP_NAMES[step.type]) })
    : t('unsupported.flow');

  return (
    <Card title={t('unsupported.title')} headingLevel={1}>
      <div className="flex flex-col gap-4" data-reason={reason}>
        <Alert tone="warning">{message}</Alert>
        <p>{t('unsupported.contact')}</p>
      </div>
    </Card>
  );
}
