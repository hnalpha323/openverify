/**
 * C161.5 (decisions 31 and 67; review H14; V16): the review status of each built-in locale. No
 * built-in translation has a recorded human review (the Phase 9 inventory, section 11), so every
 * non-source locale is machine-drafted. A reviewed locale is held to the per-key digests of the
 * catalog as reviewed: a key added or changed after the review downgrades it to
 * partially-reviewed, listing the keys, so a later key is never shown as reviewed.
 */
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  BUILT_IN_LOCALES,
  LOCALE_REVIEW_STATUS,
  catalogSha256,
  effectiveReviewStatus,
  flattenMessages,
  localeKeyDigests,
  servedReviewStatus,
  type BuiltInLocale,
  type LocaleReviewStatus,
} from './index.js';

const sha256 = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');

describe('LOCALE_REVIEW_STATUS (C161.5)', () => {
  it('covers the five built-in locales', () => {
    expect(BUILT_IN_LOCALES).toEqual(['en', 'es', 'fr', 'de', 'ar']);
    expect(Object.keys(LOCALE_REVIEW_STATUS)).toEqual([...BUILT_IN_LOCALES]);
  });

  it('calls no translation reviewed without a record', () => {
    expect(LOCALE_REVIEW_STATUS.en).toEqual({ status: 'source' });
    for (const locale of ['es', 'fr', 'de', 'ar'] as const) {
      expect(LOCALE_REVIEW_STATUS[locale]).toEqual({ status: 'machine-drafted' });
    }
  });
});

const CATALOG = {
  consent: { title: 'Consentement', continue: 'Continuer' },
  attempt: 'Tentative {{current}} sur {{max}}',
} as const;

describe('flattenMessages', () => {
  it('lists every message by its dotted key, sorted by key', () => {
    expect(flattenMessages(CATALOG)).toEqual([
      ['attempt', 'Tentative {{current}} sur {{max}}'],
      ['consent.continue', 'Continuer'],
      ['consent.title', 'Consentement'],
    ]);
  });
});

describe('localeKeyDigests and catalogSha256', () => {
  it('digests each message as NFC-normalised UTF-8', () => {
    const digests = localeKeyDigests(CATALOG, sha256);

    expect(digests['consent.title']).toBe(sha256('Consentement'));
    expect(localeKeyDigests({ title: 'Café' }, sha256).title).toBe(sha256('Café'));
  });

  it('digests the catalog from its key digests, whatever the order they were written in', () => {
    const digests = localeKeyDigests(CATALOG, sha256);
    const reordered = localeKeyDigests(
      { attempt: CATALOG.attempt, consent: { continue: 'Continuer', title: 'Consentement' } },
      sha256,
    );

    expect(catalogSha256(digests, sha256)).toBe(catalogSha256(reordered, sha256));
    expect(catalogSha256(digests, sha256)).toMatch(/^[0-9a-f]{64}$/);
    expect(catalogSha256(digests, sha256)).toBe(
      sha256(
        Object.keys(digests)
          .sort()
          .map((key) => `${key}\t${digests[key] ?? ''}\n`)
          .join(''),
      ),
    );
  });

  it('changes when any message changes', () => {
    const before = catalogSha256(localeKeyDigests(CATALOG, sha256), sha256);
    const after = catalogSha256(
      localeKeyDigests({ ...CATALOG, attempt: 'Essai {{current}} sur {{max}}' }, sha256),
      sha256,
    );

    expect(after).not.toBe(before);
  });
});

