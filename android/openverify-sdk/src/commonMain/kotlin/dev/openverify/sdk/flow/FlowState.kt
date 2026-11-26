package dev.openverify.sdk.flow

import dev.openverify.sdk.model.NfcStep
import dev.openverify.sdk.nfc.NfcView
import dev.openverify.sdk.camera.CameraLens
import dev.openverify.sdk.camera.CapturedImage
import dev.openverify.sdk.model.CompletionStep
import dev.openverify.sdk.model.ConsentStep
import dev.openverify.sdk.model.CryptoWalletStep
import dev.openverify.sdk.model.DocumentClass
import dev.openverify.sdk.model.DocumentFile
import dev.openverify.sdk.model.DocumentStep
import dev.openverify.sdk.model.FailureStep
import dev.openverify.sdk.model.FileKind
import dev.openverify.sdk.model.FlowStep
import dev.openverify.sdk.model.InputField
import dev.openverify.sdk.model.InputProblem
import dev.openverify.sdk.model.InquiryStatus
import dev.openverify.sdk.model.PersonInput
import dev.openverify.sdk.model.RetryHint
import dev.openverify.sdk.model.FlowValue
import dev.openverify.sdk.model.ScreenStep
import kotlin.time.Instant

/** What the flow shows. [FlowCoordinator] moves between these states. */
internal sealed interface FlowState {

    /** Fetching the session. */
    data object Loading : FlowState

    /**
     * The consent step. [submitting] is true while the acceptance is being sent. [retentionDays]
     * is the session's face template retention (C42.3), which the optional matching text names;
     * `null` from a server before Phase 4, and that text is then not offered. [textChanged] is true
     * when the server refused the last acceptance because the texts shown were not the version's
     * (422 `consent_text_mismatch`, C200.5): the consent is shown again from a fresh session, with a
     * notice that the wording changed, and nothing was recorded.
     */
    data class Consent(
        val step: ConsentStep,
        val submitting: Boolean = false,
        val retentionDays: Int? = null,
        val textChanged: Boolean = false,
    ) : FlowState

    /**
     * Taking photo [index] of [count] for a government ID or selfie step. [image] is set while
     * the user reviews the photo, and [retryHints] explain why the previous attempt failed.
     * [uploadAllowed] lets the user pick a photo instead: only in a sandbox (C19), for a selfie
     * or for an ID step that allows uploads.
     */
    data class Capture(
        val step: FlowStep,
        val kind: FileKind,
        val index: Int,
        val count: Int,
        val retryHints: List<RetryHint> = emptyList(),
        val image: CapturedImage? = null,
        val uploadAllowed: Boolean = false,
        /** The kept selfie [image] is being sent to its capture (C40.3); nothing can be pressed. */
        val sending: Boolean = false,
        /** The first prompt of a capture that replaced one that could not be used (C40.4). */
        val restarted: Boolean = false,
    ) : FlowState {
        val isSelfie: Boolean
            get() = kind == FileKind.SELFIE_CENTER || kind == FileKind.SELFIE_LEFT || kind == FileKind.SELFIE_RIGHT

        val lens: CameraLens get() = if (isSelfie) CameraLens.FRONT else CameraLens.BACK
    }

    /**
     * The selfie [step] waits for the camera before its verification and capture are created
     * (Workflow 4B H014). A capture's lifetime runs from its creation, and the user may spend
     * long on the camera permission, so the UI shows this behind the permission and calls
     * [FlowCoordinator.cameraReady] once the camera can be shown. Only the first selfie start of
     * a flow waits.
     */
    data class AwaitingCamera(val step: FlowStep) : FlowState

    /** Uploading, submitting and waiting for the server's decision. */
    data class Processing(val step: FlowStep) : FlowState

    /** The flow ended in its completion step, or ran out of steps ([step] is `null`). */
    data class Completed(val step: CompletionStep?, val inquiryStatus: InquiryStatus) : FlowState

    /** The flow ended in its failure step, or the inquiry failed in a flow without one ([step] is `null`). */
    data class Failed(val step: FailureStep?, val inquiryStatus: InquiryStatus) : FlowState

