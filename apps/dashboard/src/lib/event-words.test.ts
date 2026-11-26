import {
  EVENT_NAMES,
  REPORT_EVENT_NAMES,
  SELFIE_EVENT_NAMES,
  VERIFICATION_EVENT_NAMES,
} from '@openverify/contracts';
import { describe, expect, it } from 'vitest';
import { eventWords } from './event-words';

describe('every event in words (C108)', () => {
  it.each(EVENT_NAMES)('says %s in words', (name) => {
    expect(eventWords(name)).toMatch(/^[A-Z]/);
  });

  it('says the Phase 7 events in words', () => {
    expect(eventWords('list-match.created')).toBe('List match found');
    expect(eventWords('graph-query.timed-out')).toBe('Graph query timed out');
    expect(eventWords('transaction-type.converted-field')).toBe('Transaction type field converted');
  });

  // C239.3 (Workflow 11A): each side reads its own event; none says data arrived before redemption.
  it.each([
    ['connect/connection.created', 'Connection created'],
    ['connect/connection.activated', 'Connection activated'],
    ['connect/connection.deactivated', 'Connection deactivated'],
    ['connect/connection.reactivated', 'Connection reactivated, waiting for acceptance'],
    ['connect/connection.share-policy-changed', 'Connection share policy changed'],
    ['connect/share-token.outbound-created', 'Share token created for a partner'],
    ['connect/share-token.inbound-created', 'Share token received from a partner'],
    ['connect/share-token.outbound-redeemed', 'Share token redeemed by the partner'],
    ['connect/share-token.inbound-redeemed', 'Share token redeemed here'],
    ['connect/share-token.expired', 'Share token expired'],
    ['connect/share-token.failed', 'Share token redemption failed'],
    ['connect/share-token.consent-withdrawn', 'Consent withdrawn for a redeemed share'],
    ['connect/share-token.source-redacted', 'Source of a redeemed share redacted'],
    ['consent-record.created', 'Sharing consent recorded'],
    ['consent-record.declined', 'Sharing consent declined'],
    ['consent-record.withdrawn', 'Sharing consent withdrawn'],
  ])('says %s as "%s"', (name, words) => {
    expect(eventWords(name)).toBe(words);
  });
});

describe('verification events in words (Phase 5 carry-forward, Workflow 6B P5-1)', () => {
  it.each(VERIFICATION_EVENT_NAMES)('says the verification event %s in words', (name) => {
    expect(eventWords(name)).toMatch(/^Verification [a-z]+$/);
  });

  it('says what happened to the verification, as the inquiry timeline does', () => {
    expect(VERIFICATION_EVENT_NAMES.map((name) => eventWords(name))).toEqual([
      'Verification started',
      'Verification submitted',
      'Verification passed',
      'Verification failed',
      'Verification canceled',
      'Verification skipped',
    ]);
  });

  it.each(['verification.needs-review', 'verification.redacted'])('knows nothing of %s', (name) => {
    expect(eventWords(name)).toBeUndefined();
  });
});

describe('event names in words (C40.8, C47)', () => {
  it.each(SELFIE_EVENT_NAMES)('says the selfie event %s in words', (name) => {
    expect(eventWords(name)).toMatch(/^Selfie capture [a-z]+$/);
  });

  it('says what happened to the capture', () => {
    expect(SELFIE_EVENT_NAMES.map((name) => eventWords(name))).toEqual([
      'Selfie capture started',
      'Selfie capture submitted',
      'Selfie capture processed',
      'Selfie capture errored',
    ]);
  });

  it.each(['selfie.from-the-future', 'constructor', '__proto__'])('knows nothing of %s', (name) => {
    expect(eventWords(name)).toBeUndefined();
  });
});

describe('report events in words (C70.4, C86)', () => {
  it.each(REPORT_EVENT_NAMES)('says the report event %s in words', (name) => {
    // An acronym such as IP keeps its capitals (C106.1, Phase 7).
    expect(eventWords(name)).toMatch(/^[A-Z][A-Za-z ]+ report [a-z ()]+$/);
  });

  it('says what happened to the report, naming its type', () => {
    expect(
      [
        'report/watchlist.ready',
        'report/watchlist.errored',
        'report/watchlist.matched',
        'report/watchlist.dismissed',
        'report/watchlist.reviewed',
        'report/watchlist.redacted',
      ].map((name) => eventWords(name)),
    ).toEqual([
      'Watchlist report ready',
      'Watchlist report errored (not screened)',
      'Watchlist report matched',
      'Watchlist report match dismissed',
      'Watchlist report match reviewed',
      'Watchlist report redacted',
    ]);
    expect(eventWords('report/politically-exposed-person.matched')).toBe(
      'Politically exposed person report matched',
    );
    expect(eventWords('report/email-address.ready')).toBe('Email address report ready');
  });

  it('never says an errored report found nothing (C69.4)', () => {
    for (const name of REPORT_EVENT_NAMES.filter((each) => each.endsWith('.errored'))) {
      expect(eventWords(name)).toMatch(/errored \(not screened\)$/);
    }
  });

  it.each(['report/watchlist.submitted', 'report/unknown.ready'])('knows nothing of %s', (name) => {
    expect(eventWords(name)).toBeUndefined();
  });
});
