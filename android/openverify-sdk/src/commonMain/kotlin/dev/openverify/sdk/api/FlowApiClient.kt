package dev.openverify.sdk.api

import dev.openverify.sdk.consent.ConsentEvidence

import dev.openverify.sdk.camera.CapturedImage
import dev.openverify.sdk.signals.IntegrityRequests
import dev.openverify.sdk.nfc.NfcFlowRequests
import dev.openverify.sdk.flow.ShareConsentRequests
import dev.openverify.sdk.model.ClientUnableReason
import dev.openverify.sdk.model.FlowChipChallenge
import dev.openverify.sdk.model.FlowChipSubmit
import dev.openverify.sdk.model.FlowClientUnable
import dev.openverify.sdk.model.FlowSandboxChip
import dev.openverify.sdk.model.SandboxChipScenario
import dev.openverify.sdk.model.FlowIntegrityChallenge
import dev.openverify.sdk.model.wireValue
import dev.openverify.sdk.model.CaptureTrigger
import dev.openverify.sdk.model.AamvaInputs
import dev.openverify.sdk.model.BusinessWebsiteInputs
import dev.openverify.sdk.model.CRYPTO_CHALLENGE_ID
import dev.openverify.sdk.model.CaptureMethod
import dev.openverify.sdk.model.CryptoChains
import dev.openverify.sdk.model.CryptoLimits
import dev.openverify.sdk.model.DatabaseBusinessInputs
import dev.openverify.sdk.model.DatabaseInputs
import dev.openverify.sdk.model.DocumentFile
import dev.openverify.sdk.model.FileDocument
import dev.openverify.sdk.model.FileKind
import dev.openverify.sdk.model.FileResource
import dev.openverify.sdk.model.FlowConsent
import dev.openverify.sdk.model.FlowCryptoChallenge
import dev.openverify.sdk.model.FlowCryptoSubmit
import dev.openverify.sdk.model.FlowCryptoSubmitBody
import dev.openverify.sdk.model.FlowSelfieCapture
import dev.openverify.sdk.model.FlowSelfieCaptureDocument
import dev.openverify.sdk.model.FlowSession
import dev.openverify.sdk.model.FlowSignals
import dev.openverify.sdk.model.FlowSubmitCapture
import dev.openverify.sdk.model.FlowSubmitVerificationBody
import dev.openverify.sdk.model.FlowValue
import dev.openverify.sdk.model.FlowVerification
import dev.openverify.sdk.model.FlowVerificationDocument
import dev.openverify.sdk.model.InputRules
import dev.openverify.sdk.model.OpenVerifyJson
import dev.openverify.sdk.model.OtpDestination
import dev.openverify.sdk.model.OtpLimits
import dev.openverify.sdk.model.SelfieCaptureUpload
import dev.openverify.sdk.model.VerificationInputs
import dev.openverify.sdk.model.VerificationType
import dev.openverify.sdk.signals.AndroidSignalContract
import io.ktor.client.HttpClient
import io.ktor.client.request.forms.MultiPartFormDataContent
import io.ktor.http.Headers
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpMethod
import io.ktor.http.content.OutgoingContent
import io.ktor.http.content.PartData
import io.ktor.http.content.TextContent
import kotlinx.io.Buffer
import kotlinx.serialization.DeserializationStrategy
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.descriptors.SerialDescriptor
import kotlinx.serialization.descriptors.buildClassSerialDescriptor
import kotlinx.serialization.encoding.Decoder
import kotlinx.serialization.json.Json

/**
 * [FlowApi] over HTTP. It sends `Authorization: Bearer <session token>` and maps error
 * responses, including `application/problem+json` bodies, to [FlowApiException].
 *
 * Redirects are never followed, so the token is only ever sent to [apiBaseUrl]'s origin. On
 * Android the calls go through one shared OkHttp client; the `FlowApiClient` function that
 * takes an `OkHttpClient` uses yours instead.
 *
 * @param apiBaseUrl origin of the OpenVerify API, optionally with a path prefix, such as
 *   `https://verify.example.com`. It must use https, except for `localhost`, `127.0.0.1`,
 *   `::1` and the Android emulator's host alias `10.0.2.2`. An internationalized domain name
 *   is written in its `xn--` form.
 * @param sessionToken the inquiry session token (`ovs_...`). Never pass an API key.
 * @throws IllegalArgumentException if either argument is malformed. Messages never contain
 *   the token.
 */