    /**
     * The inquiry expired before the user finished it, read from the session or from the
     * `inquiry_expired` reason of a canceled session (C25.8); nothing can be submitted any more.
     */
    data object Expired : FlowState

    /**
     * The session can no longer be used (C10: 401 `session_expired` or `session_canceled`). No
     * retry can help, so the screen only closes.
     */
    data class SessionEnded(val reason: SessionEndReason) : FlowState

    /**
     * The inquiry was redacted (410, or the `inquiry_redacted` reason of a canceled session,
     * C25.8): its data is gone and nothing more can be collected.
     */
    data object Redacted : FlowState

    /** The one-time link was refused: already used, expired, revoked or unknown. */
    data object LinkRefused : FlowState

    /** A call failed. When [canRetry] is true, [FlowCoordinator.retry] repeats the failed work. */
    data class Error(val error: FlowError, val canRetry: Boolean) : FlowState

    /** The flow needs something this SDK version cannot do; [reason] says what, for diagnostics. */
    data class Unsupported(val reason: String) : FlowState

    /**
     * C150.5, C197.1: the server is deciding (a wait on facts, a workflow). The SDK reads the
     * session again after [retryAfterMs] (2 s when the server names none) and never shows what is
     * awaited. `android-driver` builds it (Stage 3).
     */
    data class Waiting(val retryAfterMs: Long? = null) : FlowState

    /**
     * C151.2, C197.2: the server stopped the flow at its loop limits; this device cannot continue
     * it, and the result is `Failed(FLOW_HALTED)`.
     */
    data object Halted : FlowState

    /**
     * C207 (Workflow 10C): the `nfc` step. What it shows is [view], `nfc-sdk`'s closed list
     * (`nfc/NfcStepController.kt`); it never holds chip bytes or typed access values.
     */
    data class Nfc(val step: NfcStep, val view: NfcView) : FlowState

    /**
     * C195: a `screen` step's client view with the session's bound [values] (C151.5), personal
     * data that never leaves the view model's memory. `android-screens` renders it (Stage 3), and
     * [FlowCoordinator.submitScreen] sends it (C195.7).
     */
    data class Screen(
        val step: ScreenStep,
        val values: Map<String, FlowValue> = emptyMap(),
        /** The screen's submission is on its way; nothing can be pressed. */
        val submitting: Boolean = false,
        /**
         * C195.4: the fields the server's 422 pointed at (`/values/<field>`), by field key, so the
         * screen shows each refusal on its field. The server's words are never kept.
         */
        val refusedFields: Set<String> = emptySet(),
        /** The server refused the submission for a reason no field shows (a `/button` pointer, or none). */
        val refused: Boolean = false,
    ) : FlowState

    /**
     * C55, C64.2: a phone or email step. Without a [code] the user enters the destination; with one,
     * the code sent to it. [retryHints] say why the previous attempt failed ("start again"), and
     * [error] why the last request was refused. While [busy], a request is on its way and nothing
     * can be pressed. When [limited], a limit refused the user (C55.6): they can only continue, and
     * the verification goes to review.
     */
    data class Otp(
        val step: FlowStep,
        val channel: OtpChannel,
        /** Phone only: the countries a code may be sent to, in the step's order (C55.8). */
        val allowedCountries: List<String>,
        /** The digits in a code (C55.2). */
        val codeLength: Int,
        val code: OtpCode? = null,
        val retryHints: List<RetryHint> = emptyList(),
        val error: OtpError? = null,
        val busy: Boolean = false,
        val limited: Boolean = false,
    ) : FlowState

