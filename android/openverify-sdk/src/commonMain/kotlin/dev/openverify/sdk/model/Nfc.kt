@file:UseSerializers(FileKind.Serializer::class)

package dev.openverify.sdk.model

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.UseSerializers

/**
 * C207.1 (Workflow 10C, contracts-10c): the wire models of the NFC step, as `@openverify/contracts`
 * freezes them (`chip-challenges.ts`, `flow-nfc.ts`). Everything the device sends here is
 * client-reported: the server verifies the chip (C207.11). Nonces, responses, MRZ values and file
 * contents are never printed.
 */

/** `chc_` plus a ULID in upper-case Crockford base32 (contract C1). */
internal val CHIP_CHALLENGE_ID: Regex = Regex("chc_[0-9A-HJKMNP-TV-Z]{26}")

/** C62.5: a chip challenge's nonce, 8 bytes as 16 lower-case hex characters. */
internal val CHIP_CHALLENGE_NONCE: Regex = Regex("[0-9a-f]{16}")

/** C62.5: the longest Active Authentication response the server takes (`ACTIVE_AUTHENTICATION_RESPONSE_MAX_BYTES`). */
internal const val ACTIVE_AUTHENTICATION_RESPONSE_MAX_BYTES: Int = 1024

/**
 * C207.2, C221.1: the MRZ's access-key fields the `nfc` client view prefills for an SDK client
 * (`prefillMrz`), as the MRZ holds them: the document number, and the birth and expiry dates as
 * YYMMDD. Personal data: held in memory for the read only.
 */
@Serializable
internal data class NfcPrefillMrz(
    val documentNumber: String,
    val birthDate: String,
    val expiryDate: String,
) {
    override fun toString(): String = "NfcPrefillMrz(<redacted>)"
}

/** C62.5: `POST /api/v1/flow/verifications/:id/chip-challenges` answers this once (`flowChipChallengeResponseSchema`). */
@Serializable
internal data class FlowChipChallenge(
    /** `chc_` and a ULID (contract C1). */
    val id: String,
    /** 16 lower-case hex characters; the chip signs its 8 bytes. */
    val nonce: String,
    @SerialName("expires-at") val expiresAt: String,
) {
    init {
        require(CHIP_CHALLENGE_ID.matches(id)) { "Not a chip challenge ID" }
        require(CHIP_CHALLENGE_NONCE.matches(nonce)) { "A chip challenge nonce is 16 lower-case hex characters" }
    }

    override fun toString(): String = "FlowChipChallenge(id=$id, nonce=<redacted>, expiresAt=$expiresAt)"
}

/** C62.5: the submit body's `chip` member (`flowChipSubmitSchema`). */
@Serializable
internal data class FlowChipSubmit(
    @SerialName("challenge-id") val challengeId: String,
    val nonce: String,
    /** Standard base64 with padding, at most 1 KiB of bytes; `null` when the chip has no Active Authentication. */
    @SerialName("active-authentication-response") val activeAuthenticationResponse: String? = null,
    /** What the device says it did: shown to operators only, never evidence. */
    @SerialName("device-report") val deviceReport: FlowChipDeviceReport? = null,
) {
    init {
        require(CHIP_CHALLENGE_ID.matches(challengeId)) { "Not a chip challenge ID" }
        require(CHIP_CHALLENGE_NONCE.matches(nonce)) { "A chip challenge nonce is 16 lower-case hex characters" }
    }

    override fun toString(): String =
        "FlowChipSubmit(challengeId=$challengeId, nonce=<redacted>, activeAuthenticationResponse=" +
            "${if (activeAuthenticationResponse == null) "null" else "<redacted>"}, deviceReport=$deviceReport)"
}

/** The body of `POST /api/v1/flow/verifications/:id/submit` for a chip. */
@Serializable
internal class FlowChipSubmitBody(val chip: FlowChipSubmit)

