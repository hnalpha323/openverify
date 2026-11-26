/**
 * C232.1, C234.1, C234.2 (Phase 11, Workflow 11A Stage 2; `connect-logic` checkpoint 1): consent
 * coverage as a pure decision. One table per side, every reason of `consent_required` at least
 * once, the order of the checks pinned, and the set relation of coverage as a seeded property.
 */
import { describe, expect, it } from 'vitest';
import { seededRandom, type SeededRandom } from '../analytics/testing/random.js';
import { SHARE_CATEGORIES, type ShareCategory } from './categories.js';
import {
  CONSENT_REQUIRED_REASONS,
  categoriesCover,
  destinationConsentRefusal,
  sourceConsentRefusal,
  type ConsentRecordFacts,
  type ConsentRequiredReason,
  type DestinationShareFacts,
  type SourceShareFacts,
} from './consent-coverage.js';

const NOW = new Date('2026-11-12T12:00:00.000Z');
const LATER = new Date('2026-11-26T12:00:00.000Z');
const EARLIER = new Date('2026-11-12T11:00:00.000Z');

const sourceRecord = (patch: Partial<ConsentRecordFacts> = {}): ConsentRecordFacts => ({
  side: 'source',
  outcome: 'accepted',
  method: 'flow',
  purpose: 'share.reuse-kyc',
  subject: { type: 'inquiry', id: 'inq_source' },
  shareTokenId: null,
  recipientOrganizationId: 'org_partner',
  categories: ['identity-fields', 'document-images', 'biometric', 'check-results'],
  explicitBiometric: true,
  expiresAt: LATER,
  withdrawnAt: null,
  redactedAt: null,
  ...patch,
});

const sourceShare = (patch: Partial<SourceShareFacts> = {}): SourceShareFacts => ({
  source: { type: 'inquiry', id: 'inq_source', holdingInquiryId: null },
  recipientOrganizationId: 'org_partner',
  purpose: 'share.reuse-kyc',
  categories: ['identity-fields', 'biometric', 'check-results'],
  attestedConsent: 'non-biometric',
  shareTokenId: null,
  now: NOW,
  ...patch,
});

const destinationRecord = (patch: Partial<ConsentRecordFacts> = {}): ConsentRecordFacts =>
  sourceRecord({
    side: 'destination',
    subject: { type: 'connect/share-token', id: 'cnst_one' },
    shareTokenId: 'cnst_one',
    recipientOrganizationId: 'org_partner',
    ...patch,
  });

const destinationShare = (patch: Partial<DestinationShareFacts> = {}): DestinationShareFacts => ({
  shareTokenId: 'cnst_one',
  recipientOrganizationId: 'org_partner',
  purpose: 'share.reuse-kyc',
  categories: ['identity-fields', 'biometric', 'check-results'],
  citedByAnotherRedemption: false,
  now: NOW,
  ...patch,
});

describe('categories coverage (C230.4, C232.1)', () => {
  it.each([
    [['identity-fields', 'biometric'], ['identity-fields'], true],
    [['identity-fields'], ['identity-fields', 'biometric'], false],
    [[], [], true],
    [['check-results'], [], true],
    [[], ['check-results'], false],
    [[...SHARE_CATEGORIES], [...SHARE_CATEGORIES], true],
  ] as [ShareCategory[], ShareCategory[], boolean][])(
    '%j covers %j: %s',
    (consented, carried, covered) => {
      expect(categoriesCover(consented, carried)).toBe(covered);
    },
  );

  const subset = (random: SeededRandom): ShareCategory[] =>
    SHARE_CATEGORIES.filter(() => random.chance(0.5));

  it('is exactly the subset relation: reflexive, transitive, monotone (seeded)', () => {
    const random = seededRandom(232_1);
    for (let run = 0; run < 3000; run += 1) {
      const a = subset(random);
      const b = subset(random);
      const c = subset(random);
      const label = `run ${String(run)}`;
      expect(categoriesCover(a, b), label).toBe(b.every((category) => a.includes(category)));
      expect(categoriesCover(a, a), label).toBe(true);
      expect(categoriesCover(a, []), label).toBe(true);
      expect(categoriesCover([...SHARE_CATEGORIES], a), label).toBe(true);
      if (categoriesCover(a, b) && categoriesCover(b, c)) {
        expect(categoriesCover(a, c), label).toBe(true);
      }
      const union = SHARE_CATEGORIES.filter(
        (category) => a.includes(category) || c.includes(category),
      );
      if (categoriesCover(a, b)) {
        expect(categoriesCover(union, b), label).toBe(true);
      }
    }
  });
});

