package dev.openverify.sdk.api

import dev.openverify.sdk.consent.ConsentEvidence

import dev.openverify.sdk.camera.CapturedImage
import dev.openverify.sdk.model.ClientUnableReason
import dev.openverify.sdk.model.FlowChipChallenge
import dev.openverify.sdk.model.FlowChipSubmit
import dev.openverify.sdk.model.FlowClientUnable
import dev.openverify.sdk.model.FlowSandboxChip
import dev.openverify.sdk.model.SandboxChipScenario
import dev.openverify.sdk.model.FlowIntegrityChallenge
import dev.openverify.sdk.model.CaptureTrigger
import dev.openverify.sdk.model.CaptureMethod
import dev.openverify.sdk.model.DocumentFile
import dev.openverify.sdk.model.FileKind
import dev.openverify.sdk.model.FileResource
import dev.openverify.sdk.model.FlowConsent
import dev.openverify.sdk.model.FlowCryptoChallenge
import dev.openverify.sdk.model.FlowCryptoSubmit
import dev.openverify.sdk.model.FlowSelfieCapture
import dev.openverify.sdk.model.FlowSession
import dev.openverify.sdk.model.FlowSignals
import dev.openverify.sdk.model.FlowValue
import dev.openverify.sdk.model.FlowSubmitCapture
import dev.openverify.sdk.model.FlowVerification
import dev.openverify.sdk.model.OtpDestination
import dev.openverify.sdk.model.SelfieCaptureUpload
import dev.openverify.sdk.model.VerificationInputs
import dev.openverify.sdk.model.VerificationType
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

/**
 * The flow API of a one-time link (C19). The first call redeems the link, once even when calls
 * race, and every call then goes to a client for the session token it got. The token lives in
 * this object's memory only: it is never written to an intent, saved state or disk, so it ends
 * with the process.
 *
 * A redeem that failed on the way (offline, a timeout) is tried again by the next call; a
 * refused link ([FlowApiException.LinkRefused]) stays refused.
 */
internal class OneTimeLinkFlowApi(
    private val inquiryId: String,
    private val oneTimeToken: String,
    private val redeem: suspend (inquiryId: String, oneTimeToken: String) -> RedeemedSession,
    private val connect: (sessionToken: String) -> FlowApi,
) : FlowApi {

    private val lock = Mutex()
    private var session: FlowApi? = null
    private var refusal: FlowApiException.LinkRefused? = null

    private suspend fun session(): FlowApi = session ?: lock.withLock {
        session ?: run {
            refusal?.let { throw it }
            val redeemed = try {
                redeem(inquiryId, oneTimeToken)
            } catch (e: FlowApiException.LinkRefused) {
                refusal = e
                throw e
            }
            connect(redeemed.sessionToken).also { session = it }
        }
    }

    override suspend fun getSession(): FlowSession = session().getSession()

    override suspend fun acceptConsent(
        textKeys: List<String>,
        locale: String,
        optionalTextKeys: List<String>,
        evidence: ConsentEvidence,
    ): FlowConsent = session().acceptConsent(textKeys, locale, optionalTextKeys, evidence)

    override suspend fun sendSignals(signals: FlowSignals): Unit = session().sendSignals(signals)

    override suspend fun submitScreen(stepId: String, values: Map<String, FlowValue>, button: String?): FlowSession =
        session().submitScreen(stepId, values, button)

    override suspend fun extendSelfieCapture(captureId: String): FlowSelfieCaptureExtension = session().extendSelfieCapture(captureId)

    override suspend fun fetchThemeAsset(assetId: String): ByteArray = session().fetchThemeAsset(assetId)

    override suspend fun createIntegrityChallenge(): FlowIntegrityChallenge = session().createIntegrityChallenge()

    override suspend fun createChipChallenge(verificationId: String): FlowChipChallenge = session().createChipChallenge(verificationId)

    override suspend fun uploadChipFile(verificationId: String, kind: FileKind, bytes: ByteArray): FileResource =
        session().uploadChipFile(verificationId, kind, bytes)

    override suspend fun submitChip(verificationId: String, chip: FlowChipSubmit): FlowVerification = session().submitChip(verificationId, chip)

    override suspend fun reportClientUnable(verificationId: String, reason: ClientUnableReason): FlowClientUnable =
        session().reportClientUnable(verificationId, reason)

    override suspend fun acceptShareConsent(stepId: String, textSha256: String, biometricTextSha256: String?, explicitBiometric: Boolean): FlowSession =
        session().acceptShareConsent(stepId, textSha256, biometricTextSha256, explicitBiometric)

    override suspend fun declineShareConsent(stepId: String): FlowSession = session().declineShareConsent(stepId)

    override suspend fun withdrawShareConsent(stepId: String): FlowSession = session().withdrawShareConsent(stepId)

    override suspend fun requestSandboxChip(verificationId: String, challengeId: String, scenario: SandboxChipScenario): FlowSandboxChip =
        session().requestSandboxChip(verificationId, challengeId, scenario)

    override suspend fun sendIntegrityToken(challengeId: String, token: String): Unit = session().sendIntegrityToken(challengeId, token)

    override suspend fun createVerification(type: VerificationType, country: String?, idClass: String?): FlowVerification =
        session().createVerification(type, country, idClass)

    override suspend fun createSelfieCapture(verificationId: String, method: CaptureMethod): FlowSelfieCapture =
        session().createSelfieCapture(verificationId, method)

    override suspend fun uploadFile(
        verificationId: String,
        kind: FileKind,
        image: CapturedImage,
        capture: SelfieCaptureUpload?,
        captureMethod: CaptureMethod?,
        captureTrigger: CaptureTrigger?,
    ): FileResource = session().uploadFile(verificationId, kind, image, capture, captureMethod, captureTrigger)

    override suspend fun uploadDocument(verificationId: String, document: DocumentFile, captureMethod: CaptureMethod?): FileResource =
        session().uploadDocument(verificationId, document, captureMethod)

    override suspend fun submitVerification(verificationId: String, capture: FlowSubmitCapture?): FlowVerification =
        session().submitVerification(verificationId, capture)

    override suspend fun getVerification(verificationId: String): FlowVerification =
        session().getVerification(verificationId)

    override suspend fun sendOtp(verificationId: String, destination: OtpDestination): FlowVerification =
        session().sendOtp(verificationId, destination)

    override suspend fun confirmOtp(verificationId: String, code: String): FlowVerification =
        session().confirmOtp(verificationId, code)

    override suspend fun enterInputs(verificationId: String, inputs: VerificationInputs): FlowVerification =
        session().enterInputs(verificationId, inputs)

    override suspend fun createCryptoChallenge(verificationId: String, chainId: String, walletAddress: String): FlowCryptoChallenge =
        session().createCryptoChallenge(verificationId, chainId, walletAddress)

    override suspend fun submitCryptoSignature(verificationId: String, crypto: FlowCryptoSubmit): FlowVerification =
        session().submitCryptoSignature(verificationId, crypto)
}
