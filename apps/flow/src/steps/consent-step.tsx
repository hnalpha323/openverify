import type { FlowConsentBody, FlowSessionResponse } from '@openverify/contracts';
import { Alert, Card } from '@openverify/ui';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { errorMessageKey } from '../api/error-message';
import type { FlowApiClient } from '../api/flow-api-client';
import { ConsentScreen } from '../components/consent-screen';
import type { ConsentStep as ConsentStepDefinition } from '../flow/flow-position';
import { DEFAULT_LANGUAGE } from '../i18n/languages';
import { fillPlaceholders } from '../i18n/fill-placeholders';
import { FLOW_CATALOG_VERSION } from '../i18n/catalog-version';
import { translateKey } from '../i18n/translate-key';
import { textSha256 } from '../lib/text-digest';
import { isCustomText } from '../session/session-copy';

export interface ConsentStepProps {
  readonly step: ConsentStepDefinition;
  readonly client: FlowApiClient;
  /** Reloads the session once consent is recorded. */
  readonly onAccepted: () => Promise<void>;
  /**
   * C42.6: how long face templates are kept (the session's `face-template-retention-days`),
   * which the matching consent states; `null` when the server does not say.
   */
  readonly retentionDays?: number | null;
  /**
   * C162.9 (Workflow 9A): the session's operator copy, so the consent says whether the words shown
   * were the operator's (`copy-source`).
   */
  readonly copy?: FlowSessionResponse['copy'];
}

/** Records the user's consent (`POST /flow/consent`) with the exact texts they were shown. */
/**
 * C162.9: the evidence of the words shown: the SHA-256 of each text as rendered, in the order of
 * `text-keys` then the accepted optional keys; whether they came from the operator's copy; and this
 * client's catalog version. A browser that cannot digest (no Web Crypto) sends none, so the server
 * records the consent with `text-sha256: null`, never as matched.
 */
async function consentEvidence(
  texts: readonly string[],
  custom: readonly boolean[],
): Promise<Pick<FlowConsentBody, 'text-sha256' | 'copy-source' | 'catalog-version'>> {
  // `custom` when every text is the operator's, `built-in` when none is, and left out when they are
  // mixed: the server matches a stated source against that source's texts only (Workflow 10A).
  const every = custom.every(Boolean);
  const none = !custom.some(Boolean);
  const source = {
    ...(every ? { 'copy-source': 'custom' as const } : {}),
    ...(none ? { 'copy-source': 'built-in' as const } : {}),
    'catalog-version': FLOW_CATALOG_VERSION,
  };
  try {
    return { 'text-sha256': await Promise.all(texts.map(textSha256)), ...source };
  } catch {
    return source;
  }
}

export function ConsentStep({
  step,
  client,
  onAccepted,
  retentionDays = null,
  copy,
}: ConsentStepProps) {
  const { t, i18n } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  // C42.3: an optional text is offered only when it can be shown exactly, `{{days}}` included;
  // one that cannot is simply not offered (declining it is the default).
  const values = retentionDays === null ? {} : { days: retentionDays };
  const optionalTexts = (step.optionalTextKeys ?? []).flatMap((key) => {
    const message = translateKey(i18n, key);
    const text = message === null ? null : fillPlaceholders(message, values);
    return text === null ? [] : [{ key, text }];
  });

  // Consent is recorded by text key: never record agreement to a text that was not shown.
  // Phase 1 treats every consent step as required (see the step's `required` flag).
  if (step.textKeys.some((key) => translateKey(i18n, key) === null)) {
    return (
      <Card title={t('consent.title')} headingLevel={1}>
        <Alert tone="error">{t('consent.unavailable')}</Alert>
      </Card>
    );
  }

  const accept = async (optionalTextKeys: readonly string[]) => {
    setBusy(true);
    setError(null);
    const locale = i18n.resolvedLanguage ?? DEFAULT_LANGUAGE;
    // The texts exactly as shown: the required ones (no placeholder), then the ticked optional ones.
    const shown = [
      ...step.textKeys.map((key) => {
        const message = translateKey(i18n, key) ?? '';
        return fillPlaceholders(message, values) ?? message;
      }),
      ...optionalTexts.filter(({ key }) => optionalTextKeys.includes(key)).map(({ text }) => text),
    ];
    const shownKeys = [...step.textKeys, ...optionalTextKeys];
    const evidence = await consentEvidence(
      shown,
      shownKeys.map((key) => isCustomText(copy, locale, key)),
    );
    try {
      await client.acceptConsent({
        accepted: true,
        'text-keys': [...step.textKeys],
        // Only a step with optional texts says which were accepted (C42.3).
        ...(step.optionalTextKeys === undefined
          ? {}
          : { 'optional-text-keys': [...optionalTextKeys] }),
        locale,
        ...evidence,
      });
    } catch (failure: unknown) {
      setError(failure);
      setBusy(false);
      return;
    }
    await onAccepted();
  };

  return (
    <ConsentScreen
      textKeys={step.textKeys}
      optionalTexts={optionalTexts}
      busy={busy}
      error={error === null ? undefined : t(errorMessageKey(error))}
      onContinue={(optionalTextKeys) => {
        void accept(optionalTextKeys);
      }}
    />
  );
}
