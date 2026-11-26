package dev.openverify.sdk.flow

/**
 * The C52.7 problem codes the flow engine branches on (contracts `PHASE5_PROBLEM_CODES`); each
 * golden problem is in `contracts/fixtures/problems/flow/`, and `ContractFixturesTest` checks that
 * every code here is one of them, with the status it comes with.
 */
internal object FlowProblemCodes {
    // One-time codes (C55).
    const val OTP_DESTINATION_INVALID = "otp_destination_invalid"
    const val OTP_DESTINATION_NOT_ALLOWED = "otp_destination_not_allowed"
    const val OTP_RESEND_TOO_SOON = "otp_resend_too_soon"
    const val OTP_RATE_LIMITED = "otp_rate_limited"
    const val OTP_DELIVERY_FAILED = "otp_delivery_failed"
    const val OTP_NOT_SENT = "otp_not_sent"
    const val OTP_INCORRECT = "otp_incorrect"
    const val OTP_EXPIRED = "otp_expired"
    const val OTP_CODE_EXHAUSTED = "otp_code_exhausted"
    const val OTP_ATTEMPTS_EXHAUSTED = "otp_attempts_exhausted"
    const val OTP_NOT_CONFIRMED = "otp_not_confirmed"
    const val OTP_ALREADY_CONFIRMED = "otp_already_confirmed"

    // Wallets (C57).
    const val CRYPTO_CHAIN_NOT_OFFERED = "crypto_chain_not_offered"
    const val CRYPTO_ADDRESS_INVALID = "crypto_address_invalid"
    const val CRYPTO_EXPECTED_ADDRESS_MISMATCH = "crypto_expected_address_mismatch"
    const val CRYPTO_CHALLENGE_INVALID = "crypto_challenge_invalid"

    // Phase 9's flow engine (C148.5, C151.4, C162.9, C171.4; Workflow 10A Stage 1a): the codes the
    // server-position driver answers by reading the session (a step that is no longer current, an
    // extension after submit) or with its own screen (a consent whose texts the server cannot
    // match). Golden problems in `contracts/fixtures/problems/flow-engine/`.
    const val FLOW_STEP_NOT_CURRENT = "flow_step_not_current"
    const val CONSENT_TEXT_MISMATCH = "consent_text_mismatch"
    const val SELFIE_CAPTURE_NOT_EXTENDABLE = "selfie_capture_not_extendable"

    /**
     * C211.3, C221.6 (Workflow 10B): the integrity token's challenge is unknown, used, expired or
     * another session's (409). The SDK sends nothing more for the inquiry (C211.2); the server's
     * signals then read `null`. Golden problem in `contracts/fixtures/problems/flow/`.
     */
    const val INTEGRITY_CHALLENGE_INVALID: String = "integrity_challenge_invalid"

    // C207.2, C207.9, C208.1 (Workflow 10C): the codes the NFC step answers on its own. Golden
    // problems in `contracts/fixtures/problems/flow/`.

    /** C62.5 (409): the chip challenge is unknown, used, superseded or expired: one more tap with a fresh one (C207.2). */
    const val CHIP_CHALLENGE_INVALID: String = "chip_challenge_invalid"

    /** C62.5 (409): the chip's SOD lists a data group that was not uploaded. */
    const val CHIP_DATA_REQUIRED: String = "chip_data_required"

    /** C207.9 (409): the client-unable report is not for the current `nfc` step, or was already made. */
    const val CLIENT_UNABLE_NOT_ALLOWED: String = "client_unable_not_allowed"

    /** C208.1 (409): the sandbox trust store does not hold the current test anchor. */
    const val SANDBOX_CHIP_ANCHOR_MISSING: String = "sandbox_chip_anchor_missing"

    /** C208.1 (422): a sandbox chip scenario this server cannot build. */
    const val SANDBOX_CHIP_SCENARIO_UNAVAILABLE: String = "sandbox_chip_scenario_unavailable"
}
