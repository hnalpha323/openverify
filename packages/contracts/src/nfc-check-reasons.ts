/**
 * The reason codes of the government ID NFC checks (C51.2, C62), `id_nfc_expired_detection`
 * among them (it left the government ID file). The 5B `emrtd` agent owns this file from 5B Stage
 * 2 and may add fraud reasons only, recorded as plan amendments.
 *
 * C62.3, C62.4: `failed` only for proven tampering or revocation; a trust-store gap, a profile
 * defect or malformed data is review (`not_applicable`), never fraud; a data-group check on data
 * whose integrity is not established fails on a mismatch and never passes on a match
 * (`integrity_not_established`).
 */
import type { CheckId } from '@openverify/core';
import { checkReasonsOf, outcome, type CheckOutcomeTable } from './check-outcome-reasons.js';

export const NFC_CHECK_IDS = Object.freeze([
  'id_nfc_passive_authentication_detection',
  'id_nfc_chip_authentication_detection',
  'id_nfc_mrz_comparison',
  'id_nfc_selfie_comparison',
  'id_nfc_repeat_detection',
  'id_nfc_expired_detection',
] as const satisfies readonly CheckId[]);

export type NfcCheckId = (typeof NFC_CHECK_IDS)[number];

const NOT_ESTABLISHED = 'integrity_not_established';

export const NFC_CHECK_OUTCOMES: CheckOutcomeTable<NfcCheckId> = Object.freeze({
  id_nfc_passive_authentication_detection: outcome(
    ['dg_hash_mismatch', 'sod_signature_invalid', 'dsc_revoked', 'specimen_issuer'],
    [
      'trust_anchor_unavailable',
      'trust_anchor_withdrawn',
      'dsc_missing',
      'crl_unavailable',
      'certificate_expired',
      'certificate_profile_invalid',
      'issuer_country_inconsistent',
      'algorithm_unsupported',
      'chip_data_malformed',
      'input_missing',
    ],
  ),
  // `chip_auth_not_server_verifiable` is non-blocking: the signed SOD lists no DG15 (decision 33).
  id_nfc_chip_authentication_detection: outcome(
    ['active_authentication_failed'],
    [
      'chip_auth_not_server_verifiable',
      'active_authentication_withheld',
      'active_authentication_unavailable',
      'chip_data_malformed',
      NOT_ESTABLISHED,
    ],
  ),
  // `not_requested` is non-blocking: the pinned flow has no government ID step.
  id_nfc_mrz_comparison: outcome(
    [
      'document_number_mismatch',
      'birthdate_mismatch',
      'expiration_date_mismatch',
      'name_mismatch',
      'nationality_mismatch',
      'issuer_mismatch',
    ],
    ['not_requested', 'no_reference_data', NOT_ESTABLISHED],
  ),
  id_nfc_selfie_comparison: outcome(
    ['face_mismatch'],
    ['no_reference_data', 'input_missing', NOT_ESTABLISHED],
  ),
  // Decision 35: a sighting is review-level by default; it fails only with sighting-outcome: fail.
  id_nfc_repeat_detection: outcome(
    ['chip_seen_on_other_account'],
    ['chip_seen_on_other_account', NOT_ESTABLISHED],
  ),
  id_nfc_expired_detection: outcome(
    ['expired', 'expired_within_grace_period', 'expiration_date_invalid'],
    ['input_missing', NOT_ESTABLISHED],
  ),
});

export const NFC_CHECK_REASONS = checkReasonsOf(NFC_CHECK_OUTCOMES);
