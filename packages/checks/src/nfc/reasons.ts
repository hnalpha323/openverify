/**
 * The reasons each NFC evaluator may emit (C51.2, C62.3, C62.4, C62.6), per status: the C29.4
 * shared reasons its registry inputs call for, then its C51.2 row. `NFC_CHECK_OUTCOMES` in
 * `@openverify/contracts` states the same table; the checks package cannot import contracts, so
 * `api-nfc`'s job contract test asserts the two agree. No evaluator emits `not_implemented`.
 */
const frozen = (...reasons: string[]): readonly string[] => Object.freeze(reasons);

export interface NfcEvaluatorOutcomes {
  /** Reasons a `passed` result may carry (the expiry's grace period). */
  readonly passed: readonly string[];
  readonly failed: readonly string[];
  readonly notApplicable: readonly string[];
}

const row = (
  failed: readonly string[],
  notApplicable: readonly string[],
  passed: readonly string[] = frozen(),
): NfcEvaluatorOutcomes => Object.freeze({ passed, failed, notApplicable });

const NOT_ESTABLISHED = 'integrity_not_established';

export const NFC_EVALUATOR_OUTCOMES: Readonly<Record<string, NfcEvaluatorOutcomes>> = Object.freeze(
  {
    id_nfc_passive_authentication_detection: row(
      frozen('dg_hash_mismatch', 'sod_signature_invalid', 'dsc_revoked', 'specimen_issuer'),
      frozen(
        'input_missing',
        'trust_anchor_unavailable',
        'trust_anchor_withdrawn',
        'dsc_missing',
        'crl_unavailable',
        'certificate_expired',
        'certificate_profile_invalid',
        'issuer_country_inconsistent',
        'algorithm_unsupported',
        'chip_data_malformed',
      ),
    ),
    id_nfc_chip_authentication_detection: row(
      frozen('active_authentication_failed'),
      frozen(
        'input_missing',
        'chip_auth_not_server_verifiable',
        'active_authentication_withheld',
        'active_authentication_unavailable',
        'chip_data_malformed',
        NOT_ESTABLISHED,
      ),
    ),
    id_nfc_mrz_comparison: row(
      frozen(
        'document_number_mismatch',
        'birthdate_mismatch',
        'expiration_date_mismatch',
        'name_mismatch',
        'nationality_mismatch',
      ),
      frozen('input_missing', 'not_requested', 'no_reference_data', NOT_ESTABLISHED),
    ),
    id_nfc_selfie_comparison: row(
      frozen('face_mismatch'),
      frozen('input_missing', 'execution_error', 'no_reference_data', NOT_ESTABLISHED),
    ),
    id_nfc_repeat_detection: row(
      frozen('chip_seen_on_other_account'),
      frozen('input_missing', 'chip_seen_on_other_account', NOT_ESTABLISHED),
    ),
    id_nfc_expired_detection: row(
      frozen('expired', 'expiration_date_invalid'),
      frozen('input_missing', NOT_ESTABLISHED),
      // C29.5: within `grace-days` an expired document passes, naming the grace period.
      frozen('expired_within_grace_period'),
    ),
  },
);
