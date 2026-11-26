/**
 * C230.3 (Phase 11, Workflow 11A Stage 2; `connect-logic` checkpoint 1): the share policy's rules,
 * table by table.
 */
import { describe, expect, it } from 'vitest';
import { CHECK_REGISTRY } from '../check-registry.js';
import { VERIFICATION_TYPES } from '../enums.js';
import {
  BIOMETRIC_CHECK_NAMES,
  SHARE_FILE_KINDS,
  SHARE_VERIFICATION_KINDS,
  VERIFICATION_TYPE_OF_SHARE_KIND,
  attestedConsentAllows,
  checkShared,
  fileKindShared,
  isBiometricCheck,
  peekPathShared,
  peekVisibilityOf,
  shareKindOfVerificationType,
  sharePolicyProblems,
  shareSourceRefusal,
  verificationKindShared,
  type ShareAttestedConsent,
  type ShareFileKind,
} from './policy.js';
import { EVERYTHING, policyWith, verificationsWith } from './testing.js';

describe('the share types of the verification types (C230.3)', () => {
  it.each([
    ['government_id', 'government-id'],
    ['selfie', 'selfie'],
    ['database', 'database'],
    ['document', 'document'],
    ['email_address', 'email-address'],
    ['phone_number', 'phone-number'],
    ['aamva', null],
    ['government_id_nfc', null],
    ['crypto_wallet', null],
    ['database_business', null],
    ['business_website', null],
    ['government-id', null],
    ['', null],
  ])('%s is shared as %s', (type, kind) => {
    expect(shareKindOfVerificationType(type)).toBe(kind);
  });

  it('maps each share type back to its verification type', () => {
    for (const kind of SHARE_VERIFICATION_KINDS) {
      const type = VERIFICATION_TYPE_OF_SHARE_KIND[kind];
      expect(VERIFICATION_TYPES).toContain(type);
      expect(shareKindOfVerificationType(type)).toBe(kind);
    }
  });
});

describe('the biometric checks (C230.3, decision 23)', () => {
  const selfieChecks = CHECK_REGISTRY.filter((check) => check.verificationType === 'selfie').map(
    (check) => check.id,
  );

  it('are every selfie check and the three face matches of an identity document', () => {
    expect(selfieChecks.length).toBeGreaterThan(10);
    expect([...BIOMETRIC_CHECK_NAMES].sort()).toEqual(
      [
        ...selfieChecks,
        'id_selfie_comparison',
        'id_nfc_selfie_comparison',
        'id_public_figure_detection',
      ].sort(),
    );
  });

  it.each([
    ['selfie_liveness_detection', true],
    ['selfie_id_comparison', true],
    ['id_selfie_comparison', true],
    ['id_nfc_selfie_comparison', true],
    ['id_public_figure_detection', true],
    ['id_portrait_detection', false],
    ['id_blur_detection', false],
    ['database_name_comparison', false],
    ['not_a_check', false],
  ])('%s is biometric: %s', (name, biometric) => {
    expect(isBiometricCheck(name)).toBe(biometric);
  });
});

describe('files (C230.3: biometric off removes portraits; a face template never)', () => {
  const cases: [boolean, boolean, ShareFileKind, boolean][] = [];
  for (const files of [true, false]) {
    for (const biometric of [true, false]) {
      for (const kind of SHARE_FILE_KINDS) {
        const expected =
          files &&
          kind !== 'face-template' &&
          (biometric || (kind !== 'portrait' && kind !== 'selfie-image'));
        cases.push([files, biometric, kind, expected]);
      }
    }
  }

  it.each(cases)('files %s, biometric %s: %s shared %s', (files, biometric, kind, expected) => {
    const policy = { ...verificationsWith({ files }), biometric };
    expect(fileKindShared(policy, kind)).toBe(expected);
  });

  it('never shares a face template, whatever the policy says', () => {
    expect(fileKindShared(EVERYTHING, 'face-template')).toBe(false);
  });
});

