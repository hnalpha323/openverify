/**
 * C161.5 (decisions 31 and 67; review H14): every built-in catalog's declared review status holds
 * against its messages as they are now. A locale declared reviewed (or partially reviewed) names
 * the SHA-256 of the catalog as reviewed, whose snapshot is kept at
 * `contracts/fixtures/i18n/reviewed/<locale>.<catalog-sha256>.json`; a key added or changed since
 * then fails this test until the locale is declared partially-reviewed with that key listed.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BUILT_IN_LOCALES,
  LOCALE_REVIEW_STATUS,
  catalogSha256,
  effectiveReviewStatus,
  localeKeyDigests,
  type LocaleReviewStatus,
  type MessageTree,
} from '@openverify/flow-spec';
import { describe, expect, it } from 'vitest';
import { CATALOGS } from './catalogs';
import { SUPPORTED_LANGUAGES } from './languages';

const sha256 = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../../..');
const REVIEWED_DIR = join(REPO_ROOT, 'contracts/fixtures/i18n/reviewed');

/** The catalog as reviewed, checked against the digest the review record names. */
function reviewedDigests(
  locale: string,
  status: LocaleReviewStatus,
): Readonly<Record<string, string>> | null {
  const reviewedSha256 =
    status.status === 'reviewed' || status.status === 'partially-reviewed'
      ? status.catalogSha256
      : undefined;
  if (reviewedSha256 === undefined) {
    return null;
  }
  const snapshot = JSON.parse(
    readFileSync(join(REVIEWED_DIR, `${locale}.${reviewedSha256}.json`), 'utf8'),
  ) as { messages: MessageTree };
  const digests = localeKeyDigests(snapshot.messages, sha256);
  expect(catalogSha256(digests, sha256)).toBe(reviewedSha256);
  return digests;
}

describe('the review status of the built-in catalogs (C161.5)', () => {
  it('names exactly the flow’s built-in languages', () => {
    expect([...BUILT_IN_LOCALES]).toEqual([...SUPPORTED_LANGUAGES]);
  });

  it('declares English the source and every other catalog machine-drafted', () => {
    expect(LOCALE_REVIEW_STATUS).toEqual({
      en: { status: 'source' },
      es: { status: 'machine-drafted' },
      fr: { status: 'machine-drafted' },
      de: { status: 'machine-drafted' },
      ar: { status: 'machine-drafted' },
    });
  });

  it('is the status docs/i18n/README.md shows for each locale', () => {
    const readme = readFileSync(join(REPO_ROOT, 'docs/i18n/README.md'), 'utf8');
    const rows = new Map(
      [...readme.matchAll(/^\|\s*`([a-z]{2})`\s*\|[^|\n]*\|[^|\n]*\|\s*`([a-z-]+)`\s*\|/gm)].map(
        (match) => [match[1], match[2]],
      ),
    );

    expect(Object.fromEntries(rows)).toEqual(
      Object.fromEntries(
        SUPPORTED_LANGUAGES.map((locale) => [locale, LOCALE_REVIEW_STATUS[locale].status]),
      ),
    );
  });

  it.each(SUPPORTED_LANGUAGES)('holds for %s against its messages as they are now', (locale) => {
    const declared = LOCALE_REVIEW_STATUS[locale];
    const current = localeKeyDigests(CATALOGS[locale], sha256);

    expect(
      effectiveReviewStatus(declared, { current, reviewed: reviewedDigests(locale, declared) }),
    ).toEqual(declared);
  });
});
