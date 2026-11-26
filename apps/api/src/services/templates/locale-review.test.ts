/**
 * R004 (Workflow 10A; C161.5): the publish and template-operation readers serve a built-in locale's
 * review status held to the catalog the flow exports now, never the declared record alone. The
 * records here are synthetic: no built-in locale has a recorded review (every non-source one is
 * machine-drafted), and none is marked reviewed.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
  BUILT_IN_LOCALES,
  LOCALE_REVIEW_STATUS,
  catalogSha256,
  localeKeyDigests,
  type BuiltInLocale,
  type LocaleReviewStatus,
  type MessageTree,
} from '@openverify/flow-spec';
import { describe, expect, it } from 'vitest';
import { servedLocaleReviewStatus } from './locale-review.js';

const sha256 = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');

/** The Spanish catalog as the flow exports it, read the way a test reads a fixture. */
const exported = JSON.parse(
  readFileSync(new URL('../../../../../contracts/fixtures/i18n/es.json', import.meta.url), 'utf8'),
) as { messages: MessageTree };
const digests = localeKeyDigests(exported.messages, sha256);

const reviewOf = (keySha256: Readonly<Record<string, string>>): LocaleReviewStatus => ({
  status: 'reviewed',
  by: 'A. Synthetic Reviewer',
  date: '2026-11-01',
  catalogSha256: catalogSha256(keySha256, sha256),
  keySha256,
});
const declaring = (status: LocaleReviewStatus): Record<BuiltInLocale, LocaleReviewStatus> => ({
  ...LOCALE_REVIEW_STATUS,
  es: status,
});

describe('servedLocaleReviewStatus (R004)', () => {
  it('serves a review of the exported catalog as reviewed', () => {
    const record = reviewOf(digests);

    expect(servedLocaleReviewStatus('es', declaring(record))).toEqual(record);
  });

  it('serves a review whose catalog then changed one message as partially reviewed, naming it', () => {
    const [key = ''] = Object.keys(digests);
    const record = reviewOf({ ...digests, [key]: sha256('the message as it was reviewed') });

    const served = servedLocaleReviewStatus('es', declaring(record));

    expect(served).toMatchObject({ status: 'partially-reviewed', unreviewedKeys: [key] });
  });

  it('serves every built-in locale as declared today', () => {
    for (const locale of BUILT_IN_LOCALES) {
      expect(servedLocaleReviewStatus(locale)).toEqual(LOCALE_REVIEW_STATUS[locale]);
    }
  });
});