describe('check results (C230.3)', () => {
  it.each([
    [true, true, 'id_blur_detection', true],
    [true, true, 'id_selfie_comparison', true],
    [true, false, 'id_blur_detection', true],
    [true, false, 'id_selfie_comparison', false],
    [true, false, 'selfie_liveness_detection', false],
    [false, true, 'id_blur_detection', false],
    [false, true, 'id_selfie_comparison', false],
  ])('check-results %s, biometric %s: %s shared %s', (results, biometric, name, expected) => {
    const policy = { ...verificationsWith({ 'check-results': results }), biometric };
    expect(checkShared(policy, name)).toBe(expected);
  });
});

describe('verification types (C230.3: selfie needs biometric)', () => {
  it.each([
    ['government-id', ['government-id'], true, true],
    ['government-id', ['database'], true, false],
    ['selfie', ['selfie'], true, true],
    ['selfie', ['selfie'], false, false],
    ['database', ['database'], false, true],
  ] as const)('%s with %j and biometric %s: %s', (kind, types, biometric, expected) => {
    const policy = { ...verificationsWith({ types: [...types] }), biometric };
    expect(verificationKindShared(policy, kind)).toBe(expected);
  });
});

describe('peek paths (C230.3, Stage 1a amendment 26)', () => {
  const inquiryOnly = policyWith({
    'source-types': ['inquiry'],
    verifications: { ...EVERYTHING.verifications, types: ['government-id'] },
  });

  it.each([
    ['inquiry.status', true],
    ['inquiry.fields.name_first', true],
    ['inquiry.fields.ssn_last4', false],
    ['account.status', false],
    ['account.fields.name_first', false],
    ['transaction.fields.amount', false],
    ['verification/government-id.status', true],
    ['verification/government-id.name-first', true],
    ['verification/selfie.status', false],
    ['verification/government-id.fields.name_first', false],
    ['inquiry.fields', false],
    ['inquiry', false],
    ['inquiry.', false],
    ['inquiry.Status', false],
    ['report.status', false],
    ['verification/aamva.status', false],
  ])('%s is shared: %s', (path, shared) => {
    expect(peekPathShared(inquiryOnly, path)).toBe(shared);
  });

  it('reads every allowlist by its own object type', () => {
    expect(peekPathShared(EVERYTHING, 'account.fields.phone_number')).toBe(true);
    expect(peekPathShared(EVERYTHING, 'account.fields.email_address')).toBe(false);
    expect(peekPathShared(EVERYTHING, 'transaction.fields.receipt')).toBe(true);
    expect(peekPathShared(EVERYTHING, 'transaction.status')).toBe(true);
  });

  it('serves full only where the policy names a shared path full', () => {
    const policy = policyWith({
      peek: {
        'inquiry.status': 'full',
        'inquiry.fields.name_first': 'presence',
        'account.fields.email_address': 'full',
      },
    });
    expect(peekVisibilityOf(policy, 'inquiry.status')).toBe('full');
    expect(peekVisibilityOf(policy, 'inquiry.fields.name_first')).toBe('presence');
    expect(peekVisibilityOf(policy, 'inquiry.created-at')).toBe('presence');
    expect(peekVisibilityOf(policy, 'account.fields.email_address')).toBe('presence');
    expect(peekVisibilityOf(policy, 'constructor')).toBe('presence');
  });
});

