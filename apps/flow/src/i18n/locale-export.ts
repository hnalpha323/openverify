/**
 * C161.8, C162.9 (verification round V01): what `apps/flow/scripts/export-flow-locales.ts`
 * writes, computed here so it is typed and tested.
 *
 * - `contracts/fixtures/i18n/<locale>.json`, one per built-in locale: its messages as the
 *   TypeScript catalog holds them, the catalog version, the catalog's review digest and its review
 *   status. Phase 10 builds the Android `values-fr`, `values-de` and `values-ar` from them (C175.1).
 * - `contracts/fixtures/i18n/consent-texts.json`, append-only: every built-in consent and notice text
 *   as written (placeholders unfilled, `{{name}}`), one entry per catalog version, client, key and
 *   locale. The server fills an entry's placeholders with the session's values, normalises it to NFC
 *   and hashes it to check a consent's `text-sha256` (C162.9); an entry that left the table would make
 *   a consent given to those words unverifiable, so none ever does (a test reads every committed
 *   revision).
 * - `apps/flow/src/i18n/catalog-version.ts`: the catalog version the flow sends with each consent.
 *
 * The catalog version names the consent texts only (`web-` and 16 hex digits of their digest), so
 * the table grows when a consent or notice text changes, not with every other message.
 */
import {
  LOCALE_REVIEW_STATUS,
  catalogSha256,
  flattenMessages,
  localeKeyDigests,
  type LocaleReviewStatus,
  type MessageTree,
  type Sha256Hex,
} from '@openverify/flow-spec';
import { CATALOGS } from './catalogs';
import { SUPPORTED_LANGUAGES, type SupportedLanguage } from './languages';

/**
 * The message groups whose texts a consent step shows and records (C45.1, C94.6, C128.4), and the
 * built-in share-consent texts the server composes and digests (C238.3, Workflow 11A).
 */
export const CONSENT_TEXT_GROUPS = ['consent', 'notice', 'share.consent'] as const;

/**
 * The client whose texts this export appends; the Android SDK's rows (`android`, C200.3) are
 * appended by `:openverify-sdk:exportConsentTexts` and kept here as they are, in place.
 */
export const CONSENT_TEXTS_CLIENT = 'web';

export const CONSENT_TEXTS_DESCRIPTION =
  'Append-only (C162.9, C200.3): the built-in consent and notice texts of each released catalog, as written, ' +
  'placeholders unfilled ({{name}}), one entry per catalog version, client, key and locale. The web rows ' +
  '(client web) are written by apps/flow/scripts/export-flow-locales.ts, the Android SDK rows (client android) ' +
  'by :openverify-sdk:exportConsentTexts; each keeps the other client rows; never edit or remove an entry.';

export const I18N_FIXTURES_DIRECTORY = 'contracts/fixtures/i18n';
export const CATALOG_VERSION_MODULE = 'apps/flow/src/i18n/catalog-version.ts';

export type Catalogs = Readonly<Record<SupportedLanguage, MessageTree>>;

export interface ConsentTextEntry {
  readonly 'catalog-version': string;
  readonly client: string;
  readonly key: string;
  readonly locale: string;
  readonly text: string;
}

export interface ConsentTextsTable {
  readonly format: 1;
  readonly description: string;
  readonly entries: readonly ConsentTextEntry[];
}

export interface LocaleExport {
  readonly locale: SupportedLanguage;
  readonly 'catalog-version': string;
  readonly 'catalog-sha256': string;
  readonly 'review-status': LocaleReviewStatus;
  readonly messages: MessageTree;
}

/** Every consent and notice text of every locale, in locale then key order, unfilled. */
export function consentTextsOf(
  catalogs: Catalogs,
): { key: string; locale: SupportedLanguage; text: string }[] {
  return SUPPORTED_LANGUAGES.flatMap((locale) =>
    flattenMessages(catalogs[locale])
      .filter(([key]) => CONSENT_TEXT_GROUPS.some((group) => key.startsWith(`${group}.`)))
      .map(([key, text]) => ({ key, locale, text })),
  );
}