describe('a source-side record (C232.1, review P03, P34)', () => {
  it.each([
    ['a flow record on the source inquiry', sourceRecord(), sourceShare(), null],
    ['no record', null, sourceShare(), 'missing'],
    ['a destination-side record', sourceRecord({ side: 'destination' }), sourceShare(), 'missing'],
    ['a declined record', sourceRecord({ outcome: 'declined' }), sourceShare(), 'missing'],
    ['a redacted record', sourceRecord({ redactedAt: EARLIER }), sourceShare(), 'missing'],
    [
      'a record whose subject was redacted',
      sourceRecord({ subject: null }),
      sourceShare(),
      'missing',
    ],
    [
      "another inquiry's record",
      sourceRecord({ subject: { type: 'inquiry', id: 'inq_other' } }),
      sourceShare(),
      'subject',
    ],
    [
      'a verification inside the subject inquiry',
      sourceRecord(),
      sourceShare({
        source: { type: 'verification', id: 'ver_x', holdingInquiryId: 'inq_source' },
      }),
      null,
    ],
    [
      "a verification of another inquiry than the record's",
      sourceRecord(),
      sourceShare({ source: { type: 'verification', id: 'ver_x', holdingInquiryId: 'inq_other' } }),
      'subject',
    ],
    [
      'an attested record on an account',
      sourceRecord({
        method: 'attested',
        subject: { type: 'account', id: 'acc_x' },
        categories: ['identity-fields'],
        explicitBiometric: false,
      }),
      sourceShare({
        source: { type: 'account', id: 'acc_x', holdingInquiryId: null },
        categories: ['identity-fields'],
      }),
      null,
    ],
    [
      'a flow record can never name an account',
      sourceRecord({ subject: { type: 'account', id: 'acc_x' } }),
      sourceShare({ source: { type: 'account', id: 'acc_x', holdingInquiryId: null } }),
      'subject',
    ],
    [
      'an attested record on a transaction',
      sourceRecord({
        method: 'attested',
        subject: { type: 'transaction', id: 'txn_x' },
        categories: ['other-fields'],
        explicitBiometric: false,
      }),
      sourceShare({
        source: { type: 'transaction', id: 'txn_x', holdingInquiryId: null },
        categories: ['other-fields'],
      }),
      null,
    ],
    [
      'an attested record where the policy accepts none',
      sourceRecord({ method: 'attested' }),
      sourceShare({ categories: ['identity-fields'], attestedConsent: 'none' }),
      'attested_not_accepted',
    ],
    [
      'an attested record for a biometric share under non-biometric',
      sourceRecord({ method: 'attested' }),
      sourceShare(),
      'attested_not_accepted',
    ],
    [
      'an attested record for a share without biometric under non-biometric',
      sourceRecord({ method: 'attested' }),
      sourceShare({ categories: ['identity-fields'] }),
      null,
    ],
    [
      'an attested record for a biometric share under all',
      sourceRecord({ method: 'attested' }),
      sourceShare({ attestedConsent: 'all' }),
      null,
    ],
    [
      'another recipient',
      sourceRecord({ recipientOrganizationId: 'org_third' }),
      sourceShare(),
      'recipient',
    ],
    ['another purpose', sourceRecord({ purpose: 'share.other' }), sourceShare(), 'recipient'],
    [
      'a category the record does not name',
      sourceRecord(),
      sourceShare({ categories: ['contact-fields'] }),
      'categories',
    ],
    [
      'a biometric share without the explicit tick',
      sourceRecord({ explicitBiometric: false }),
      sourceShare(),
      'explicit_biometric',
    ],
    [
      'the explicit tick is not needed without biometric',
      sourceRecord({ explicitBiometric: false }),
      sourceShare({ categories: ['identity-fields'] }),
      null,
    ],
    ['a withdrawn record', sourceRecord({ withdrawnAt: EARLIER }), sourceShare(), 'withdrawn'],
    ['a record expiring now', sourceRecord({ expiresAt: NOW }), sourceShare(), 'expired'],
    ['an expired record', sourceRecord({ expiresAt: EARLIER }), sourceShare(), 'expired'],
    [
      'a record another token cites',
      sourceRecord({ shareTokenId: 'cnst_other' }),
      sourceShare(),
      'already_used',
    ],
    [
      'a record another token cites, checked at redemption',
      sourceRecord({ shareTokenId: 'cnst_other' }),
      sourceShare({ shareTokenId: 'cnst_one' }),
      'already_used',
    ],
    [
      'the record this token cites, re-checked by the job',
      sourceRecord({ shareTokenId: 'cnst_one' }),
      sourceShare({ shareTokenId: 'cnst_one' }),
      null,
    ],
  ] as [string, ConsentRecordFacts | null, SourceShareFacts, ConsentRequiredReason | null][])(
    '%s',
    (_name, record, share, reason) => {
      expect(sourceConsentRefusal(record, share)).toBe(reason);
    },
  );

  it('checks in a fixed order: missing, subject, attestation, recipient, categories, tick, withdrawal, expiry, use', () => {
    const everythingWrong = sourceRecord({
      method: 'attested',
      subject: { type: 'inquiry', id: 'inq_other' },
      recipientOrganizationId: 'org_third',
      categories: [],
      explicitBiometric: false,
      withdrawnAt: EARLIER,
      expiresAt: EARLIER,
      shareTokenId: 'cnst_other',
    });
    const seen: (ConsentRequiredReason | null)[] = [];
    const fixes: Partial<ConsentRecordFacts>[] = [
      { subject: { type: 'inquiry', id: 'inq_source' } },
      { method: 'flow' },
      { recipientOrganizationId: 'org_partner' },
      { categories: ['identity-fields', 'biometric', 'check-results'] },
      { explicitBiometric: true },
      { withdrawnAt: null },
      { expiresAt: LATER },
      { shareTokenId: null },
    ];
    let record = everythingWrong;
    seen.push(sourceConsentRefusal(record, sourceShare()));
    for (const fix of fixes) {
      record = { ...record, ...fix };
      seen.push(sourceConsentRefusal(record, sourceShare()));
    }
    expect(seen).toEqual([
      'subject',
      'attested_not_accepted',
      'recipient',
      'categories',
      'explicit_biometric',
      'withdrawn',
      'expired',
      'already_used',
      null,
    ]);
  });
});

