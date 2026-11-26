import { Alert, Button, Card, Checkbox } from '@openverify/ui';
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { translateKey } from '../i18n/translate-key';

/** The default template's consent texts (contract C7). */
export const DEFAULT_CONSENT_TEXT_KEYS: readonly string[] = [
  'consent.biometric',
  'consent.processing',
];

export interface ConsentScreenProps {
  /**
   * Called once the user has explicitly agreed and pressed Continue, with the keys of the
   * optional texts they also accepted, in the order shown.
   */
  onContinue: (optionalTextKeys: readonly string[]) => void;
  /** Keys of the texts to show, in order; each must have a message (see `translateKey`). */
  textKeys?: readonly string[];
  /** C42.3: texts the user may accept or decline, each shown with its own unchecked checkbox. */
  optionalTexts?: readonly { readonly key: string; readonly text: string }[];
  /** While consent is being saved: Continue is disabled and the wait is announced. */
  busy?: boolean;
  /** Why saving failed, shown above Continue. */
  error?: ReactNode;
}

/**
 * Explicit, opt-in consent to biometric processing (BIPA, GDPR Art. 9) before any
 * camera access. Continue stays disabled until the consent box is checked.
 */
export function ConsentScreen({
  onContinue,
  textKeys = DEFAULT_CONSENT_TEXT_KEYS,
  optionalTexts = [],
  busy = false,
  error,
}: ConsentScreenProps) {
  const { t, i18n } = useTranslation();
  const [accepted, setAccepted] = useState(false);
  // Every optional text starts unticked: declining it still lets the user verify (C42.3).
  const [optional, setOptional] = useState<ReadonlySet<string>>(() => new Set());

  return (
    <Card title={t('consent.title')} headingLevel={1}>
      <form
        className="flex flex-col gap-6"
        aria-busy={busy}
        onSubmit={(event) => {
          event.preventDefault();
          if (accepted && !busy) {
            onContinue(optionalTexts.map(({ key }) => key).filter((key) => optional.has(key)));
          }
        }}
      >
        <div className="flex flex-col gap-3">
          {textKeys.map((key) => (
            <p key={key} data-consent-text={key}>
              {translateKey(i18n, key)}
            </p>
          ))}
        </div>
        <Checkbox
          label={t('consent.checkbox')}
          required
          checked={accepted}
          onChange={(event) => {
            setAccepted(event.currentTarget.checked);
          }}
        />
        {optionalTexts.map(({ key, text }) => (
          <Checkbox
            key={key}
            data-consent-text={key}
            label={text}
            checked={optional.has(key)}
            onChange={(event) => {
              const { checked } = event.currentTarget;
              setOptional((current) => {
                const next = new Set(current);
                if (checked) {
                  next.add(key);
                } else {
                  next.delete(key);
                }
                return next;
              });
            }}
          />
        ))}
        {busy && <Alert tone="info">{t('consent.saving')}</Alert>}
        {error !== undefined && error !== null && <Alert tone="error">{error}</Alert>}
        <Button type="submit" disabled={!accepted || busy} className="sm:self-end">
          {t('consent.continue')}
        </Button>
      </form>
    </Card>
  );
}