internal class FlowApiClient internal constructor(
    apiBaseUrl: String,
    sessionToken: String,
    httpClient: HttpClient,
    json: Json = OpenVerifyJson,
) : FlowApi {

    /** A client on the SDK's shared HTTP client. */
    public constructor(apiBaseUrl: String, sessionToken: String, json: Json = OpenVerifyJson) :
        this(apiBaseUrl, sessionToken, defaultFlowHttpClient(), json)

    private val apiBase: ApiBaseUrl = SessionCredentials.parseApiBaseUrl(apiBaseUrl)
    private val authorization: String = SessionCredentials.requireSessionToken(sessionToken).let { "Bearer $sessionToken" }
    private val http = FlowHttp(httpClient, json)

    override suspend fun getSession(): FlowSession = get(url("session"), FlowSession.serializer())

    override suspend fun acceptConsent(
        textKeys: List<String>,
        locale: String,
        optionalTextKeys: List<String>,
        evidence: ConsentEvidence,
    ): FlowConsent {
        // Left out when none was ticked, which every server reads as none (C42.3).
        // C200.1: the evidence's three members are left out when absent, as the body was before them.
        val body = ConsentRequest(
            true,
            textKeys,
            optionalTextKeys.takeIf { it.isNotEmpty() },
            locale,
            evidence.textSha256,
            evidence.copySource,
            evidence.catalogVersion,
        )
        return post(url("consent"), http.jsonBody(ConsentRequest.serializer(), body), ConsentResponse.serializer()).consent
    }

    override suspend fun sendSignals(signals: FlowSignals) {
        val problems = AndroidSignalContract.problems(signals)
        // Names the members only, never their values: the ANDROID_ID is personal data (C91.6).
        require(problems.isEmpty()) { "Signal members outside their contract (C94.2): $problems" }
        post(url("signals"), http.jsonBody(FlowSignals.serializer(), signals), NoContent)
    }

    override suspend fun submitScreen(stepId: String, values: Map<String, FlowValue>, button: String?): FlowSession {
        // Validated rather than only encoded: the step id is a path segment, and `..` would be a dot segment.
        require(STEP_ID.matches(stepId)) { "Not a step id (C147.2)" }
        require(button == null || BUTTON_KEY.matches(button)) { "Not a button key (C148.5)" }
        // Names neither the keys nor the values: both can describe the person (C174.5).
        require(values.keys.all(FIELD_KEY::matches)) { "A value's key is not a field key (C148.5)" }
        require(values.values.none { it is FlowValue.Set }) { "A value the server holds as set is never sent back (C151.5)" }
        val url = apiBase.resolve("api", "v1", "flow", "screens", stepId, "submit")
        return post(url, http.jsonBody(ScreenSubmission.serializer(), ScreenSubmission(values, button)), FlowSession.serializer())
    }

    override suspend fun extendSelfieCapture(captureId: String): FlowSelfieCaptureExtension {
        require(CAPTURE_ID.matches(captureId)) { "Not a selfie capture ID" }
        val url = apiBase.resolve("api", "v1", "flow", "selfie-captures", captureId, "extend")
        // No body: the route reads only its path (C171.4).
        val extended = http.send(HttpMethod.Post, url, SelfieCaptureExtensionDocument.serializer(), authorization).data
        return FlowSelfieCaptureExtension(extended.id, extended.attributes.expiresAt)
    }

    // C238.4, C237.6 (Workflow 11A): the share-consent exits' encoding is clients-connect's, in
    // flow/ShareConsent.kt, sent over this client's HTTP client, API base and authorization.
    override suspend fun acceptShareConsent(stepId: String, textSha256: String, biometricTextSha256: String?, explicitBiometric: Boolean): FlowSession =
        ShareConsentRequests.accept(http, apiBase, authorization, stepId, textSha256, biometricTextSha256, explicitBiometric)

    override suspend fun declineShareConsent(stepId: String): FlowSession = ShareConsentRequests.decline(http, apiBase, authorization, stepId)

    override suspend fun withdrawShareConsent(stepId: String): FlowSession = ShareConsentRequests.withdraw(http, apiBase, authorization, stepId)

    // C211.3 (Workflow 10B): the integrity routes' encoding is device-integrity-android's, in
    // signals/IntegrityRequests.kt, sent over this client's HTTP client, API base and authorization.
    override suspend fun createIntegrityChallenge(): FlowIntegrityChallenge = IntegrityRequests.challenge(http, apiBase, authorization)

    override suspend fun sendIntegrityToken(challengeId: String, token: String): Unit =
        IntegrityRequests.token(http, apiBase, authorization, challengeId, token)

    // C207.1 (Workflow 10C): the NFC routes' encoding is nfc-sdk's, in nfc/NfcFlowRequests.kt, sent over
    // this client's HTTP client, API base and authorization (the 10C decisions, item 10).
    override suspend fun createChipChallenge(verificationId: String): FlowChipChallenge =
        NfcFlowRequests.chipChallenge(http, apiBase, authorization, verificationId)

    override suspend fun uploadChipFile(verificationId: String, kind: FileKind, bytes: ByteArray): FileResource =
        NfcFlowRequests.chipFile(http, apiBase, authorization, verificationId, kind, bytes)

    override suspend fun submitChip(verificationId: String, chip: FlowChipSubmit): FlowVerification =
        NfcFlowRequests.chipSubmit(http, apiBase, authorization, verificationId, chip)

    override suspend fun reportClientUnable(verificationId: String, reason: ClientUnableReason): FlowClientUnable =
        NfcFlowRequests.clientUnable(http, apiBase, authorization, verificationId, reason)

    override suspend fun requestSandboxChip(verificationId: String, challengeId: String, scenario: SandboxChipScenario): FlowSandboxChip =
        NfcFlowRequests.sandboxChip(http, apiBase, authorization, verificationId, challengeId, scenario)

    override suspend fun fetchThemeAsset(assetId: String): ByteArray {
        require(THEME_ASSET_ID.matches(assetId)) { "Not a theme asset ID" }
        return http.bytes(apiBase.resolve("api", "v1", "flow", "theme-assets", assetId), authorization, THEME_ASSET_MAX_BYTES)
    }

    override suspend fun createVerification(type: VerificationType, country: String?, idClass: String?): FlowVerification {
        require(type != VerificationType.UNKNOWN) { "VerificationType.UNKNOWN is a placeholder and cannot be created" }
        val body = CreateVerificationRequest(type.apiValue, country, idClass)
        return post(url("verifications"), http.jsonBody(CreateVerificationRequest.serializer(), body), FlowVerificationDocument.serializer()).data
    }

    override suspend fun createSelfieCapture(verificationId: String, method: CaptureMethod): FlowSelfieCapture =
        // A capture that breaks the contract (its id, nonce or prompts) fails to decode, so it is
        // an InvalidResponse like any other unexpected body.
        post(
            url("verifications", verificationId, "selfies"),
            http.jsonBody(CreateSelfieCaptureRequest.serializer(), CreateSelfieCaptureRequest(method)),
            FlowSelfieCaptureDocument.serializer(),
        ).data

    override suspend fun uploadFile(
        verificationId: String,
        kind: FileKind,
        image: CapturedImage,
        capture: SelfieCaptureUpload?,
        captureMethod: CaptureMethod?,
        captureTrigger: CaptureTrigger?,
    ): FileResource {
        require(kind != FileKind.UNKNOWN) { "FileKind.UNKNOWN is a placeholder and cannot be sent" }
        val parts = buildList {
            // `kind` and the capture fields go first so a streaming server knows them before the
            // file arrives.
            add(formField(KIND_FIELD, kind.wireValue))
            if (capture != null) {
                add(formField(CAPTURE_ID_FIELD, capture.captureId))
                add(formField(NONCE_FIELD, capture.nonce))
                add(formField(CLIENT_ELAPSED_MS_FIELD, capture.clientElapsedMs.toString()))
            }
            // C206 (Workflow 10B): client-reported, each left out when null.
            captureMethod?.let { add(formField(CAPTURE_METHOD_FIELD, it.wireValue())) }
            captureTrigger?.let { add(formField(CAPTURE_TRIGGER_FIELD, it.wireValue)) }
            // A fixed name: the user's file names can contain personal data.
            add(filePart("${kind.wireValue}.${EXTENSIONS.getValue(image.mimeType)}", image.bytes, image.mimeType))
        }
        return post(url("verifications", verificationId, "files"), MultiPartFormDataContent(parts), FileDocument.serializer()).data
    }

    override suspend fun uploadDocument(verificationId: String, document: DocumentFile, captureMethod: CaptureMethod?): FileResource {
        val url = url("verifications", verificationId, "files")
        val parts = listOfNotNull(
            formField(KIND_FIELD, FileKind.DOCUMENT.wireValue),
            captureMethod?.let { formField(CAPTURE_METHOD_FIELD, it.wireValue()) },
            // A fixed name: the user's file names can contain personal data.
            filePart("${FileKind.DOCUMENT.wireValue}.${EXTENSIONS.getValue(document.mimeType)}", document.bytes, document.mimeType),
        )
        return post(url, MultiPartFormDataContent(parts), FileDocument.serializer()).data
    }

    override suspend fun submitVerification(verificationId: String, capture: FlowSubmitCapture?): FlowVerification {
        val body = if (capture == null) {
            TextContent("{}", FlowHttp.JSON)
        } else {
            http.jsonBody(FlowSubmitVerificationBody.serializer(), FlowSubmitVerificationBody(capture))
        }
        return post(url("verifications", verificationId, "submit"), body, FlowVerificationDocument.serializer()).data
    }

    override suspend fun getVerification(verificationId: String): FlowVerification =
        get(url("verifications", verificationId), FlowVerificationDocument.serializer()).data

    override suspend fun sendOtp(verificationId: String, destination: OtpDestination): FlowVerification {
        val url = url("verifications", verificationId, "otp")
        // C55 `flowOtpSendBodySchema` caps only the input: the server validates the destination
        // (C55.8). The messages never repeat the value, which is personal data.
        val body = when (destination) {
            is OtpDestination.Phone -> {
                require(destination.phoneNumber.length in 1..OTP_PHONE_MAX_LENGTH) { "A phone number is 1 to 32 characters" }
                http.jsonBody(OtpDestination.Phone.serializer(), destination)
            }
            is OtpDestination.Email -> {
                require(destination.emailAddress.length in OTP_EMAIL_LENGTHS) { "An email address is 3 to 254 characters" }
                http.jsonBody(OtpDestination.Email.serializer(), destination)
            }
        }
        return post(url, body, FlowVerificationDocument.serializer()).data
    }

    override suspend fun confirmOtp(verificationId: String, code: String): FlowVerification {
        val url = url("verifications", verificationId, "otp", "confirm")
        require(OTP_CODE.matches(code)) { "A code is six to ten digits" }
        return post(url, http.jsonBody(ConfirmOtpRequest.serializer(), ConfirmOtpRequest(code)), FlowVerificationDocument.serializer()).data
    }

    override suspend fun enterInputs(verificationId: String, inputs: VerificationInputs): FlowVerification {
        val url = url("verifications", verificationId, "inputs")
        val problems = InputRules.problems(inputs)
        // Names the members only, never their values.
        require(problems.isEmpty()) { "Values outside their contract (C52.3): ${problems.keys.map { it.wireName }}" }
        if (inputs is DatabaseBusinessInputs) {
            val persons = inputs.associatedPersons.orEmpty()
            require(persons.size <= DatabaseBusinessInputs.MAX_ASSOCIATED_PERSONS) { "At most 10 associated persons (C52.3)" }
            val personProblems = InputRules.personProblems(inputs)
            require(personProblems.isEmpty()) {
                "Associated persons outside their contract (C52.3): ${personProblems.keys.map { "${it.index}/${it.field.wireName}" }}"
            }
        }
        val body = when (inputs) {
            is DatabaseInputs -> http.jsonBody(DatabaseInputs.serializer(), inputs)
            is AamvaInputs -> http.jsonBody(AamvaInputs.serializer(), inputs)
            is DatabaseBusinessInputs -> http.jsonBody(DatabaseBusinessInputs.serializer(), inputs)
            is BusinessWebsiteInputs -> http.jsonBody(BusinessWebsiteInputs.serializer(), inputs)
        }
        return post(url, body, FlowVerificationDocument.serializer()).data
    }

    override suspend fun createCryptoChallenge(verificationId: String, chainId: String, walletAddress: String): FlowCryptoChallenge {
        val url = url("verifications", verificationId, "crypto-challenges")
        require(CryptoChains.isChainId(chainId)) { "Not a chain id the contracts know (C57.1)" }
        require(walletAddress.length in 1..CryptoLimits.ADDRESS_MAX_LENGTH) { "A wallet address is 1 to 128 characters" }
        val body = http.jsonBody(CreateCryptoChallengeRequest.serializer(), CreateCryptoChallengeRequest(chainId, walletAddress))
        // C57.2: the 201 is the challenge itself, not a JSON:API document.
        return post(url, body, FlowCryptoChallenge.serializer())
    }

    override suspend fun submitCryptoSignature(verificationId: String, crypto: FlowCryptoSubmit): FlowVerification {
        val url = url("verifications", verificationId, "submit")
        require(CRYPTO_CHALLENGE_ID.matches(crypto.challengeId)) { "Not a wallet challenge ID" }
        require(crypto.signature.length in 1..CryptoLimits.SIGNATURE_MAX_LENGTH) { "A signature is 1 to 1024 characters" }
        crypto.signedMessage?.let { signed ->
            require(signed.isNotEmpty() && signed.encodeToByteArray().size <= CryptoLimits.MESSAGE_MAX_BYTES) {
                "A signed message is 1 byte to 4 KiB"
            }
        }
        return post(url, http.jsonBody(FlowCryptoSubmitBody.serializer(), FlowCryptoSubmitBody(crypto)), FlowVerificationDocument.serializer()).data
    }

    private fun url(endpoint: String, verificationId: String? = null, vararg actions: String): String {
        // Validated rather than only encoded: `..` would be resolved as a dot segment.
        require(verificationId == null || VERIFICATION_ID.matches(verificationId)) { "Not a verification ID" }
        return apiBase.resolve(*(listOfNotNull("api", "v1", "flow", endpoint, verificationId) + actions).toTypedArray())
    }

    private suspend fun <T> get(url: String, deserializer: DeserializationStrategy<T>): T =
        http.send(HttpMethod.Get, url, deserializer, authorization)

    private suspend fun <T> post(url: String, body: OutgoingContent, deserializer: DeserializationStrategy<T>): T =
        http.send(HttpMethod.Post, url, deserializer, authorization, body)

    private companion object {
        const val KIND_FIELD = "kind"

        /** C206 (Workflow 10B): `flowFileUploadFieldsSchema`'s client-reported fields. */
        const val CAPTURE_METHOD_FIELD = "capture-method"
        const val CAPTURE_TRIGGER_FIELD = "capture-trigger"
        const val FILE_FIELD = "file"

        // C40.3 `SELFIE_CAPTURE_ID_FIELD`, `SELFIE_CAPTURE_NONCE_FIELD`, `CLIENT_ELAPSED_MS_FIELD`.
        const val CAPTURE_ID_FIELD = "capture-id"
        const val NONCE_FIELD = "nonce"
        const val CLIENT_ELAPSED_MS_FIELD = "client-elapsed-ms"
        val EXTENSIONS = mapOf("image/jpeg" to "jpg", "image/png" to "png", "image/webp" to "webp", "application/pdf" to "pdf")

        /** `self_` plus a ULID (contract C1), a path segment of the extension route. */
        val CAPTURE_ID = Regex("self_[0-9A-HJKMNP-TV-Z]{26}")

        /** `tsa_` plus a ULID (`flowThemeAssetParamsSchema`), a path segment of the asset route. */
        val THEME_ASSET_ID = Regex("tsa_[0-9A-HJKMNP-TV-Z]{26}")

        /** C147.2 `STEP_ID_PATTERN`: a step id, a path segment of the screen route. */
        val STEP_ID = Regex("[a-z][a-z0-9_-]{0,63}")

        /** C148.5 `submitFlowScreenBodySchema`: a value's key, a template field key. */
        val FIELD_KEY = Regex("[a-z][a-z0-9_]{0,63}")

        /** C148.5 `submitFlowScreenBodySchema`: a button's key. */
        val BUTTON_KEY = Regex("[a-z][a-z0-9_]{0,39}")

        /** `ver_` plus a ULID in upper-case Crockford base32 (contract C1). */
        val VERIFICATION_ID = Regex("ver_[0-9A-HJKMNP-TV-Z]{26}")

        /** C55 `otpCodeSchema`: six to ten ASCII digits. */
        val OTP_CODE = Regex("[0-9]{6,10}")

        /** C55 `flowOtpSendBodySchema`'s bounds, which the coordinator also checks first (P028). */
        const val OTP_PHONE_MAX_LENGTH = OtpLimits.PHONE_MAX_LENGTH
        val OTP_EMAIL_LENGTHS = OtpLimits.EMAIL_LENGTHS

        /** A form field with its name quoted, as OkHttp wrote it; Ktor adds the part's length. */
        fun formField(name: String, value: String): PartData =
            PartData.FormItem(value, {}, Headers.build { append(HttpHeaders.ContentDisposition, "form-data; name=\"$name\"") })

        /**
         * The file, with its type and, since every part's length is then known, a request with a
         * Content-Length, as OkHttp sent it, rather than a chunked one.
         */
        fun filePart(fileName: String, bytes: ByteArray, mimeType: String): PartData =
            PartData.BinaryItem(
                { Buffer().apply { write(bytes) } },
                {},
                Headers.build {
                    append(HttpHeaders.ContentDisposition, "form-data; name=\"$FILE_FIELD\"; filename=\"$fileName\"")
                    append(HttpHeaders.ContentType, mimeType)
                    append(HttpHeaders.ContentLength, bytes.size.toString())
                },
            )
    }
}