describe('effectiveReviewStatus: a reviewed locale is downgraded when a key changes', () => {
  const reviewed = localeKeyDigests(CATALOG, sha256);
  const record: LocaleReviewStatus = {
    status: 'reviewed',
    by: 'A. Reviewer',
    date: '2026-11-01',
    catalogSha256: catalogSha256(reviewed, sha256),
  };

  it('keeps a reviewed locale reviewed while every message is as reviewed', () => {
    expect(effectiveReviewStatus(record, { current: reviewed, reviewed })).toEqual(record);
  });

  it('keeps it reviewed when a key was only removed', () => {
    const rest = Object.fromEntries(Object.entries(reviewed).filter(([key]) => key !== 'attempt'));

    expect(effectiveReviewStatus(record, { current: rest, reviewed })).toEqual(record);
  });

  it('lists every key added or changed after the review, sorted, with the review it came from', () => {
    const current = localeKeyDigests(
      {
        ...CATALOG,
        attempt: 'Essai {{current}} sur {{max}}',
        consent: { ...CATALOG.consent, saving: 'Enregistrement…' },
      },
      sha256,
    );

    expect(effectiveReviewStatus(record, { current, reviewed })).toEqual({
      status: 'partially-reviewed',
      unreviewedKeys: ['attempt', 'consent.saving'],
      by: 'A. Reviewer',
      date: '2026-11-01',
      catalogSha256: record.catalogSha256,
    });
  });

  it('fails closed: without the catalog as reviewed, every key is unreviewed', () => {
    expect(effectiveReviewStatus(record, { current: reviewed, reviewed: null })).toEqual({
      status: 'partially-reviewed',
      unreviewedKeys: ['attempt', 'consent.continue', 'consent.title'],
      by: 'A. Reviewer',
      date: '2026-11-01',
      catalogSha256: record.catalogSha256,
    });
  });

  it('keeps a partially-reviewed locale’s keys and adds those changed since its review', () => {
    const partial: LocaleReviewStatus = {
      status: 'partially-reviewed',
      unreviewedKeys: ['consent.title'],
      by: 'A. Reviewer',
      date: '2026-11-01',
      catalogSha256: record.catalogSha256,
    };
    const current = localeKeyDigests({ ...CATALOG, attempt: 'Essai' }, sha256);

    expect(effectiveReviewStatus(partial, { current, reviewed: null })).toEqual({
      ...partial,
      unreviewedKeys: ['attempt', 'consent.continue', 'consent.title'],
    });
    expect(effectiveReviewStatus(partial, { current, reviewed })).toEqual({
      ...partial,
      unreviewedKeys: ['attempt', 'consent.title'],
    });
    expect(effectiveReviewStatus(partial, { current: reviewed, reviewed })).toEqual(partial);
  });

  it.each([{ status: 'source' }, { status: 'machine-drafted' }] as const)(
    'leaves a $status locale as it is',
    (declared) => {
      expect(effectiveReviewStatus(declared, { current: reviewed, reviewed: null })).toBe(declared);
    },
  );
});

describe('servedReviewStatus: what every reader serves, the record held to the catalog now (R004)', () => {
  const asReviewed = localeKeyDigests(CATALOG, sha256);
  const record = {
    status: 'reviewed',
    by: 'A. Reviewer',
    date: '2026-11-01',
    catalogSha256: catalogSha256(asReviewed, sha256),
    keySha256: asReviewed,
  } as const satisfies LocaleReviewStatus;
  const declaring = (status: LocaleReviewStatus): Record<BuiltInLocale, LocaleReviewStatus> => ({
    ...LOCALE_REVIEW_STATUS,
    fr: status,
  });

  it('serves a reviewed locale as reviewed while its catalog is the one reviewed', () => {
    expect(servedReviewStatus('fr', CATALOG, sha256, declaring(record))).toEqual(record);
  });

  it('serves it partially reviewed, naming the key, once its catalog changed one message', () => {
    const changed = { ...CATALOG, attempt: 'Essai {{current}} sur {{max}}' };

    expect(servedReviewStatus('fr', changed, sha256, declaring(record))).toEqual({
      status: 'partially-reviewed',
      unreviewedKeys: ['attempt'],
      by: 'A. Reviewer',
      date: '2026-11-01',
      catalogSha256: record.catalogSha256,
      keySha256: asReviewed,
    });
  });

  it('fails closed without the snapshot, or with one that is not the catalog its record names', () => {
    const withoutSnapshot: LocaleReviewStatus = {
      status: 'reviewed',
      by: record.by,
      date: record.date,
      catalogSha256: record.catalogSha256,
    };
    const wrongSnapshot = { ...record, keySha256: { ...asReviewed, attempt: sha256('other') } };
    const allUnreviewed = ['attempt', 'consent.continue', 'consent.title'];

    for (const status of [withoutSnapshot, wrongSnapshot]) {
      const served = servedReviewStatus('fr', CATALOG, sha256, declaring(status));
      expect(served.status).toBe('partially-reviewed');
      expect(served.status === 'partially-reviewed' ? served.unreviewedKeys : []).toEqual(
        allUnreviewed,
      );
    }
  });

  it('serves source and machine-drafted locales as declared, the built-in ones today', () => {
    for (const locale of BUILT_IN_LOCALES) {
      expect(servedReviewStatus(locale, CATALOG, sha256)).toEqual(LOCALE_REVIEW_STATUS[locale]);
    }
  });
});