/** C62.5: the `device-report` (`chipDeviceReportSchema`): at most ten protocols and the read's time. */
@Serializable
internal data class FlowChipDeviceReport(
    val protocols: List<Attempt>? = null,
    @SerialName("read-ms") val readMs: Long? = null,
) {
    /** One protocol the device tried, in the wire's words (`bac`, `pace`, ...; `succeeded`, `failed`, `not-attempted`). */
    @Serializable
    data class Attempt(val protocol: String, val outcome: String)
}

/** C207.9: why this client cannot read a document chip (`CLIENT_UNABLE_REASONS`); every one is self-reported. */
@Serializable
internal enum class ClientUnableReason(internal val wireValue: String) {
    /** The phone has no NFC hardware. */
    @SerialName("nfc_unavailable")
    NFC_UNAVAILABLE("nfc_unavailable"),

    /** The host app installed no chip reader. */
    @SerialName("reader_not_installed")
    READER_NOT_INSTALLED("reader_not_installed"),

    /** NFC is off and the person chose another way. */
    @SerialName("nfc_disabled_declined")
    NFC_DISABLED_DECLINED("nfc_disabled_declined"),

    /** The platform cannot read a chip at all (the web flow's reason). */
    @SerialName("platform_unsupported")
    PLATFORM_UNSUPPORTED("platform_unsupported"),

    /** The client can read chips, but its reads of this one did not finish (the challenges are spent). */
    @SerialName("read_failed")
    READ_FAILED("read_failed"),
}

/** C207.9: the body of `POST /api/v1/flow/verifications/:id/client-unable` (`flowClientUnableBodySchema`). */
@Serializable
internal data class FlowClientUnableBody(val reason: ClientUnableReason)

/** C207.9: its answer (`flowClientUnableResponseSchema`): the verification, ended without passing. */
@Serializable
internal data class FlowClientUnable(
    @SerialName("verification-id") val verificationId: String,
    val status: VerificationStatus,
)

/** C208.1: the sandbox test chip's scenarios (`SANDBOX_CHIP_SCENARIOS`). */
@Serializable
internal enum class SandboxChipScenario(internal val wireValue: String) {
    @SerialName("match")
    MATCH("match"),

    @SerialName("mrz-mismatch")
    MRZ_MISMATCH("mrz-mismatch"),

    @SerialName("face-mismatch")
    FACE_MISMATCH("face-mismatch"),

    @SerialName("no-active-authentication")
    NO_ACTIVE_AUTHENTICATION("no-active-authentication"),

    @SerialName("tampered-dg1")
    TAMPERED_DG1("tampered-dg1"),
}

/** C208.1: the body of `POST /api/v1/flow/verifications/:id/sandbox-chip` (`flowSandboxChipBodySchema`). */
@Serializable
internal data class FlowSandboxChipBody(
    @SerialName("challenge-id") val challengeId: String,
    val scenario: SandboxChipScenario = SandboxChipScenario.MATCH,
) {
    init {
        require(CHIP_CHALLENGE_ID.matches(challengeId)) { "Not a chip challenge ID" }
    }
}

/**
 * C208.1: the sandbox route's answer (`flowSandboxChipResponseSchema`): a synthetic chip's files as
 * base64, every file but DG2, which the server attaches itself ([dg2Attached]), and the Active
 * Authentication response over the challenge's nonce when the scenario has one.
 */
@Serializable
internal data class FlowSandboxChip(
    val files: List<File>,
    @SerialName("dg2-attached") val dg2Attached: Boolean,
    @SerialName("active-authentication-response") val activeAuthenticationResponse: String? = null,
) {
    /** One chip file: its upload kind and its bytes as standard base64. */
    @Serializable
    data class File(val kind: FileKind, val content: String) {
        override fun toString(): String = "File(kind=${kind.wireValue}, content=<redacted>)"
    }

    override fun toString(): String =
        "FlowSandboxChip(files=${files.joinToString("|") { it.kind.wireValue }}, dg2Attached=$dg2Attached, " +
            "activeAuthenticationResponse=${if (activeAuthenticationResponse == null) "null" else "<redacted>"})"
}