    /**
     * C52.3, C64.2: a database step, or an AAMVA step whose source is the form: the [fields] to
     * enter in order, the [required] ones, each field's objection (the device's or a 422 pointer's),
     * and the previous attempt's hints. [refused] is set when the server refused the values for a
     * reason no field shows. While [submitting], the values are on their way.
     */
    data class Form(
        val step: FlowStep,
        val fields: List<InputField>,
        val required: Set<InputField>,
        val retryHints: List<RetryHint> = emptyList(),
        val errors: Map<InputField, InputProblem> = emptyMap(),
        val refused: Boolean = false,
        val submitting: Boolean = false,
        /** A business step asks for up to ten associated persons (C52.3). */
        val collectsPersons: Boolean = false,
        /** Each associated person's objection, the device's or a 422 pointer's. */
        val personErrors: Map<PersonInput, InputProblem> = emptyMap(),
    ) : FlowState

    /**
     * C60, C64.2: a document step. [acceptedTypes] and [maxAgeDays] are what the guidance says (the
     * step's own classes and no window until it does, C52.2), [mediaTypes] the media types a file
     * may be and [maxPages] the most pages a PDF may have. [upload] says a file can be chosen and
     * [camera] that a photo can be taken. [picked] is the file the user chose, shown by its name and
     * size only; [error] why the last file was refused. While [busy], it is on its way.
     */
    data class Document(
        val step: DocumentStep,
        val acceptedTypes: List<DocumentClass>,
        val maxAgeDays: Int?,
        val maxPages: Int?,
        val mediaTypes: List<String>,
        val upload: Boolean,
        val camera: Boolean,
        val picked: PickedDocument? = null,
        val retryHints: List<RetryHint> = emptyList(),
        val error: DocumentError? = null,
        val busy: Boolean = false,
    ) : FlowState

    /**
     * C57, C64.2: a crypto wallet step, signed by pasting: the user picks one of the [chains] and
     * enters the address, the server builds the message to sign ([challenge]), and the user signs it
     * in their own wallet app and pastes the signature. [restarted] says the previous attempt ended
     * after too many messages (C57.2), so this one starts again.
     */
    data class CryptoWallet(
        val step: CryptoWalletStep,
        /** The chains offered that this SDK knows, in the step's order (C57.1). */
        val chains: List<String>,
        /** The message to sign; `null` while the user picks the chain and enters the address. */
        val challenge: CryptoChallenge? = null,
        val retryHints: List<RetryHint> = emptyList(),
        val error: CryptoError? = null,
        val busy: Boolean = false,
        val restarted: Boolean = false,
    ) : FlowState
}

/**
 * A document the user picked (C64.2): the file to upload, typed by its bytes, and its own [name] and
 * [size] to show the user. The name never leaves the device and never prints (C53.8).
 */
internal class PickedDocument(val file: DocumentFile, val name: String?, val size: Long) {
    override fun equals(other: Any?): Boolean = other is PickedDocument && file == other.file && name == other.name && size == other.size

    override fun hashCode(): Int = 31 * (31 * file.hashCode() + name.hashCode()) + size.hashCode()

    override fun toString(): String = "PickedDocument($file, name=<redacted>, size=$size)"
}

/** Why a document was refused (C52.4), by the device or the server, as the screen explains it. */
internal enum class DocumentError {
    /** The file holds nothing. */
    EMPTY,

    /** Larger than 10 MiB (or the server's 413). */
    TOO_LARGE,

    /** Not a PDF or image the step accepts (or the server's 415 or 422). */
    UNSUPPORTED_TYPE,

    /** It could not be read. */
    UNREADABLE,
}

/** C57.2: the message the server built for one chain and address, returned once. */
internal data class CryptoChallenge(
    /** `cwc_` and a ULID. */
    val id: String,
    val chainId: String,
    /** The text to sign; it names the wallet address, so it never prints (C53.8). */
    val message: String,
    /** `null` when the server's time could not be read. */
    val expiresAt: Instant?,
) {
    override fun toString(): String = "CryptoChallenge(id=$id, chainId=$chainId, message=<redacted>, expiresAt=$expiresAt)"
}

/** Why the server refused a wallet request (C52.7), as the screen explains it. */
internal enum class CryptoError {
    /** `crypto_chain_not_offered`. */
    CHAIN_NOT_OFFERED,

    /** `crypto_address_invalid`: not an address of that chain, or an EVM address without its checksum. */
    ADDRESS_INVALID,

