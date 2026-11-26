package dev.openverify.sdk.api

import dev.openverify.sdk.consent.ConsentEvidence

import dev.openverify.sdk.camera.CapturedImage
import dev.openverify.sdk.model.FlowIntegrityChallenge
import dev.openverify.sdk.model.CaptureTrigger
import dev.openverify.sdk.model.CaptureMethod
import dev.openverify.sdk.model.DocumentFile
import dev.openverify.sdk.model.FileKind
import dev.openverify.sdk.model.FileResource
import dev.openverify.sdk.model.ClientUnableReason
import dev.openverify.sdk.model.FlowChipChallenge
import dev.openverify.sdk.model.FlowChipSubmit
import dev.openverify.sdk.model.FlowClientUnable
import dev.openverify.sdk.model.FlowConsent
import dev.openverify.sdk.model.FlowSandboxChip
import dev.openverify.sdk.model.SandboxChipScenario
import dev.openverify.sdk.model.FlowCryptoChallenge
import dev.openverify.sdk.model.FlowCryptoSubmit
import dev.openverify.sdk.model.FlowSelfieCapture
import dev.openverify.sdk.model.FlowSession
import dev.openverify.sdk.model.FlowSignals
import dev.openverify.sdk.model.FlowSubmitCapture
import dev.openverify.sdk.model.FlowValue
import dev.openverify.sdk.model.FlowVerification
import dev.openverify.sdk.model.OtpDestination
import dev.openverify.sdk.model.SelfieCaptureUpload
import dev.openverify.sdk.model.VerificationInputs
import dev.openverify.sdk.model.VerificationType
import kotlinx.coroutines.delay
import kotlin.time.Duration
import kotlin.time.Duration.Companion.seconds

/**
 * The flow API (contract C3), authenticated with an inquiry session token. Every call throws
 * [FlowApiException] when it fails.
 */
internal interface FlowApi {
    /** `GET /api/v1/flow/session`. The first call moves the inquiry from `created` to `pending`. */
    public suspend fun getSession(): FlowSession

    /**
     * `POST /api/v1/flow/consent`. [textKeys] are the consent texts the user was shown, and
     * [optionalTextKeys] the optional ones the user ticked (C42.3). [evidence] is what the SDK reports
     * it rendered (C200.1): `text-sha256`, `copy-source` and `catalog-version`, each left out when absent.
     */
    public suspend fun acceptConsent(
        textKeys: List<String>,
        locale: String,
        optionalTextKeys: List<String> = emptyList(),
        evidence: ConsentEvidence = ConsentEvidence.NONE,
    ): FlowConsent

    /** `POST /api/v1/flow/verifications`. The new verification is `initiated`. */
    public suspend fun createVerification(
        type: VerificationType,
        country: String? = null,
        idClass: String? = null,
    ): FlowVerification

    /**
     * `POST /api/v1/flow/verifications/:id/selfies` (C40.2): a selfie capture of an `initiated`
     * selfie verification, with its prompts and its nonce. It replaces the verification's open
     * capture. [method] `upload` is accepted in a sandbox only.
     */
    public suspend fun createSelfieCapture(verificationId: String, method: CaptureMethod): FlowSelfieCapture

    /**
     * `POST /api/v1/flow/verifications/:id/files` (multipart `kind` and `file`). A selfie pose
     * also names its [capture] (C40.3). [captureMethod] (C206.1, Phase 9 C153.2) and [captureTrigger]
     * (C206.2) are client-reported: how the photo was taken (`camera`, `upload`) and whether the
     * shutter or the auto-capture fired (`manual`, `auto`); each is left out when null.
     */
    public suspend fun uploadFile(
        verificationId: String,
        kind: FileKind,
        image: CapturedImage,
        capture: SelfieCaptureUpload? = null,
        captureMethod: CaptureMethod? = null,
        captureTrigger: CaptureTrigger? = null,
    ): FileResource

    /**
     * `POST /api/v1/flow/verifications/:id/files` with kind `document` (C52.4): a PDF or an image,
     * sent as the bytes the user picked, named after its kind and type, never the user's own name.
     */
    public suspend fun uploadDocument(verificationId: String, document: DocumentFile, captureMethod: CaptureMethod? = null): FileResource

