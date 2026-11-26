import {
  ATTESTED_CONSENT_MODES,
  CONNECTION_DIRECTIONS,
  CONNECTION_STATUSES,
  CONNECT_SIDES,
  CONSENT_METHODS,
  CONSENT_RECORD_STATUSES,
  CONSENT_WITHDRAWAL_REASONS,
  CONSENT_WITHDRAWN_VIA,
  SHARE_PURPOSES,
  SHARE_REDEEM_MODES,
  SHARE_SOURCE_TYPES,
  SHARE_TOKEN_EXPIRY_REASONS,
  SHARE_TOKEN_FAILURE_REASONS,
  SHARE_TOKEN_STATUSES,
  SHARE_VERIFICATION_TYPES,
} from '@openverify/contracts';
import { SHARE_CATEGORIES } from '@openverify/core';
import { describe, expect, it } from 'vitest';
import {
  ATTESTED_CONSENT_WORDS,
  CONNECTION_DIRECTION_WORDS,
  CONNECTION_STATUS_TONES,
  CONNECTION_STATUS_WORDS,
  CONNECT_SIDE_WORDS,
  CONSENT_METHOD_WORDS,
  CONSENT_STATUS_TONES,
  CONSENT_STATUS_WORDS,
  CONSENT_WITHDRAWAL_REASON_WORDS,
  CONSENT_WITHDRAWN_VIA_WORDS,
  SHARE_CATEGORY_WORDS,
  SHARE_PURPOSE_WORDS,
  SHARE_REDEEM_MODE_WORDS,
  SHARE_SOURCE_TYPE_WORDS,
  SHARE_TOKEN_EXPIRY_WORDS,
  SHARE_TOKEN_FAILURE_WORDS,
  SHARE_TOKEN_STATUS_TONES,
  SHARE_TOKEN_STATUS_WORDS,
  SHARE_VERIFICATION_TYPE_WORDS,
  categoriesInWords,
  listInWords,
} from './connect-words';

/** Every closed list the Connect pages show, with the words the console says it in. */
const TABLES: readonly (readonly [string, readonly string[], Readonly<Record<string, string>>])[] =
  [
    ['connection statuses', CONNECTION_STATUSES, CONNECTION_STATUS_WORDS],
    ['connection directions', CONNECTION_DIRECTIONS, CONNECTION_DIRECTION_WORDS],
    ['share token statuses', SHARE_TOKEN_STATUSES, SHARE_TOKEN_STATUS_WORDS],
    ['failure reasons', SHARE_TOKEN_FAILURE_REASONS, SHARE_TOKEN_FAILURE_WORDS],
    ['expiry reasons', SHARE_TOKEN_EXPIRY_REASONS, SHARE_TOKEN_EXPIRY_WORDS],
    ['redeem modes', SHARE_REDEEM_MODES, SHARE_REDEEM_MODE_WORDS],
    ['source types', SHARE_SOURCE_TYPES, SHARE_SOURCE_TYPE_WORDS],
    ['verification types', SHARE_VERIFICATION_TYPES, SHARE_VERIFICATION_TYPE_WORDS],
    ['attested-consent modes', ATTESTED_CONSENT_MODES, ATTESTED_CONSENT_WORDS],
    ['purposes', SHARE_PURPOSES, SHARE_PURPOSE_WORDS],
    ['categories', SHARE_CATEGORIES, SHARE_CATEGORY_WORDS],
    ['consent methods', CONSENT_METHODS, CONSENT_METHOD_WORDS],
    ['sides', CONNECT_SIDES, CONNECT_SIDE_WORDS],
    ['consent statuses', CONSENT_RECORD_STATUSES, CONSENT_STATUS_WORDS],
    ['withdrawal channels', CONSENT_WITHDRAWN_VIA, CONSENT_WITHDRAWN_VIA_WORDS],
    ['withdrawal reasons', CONSENT_WITHDRAWAL_REASONS, CONSENT_WITHDRAWAL_REASON_WORDS],
  ];

describe('Connect in words (C242)', () => {
  it.each(TABLES)('says every one of the %s, and nothing else', (_name, values, words) => {
    expect(Object.keys(words).sort()).toEqual([...values].sort());
    for (const value of values) {
      expect(words[value]?.trim()).not.toBe('');
      // Words, not the code itself: a snake_case or kebab-case code is never shown as-is.
      expect(words[value]).not.toBe(value);
    }
  });

  it('gives every status a badge tone', () => {
    expect(Object.keys(CONNECTION_STATUS_TONES).sort()).toEqual([...CONNECTION_STATUSES].sort());
    expect(Object.keys(SHARE_TOKEN_STATUS_TONES).sort()).toEqual([...SHARE_TOKEN_STATUSES].sort());
    expect(Object.keys(CONSENT_STATUS_TONES).sort()).toEqual([...CONSENT_RECORD_STATUSES].sort());
  });

  it('labels an attested consent "not witnessed" and a flow consent "witnessed in the flow" (C242.3)', () => {
    expect(CONSENT_METHOD_WORDS.flow).toBe('Witnessed in the flow');
    expect(CONSENT_METHOD_WORDS.attested).toBe('Attested by the operator, not witnessed');
  });

  it('says a decline as declined, never as an active consent', () => {
    expect(CONSENT_STATUS_WORDS.declined).toBe('Declined');
    expect(CONSENT_STATUS_TONES.declined).not.toBe('success');
  });

  it('joins lists as English writes them', () => {
    expect(listInWords([], 'None')).toBe('None');
    expect(listInWords(['Inquiries'], 'None')).toBe('Inquiries');
    expect(listInWords(['Inquiries', 'accounts'], 'None')).toBe('Inquiries and accounts');
    expect(listInWords(['Inquiries', 'accounts', 'verifications'], 'None')).toBe(
      'Inquiries, accounts and verifications',
    );
  });

  it('says a share’s categories in the order given, and "No data" for none', () => {
    expect(categoriesInWords(['identity-fields', 'biometric'])).toBe(
      'Identity fields (names, dates, addresses, ID numbers) and biometric data (selfies, ID portraits, liveness and face-match results)',
    );
    expect(categoriesInWords([])).toBe('No data');
  });
});
