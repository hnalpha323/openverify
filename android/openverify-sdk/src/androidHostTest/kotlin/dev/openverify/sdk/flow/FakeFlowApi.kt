package dev.openverify.sdk.flow

import dev.openverify.sdk.api.FlowApi
import dev.openverify.sdk.api.FlowApiException
import dev.openverify.sdk.api.FlowSelfieCaptureExtension
import dev.openverify.sdk.camera.CapturedImage
import dev.openverify.sdk.consent.ConsentEvidence
import dev.openverify.sdk.model.FlowIntegrityChallenge
import dev.openverify.sdk.model.ClientUnableReason
import dev.openverify.sdk.model.FlowChipChallenge
import dev.openverify.sdk.model.FlowChipSubmit
import dev.openverify.sdk.model.FlowClientUnable
import dev.openverify.sdk.model.FlowSandboxChip
import dev.openverify.sdk.model.SandboxChipScenario
import dev.openverify.sdk.model.CaptureTrigger
import dev.openverify.sdk.model.AamvaSource
import dev.openverify.sdk.model.AamvaStep
import dev.openverify.sdk.model.CaptureMethod
import dev.openverify.sdk.model.DatabaseBusinessStep
import dev.openverify.sdk.model.DocumentClass
import dev.openverify.sdk.model.DocumentFile
import dev.openverify.sdk.model.DocumentStep
import dev.openverify.sdk.model.EmailOtpStep
import dev.openverify.sdk.model.FileAttributes
import dev.openverify.sdk.model.FileKind
import dev.openverify.sdk.model.FileRelationships
import dev.openverify.sdk.model.FileResource
import dev.openverify.sdk.model.Fixtures
import dev.openverify.sdk.model.Flow
import dev.openverify.sdk.model.FlowConsent
import dev.openverify.sdk.model.FlowCryptoChallenge
import dev.openverify.sdk.model.FlowCryptoSubmit
import dev.openverify.sdk.model.FlowEnvironment
import dev.openverify.sdk.model.FlowSelfieCapture
import dev.openverify.sdk.model.FlowSelfieCaptureAttributes
import dev.openverify.sdk.model.FlowSession
import dev.openverify.sdk.model.FlowSessionInquiry
import dev.openverify.sdk.model.FlowSubmitCapture
import dev.openverify.sdk.model.FlowValue
import dev.openverify.sdk.model.FlowWithdrawableShareConsent
import dev.openverify.sdk.model.FlowVerification
import dev.openverify.sdk.model.FlowVerificationAttributes
import dev.openverify.sdk.model.InquiryStatus
import dev.openverify.sdk.model.Liveness
import dev.openverify.sdk.model.OpenVerifyJson
import dev.openverify.sdk.model.OtpDestination
import dev.openverify.sdk.model.PhoneOtpStep
import dev.openverify.sdk.model.Problem
import dev.openverify.sdk.model.ResourceIdentifier
import dev.openverify.sdk.model.RetryHint
import dev.openverify.sdk.model.SelfieCaptureGuidance
import dev.openverify.sdk.model.SelfieCaptureUpload
import dev.openverify.sdk.model.SelfiePose
import dev.openverify.sdk.model.SelfieStep
import dev.openverify.sdk.model.ToOneRelationship
import dev.openverify.sdk.model.VerificationInputs
import dev.openverify.sdk.model.VerificationStatus
import dev.openverify.sdk.model.VerificationType
import kotlinx.coroutines.yield
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.add
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonArray
import kotlinx.serialization.json.putJsonObject

/**
 * An in-memory flow API that behaves like the C3 server with the C40 selfie capture protocol:
 * the first session read starts the inquiry, uploads need consent, each submitted verification is
 * decided by the next scripted [Decision] when it is polled, and a selfie's poses go to a capture
 * whose id, nonce, prompts and lifetime the server checks.
 */