describe('a destination-side record (C234.1, C234.2; review P02)', () => {
  it.each([
    ['a flow record about the token', destinationRecord(), destinationShare(), null],
    [
      'an attested destination record',
      destinationRecord({ method: 'attested' }),
      destinationShare(),
      null,
    ],
    ['no record', null, destinationShare(), 'missing'],
    ['a source-side record', destinationRecord({ side: 'source' }), destinationShare(), 'missing'],
    [
      'a declined record',
      destinationRecord({ outcome: 'declined' }),
      destinationShare(),
      'missing',
    ],
    [
      'a redacted record',
      destinationRecord({ redactedAt: EARLIER }),
      destinationShare(),
      'missing',
    ],
    [
      "another token's record",
      destinationRecord({ shareTokenId: 'cnst_other' }),
      destinationShare(),
      'subject',
    ],
    [
      'another recipient',
      destinationRecord({ recipientOrganizationId: 'org_third' }),
      destinationShare(),
      'recipient',
    ],
    ['another purpose', destinationRecord({ purpose: 'x' }), destinationShare(), 'recipient'],
    [
      "a category of the token's that the record does not name",
      destinationRecord({ categories: ['identity-fields', 'biometric'] }),
      destinationShare(),
      'categories',
    ],
    [
      'a biometric token without the tick',
      destinationRecord({ explicitBiometric: false }),
      destinationShare(),
      'explicit_biometric',
    ],
    [
      'a withdrawn record',
      destinationRecord({ withdrawnAt: EARLIER }),
      destinationShare(),
      'withdrawn',
    ],
    ['an expired record', destinationRecord({ expiresAt: NOW }), destinationShare(), 'expired'],
    [
      'a record another redemption cited',
      destinationRecord(),
      destinationShare({ citedByAnotherRedemption: true }),
      'already_used',
    ],
  ] as [string, ConsentRecordFacts | null, DestinationShareFacts, ConsentRequiredReason | null][])(
    '%s',
    (_name, record, share, reason) => {
      expect(destinationConsentRefusal(record, share)).toBe(reason);
    },
  );
});

