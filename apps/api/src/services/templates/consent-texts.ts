/**
 * C162.9 (Workflow 9A; reviews P04, H10, V01): the consent body's digests are checked against the
 * stored template texts, each filled with the session's placeholder values (`days` from
 * `face-template-retention-days`, `organization` from `organization-display-name`), NFC-normalised
 * and hashed; a mismatch with every candidate answers 422 `consent_text_mismatch`. A client that
 * sends no digests is not checked, and the consent is recorded as any other (its text keys,
 * optional keys, locale, address and user agent): no column stores a client's digests, so nothing
 * records whether a consent's texts were checked (KP11-73, Workflow 11F). Owner:
 * `api-templates`; the call in the consent path (`recordConsent`, `services/flow.ts`, inside its
 * transaction and before the consent is written) was placed by `foundation-9a` (Stage 1b (T)).
 *
 * The candidates for a key and locale: with `copy-source: custom`, the version's own text (its
 * `{name}` placeholders filled); with `built-in`, every released text of the key and locale in
 * `contracts/fixtures/i18n/consent-texts.json` (the append-only table `flow-i18n` exports, its
 * `{{name}}` placeholders filled); without a source, both.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { FlowConsentBody } from '@openverify/contracts';
import {
  getEnvironment,
  getInquiry,
  getInquiryTemplateVersion,
  resolveFaceTemplateSettings,
  type Db,
} from '@openverify/db';
import { FlowEngineProblemError } from '../../flow-engine/problems.js';
import { storedCopy } from './versions.js';

/** The session whose consent is checked; the caller holds the inquiry's row lock. */
export interface ConsentSessionRef {
  environmentId: string;
  inquiryId: string;
  sessionId: string;
}

interface ReleasedText {
  key: string;
  locale: string;
  text: string;
}

let released: readonly ReleasedText[] | undefined;

/** The released built-in consent texts, read once (the table is append-only). */
function releasedTexts(): readonly ReleasedText[] {
  released ??= (
    JSON.parse(
      readFileSync(
        new URL('../../../../../contracts/fixtures/i18n/consent-texts.json', import.meta.url),
        'utf8',
      ),
    ) as { entries: ReleasedText[] }
  ).entries;
  return released;
}

const sha256 = (text: string) =>
  createHash('sha256').update(text.normalize('NFC'), 'utf8').digest('hex');

/** Fills every `{name}` (operator copy) or `{{name}}` (built-in catalogs) the session knows. */
function filled(text: string, values: Readonly<Record<string, string>>, builtIn: boolean): string {
  return Object.entries(values).reduce(
    (result, [name, value]) => result.replaceAll(builtIn ? `{{${name}}}` : `{${name}}`, value),
    text,
  );
}

/**
 * The `text-sha256` the check expects of `text`: its placeholders filled with `values` (`{{name}}`
 * in a released built-in text, `{name}` in operator copy), NFC-normalised, UTF-8, SHA-256 in hex.
 * Exported for the Android digest vectors (C200.4, Workflow 10A), so they are the server's own.
 */
export function consentTextDigest(
  text: string,
  values: Readonly<Record<string, string>>,
  builtIn: boolean,
): string {
  return sha256(filled(text, values, builtIn));
}

const mismatch = () =>
  new FlowEngineProblemError(
    'consent_text_mismatch',
    'The consent texts sent are not the texts this version shows.',
  );

/** Refuses a consent body whose texts are not the ones shown (C162.9). */
export async function checkConsentTextsInTx(
  tx: Db,
  session: ConsentSessionRef,
  body: FlowConsentBody,
): Promise<void> {
  const digests = body['text-sha256'];
  if (digests === undefined) {
    return;
  }
  const keys = [...body['text-keys'], ...(body['optional-text-keys'] ?? [])];
  if (digests.length !== keys.length) {
    throw mismatch();
  }
  const inquiry = await getInquiry(tx, session.environmentId, session.inquiryId);
  const version =
    inquiry === null
      ? null
      : await getInquiryTemplateVersion(
          tx,
          session.environmentId,
          inquiry.inquiryTemplateVersionId,
        );
  const environment = await getEnvironment(tx, session.environmentId);
  if (version === null || environment === null) {
    throw mismatch();
  }
  const values: Record<string, string> = {
    days: String(resolveFaceTemplateSettings(environment.settings)['face-template-retention-days']),
  };
  const organization = environment.settings['organization-display-name'];
  if (typeof organization === 'string') {
    values.organization = organization;
  }
  const locale = body.locale.split('-')[0] ?? body.locale;
  const custom =
    storedCopy(version).messages[locale as keyof ReturnType<typeof storedCopy>['messages']];
  const source = body['copy-source'];
  keys.forEach((key, index) => {
    const candidates = [
      ...(source === 'built-in' || custom?.[key] === undefined
        ? []
        : [consentTextDigest(custom[key], values, false)]),
      ...(source === 'custom'
        ? []
        : releasedTexts()
            .filter((entry) => entry.key === key && entry.locale === locale)
            .map((entry) => consentTextDigest(entry.text, values, true))),
    ];
    if (!candidates.includes(digests[index] ?? '')) {
      throw mismatch();
    }
  });
}
