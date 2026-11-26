package dev.openverify.sdk.flow

import dev.openverify.sdk.model.AamvaStep
import dev.openverify.sdk.model.BusinessWebsiteStep
import dev.openverify.sdk.model.CryptoWalletStep
import dev.openverify.sdk.model.DatabaseBusinessStep
import dev.openverify.sdk.model.DatabaseStep
import dev.openverify.sdk.model.DocumentStep
import dev.openverify.sdk.model.EmailOtpStep
import dev.openverify.sdk.model.FlowStep
import dev.openverify.sdk.model.GovernmentIdStep
import dev.openverify.sdk.model.NfcStep
import dev.openverify.sdk.model.PhoneOtpStep
import dev.openverify.sdk.model.SelfieStep
import dev.openverify.sdk.model.VerificationType

/**
 * C50.1 `DEFAULT_MAX_ATTEMPTS` (contracts `verification-types.ts`): how many attempts a Phase 5
 * type's step allows when it sets no `maxAttempts`. Government ID and selfie steps always set theirs.
 */
internal val DEFAULT_MAX_ATTEMPTS: Map<VerificationType, Int> = mapOf(
    VerificationType.DOCUMENT to 3,
    VerificationType.DATABASE to 1,
    VerificationType.AAMVA to 1,
    VerificationType.PHONE_NUMBER to 5,
    VerificationType.EMAIL_ADDRESS to 5,
    VerificationType.GOVERNMENT_ID_NFC to 3,
    VerificationType.CRYPTO_WALLET to 3,
    VerificationType.DATABASE_BUSINESS to 3,
    VerificationType.BUSINESS_WEBSITE to 3,
)

/**
 * C50.2 `stepMaxAttempts`: the step's own `maxAttempts`, else its type's default; `null` for a step
 * that creates no verification this SDK runs.
 */
internal fun stepMaxAttempts(step: FlowStep): Int? = when (step) {
    is GovernmentIdStep -> step.maxAttempts
    is SelfieStep -> step.maxAttempts
    is PhoneOtpStep -> step.maxAttempts ?: DEFAULT_MAX_ATTEMPTS.getValue(VerificationType.PHONE_NUMBER)
    is EmailOtpStep -> step.maxAttempts ?: DEFAULT_MAX_ATTEMPTS.getValue(VerificationType.EMAIL_ADDRESS)
    is DatabaseStep -> step.maxAttempts ?: DEFAULT_MAX_ATTEMPTS.getValue(VerificationType.DATABASE)
    is AamvaStep -> step.maxAttempts ?: DEFAULT_MAX_ATTEMPTS.getValue(VerificationType.AAMVA)
    is CryptoWalletStep -> step.maxAttempts ?: DEFAULT_MAX_ATTEMPTS.getValue(VerificationType.CRYPTO_WALLET)
    is DocumentStep -> step.maxAttempts ?: DEFAULT_MAX_ATTEMPTS.getValue(VerificationType.DOCUMENT)
    is DatabaseBusinessStep -> step.maxAttempts ?: DEFAULT_MAX_ATTEMPTS.getValue(VerificationType.DATABASE_BUSINESS)
    is BusinessWebsiteStep -> step.maxAttempts ?: DEFAULT_MAX_ATTEMPTS.getValue(VerificationType.BUSINESS_WEBSITE)
    is NfcStep -> step.maxAttempts ?: DEFAULT_MAX_ATTEMPTS.getValue(VerificationType.GOVERNMENT_ID_NFC)
    else -> null
}
