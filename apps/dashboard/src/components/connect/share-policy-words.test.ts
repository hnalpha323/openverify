import { connectionDocumentSchema, storedSharePolicySchema } from '@openverify/contracts';
import { describe, expect, it } from 'vitest';
import { goldenConnectDocument } from './connect-fixtures';
import { ATTESTED_CONSENT_WORDS } from './connect-words';
import {
  sharePolicyChanges,
  sharePolicyStatements,
  type SharePolicyBody,
} from './share-policy-words';

const golden = (name: string) => connectionDocumentSchema.parse(goldenConnectDocument(name)).data;

/** The golden connection's policy (`connection-destination.json`). */
const POLICY: SharePolicyBody = golden('connection-destination').attributes['share-policy'].body;

const valueOf = (policy: SharePolicyBody, id: string) =>
  sharePolicyStatements(policy).find((statement) => statement.id === id)?.value;

describe('a share policy in words (C242.1)', () => {
  it('says every member of the golden policy, in order, for the operator who accepts it', () => {
    expect(sharePolicyStatements(POLICY)).toEqual([
      { id: 'purpose', term: 'Purpose', value: 'Reusing an identity verification' },
      {
        id: 'source-types',
        term: 'What can be shared',
        value: 'Inquiries, accounts and verifications',
      },
      {
        id: 'verification-types',
        term: 'Verification types',
        value: 'Government ID, selfie and database',
      },
      { id: 'extracted-data', term: 'Extracted data', value: 'Shared' },
      { id: 'check-results', term: 'Check results', value: 'Shared' },
      { id: 'files', term: 'Files', value: 'Shared' },
      {
        id: 'biometric',
        term: 'Biometric data',
        value:
          'Shared: selfie images, ID portraits, and liveness and face-match results. Face templates are never shared.',
      },
      {
        id: 'fields-inquiry',
        term: 'Inquiry fields',
        value: 'name_first, name_last, birthdate and email_address',
      },
      { id: 'fields-account', term: 'Account fields', value: 'name_first and name_last' },
      { id: 'fields-transaction', term: 'Transaction fields', value: 'None' },
      {
        id: 'peek',
        term: 'Peek',
        value:
          'In full: inquiry.status, inquiry.fields.name_first and verification/government-id.status. Present or not: account.fields.name_first. Anything else shared shows only whether the source holds a value.',
      },
      {
        id: 'attested-consent',
        term: 'Attested consent',
        value: ATTESTED_CONSENT_WORDS['non-biometric'],
      },
    ]);
  });

  it('says that biometric data is left out when the policy does not share it, and never a face template', () => {
    const without = storedSharePolicySchema.parse({
      ...POLICY,
      verifications: { ...POLICY.verifications, types: ['government-id', 'database'] },
      biometric: false,
      peek: {},
    });

    expect(valueOf(without, 'biometric')).toBe(
      'Not shared: ID portraits and face-match and liveness results are left out, even with check results and files on. Face templates are never shared.',
    );
    expect(valueOf(without, 'peek')).toBe(
      'Every shared attribute shows only whether the source holds a value.',
    );
  });

  it('says a switched-off member as not shared, and an empty list as none', () => {
    const narrow = storedSharePolicySchema.parse({
      ...POLICY,
      'source-types': ['account'],
      verifications: { types: [], 'extracted-data': false, 'check-results': false, files: false },
      biometric: false,
      peek: {},
      'attested-consent': 'none',
    });

    expect(valueOf(narrow, 'source-types')).toBe('Accounts');
    expect(valueOf(narrow, 'verification-types')).toBe('None');
    expect(valueOf(narrow, 'extracted-data')).toBe('Not shared');
    expect(valueOf(narrow, 'check-results')).toBe('Not shared');
    expect(valueOf(narrow, 'files')).toBe('Not shared');
    expect(valueOf(narrow, 'attested-consent')).toBe(ATTESTED_CONSENT_WORDS.none);
  });
});

describe('the changes between two versions (C242.1)', () => {
  it('lists only what differs, with each version’s words', () => {
    const next = storedSharePolicySchema.parse({
      ...POLICY,
      verifications: {
        ...POLICY.verifications,
        types: ['government-id', 'database'],
        files: false,
      },
      biometric: false,
      fields: { ...POLICY.fields, transaction: ['amount'] },
      peek: { 'inquiry.status': 'full' },
      'attested-consent': 'all',
    });

    const changes = sharePolicyChanges(POLICY, next);

    expect(changes.map((change) => change.id)).toEqual([
      'verification-types',
      'files',
      'biometric',
      'fields-transaction',
      'peek',
      'attested-consent',
    ]);
    expect(changes[0]).toEqual({
      id: 'verification-types',
      term: 'Verification types',
      before: 'Government ID, selfie and database',
      after: 'Government ID and database',
    });
    expect(changes[3]).toEqual({
      id: 'fields-transaction',
      term: 'Transaction fields',
      before: 'None',
      after: 'amount',
    });
  });

  it('lists nothing between a version and itself', () => {
    expect(sharePolicyChanges(POLICY, POLICY)).toEqual([]);
  });
});