internal open class FakeFlowApi(
    inquiryId: String = INQUIRY_ID,
    var flow: Flow = DEFAULT_FLOW,
    inquiryStatus: InquiryStatus = InquiryStatus.CREATED,
    var consent: FlowConsent? = null,
    verifications: List<FlowVerification> = emptyList(),
    /** The session's environment (C19); `null` as a Phase 1 server sent it. */
    var environment: FlowEnvironment? = null,
    /** C42.3: the environment's face template retention, as a Phase 4 server sends it. */
    var faceTemplateRetentionDays: Int? = RETENTION_DAYS,
) : FlowApi {

    data class Decision(
        val status: VerificationStatus,
        val inquiryStatus: InquiryStatus,
        val retryHints: List<RetryHint> = emptyList(),
    )

    /** C206 (Workflow 10B): each upload's client-reported capture-method and capture-trigger, in order (a document's trigger is null). */
    val uploadMetadata: MutableList<Pair<CaptureMethod?, CaptureTrigger?>> = mutableListOf()

    data class Upload(
        val verificationId: String,
        val kind: FileKind,
        val image: CapturedImage,
        /** The C40.3 fields of a selfie pose. */
        val capture: SelfieCaptureUpload? = null,
    )

    /** A selfie capture as the server keeps it (C40.5). */
    data class Capture(
        val id: String,
        val verificationId: String,
        val method: CaptureMethod,
        val nonce: String,
        val prompts: List<SelfiePose>,
        /** `initiated`, `submitted` or `errored` (superseded, canceled). */
        var status: String = "initiated",
        /** The server's clock passed its expiry. */
        var expired: Boolean = false,
    )

    data class Submit(val verificationId: String, val capture: FlowSubmitCapture?)

    var inquiry = FlowSessionInquiry(inquiryId, inquiryStatus)
    val verifications = verifications.toMutableList()
    val decisions = ArrayDeque<Decision>()
    val calls = mutableListOf<String>()
    val uploads = mutableListOf<Upload>()
    val captures = mutableListOf<Capture>()
    val submits = mutableListOf<Submit>()
    var consentRequest: Pair<List<String>, String>? = null

    /** The optional consent keys of the last consent call (C42.3). */
    var optionalConsent: List<String>? = null

    /** The consent evidence of the last acceptance (C200.1): what the coordinator's consent hook gave. */
    var consentEvidence: ConsentEvidence? = null

    /**
     * The order the server draws for the side poses of an active capture (C40.2 uses a CSPRNG).
     * It differs from the step's order, so following it shows the client uses the server's.
     */
    var sideOrder: List<SelfiePose> = listOf(SelfiePose.RIGHT, SelfiePose.LEFT)

    /** C40.2 `SELFIE_CAPTURE_LIMIT`. */
    var captureLimit = 10

    /** Polls that still see `submitted` before the next decision applies. */
    var undecidedPolls = 0

    /**
     * An inquiry status applied by a later session read, as the worker does in a second
     * transaction after it fails a verification: the first value is how many reads still see
     * the current status.
     */
    private var laterInquiryStatus: Pair<Int, InquiryStatus>? = null

    private val failures = mutableMapOf<String, ArrayDeque<Exception>>()
    private val lostAnswers = mutableMapOf<String, ArrayDeque<Exception>>()
    private var nextId = 0

    /** The next call named [call] throws [error] instead of running. */
    fun failNext(call: String, error: Exception) {
        failures.getOrPut(call) { ArrayDeque() }.addLast(error)
    }

    /**
     * The next call named [call] runs, as the server would, and then throws [error]: its answer
     * was lost on the way back (a timeout or a dropped connection). Creates and submits support it.
     */
    fun loseAnswerOfNext(call: String, error: Exception) {
        lostAnswers.getOrPut(call) { ArrayDeque() }.addLast(error)
    }

    fun decide(status: VerificationStatus, inquiryStatus: InquiryStatus, vararg hints: RetryHint) {
        decisions.addLast(Decision(status, inquiryStatus, hints.toList()))
    }

    /** After [reads] more session reads that see the current status, the inquiry becomes [status]. */
    fun changeInquiryAfter(reads: Int, status: InquiryStatus) {
        laterInquiryStatus = reads to status
    }

    /** The open capture's expiry passes on the server's clock. */
    fun expireOpenCapture() {
        captures.single { it.status == "initiated" }.expired = true
    }

    /** The uploads of the capture [id], in the order they arrived. */
    fun uploadsOf(id: String): List<Upload> = uploads.filter { it.capture?.captureId == id }

    private suspend fun record(call: String) {
        // Suspend like a real network call, so concurrent actions can interleave.
        yield()
        calls += call
        failures[call]?.removeFirstOrNull()?.let { throw it }
    }

    private fun answerLost(call: String) {
        lostAnswers[call]?.removeFirstOrNull()?.let { throw it }
    }

    override suspend fun getSession(): FlowSession {
        record("getSession")
        return sessionAnswer()
    }

    /**
     * The session as the server answers it, after the reads' side effects: a screen submission's
     * answer is one too, without counting as a session read (C148.5).
     */
    protected open fun sessionAnswer(): FlowSession {
        if (inquiry.status == InquiryStatus.CREATED) {
            inquiry = inquiry.copy(status = InquiryStatus.PENDING)
        }
        laterInquiryStatus?.let { (reads, status) ->
            if (reads > 0) {
                laterInquiryStatus = reads - 1 to status
            } else {
                inquiry = inquiry.copy(status = status)
                laterInquiryStatus = null
            }
        }
        serverCreated?.let { (reads, created) ->
            if (reads > 0) {
                serverCreated = reads - 1 to created
            } else {
                verifications += created
                serverCreated = null
            }
        }
        return FlowSession(
            inquiry,
            flow,
            verifications.toList(),
            consent,
            environment,
            faceTemplateRetentionDays,
            withdrawableShareConsents = withdrawableShareConsents,
        )
    }

    override suspend fun acceptConsent(
        textKeys: List<String>,
        locale: String,
        optionalTextKeys: List<String>,
        evidence: ConsentEvidence,
    ): FlowConsent {
        record("acceptConsent")
        consentRequest = textKeys to locale
        optionalConsent = optionalTextKeys
        consentEvidence = evidence
        return FlowConsent(NOW).also { consent = it }
    }

    override suspend fun createVerification(type: VerificationType, country: String?, idClass: String?): FlowVerification {
        record("createVerification:${type.apiValue}")
        // C52.2, C59.6: the server alone creates a silent AAMVA attempt.
        if (type == VerificationType.AAMVA && flow.steps.any { it is AamvaStep && it.source == AamvaSource.GOVERNMENT_ID }) {
            throw conflict("verification_created_by_server")
        }
        val created = verification(String.format("ver_01M5CK16P0D13FXHZSS4TCFB%02d", nextId++), type, VerificationStatus.INITIATED)
            .let { made -> guidanceFor(type)?.let { made.copy(attributes = made.attributes.copy(guidance = it)) } ?: made }
            // C52.2: a form type's view says whether its values arrived.
            .let { made -> if (type in INPUT_TYPES) made.copy(attributes = made.attributes.copy(inputsReceived = false)) else made }
        verifications += created
        answerLost("createVerification:${type.apiValue}")
        return created
    }

    override suspend fun createSelfieCapture(verificationId: String, method: CaptureMethod): FlowSelfieCapture {
        record("createSelfieCapture:${method.name.lowercase()}")
        check(consent != null) { "409: consent is required before a capture" }
        val verification = find(verificationId)
        check(verification.verificationType == VerificationType.SELFIE && verification.attributes.status == VerificationStatus.INITIATED) {
            "409: captures are for an initiated selfie verification"
        }
        if (method == CaptureMethod.UPLOAD) {
            check(environment?.kind == dev.openverify.sdk.model.EnvironmentKind.SANDBOX) { "403: uploads only in a sandbox" }
        }
        val existing = captures.filter { it.verificationId == verificationId }
        if (existing.size >= captureLimit) {
            // C40.2: the 11th create cancels the verification and its open capture.
            existing.filter { it.status == "initiated" }.forEach { it.status = "errored" }
            update(verificationId, VerificationStatus.CANCELED, emptyList())
            throw conflict("selfie_capture_limit")
        }
        // C40.2: a new capture supersedes the open one, whose files are deleted.
        existing.filter { it.status == "initiated" }.forEach { open ->
            open.status = "errored"
            uploads.removeAll { it.capture?.captureId == open.id }
        }
        val step = flow.steps.filterIsInstance<SelfieStep>().single()
        val sides = step.poses.filter { it != SelfiePose.CENTER }
        val prompts = listOf(SelfiePose.CENTER) + if (step.liveness == Liveness.ACTIVE) sideOrder.filter { it in sides } else sides
        val capture = Capture(
            id = String.format("self_01M5CK3190XEVBM5ZXA76E1J%02d", captures.size),
            verificationId = verificationId,
            method = method,
            nonce = String.format("SyntheticNonce%08d", captures.size),
            prompts = prompts,
        )
        captures += capture
        return FlowSelfieCapture(
            type = "selfie",
            id = capture.id,
            attributes = FlowSelfieCaptureAttributes(capture.prompts, "2026-10-20T12:03:30.000Z", capture.nonce, GUIDANCE),
        )
    }

    override suspend fun uploadFile(
        verificationId: String,
        kind: FileKind,
        image: CapturedImage,
        capture: SelfieCaptureUpload?,
        captureMethod: CaptureMethod?,
        captureTrigger: CaptureTrigger?,
    ): FileResource {
        record("upload:${kind.wireValue}")
        uploadMetadata += captureMethod to captureTrigger
        check(consent != null) { "409: consent is required before uploads" }
        if (find(verificationId).verificationType == VerificationType.SELFIE) {
            // C40.7: a Phase 4 selfie verification needs its capture fields.
            checkNotNull(capture) { "A selfie pose was sent without its capture" }
            val open = captures.firstOrNull { it.id == capture.captureId && it.verificationId == verificationId }
            if (open == null || open.nonce != capture.nonce || open.status != "initiated" || open.expired ||
                kind !in open.prompts.map(::kindOf)
            ) {
                throw conflict("selfie_capture_invalid")
            }
        } else {
            check(capture == null) { "Capture fields are refused for other kinds (C40.3)" }
        }
        uploads.removeAll { it.verificationId == verificationId && it.kind == kind && it.capture?.captureId == capture?.captureId }
        uploads += Upload(verificationId, kind, image, capture)
        return FileResource(
            type = "file",
            id = "file_01M5CK3288G5K9T8DC51K68D${uploads.size.toString().padStart(2, '0')}",
            attributes = FileAttributes(kind, image.mimeType, image.bytes.size.toLong(), NOW),
            relationships = FileRelationships(
                ToOneRelationship(ResourceIdentifier(find(verificationId).type, verificationId)),
            ),
        )
    }

    // Documents (C52.4, C52.6) -----------------------------------------------------------------

    /** Each document upload's verification and file, in the order they arrived. */
    val documents = mutableListOf<Pair<String, DocumentFile>>()

    override suspend fun uploadDocument(verificationId: String, document: DocumentFile, captureMethod: CaptureMethod?): FileResource {
        record("upload:document")
        uploadMetadata += captureMethod to null
        check(consent != null) { "409: consent is required before uploads" }
        val verification = find(verificationId)
        // C52.4: a document goes to an initiated document verification only.
        if (verification.verificationType != VerificationType.DOCUMENT || verification.attributes.status != VerificationStatus.INITIATED) {
            throw conflict("not_initiated")
        }
        // A new document replaces the earlier one, as the server replaces a kind's file.
        documents.removeAll { it.first == verificationId }
        documents += verificationId to document
        return FileResource(
            type = "file",
            id = "file_01M5CK3288G5K9T8DC51K68D${(uploads.size + documents.size).toString().padStart(2, '0')}",
            attributes = FileAttributes(FileKind.DOCUMENT, document.mimeType, document.bytes.size.toLong(), NOW),
            relationships = FileRelationships(ToOneRelationship(ResourceIdentifier(verification.type, verificationId))),
        )
    }

    override suspend fun submitVerification(verificationId: String, capture: FlowSubmitCapture?): FlowVerification {
        record("submit")
        val verification = find(verificationId)
        if (verification.verificationType == VerificationType.SELFIE) {
            checkNotNull(capture) { "409 selfie_capture_required: a selfie submit names its capture (C40.7)" }
            val named = captures.firstOrNull { it.id == capture.id && it.verificationId == verificationId && it.nonce == capture.nonce }
            when {
                // C40.4: the repeat of a submit that already moved the verification answers 202.
                named?.status == "submitted" && verification.attributes.status == VerificationStatus.SUBMITTED ->
                    return verification.also { answerLost("submit") }
                named == null || named.status != "initiated" || named.expired -> throw conflict("selfie_capture_invalid")
                named.prompts.any { pose -> uploadsOf(named.id).none { it.kind == kindOf(pose) } } ->
                    throw conflict("selfie_capture_incomplete")
            }
            checkNotNull(named).status = "submitted"
        } else if (verification.verificationType == VerificationType.DOCUMENT) {
            check(capture == null) { "A document submit names no capture" }
            // C52.6: a document is submitted with its file (422 without it).
            if (documents.none { it.first == verificationId } && uploads.none { it.verificationId == verificationId && it.kind == FileKind.DOCUMENT }) {
                throw FlowApiException.Rejected(422, Problem(title = "Unprocessable Content", status = 422, detail = "Missing required files: document."), null)
            }
        } else if (verification.verificationType in INPUT_TYPES) {
            check(capture == null) { "A form submit names no capture" }
            // C52.6: a form type needs its values (409 inputs_required).
            if (verification.attributes.inputsReceived != true) throw conflict("inputs_required")
        } else if (verification.verificationType in OTP_TYPES) {
            check(capture == null) { "A phone or email submit names no capture" }
            // C52.6: a confirmed code, or a limit refusal the server recorded (C55.6).
            if (verification.attributes.status == VerificationStatus.SUBMITTED) return verification
            if (verification.attributes.status != VerificationStatus.CONFIRMED && verificationId !in otpLimited) {
                throw conflict("otp_not_confirmed")
            }
        } else {
            check(capture == null) { "A government ID submit names no capture" }
        }
        submits += Submit(verificationId, capture)
        update(verificationId, VerificationStatus.SUBMITTED, emptyList())
        answerLost("submit")
        return find(verificationId)
    }

    override suspend fun getVerification(verificationId: String): FlowVerification {
        record("getVerification")
        if (find(verificationId).attributes.status == VerificationStatus.SUBMITTED) {
            if (undecidedPolls > 0) {
                undecidedPolls--
            } else {
                val decision = checkNotNull(decisions.removeFirstOrNull()) { "No decision scripted for $verificationId" }
                update(verificationId, decision.status, decision.retryHints)
                inquiry = inquiry.copy(status = decision.inquiryStatus)
            }
        }
        return find(verificationId)
    }

    // One-time codes (C55) ----------------------------------------------------------------

    /** The open code of each phone or email verification, as the server keeps it. */
    data class OpenCode(val destination: OtpDestination, val code: String, var failed: Int = 0)

    val openCodes = mutableMapOf<String, OpenCode>()

    /** Accepted sends per verification (C55.6). */
    val otpSends = mutableMapOf<String, Int>()

    /** Every destination a send asked for, in order. */
    val otpDestinations = mutableListOf<OtpDestination>()

    /** The code the next send opens. */
    var nextOtpCode = "123456"

    /** Whether a send's answer describes the open code in its guidance (C52.2), as the built server does. */
    var describesCodes = true

    /** Verifications whose limit refusal the server recorded, so a submit may send them to review (C55.6). */
    val otpLimited = mutableSetOf<String>()

    /** The next call named by a key submits its verification and answers 409 with the code (C55.5, C55.6). */
    private val movesOn = mutableMapOf<String, String>()

    fun submitOnNext(call: String, code: String) {
        movesOn[call] = code
    }

    private fun movedOn(call: String, verificationId: String) {
        movesOn.remove(call)?.let { code ->
            update(verificationId, VerificationStatus.SUBMITTED, emptyList())
            throw conflict(code)
        }
    }

    override suspend fun sendOtp(verificationId: String, destination: OtpDestination): FlowVerification {
        record("sendOtp")
        check(consent != null) { "409: consent is required before a send" }
        val verification = find(verificationId)
        check(verification.verificationType in OTP_TYPES) { "422: not a phone or email verification" }
        if (verification.attributes.status == VerificationStatus.CONFIRMED) throw conflict("otp_already_confirmed")
        check(verification.attributes.status == VerificationStatus.INITIATED) { "409: the verification is not initiated" }
        movedOn("sendOtp", verificationId)
        otpDestinations += destination
        val sends = (otpSends[verificationId] ?: 0) + 1
        otpSends[verificationId] = sends
        openCodes[verificationId] = OpenCode(destination, nextOtpCode)
        if (describesCodes) updateGuidance(verificationId, otpGuidance(verification.verificationType, OTP_MAX_SENDS - sends, OTP_MAX_ATTEMPTS))
        return find(verificationId)
    }

    override suspend fun confirmOtp(verificationId: String, code: String): FlowVerification {
        record("confirmOtp")
        val verification = find(verificationId)
        check(verification.verificationType in OTP_TYPES) { "422: not a phone or email verification" }
        if (verification.attributes.status == VerificationStatus.CONFIRMED) throw conflict("otp_already_confirmed")
        movedOn("confirmOtp", verificationId)
        val open = openCodes[verificationId] ?: throw conflict("otp_not_sent")
        if (code != open.code) {
            open.failed++
            throw FlowApiException.Rejected(
                422,
                Problem(title = "Unprocessable Content", status = 422, code = "otp_incorrect", attemptsRemaining = OTP_MAX_ATTEMPTS - open.failed),
                null,
            )
        }
        openCodes.remove(verificationId)
        update(verificationId, VerificationStatus.CONFIRMED, emptyList())
        return find(verificationId)
    }

    /** The phone or email guidance with an open code, as the C52.2 server builds it after a send. */
    fun otpGuidance(type: VerificationType, sendsRemaining: Int, attemptsRemaining: Int): JsonObject = buildJsonObject {
        when (type) {
            VerificationType.PHONE_NUMBER -> {
                val step = flow.steps.filterIsInstance<PhoneOtpStep>().single()
                putJsonArray("allowed-countries") { step.allowedCountries.forEach { add(it) } }
                put("code-length", step.codeLength ?: 6)
            }
            else -> put("code-length", flow.steps.filterIsInstance<EmailOtpStep>().single().codeLength ?: 6)
        }
        putJsonObject("otp") {
            put("masked-destination", MASKED_DESTINATION)
            put("expires-at", CODE_EXPIRES_AT)
            if (sendsRemaining > 0) put("resend-available-at", RESEND_AVAILABLE_AT) else put("resend-available-at", JsonNull)
            put("sends-remaining", sendsRemaining)
            put("attempts-remaining", attemptsRemaining)
        }
    }

    private fun updateGuidance(id: String, guidance: JsonObject) {
        val index = verifications.indexOfFirst { it.id == id }
        val current = verifications[index]
        verifications[index] = current.copy(attributes = current.attributes.copy(guidance = guidance))
    }

    // Guidance (C52.2) -------------------------------------------------------------------------

    /**
     * Each type's guidance in place of the one derived from its step; a key mapped to `null` gives
     * none. The derived one: a document's classes from its step, its window 90 days and its pages
     * 50, every media type; a business's people from its step and [businessRequiredInputs].
     */
    val guidanceOf = mutableMapOf<VerificationType, JsonObject?>()

    /** C52.2, C52.3: the business inputs every configured match group names. */
    var businessRequiredInputs: List<String> = listOf("business-name")

    private fun guidanceFor(type: VerificationType): JsonObject? {
        if (type in guidanceOf) return guidanceOf[type]
        return when (type) {
            VerificationType.DOCUMENT -> buildJsonObject {
                putJsonArray("accepted-types") {
                    flow.steps.filterIsInstance<DocumentStep>().first().documentTypes.forEach {
                        add(OpenVerifyJson.encodeToJsonElement(DocumentClass.serializer(), it))
                    }
                }
                put("max-age-days", 90)
                put("max-pages", 50)
                putJsonArray("accepted-mime-types") { DocumentFile.MIME_TYPES.forEach { add(it) } }
            }
            VerificationType.DATABASE_BUSINESS -> buildJsonObject {
                put("collect-associated-persons", flow.steps.filterIsInstance<DatabaseBusinessStep>().first().collectAssociatedPersons ?: false)
                putJsonArray("required-inputs") { businessRequiredInputs.forEach { add(it) } }
            }
            VerificationType.BUSINESS_WEBSITE -> JsonObject(emptyMap())
            else -> null
        }
    }

    // Entered values (C52.3) and the silent AAMVA step (C59.6) ---------------------------------

    /** The values each verification holds; a new body replaces the earlier one. */
    val entered = mutableMapOf<String, VerificationInputs>()

    /** A verification the worker creates itself, after some more session reads (the silent AAMVA step). */
    private var serverCreated: Pair<Int, FlowVerification>? = null

    fun createAfter(reads: Int, verification: FlowVerification) {
        serverCreated = reads to verification
    }

    override suspend fun enterInputs(verificationId: String, inputs: VerificationInputs): FlowVerification {
        record("enterInputs")
        check(consent != null) { "409: consent is required before values" }
        val verification = find(verificationId)
        check(verification.verificationType in INPUT_TYPES) { "422: not a form verification" }
        check(verification.attributes.status == VerificationStatus.INITIATED) { "409: the verification is not initiated" }
        entered[verificationId] = inputs
        val index = verifications.indexOfFirst { it.id == verificationId }
        verifications[index] = verification.copy(attributes = verification.attributes.copy(inputsReceived = true))
        return find(verificationId)
    }

    // Wallet challenges (C57.2, C57.3) ---------------------------------------------------------

    /** C57.2 `CRYPTO_CHALLENGE_LIMIT`: the most challenges a verification may create. */
    var challengeLimit = 10

    /** Each challenge request's verification, chain and address, in order. */
    val challengeRequests = mutableListOf<Triple<String, String, String>>()

    /** The open challenge of each verification. */
    val openChallenges = mutableMapOf<String, FlowCryptoChallenge>()

    /** What each wallet submit carried. */
    val cryptoSubmits = mutableListOf<FlowCryptoSubmit>()

    override suspend fun createCryptoChallenge(verificationId: String, chainId: String, walletAddress: String): FlowCryptoChallenge {
        record("createCryptoChallenge")
        check(consent != null) { "409: consent is required before a challenge" }
        val verification = find(verificationId)
        check(verification.verificationType == VerificationType.CRYPTO_WALLET) { "422: not a wallet verification" }
        check(verification.attributes.status == VerificationStatus.INITIATED) { "409: the verification is not initiated" }
        if (challengeRequests.count { it.first == verificationId } >= challengeLimit) {
            // C57.2: the 11th challenge cancels the verification, a retryable attempt.
            openChallenges.remove(verificationId)
            update(verificationId, VerificationStatus.CANCELED, emptyList())
            throw conflict("crypto_challenge_invalid")
        }
        challengeRequests += Triple(verificationId, chainId, walletAddress)
        val challenge = FlowCryptoChallenge(
            String.format("cwc_01M5CK16P0D13FXHZSS4TCFB%02d", challengeRequests.size),
            "openverify.test wants you to sign in with your account:\n$walletAddress\n\nNonce: ${"n".repeat(16)}",
            CHALLENGE_EXPIRES_AT,
        )
        openChallenges[verificationId] = challenge
        return challenge
    }

    override suspend fun submitCryptoSignature(verificationId: String, crypto: FlowCryptoSubmit): FlowVerification {
        record("submitCryptoSignature")
        val verification = find(verificationId)
        check(verification.verificationType == VerificationType.CRYPTO_WALLET) { "422: not a wallet verification" }
        if (verification.attributes.status == VerificationStatus.SUBMITTED) return verification
        // C57.3: one 409 for an unknown, used, superseded or expired challenge.
        if (openChallenges[verificationId]?.id != crypto.challengeId) throw conflict("crypto_challenge_invalid")
        openChallenges.remove(verificationId)
        cryptoSubmits += crypto
        update(verificationId, VerificationStatus.SUBMITTED, emptyList())
        return find(verificationId)
    }

    // Phase 9's screen, extension and theme-asset routes (C148.5, C171.4, C160.6) -------------

    /** A screen submission: the step, its values and the pressed button (C148.5). */
    data class ScreenSubmit(val stepId: String, val values: Map<String, FlowValue>, val button: String?)

    val screenSubmits = mutableListOf<ScreenSubmit>()

    /** The theme assets the server holds, by id (C160.6). */
    val themeAssets = mutableMapOf<String, ByteArray>()

    override suspend fun submitScreen(stepId: String, values: Map<String, FlowValue>, button: String?): FlowSession {
        record("submitScreen")
        screenSubmits += ScreenSubmit(stepId, values, button)
        return sessionAnswer()
    }

    override suspend fun extendSelfieCapture(captureId: String): FlowSelfieCaptureExtension {
        record("extendSelfieCapture")
        val capture = captures.firstOrNull { it.id == captureId } ?: throw conflict("selfie_capture_invalid")
        // C171.4: an extension after the capture's submit is refused.
        if (capture.status != "initiated") throw conflict("selfie_capture_not_extendable")
        capture.expired = false
        return FlowSelfieCaptureExtension(capture.id, "2026-10-20T12:06:30.000Z")
    }

    /** C211.3 (Workflow 10B): the challenges made and the tokens received, in order (synthetic only). */
    val integrityChallenges: MutableList<FlowIntegrityChallenge> = mutableListOf()
    val integrityTokens: MutableList<Pair<String, String>> = mutableListOf()

    override suspend fun createIntegrityChallenge(): FlowIntegrityChallenge {
        record("createIntegrityChallenge")
        return FlowIntegrityChallenge("ich_01M5CK3190XEVBM5ZXA76E1JS${integrityChallenges.size}", "syntheticAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA", NOW)
            .also { integrityChallenges += it }
    }

    override suspend fun sendIntegrityToken(challengeId: String, token: String) {
        record("sendIntegrityToken")
        integrityTokens += challengeId to token
    }

    /** C207.1 (Workflow 10C): the chip challenges made, the chip files and submits received and the client-unable reports, in order (synthetic only). */
    val chipChallenges: MutableList<FlowChipChallenge> = mutableListOf()
    val chipFiles: MutableList<Pair<FileKind, Int>> = mutableListOf()
    val chipSubmits: MutableList<FlowChipSubmit> = mutableListOf()
    val clientUnableReports: MutableList<Pair<String, ClientUnableReason>> = mutableListOf()
    val sandboxChipRequests: MutableList<Pair<String, SandboxChipScenario>> = mutableListOf()

    /** What [requestSandboxChip] answers: synthetic placeholders, never a chip's bytes. */
    var sandboxChip: FlowSandboxChip = FlowSandboxChip(
        files = listOf(FlowSandboxChip.File(FileKind.CHIP_SOD, "c3ludGhldGlj"), FlowSandboxChip.File(FileKind.CHIP_DG1, "c3ludGhldGlj")),
        dg2Attached = true,
    )

    override suspend fun createChipChallenge(verificationId: String): FlowChipChallenge {
        record("createChipChallenge")
        return FlowChipChallenge("chc_01M5CK3190XEVBM5ZXA76E1JS${chipChallenges.size % 10}", "0123456789abcde${chipChallenges.size % 10}", NOW)
            .also { chipChallenges += it }
    }

    override suspend fun uploadChipFile(verificationId: String, kind: FileKind, bytes: ByteArray): FileResource {
        record("uploadChipFile")
        chipFiles += kind to bytes.size
        return FileResource(
            type = "file",
            id = "file_01M5CK3288G5K9T8DC51K68C${chipFiles.size.toString().padStart(2, '0')}",
            attributes = FileAttributes(kind, "application/octet-stream", bytes.size.toLong(), NOW),
            relationships = FileRelationships(ToOneRelationship(ResourceIdentifier(find(verificationId).type, verificationId))),
        )
    }

    override suspend fun submitChip(verificationId: String, chip: FlowChipSubmit): FlowVerification {
        record("submitChip")
        // Recorded only once accepted, as the server stores a submit it took.
        return submitVerification(verificationId, null).also { chipSubmits += chip }
    }

    override suspend fun reportClientUnable(verificationId: String, reason: ClientUnableReason): FlowClientUnable {
        record("reportClientUnable")
        clientUnableReports += verificationId to reason
        // C207.9: the server ends the attempt `canceled`, so the step's attempts are used up.
        update(verificationId, VerificationStatus.CANCELED, emptyList())
        return FlowClientUnable(verificationId, VerificationStatus.CANCELED)
    }

    override suspend fun requestSandboxChip(verificationId: String, challengeId: String, scenario: SandboxChipScenario): FlowSandboxChip {
        record("requestSandboxChip")
        sandboxChipRequests += challengeId to scenario
        return sandboxChip
    }

    /** C238.4, C237.6 (Workflow 11A, clients-connect): one share-consent exit as the server received it. */
    data class ShareConsentExit(
        val stepId: String,
        val exit: String,
        val textSha256: String? = null,
        val biometricTextSha256: String? = null,
        val explicitBiometric: Boolean? = null,
    )

    /** The share-consent exits received, in order (synthetic only). */
    val shareConsentExits: MutableList<ShareConsentExit> = mutableListOf()

    /** The session's `withdrawable-share-consents` (C237.6), served as they are; a withdrawal removes its entry. */
    var withdrawableShareConsents: List<FlowWithdrawableShareConsent>? = null

    /** What the "server" does on an exit it took, before it answers the session (a test moves the position here). */
    var onShareConsentExit: (ShareConsentExit) -> Unit = {}

    private fun shareConsentAnswer(exit: ShareConsentExit): FlowSession {
        shareConsentExits += exit
        if (exit.exit == "withdraw") {
            withdrawableShareConsents = withdrawableShareConsents?.filter { it.stepId != exit.stepId }?.takeIf { it.isNotEmpty() }
        }
        onShareConsentExit(exit)
        return sessionAnswer()
    }

    override suspend fun acceptShareConsent(stepId: String, textSha256: String, biometricTextSha256: String?, explicitBiometric: Boolean): FlowSession {
        record("acceptShareConsent")
        return shareConsentAnswer(ShareConsentExit(stepId, "accept", textSha256, biometricTextSha256, explicitBiometric))
    }

    override suspend fun declineShareConsent(stepId: String): FlowSession {
        record("declineShareConsent")
        return shareConsentAnswer(ShareConsentExit(stepId, "decline"))
    }

    override suspend fun withdrawShareConsent(stepId: String): FlowSession {
        record("withdrawShareConsent")
        return shareConsentAnswer(ShareConsentExit(stepId, "withdraw"))
    }

    override suspend fun fetchThemeAsset(assetId: String): ByteArray {
        record("fetchThemeAsset")
        return themeAssets[assetId] ?: throw FlowApiException.NotFound(Problem(title = "Not Found", status = 404), null)
    }

    private fun find(id: String): FlowVerification = verifications.single { it.id == id }

    private fun update(id: String, status: VerificationStatus, hints: List<RetryHint>) {
        val index = verifications.indexOfFirst { it.id == id }
        val current = verifications[index]
        verifications[index] = current.copy(attributes = current.attributes.copy(status = status, retryHints = hints))
    }

    companion object {
        const val INQUIRY_ID = "inq_01M5CJXHG07XPHF3HRM6NREDH7"
        const val NOW = "2026-10-20T12:00:30.000Z"

        /** `face-template-retention-days` of the golden session (`api/flow-session.json`). */
        const val RETENTION_DAYS = 365

        val GUIDANCE = SelfieCaptureGuidance(maxCenterYawRatio = 0.021, minSideYawRatioChange = 0.077, holdMs = 500)

        /** The default template flow (C7, C45.1): three poses with active liveness, from the golden fixture. */
        val DEFAULT_FLOW: Flow = OpenVerifyJson.decodeFromString<FlowSession>(Fixtures.read("api/flow-session.json")).flow

        /** The file kind a pose is uploaded as (C40.3 `SELFIE_POSE_FILE_KINDS`). */
        fun kindOf(pose: SelfiePose): FileKind = when (pose) {
            SelfiePose.CENTER -> FileKind.SELFIE_CENTER
            SelfiePose.LEFT -> FileKind.SELFIE_LEFT
            SelfiePose.RIGHT -> FileKind.SELFIE_RIGHT
        }

        /** The 409 the flow API answers with a C40 problem code. */
        fun conflict(code: String) = FlowApiException.Conflict(Problem(title = "Conflict", status = 409, code = code), null)

        val OTP_TYPES = setOf(VerificationType.PHONE_NUMBER, VerificationType.EMAIL_ADDRESS)

        /** The types whose step collects entered values (C52.3 `INPUT_VERIFICATION_TYPES`). */
        val INPUT_TYPES = setOf(
            VerificationType.DATABASE,
            VerificationType.AAMVA,
            VerificationType.DATABASE_BUSINESS,
            VerificationType.BUSINESS_WEBSITE,
        )

        /** C55.5, C55.6 (contracts `OTP_MAX_SENDS`, `OTP_MAX_ATTEMPTS_PER_CODE`). */
        const val OTP_MAX_SENDS = 5
        const val OTP_MAX_ATTEMPTS = 5

        /** The fake server's open code: the destination as it shows it, its expiry and the next send. */
        const val MASKED_DESTINATION = "•••• ••00"
        const val CODE_EXPIRES_AT = "2026-10-20T12:10:30.000Z"
        const val RESEND_AVAILABLE_AT = "2026-10-20T12:01:00.000Z"

        /** The fake server's wallet challenges expire then (C57.2, ten minutes). */
        const val CHALLENGE_EXPIRES_AT = "2026-10-20T12:10:30.000Z"

        fun verification(
            id: String,
            type: VerificationType,
            status: VerificationStatus,
            vararg hints: RetryHint,
        ) = FlowVerification(
            type = type.resourceType,
            id = id,
            attributes = FlowVerificationAttributes(status, hints.toList(), NOW, NOW),
        )
    }
}
