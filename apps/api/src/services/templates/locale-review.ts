/**
 * R004 (Workflow 10A; C161.5): the review status each built-in locale is served with, for the
 * publish and template-operation readers: `servedReviewStatus` (`@openverify/flow-spec`) over the
 * locale's catalog as the flow exports it (`contracts/fixtures/i18n/<locale>.json`, read once), so a
 * reviewed locale whose catalog changed is never served as reviewed.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
  LOCALE_REVIEW_STATUS,
  servedReviewStatus,
  type BuiltInLocale,
  type LocaleReviewStatus,
  type MessageTree,
} from '@openverify/flow-spec';

const sha256 = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');

const catalogs = new Map<BuiltInLocale, MessageTree>();

/** The locale's catalog as the flow exports it (the export's own test holds it to the flow's). */
function exportedCatalog(locale: BuiltInLocale): MessageTree {
  let catalog = catalogs.get(locale);
  if (catalog === undefined) {
    catalog = (
      JSON.parse(
        readFileSync(
          new URL(`../../../../../contracts/fixtures/i18n/${locale}.json`, import.meta.url),
          'utf8',
        ),
      ) as { messages: MessageTree }
    ).messages;
    catalogs.set(locale, catalog);
  }
  return catalog;
}

/** The status `locale` is served with; `declared` is the record table (the built-in one by default). */
export function servedLocaleReviewStatus(
  locale: BuiltInLocale,
  declared: Readonly<Record<BuiltInLocale, LocaleReviewStatus>> = LOCALE_REVIEW_STATUS,
): LocaleReviewStatus {
  const record = declared[locale];
  // A source or machine-drafted locale is served as declared: its catalog is not read.
  if (record.status === 'source' || record.status === 'machine-drafted') {
    return record;
  }
  return servedReviewStatus(locale, exportedCatalog(locale), sha256, declared);
}
