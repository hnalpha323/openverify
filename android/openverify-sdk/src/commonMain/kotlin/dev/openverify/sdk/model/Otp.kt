package dev.openverify.sdk.model

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/**
 * Where `POST /api/v1/flow/verifications/:id/otp` sends a code (C55, contracts
 * `flowOtpSendBodySchema`): the phone number of a phone verification, or the email address of an
 * email one. The server validates it (C55.8) before anything is sent. Both are personal data, so
 * neither ever prints (C53.8).
 */
internal sealed interface OtpDestination {

    /**
     * A phone number in international form: `+`, the country code and the number, as the server
     * reads it (C55.8), such as `+1 555 555 0100`.
     */
    @Serializable
    public data class Phone(@SerialName("phone-number") val phoneNumber: String) : OtpDestination {
        override fun toString(): String = "Phone(phoneNumber=<redacted>)"
    }

    /** An email address. */
    @Serializable
    public data class Email(@SerialName("email-address") val emailAddress: String) : OtpDestination {
        override fun toString(): String = "Email(emailAddress=<redacted>)"
    }
}

/** The one-time code values of C55 (contracts `otp.ts` `OTP_CODE_LENGTH`), provisional as the plan states. */
internal object OtpLimits {
    /** C55.2: six digits unless the step says otherwise. */
    const val DEFAULT_CODE_LENGTH: Int = 6

    /** C55.2: the fewest digits a code has (SP 800-63B-4 §3.1.3.2). */
    const val MIN_CODE_LENGTH: Int = 6

    /** C55.2: the most digits a code has. */
    const val MAX_CODE_LENGTH: Int = 10

    /** C55.8, `flowOtpSendBodySchema`: the most characters a phone number may have. */
    const val PHONE_MAX_LENGTH: Int = 32

    /** C55.8, `flowOtpSendBodySchema`: the lengths an email address may have. */
    val EMAIL_LENGTHS: IntRange = 3..254

    /** Whether [destination] is longer than the server reads (Workflow 5C review P028). */
    fun tooLong(destination: OtpDestination): Boolean = when (destination) {
        is OtpDestination.Phone -> destination.phoneNumber.length > PHONE_MAX_LENGTH
        is OtpDestination.Email -> destination.emailAddress.length > EMAIL_LENGTHS.last
    }
}
