/**
 * Test support for `connect-logic`'s suites (Phase 11, Workflow 11A Stage 2): a policy that shares
 * everything and synthetic source rows (rule 3: synthetic values only). Not exported from the
 * package root.
 */
import type {
  ShareCheckEntry,
  ShareFieldEntry,
  ShareFileEntry,
  ShareObjectEntry,
  ShareSourceContent,
  ShareVerificationEntry,
} from './content.js';
import type { SharePolicyRules } from './policy.js';

/** A policy that shares every source type, verification type and part, with no peek entry. */
export const EVERYTHING: SharePolicyRules = Object.freeze<SharePolicyRules>({
  purpose: 'share.reuse-kyc',
  'source-types': ['inquiry', 'account', 'transaction', 'verification'],
  verifications: {
    types: ['government-id', 'selfie', 'database', 'document', 'email-address', 'phone-number'],
    'extracted-data': true,
    'check-results': true,
    files: true,
  },
  fields: {
    inquiry: ['name_first', 'email_address', 'loyalty_points', 'proof', 'nickname'],
    account: ['name_first', 'phone_number'],
    transaction: ['amount', 'receipt'],
  },
  biometric: true,
  peek: {},
  'attested-consent': 'non-biometric',
});

type Mutable<Value> = { -readonly [Key in keyof Value]: Value[Key] };

/** {@link EVERYTHING} with some members replaced (a shallow patch of the top level). */
export function policyWith(patch: Partial<Mutable<SharePolicyRules>>): SharePolicyRules {
  return { ...EVERYTHING, ...patch };
}

/** {@link EVERYTHING}'s `verifications` with some members replaced. */
export function verificationsWith(
  patch: Partial<Mutable<SharePolicyRules['verifications']>>,
): SharePolicyRules {
  return policyWith({ verifications: { ...EVERYTHING.verifications, ...patch } });
}

export const field = (key: string, type: ShareFieldEntry['type'], value: unknown) => ({
  key,
  type,
  value,
});

export const file = (id: string, kind: ShareFileEntry['kind']): ShareFileEntry => ({ id, kind });

export const check = (name: string, status = 'passed'): ShareCheckEntry => ({ name, status });

/** A passed government ID with extracted data, three checks and three files. */
export function governmentId(patch: Partial<ShareVerificationEntry> = {}): ShareVerificationEntry {
  return {
    id: 'ver_gov',
    type: 'government_id',
    status: 'passed',
    cloned: false,
    fromRejectedHandoff: false,
    attributes: {
      'created-at': '2026-10-20T11:00:00.000Z',
      country: 'US',
      'id-class': 'dl',
      'name-first': 'Alex',
      'name-last': 'Example',
      birthdate: null,
    },
    checks: [
      check('id_blur_detection'),
      check('id_selfie_comparison'),
      check('id_public_figure_detection', 'failed'),
    ],
    files: [
      file('file_front', 'document-image'),
      file('file_portrait', 'portrait'),
      file('file_template', 'face-template'),
    ],
    ...patch,
  };
}

/** A passed selfie with a liveness check, an image and a face template. */
export function selfie(patch: Partial<ShareVerificationEntry> = {}): ShareVerificationEntry {
  return {
    id: 'ver_selfie',
    type: 'selfie',
    status: 'passed',
    cloned: false,
    fromRejectedHandoff: false,
    attributes: { 'created-at': '2026-10-20T11:01:00.000Z' },
    checks: [check('selfie_liveness_detection'), check('selfie_id_comparison')],
    files: [file('file_selfie', 'selfie-image'), file('file_selfie_template', 'face-template')],
    ...patch,
  };
}

/** A passed email-address verification with its address. */
export function emailAddress(patch: Partial<ShareVerificationEntry> = {}): ShareVerificationEntry {
  return {
    id: 'ver_email',
    type: 'email_address',
    status: 'passed',
    cloned: false,
    fromRejectedHandoff: false,
    attributes: { 'created-at': '2026-10-20T11:02:00.000Z', 'email-address': 'alex@example.com' },
    checks: [check('email_address_otp_comparison')],
    files: [],
    ...patch,
  };
}

export function inquiryObject(patch: Partial<ShareObjectEntry> = {}): ShareObjectEntry {
  return {
    id: 'inq_source',
    cloned: false,
    attributes: {
      status: 'approved',
      'created-at': '2026-10-20T10:59:00.000Z',
      'decisioned-at': '2026-10-20T11:05:00.000Z',
      'reference-id': 'customer-7',
      note: 'synthetic operator note',
      tags: ['vip'],
    },
    fields: [
      field('name_first', 'string', 'Alex'),
      field('email_address', 'email-address', 'alex@example.com'),
      field('loyalty_points', 'integer', null),
      field('proof', 'platform-file', 'file_proof'),
      field('ssn_last4', 'string', '0000'),
    ],
    ...patch,
  };
}

/** An approved inquiry holding a government ID, a selfie and an email-address verification. */
export function inquiryContent(
  verifications: readonly ShareVerificationEntry[] = [governmentId(), selfie(), emailAddress()],
  object: ShareObjectEntry = inquiryObject(),
): ShareSourceContent {
  return { type: 'inquiry', object, verifications };
}