    /** `POST /api/v1/flow/verifications/:id/submit`. A selfie names the [capture] it consumes (C40.4). */
    public suspend fun submitVerification(verificationId: String, capture: FlowSubmitCapture? = null): FlowVerification

    /** `GET /api/v1/flow/verifications/:id`. */
    public suspend fun getVerification(verificationId: String): FlowVerification

    /**
     * `POST /api/v1/flow/verifications/:id/otp` (C55): sends a one-time code to [destination], the
     * phone number of a phone verification or the email address of an email one. A send to another
     * destination supersedes the open code. The answer is the verification with its open code in
     * `guidance.otp`, never the code itself.
     */
    public suspend fun sendOtp(verificationId: String, destination: OtpDestination): FlowVerification

    /**
     * `POST /api/v1/flow/verifications/:id/otp/confirm` (C55): [code] is the six to ten digits the
     * user received. A correct code moves the verification to `confirmed`.
     */
    public suspend fun confirmOtp(verificationId: String, code: String): FlowVerification

    /**
     * `POST /api/v1/flow/verifications/:id/inputs` (C52.3): the values a database, AAMVA, business
     * registry or business website form entered. They replace earlier values while the verification is `initiated`; the answer says
     * they arrived (`inputs-received`) and never echoes them.
     */
    public suspend fun enterInputs(verificationId: String, inputs: VerificationInputs): FlowVerification

    /**
     * `POST /api/v1/flow/verifications/:id/crypto-challenges` (C57.2): the message to sign for
     * [walletAddress] on [chainId] (a canonical CAIP-2 id), returned once. A new one supersedes the
     * open one.
     */
    public suspend fun createCryptoChallenge(verificationId: String, chainId: String, walletAddress: String): FlowCryptoChallenge

    /** `POST /api/v1/flow/verifications/:id/submit` with the signature over a challenge's message (C57.3). */
    public suspend fun submitCryptoSignature(verificationId: String, crypto: FlowCryptoSubmit): FlowVerification

    /**
     * `POST /api/v1/flow/signals` (C94.2, C94.7): one signal body after consent, answered 202 with no
     * body. [FlowApiClient] checks the body against the contract first and names only the members it
     * refuses. The default sends nothing, which the server reads as `collector_missing`, never as a
     * clean device; it lets test doubles leave the call out.
     */
    public suspend fun sendSignals(signals: FlowSignals) {}

    /**
     * `POST /api/v1/flow/screens/:stepId/submit` (C148.5, C195.7): the current screen's [values] by
     * field key and the pressed [button]'s key (`null`: the primary button, port `next`). The answer
     * is the session at its new position. Only the current step accepts it (409
     * `flow_step_not_current`); the server validates every value again and drops a hidden
     * component's. [values] are personal data. A [dev.openverify.sdk.model.FlowValue.Set] is never sent.
     */
    public suspend fun submitScreen(stepId: String, values: Map<String, FlowValue>, button: String?): FlowSession

    /**
     * `POST /api/v1/flow/selfie-captures/:id/extend` (C171.4, C204.5): moves the open capture's
     * expiry by 180 s, at least ten times; 409 `selfie_capture_not_extendable` after submit. The
     * answer is the `selfie` resource without its nonce, read for the id and the new expiry.
     */
    public suspend fun extendSelfieCapture(captureId: String): FlowSelfieCaptureExtension

    /**
     * `GET /api/v1/flow/theme-assets/:id` (C160.6, C198.3): the bytes of a theme asset of the
     * session's theme, such as its logo, to be checked before any decoding.
     */
    public suspend fun fetchThemeAsset(assetId: String): ByteArray

    /** C211.3 (Workflow 10B): `POST /api/v1/flow/integrity-challenges` (an empty body): one challenge for the inquiry's token. */
    public suspend fun createIntegrityChallenge(): FlowIntegrityChallenge