describe('every reason is reachable, and an authorising record always covers (seeded)', () => {
  it('answers every reason of the closed list on one side or the other', () => {
    const reasons = new Set<ConsentRequiredReason | null>([
      sourceConsentRefusal(null, sourceShare()),
      sourceConsentRefusal(sourceRecord({ subject: { type: 'inquiry', id: 'x' } }), sourceShare()),
      sourceConsentRefusal(sourceRecord({ recipientOrganizationId: 'x' }), sourceShare()),
      sourceConsentRefusal(sourceRecord({ categories: [] }), sourceShare()),
      sourceConsentRefusal(sourceRecord({ explicitBiometric: false }), sourceShare()),
      sourceConsentRefusal(sourceRecord({ method: 'attested' }), sourceShare()),
      sourceConsentRefusal(sourceRecord({ withdrawnAt: NOW }), sourceShare()),
      sourceConsentRefusal(sourceRecord({ expiresAt: NOW }), sourceShare()),
      sourceConsentRefusal(sourceRecord({ shareTokenId: 'cnst_x' }), sourceShare()),
    ]);
    expect([...reasons].sort()).toEqual([...CONSENT_REQUIRED_REASONS].sort());
  });

  it('never authorises a share whose categories the record does not cover', () => {
    const random = seededRandom(234_1);
    const pick = (): ShareCategory[] => SHARE_CATEGORIES.filter(() => random.chance(0.5));
    for (let run = 0; run < 3000; run += 1) {
      const record = sourceRecord({
        method: random.chance(0.5) ? 'flow' : 'attested',
        categories: pick(),
        explicitBiometric: random.chance(0.5),
      });
      const share = sourceShare({
        categories: pick(),
        attestedConsent: random.pick(['none', 'non-biometric', 'all'] as const),
      });
      const label = `run ${String(run)}`;
      if (sourceConsentRefusal(record, share) === null) {
        expect(categoriesCover(record.categories, share.categories), label).toBe(true);
        if (share.categories.includes('biometric')) {
          expect(record.explicitBiometric, label).toBe(true);
          expect(record.method === 'flow' || share.attestedConsent === 'all', label).toBe(true);
        }
      }
      const destination = destinationRecord({
        categories: record.categories,
        explicitBiometric: record.explicitBiometric,
      });
      const redemption = destinationShare({ categories: share.categories });
      if (destinationConsentRefusal(destination, redemption) === null) {
        expect(categoriesCover(destination.categories, redemption.categories), label).toBe(true);
      }
    }
  });
});