/** `web-` and the first 16 hex digits of the digest of every consent text (NFC), by locale and key. */
export function catalogVersionOf(catalogs: Catalogs, sha256: Sha256Hex): string {
  const lines = consentTextsOf(catalogs).map(
    ({ key, locale, text }) => `${locale}\t${key}\t${sha256(text.normalize('NFC'))}\n`,
  );
  return `${CONSENT_TEXTS_CLIENT}-${sha256(lines.join('')).slice(0, 16)}`;
}

/** The JSON export of one locale. */
export function localeExportOf(
  locale: SupportedLanguage,
  catalogs: Catalogs,
  sha256: Sha256Hex,
): LocaleExport {
  return {
    locale,
    'catalog-version': catalogVersionOf(catalogs, sha256),
    'catalog-sha256': catalogSha256(localeKeyDigests(catalogs[locale], sha256), sha256),
    'review-status': LOCALE_REVIEW_STATUS[locale],
    messages: catalogs[locale],
  };
}

function identity(entry: ConsentTextEntry): string {
  return [entry['catalog-version'], entry.client, entry.key, entry.locale].join('\u0000');
}

/**
 * `table` with the consent texts of `catalogs` appended under their catalog version, each once:
 * an entry already there for that version, client, key and locale is never added again, and no
 * entry is ever changed or removed.
 */
export function appendConsentTexts(
  table: ConsentTextsTable | null,
  catalogs: Catalogs,
  sha256: Sha256Hex,
): ConsentTextsTable {
  const entries = [...(table?.entries ?? [])];
  const known = new Set(entries.map(identity));
  const version = catalogVersionOf(catalogs, sha256);
  for (const { key, locale, text } of consentTextsOf(catalogs)) {
    const entry: ConsentTextEntry = {
      'catalog-version': version,
      client: CONSENT_TEXTS_CLIENT,
      key,
      locale,
      text,
    };
    if (!known.has(identity(entry))) {
      known.add(identity(entry));
      entries.push(entry);
    }
  }
  return { format: 1, description: CONSENT_TEXTS_DESCRIPTION, entries };
}

/** The entries of `before` that `after` no longer holds exactly: removed or edited. */
export function removedConsentTexts(
  before: ConsentTextsTable,
  after: ConsentTextsTable,
): ConsentTextEntry[] {
  const kept = new Set(after.entries.map((entry) => JSON.stringify([identity(entry), entry.text])));
  return before.entries.filter((entry) => !kept.has(JSON.stringify([identity(entry), entry.text])));
}

/** The source of `catalog-version.ts` for `version`. */
export function catalogVersionModule(version: string): string {
  return [
    '/**',
    ' * C162.9: the version of the flow’s built-in consent texts, sent with every consent as',
    ' * `catalog-version`. Written by `apps/flow/scripts/export-flow-locales.ts`; do not edit.',
    ' */',
    `export const FLOW_CATALOG_VERSION = '${version}';`,
    '',
  ].join('\n');
}

/**
 * Every file the export writes, by path from the repository root, as unformatted JSON or source:
 * the five locale exports, the consent-texts table with the current texts appended to `existing`,
 * and the catalog version module.
 */
export function exportFiles(
  existing: ConsentTextsTable | null,
  sha256: Sha256Hex,
): Readonly<Record<string, unknown>> {
  return {
    ...Object.fromEntries(
      SUPPORTED_LANGUAGES.map((locale) => [
        `${I18N_FIXTURES_DIRECTORY}/${locale}.json`,
        localeExportOf(locale, CATALOGS, sha256),
      ]),
    ),
    [`${I18N_FIXTURES_DIRECTORY}/consent-texts.json`]: appendConsentTexts(
      existing,
      CATALOGS,
      sha256,
    ),
    [CATALOG_VERSION_MODULE]: catalogVersionModule(catalogVersionOf(CATALOGS, sha256)),
  };
}
