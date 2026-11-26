/**
 * A share policy in words (C242.1): what a connection lets the source copy, as statements an
 * operator reads before accepting it, and the changes between two versions. The policy states what
 * the platform will copy; it says nothing about what the destination does with a copy (C230.6).
 * A module client components may import.
 */
import type { SharePolicyVersion } from '@openverify/contracts';
import {
  ATTESTED_CONSENT_WORDS,
  SHARE_PURPOSE_WORDS,
  SHARE_SOURCE_TYPE_WORDS,
  SHARE_VERIFICATION_TYPE_WORDS,
  listInWords,
} from './connect-words';

/** A stored policy body (`attested-consent` always present). */
export type SharePolicyBody = SharePolicyVersion['body'];

/** One line of the policy: what it is about and what the policy says. */
export interface PolicyStatement {
  readonly id: string;
  readonly term: string;
  readonly value: string;
}

/** One line that differs between two versions. */
export interface PolicyChange {
  readonly id: string;
  readonly term: string;
  readonly before: string;
  readonly after: string;
}

const shared = (on: boolean) => (on ? 'Shared' : 'Not shared');

const NEVER_A_TEMPLATE = 'Face templates are never shared.';

/** C230.3: biometric data, and the face template that no policy shares. */
function biometricInWords(on: boolean): string {
  return on
    ? `Shared: selfie images, ID portraits, and liveness and face-match results. ${NEVER_A_TEMPLATE}`
    : `Not shared: ID portraits and face-match and liveness results are left out, even with check results and files on. ${NEVER_A_TEMPLATE}`;
}

/** C233.2: the paths shown in full, the paths shown as present or not (in the policy's order), and the default. */
function peekInWords(peek: SharePolicyBody['peek']): string {
  const paths = Object.keys(peek);
  const full = paths.filter((path) => peek[path] === 'full');
  const presence = paths.filter((path) => peek[path] === 'presence');
  if (full.length === 0 && presence.length === 0) {
    return 'Every shared attribute shows only whether the source holds a value.';
  }
  return [
    ...(full.length === 0 ? [] : [`In full: ${listInWords(full, '')}.`]),
    ...(presence.length === 0 ? [] : [`Present or not: ${listInWords(presence, '')}.`]),
    'Anything else shared shows only whether the source holds a value.',
  ].join(' ');
}

/** The source types, the first capitalised as a sentence starts. */
function sourceTypesInWords(types: SharePolicyBody['source-types']): string {
  return listInWords(
    types.map((type, index) => {
      const words = SHARE_SOURCE_TYPE_WORDS[type];
      return index === 0 ? words : words.toLowerCase();
    }),
    'Nothing',
  );
}

function verificationTypesInWords(types: SharePolicyBody['verifications']['types']): string {
  return listInWords(
    types.map((type, index) => {
      const words = SHARE_VERIFICATION_TYPE_WORDS[type];
      // "Government ID" keeps its capitals wherever it stands; the others read as one sentence.
      return index === 0 || type === 'government-id' ? words : words.toLowerCase();
    }),
    'None',
  );
}

/** C242.1: every member of the policy, in the order an operator reads it. */
export function sharePolicyStatements(policy: SharePolicyBody): PolicyStatement[] {
  return [
    { id: 'purpose', term: 'Purpose', value: SHARE_PURPOSE_WORDS[policy.purpose] },
    {
      id: 'source-types',
      term: 'What can be shared',
      value: sourceTypesInWords(policy['source-types']),
    },
    {
      id: 'verification-types',
      term: 'Verification types',
      value: verificationTypesInWords(policy.verifications.types),
    },
    {
      id: 'extracted-data',
      term: 'Extracted data',
      value: shared(policy.verifications['extracted-data']),
    },
    {
      id: 'check-results',
      term: 'Check results',
      value: shared(policy.verifications['check-results']),
    },
    { id: 'files', term: 'Files', value: shared(policy.verifications.files) },
    { id: 'biometric', term: 'Biometric data', value: biometricInWords(policy.biometric) },
    {
      id: 'fields-inquiry',
      term: 'Inquiry fields',
      value: listInWords(policy.fields.inquiry, 'None'),
    },
    {
      id: 'fields-account',
      term: 'Account fields',
      value: listInWords(policy.fields.account, 'None'),
    },
    {
      id: 'fields-transaction',
      term: 'Transaction fields',
      value: listInWords(policy.fields.transaction, 'None'),
    },
    { id: 'peek', term: 'Peek', value: peekInWords(policy.peek) },
    {
      id: 'attested-consent',
      term: 'Attested consent',
      value: ATTESTED_CONSENT_WORDS[policy['attested-consent']],
    },
  ];
}

/** C242.1: the statements that differ between `before` and `after`, in the statements' order. */
export function sharePolicyChanges(
  before: SharePolicyBody,
  after: SharePolicyBody,
): PolicyChange[] {
  const earlier = new Map(
    sharePolicyStatements(before).map((statement) => [statement.id, statement.value]),
  );
  return sharePolicyStatements(after).flatMap((statement) => {
    const previous = earlier.get(statement.id) ?? '';
    return previous === statement.value
      ? []
      : [{ id: statement.id, term: statement.term, before: previous, after: statement.value }];
  });
}