    /** `crypto_expected_address_mismatch`: not the address the user was asked to verify. */
    EXPECTED_ADDRESS_MISMATCH,

    /** `crypto_challenge_invalid` at submit: the message expired or was replaced; a new one is needed. */
    CHALLENGE_INVALID,

    /** The device's own refusal: a pasted signature over the 1,024 characters C57.1 allows; never sent. */
    SIGNATURE_TOO_LONG,

    /** The device's own refusal: a pasted signed message over the 4,096 bytes C57.1 allows; never sent. */
    SIGNED_MESSAGE_TOO_LONG,
}

/** Where a one-time code goes (C55). */
internal enum class OtpChannel {
    PHONE,
    EMAIL,
}

/**
 * The open code of a phone or email verification, as the server's `guidance.otp` describes it
 * (C52.2). [resent] is set once a second code was sent, so the screen says it is a new one. A
 * member the server did not describe is `null`, and the screen leaves it out.
 */
internal data class OtpCode(
    /** The destination with most characters hidden; never printed (C53.8). */
    val maskedDestination: String?,
    /** `null` when the server's time could not be read. */
    val expiresAt: Instant?,
    /** When the next send is allowed; `null` when none is left or the time could not be read. */
    val resendAvailableAt: Instant?,
    val sendsRemaining: Int?,
    val attemptsRemaining: Int?,
    val resent: Boolean = false,
) {
    override fun toString(): String =
        "OtpCode(maskedDestination=<redacted>, expiresAt=$expiresAt, resendAvailableAt=$resendAvailableAt, " +
            "sendsRemaining=$sendsRemaining, attemptsRemaining=$attemptsRemaining, resent=$resent)"
}

/** Why the server refused a one-time code request (C52.7), as the screen explains it. */
internal enum class OtpError {
    /** `otp_destination_invalid`: the number or address cannot receive a code. */
    DESTINATION_INVALID,

    /** `otp_destination_not_allowed`: the step does not send codes there (a country, a number type). */
    DESTINATION_NOT_ALLOWED,

    /** `otp_delivery_failed`: the code could not be delivered; back to the entry (C64.1). */
    DELIVERY_FAILED,

    /** `otp_incorrect`: the code is wrong; the tries left are in the code. */
    CODE_INCORRECT,

    /** `otp_expired`. */
    CODE_EXPIRED,

    /** `otp_code_exhausted`: too many wrong tries for this code; a new one is needed. */
    CODE_EXHAUSTED,

    /** `otp_not_sent`: no code is open; one must be sent first. */
    CODE_NOT_SENT,

    /** `otp_resend_too_soon`: the next send is allowed later. */
    RESEND_TOO_SOON,

    /** The server did not record the limit refusal, so the verification cannot go to review yet. */
    CONTINUE_REFUSED,

    /**
     * The device's own refusal: a number over the 32 characters, or an address over the 254, that
     * `flowOtpSendBodySchema` allows (C55.8); never sent.
     */
    DESTINATION_TOO_LONG,
}

internal enum class SessionEndReason {
    /** Its time ran out, or it was expired through the server API. */
    EXPIRED,

    /**
     * Its inquiry left `created` or `pending` because it finished, or for a reason this SDK
     * version does not know. An expired or redacted inquiry has its own state (C25.8).
     */
    CANCELED,
}

internal enum class FlowError {
    /** No connection, a timeout, or rate limiting. */
    NETWORK,

    /** The session token was refused (401). */
    SESSION_EXPIRED,

    /** The session belongs to a different inquiry than the one requested. */
    INQUIRY_MISMATCH,

    /** The server refused the request (400, 403, 404, 413, 415, 422). */
    REJECTED,

    /** The request conflicted with the inquiry's state (409); retrying re-reads the session. */
    OUT_OF_SYNC,

    /** A 5xx or unexpected status. */
    SERVER,

    /** The server's response did not match the contract. */
    INVALID_RESPONSE,

    /** The server had not decided the verification when polling stopped. */
    STILL_PROCESSING,
}