describe('the policy rules with JSON pointers (C230.3, Stage 1a amendment 27)', () => {
  it('finds nothing wrong with a policy that keeps every rule', () => {
    expect(sharePolicyProblems(EVERYTHING)).toEqual([]);
    expect(
      sharePolicyProblems(
        policyWith({ peek: { 'inquiry.status': 'full', 'verification/selfie.status': 'full' } }),
      ),
    ).toEqual([]);
  });

  it('asks biometric for a selfie, at the selfie entry', () => {
    expect(
      sharePolicyProblems({
        ...verificationsWith({ types: ['government-id', 'selfie'] }),
        biometric: false,
      }),
    ).toEqual([{ pointer: '/verifications/types/1', rule: 'selfie_needs_biometric' }]);
  });

  it('asks a verification source for at least one verification type', () => {
    expect(sharePolicyProblems(verificationsWith({ types: [] }))).toEqual([
      { pointer: '/verifications/types', rule: 'verification_types_missing' },
    ]);
    expect(
      sharePolicyProblems({
        ...verificationsWith({ types: [] }),
        'source-types': ['inquiry'],
      }),
    ).toEqual([]);
  });

  it('refuses a peek path outside the policy, escaping its slash', () => {
    const policy = policyWith({
      verifications: { ...EVERYTHING.verifications, types: ['database'] },
      peek: {
        'inquiry.status': 'full',
        'verification/selfie.status': 'full',
        'inquiry.fields.ssn_last4': 'presence',
        'not a path': 'full',
      },
    });
    expect(sharePolicyProblems(policy)).toEqual([
      { pointer: '/peek/verification~1selfie.status', rule: 'peek_path_not_shared' },
      { pointer: '/peek/inquiry.fields.ssn_last4', rule: 'peek_path_not_shared' },
      { pointer: '/peek/not a path', rule: 'peek_path_not_shared' },
    ]);
  });

  it('escapes a tilde before a slash (RFC 6901)', () => {
    expect(sharePolicyProblems(policyWith({ peek: { 'a~/b': 'full' } }))).toEqual([
      { pointer: '/peek/a~0~1b', rule: 'peek_path_not_shared' },
    ]);
  });

  it('refuses more than 400 peek paths once, at the map', () => {
    const peek = Object.fromEntries(
      Array.from({ length: 401 }, (_, index) => [`inquiry.a${String(index)}`, 'full' as const]),
    );
    expect(sharePolicyProblems(policyWith({ peek }))).toEqual([
      { pointer: '/peek', rule: 'peek_paths_over_limit' },
    ]);
    const atLimit = Object.fromEntries(Object.entries(peek).slice(0, 400));
    expect(sharePolicyProblems(policyWith({ peek: atLimit }))).toEqual([]);
  });
});

describe('attested consent (C230.3, review P03)', () => {
  it.each([
    ['none', false, false],
    ['none', true, false],
    ['non-biometric', false, true],
    ['non-biometric', true, false],
    ['all', false, true],
    ['all', true, true],
  ] as [ShareAttestedConsent, boolean, boolean][])(
    '%s with biometric %s allows %s',
    (mode, biometric, allowed) => {
      expect(attestedConsentAllows(mode, biometric)).toBe(allowed);
    },
  );
});

describe('the source a policy shares (C232.1: share_source_not_allowed)', () => {
  const noVerificationSource = policyWith({ 'source-types': ['inquiry', 'account'] });

  it.each([
    [EVERYTHING, { type: 'inquiry' }, null],
    [EVERYTHING, { type: 'account' }, null],
    [EVERYTHING, { type: 'transaction' }, null],
    [EVERYTHING, { type: 'verification', verificationType: 'government_id' }, null],
    [EVERYTHING, { type: 'verification', verificationType: 'selfie' }, null],
    [EVERYTHING, { type: 'verification', verificationType: 'aamva' }, 'share_source_not_allowed'],
    [EVERYTHING, { type: 'verification' }, 'share_source_not_allowed'],
    [noVerificationSource, { type: 'transaction' }, 'share_source_not_allowed'],
    [
      noVerificationSource,
      { type: 'verification', verificationType: 'government_id' },
      'share_source_not_allowed',
    ],
    [
      verificationsWith({ types: ['database'] }),
      { type: 'verification', verificationType: 'government_id' },
      'share_source_not_allowed',
    ],
    [
      { ...EVERYTHING, biometric: false },
      { type: 'verification', verificationType: 'selfie' },
      'share_source_not_allowed',
    ],
  ] as const)('case %#', (policy, source, expected) => {
    expect(shareSourceRefusal(policy, source)).toBe(expected);
  });
});