/** C160.6, C198.3: the most of a theme asset the client reads, the logo limit the server enforces. */
internal const val THEME_ASSET_MAX_BYTES: Int = 256 * 1024

/** A 2xx answer with no body, such as the 202 of `POST /api/v1/flow/signals` (C94.2). */
private object NoContent : DeserializationStrategy<Unit> {
    override val descriptor: SerialDescriptor = buildClassSerialDescriptor("dev.openverify.sdk.api.NoContent")

    override fun deserialize(decoder: Decoder) = Unit
}

@Serializable
private class ConsentRequest(
    val accepted: Boolean,
    @SerialName("text-keys") val textKeys: List<String>,
    @SerialName("optional-text-keys") val optionalTextKeys: List<String>? = null,
    val locale: String,
    @SerialName("text-sha256") val textSha256: List<String>? = null,
    @SerialName("copy-source") val copySource: String? = null,
    @SerialName("catalog-version") val catalogVersion: String? = null,
)

@Serializable
private class CreateSelfieCaptureRequest(val method: CaptureMethod)

/** C171.4: the extension's answer, the `selfie` resource, read for its id and new expiry only. */
@Serializable
private class SelfieCaptureExtensionDocument(val data: SelfieCaptureExtensionResource)

@Serializable
private class SelfieCaptureExtensionResource(val id: String, val attributes: SelfieCaptureExtensionAttributes)

@Serializable
private class SelfieCaptureExtensionAttributes(@SerialName("expires-at") val expiresAt: String)

/** C148.5 `submitFlowScreenBodySchema`: the screen's values by field key, and the button's key (absent: the primary). */
@Serializable
private class ScreenSubmission(val values: Map<String, FlowValue>, val button: String? = null)

@Serializable
private class ConsentResponse(val consent: FlowConsent)

@Serializable
private class ConfirmOtpRequest(val code: String)

@Serializable
private class CreateCryptoChallengeRequest(
    @SerialName("chain-id") val chainId: String,
    @SerialName("wallet-address") val walletAddress: String,
)

@Serializable
private class CreateVerificationRequest(
    val type: String,
    val country: String? = null,
    @SerialName("id-class") val idClass: String? = null,
)
