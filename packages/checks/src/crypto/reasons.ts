/**
 * The reasons each crypto wallet evaluator may emit (C51.2, C57.4): the C29.4 shared reasons its
 * registry inputs call for, then its C51.2 row. `CRYPTO_WALLET_CHECK_REASONS` in
 * `@openverify/contracts` lists the same; the API's crypto job contract test asserts the two agree.
 */
const frozen = (...reasons: string[]): readonly string[] => Object.freeze(reasons);

export const CRYPTO_WALLET_EVALUATOR_REASONS: Readonly<Record<string, readonly string[]>> =
  Object.freeze({
    crypto_wallet_validity_detection: frozen(
      'input_missing',
      'address_invalid',
      'address_checksum_invalid',
    ),
    crypto_wallet_disallowed_chain_detection: frozen(
      'input_missing',
      'chain_not_allowed',
      'no_allowlist',
    ),
    crypto_wallet_statement_comparison: frozen('input_missing', 'statement_mismatch'),
    crypto_wallet_address_comparison: frozen(
      'input_missing',
      'execution_error',
      'provider_not_configured',
      'signature_invalid',
      'signature_address_mismatch',
      'expected_address_mismatch',
      'signature_inconclusive',
      'ownership_proof_unsupported',
      'contract_wallet_not_allowed',
    ),
  });