    /** C211.3: `POST /api/v1/flow/integrity-tokens` (`{challenge-id, token}`, 202). The token is never logged or kept. */
    public suspend fun sendIntegrityToken(challengeId: String, token: String)

    /**
     * C62.5, C207.1 (Workflow 10C): `POST /api/v1/flow/verifications/:id/chip-challenges`: the nonce a
     * chip signs for Active Authentication, returned once. The SDK asks for it when the person presses
     * "I'm ready" (C207.2), at most nine times per verification (the tenth cancels it on the server).
     */
    public suspend fun createChipChallenge(verificationId: String): FlowChipChallenge

    /**
     * C207.1: `POST /api/v1/flow/verifications/:id/files` with one chip file: [kind] is one of the
     * eight chip kinds, DG2 at most 1 MiB and the others at most 64 KiB, checked before sending.
     * [bytes] are chip data: in memory only, never logged.
     */
    public suspend fun uploadChipFile(verificationId: String, kind: FileKind, bytes: ByteArray): FileResource

    /** C62.5, C207.1: `POST /api/v1/flow/verifications/:id/submit` with the chip's challenge, nonce, response and device report. */
    public suspend fun submitChip(verificationId: String, chip: FlowChipSubmit): FlowVerification

    /**
     * C207.9: `POST /api/v1/flow/verifications/:id/client-unable`: this client cannot read a document
     * chip, for [reason]. Self-reported; accepted once, for the current `nfc` step only (409
     * `client_unable_not_allowed` otherwise). The server ends the verification without passing and
     * leaves the step through its fallback.
     */
    public suspend fun reportClientUnable(verificationId: String, reason: ClientUnableReason): FlowClientUnable

    /**
     * C208.1: `POST /api/v1/flow/verifications/:id/sandbox-chip`: a synthetic chip's files for
     * [challengeId], every file but DG2, which the server attaches itself. Sandbox environments
     * only; `SandboxChipReader` (C208.2) is its one caller.
     */
    public suspend fun requestSandboxChip(
        verificationId: String,
        challengeId: String,
        scenario: SandboxChipScenario = SandboxChipScenario.MATCH,
    ): FlowSandboxChip

    /**
     * C238.4 (Workflow 11A, clients-connect): `POST /api/v1/flow/share-consents/:stepId/accept`, for
     * the current `share_consent` step only (409 `flow_step_not_current` otherwise): the SHA-256 of
     * the text and, when one was served, of the biometric text, each as the SDK displayed it, and
     * the separate biometric tick. The answer is the session at its next position.
     */
    public suspend fun acceptShareConsent(stepId: String, textSha256: String, biometricTextSha256: String?, explicitBiometric: Boolean): FlowSession

    /** C238.1: `POST /api/v1/flow/share-consents/:stepId/decline` (an empty body); the flow goes on. */
    public suspend fun declineShareConsent(stepId: String): FlowSession

    /**
     * C237.6: `POST /api/v1/flow/share-consents/:stepId/withdraw` (an empty body), for a step the
     * session lists in `withdrawable-share-consents`; the answer is the session where it was.
     */
    public suspend fun withdrawShareConsent(stepId: String): FlowSession

    /**
     * Calls [getVerification] up to [maxAttempts] times, [interval] apart, until the server has
     * decided the verification.
     *
     * @throws FlowApiException.StillProcessing if it is still undecided after the last attempt.
     */
    public suspend fun pollVerification(
        verificationId: String,
        interval: Duration = DEFAULT_POLL_INTERVAL,
        maxAttempts: Int = DEFAULT_POLL_ATTEMPTS,
    ): FlowVerification {
        require(maxAttempts >= 1) { "maxAttempts must be at least 1" }
        for (attempt in 1..maxAttempts) {
            val verification = getVerification(verificationId)
            if (verification.attributes.status.isDecided) {
                return verification
            }
            if (attempt < maxAttempts) {
                delay(interval)
            }
        }
        throw FlowApiException.StillProcessing(verificationId)
    }

    public companion object {
        public val DEFAULT_POLL_INTERVAL: Duration = 2.seconds
        public const val DEFAULT_POLL_ATTEMPTS: Int = 60
    }
}
