package dev.openverify.sdk.api

import dev.openverify.sdk.camera.CapturedImage
import dev.openverify.sdk.model.AamvaInputs
import dev.openverify.sdk.model.AssociatedPersonInputs
import dev.openverify.sdk.model.BusinessWebsiteInputs
import dev.openverify.sdk.model.CaptureMethod
import dev.openverify.sdk.model.CryptoSignatureScheme
import dev.openverify.sdk.model.DatabaseBusinessInputs
import dev.openverify.sdk.model.DatabaseInputs
import dev.openverify.sdk.model.DocumentFile
import dev.openverify.sdk.model.FileKind
import dev.openverify.sdk.model.FlowConsent
import dev.openverify.sdk.model.FlowCryptoChallenge
import dev.openverify.sdk.model.FlowCryptoSubmit
import dev.openverify.sdk.model.FlowSubmitCapture
import dev.openverify.sdk.model.InquiryStatus
import dev.openverify.sdk.model.OpenVerifyJson
import dev.openverify.sdk.model.OtpDestination
import dev.openverify.sdk.model.PhoneNumberGuidance
import dev.openverify.sdk.model.Problem
import dev.openverify.sdk.model.SelfieCaptureUpload
import dev.openverify.sdk.model.SelfieDeviceSnapshot
import dev.openverify.sdk.model.SelfiePose
import dev.openverify.sdk.model.VerificationStatus
import dev.openverify.sdk.model.VerificationType
import dev.openverify.sdk.model.guidanceAs
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.MockRequestHandleScope
import io.ktor.client.engine.mock.respond
import io.ktor.client.engine.mock.toByteArray
import io.ktor.client.request.HttpRequestData
import io.ktor.client.request.HttpResponseData
import io.ktor.http.ContentType
import io.ktor.http.Headers
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.awaitCancellation
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeout
import kotlinx.io.IOException
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlin.test.Test
import kotlin.test.assertContentEquals
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertIs
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlin.time.Duration.Companion.seconds

/**
 * The flow API client's HTTP contract (K4) on Ktor's MockEngine, in common code so it also runs
 * on iOS. `FlowApiClientTest` checks the same exchanges on the wire, over OkHttp and MockWebServer.
 */
class FlowApiClientContractTest {

    private val requests = mutableListOf<Recorded>()
    private var answer: suspend MockRequestHandleScope.(HttpRequestData) -> HttpResponseData = { json(200, SESSION) }

    private val engine = MockEngine { request ->
        requests += Recorded(request, request.body.toByteArray())
        answer(request)
    }

    private fun client(apiBaseUrl: String = BASE): FlowApiClient = FlowApiClient(apiBaseUrl, TOKEN, flowHttpClient(engine))

    // Requests ---------------------------------------------------------------------------------

    @Test
    fun aFlowCallSendsTheSdkHeadersAndTheSessionToken() = runTest {
        val session = client().getSession()

        val request = requests.single()
        assertEquals("GET", request.method)
        assertEquals("$BASE/api/v1/flow/session", request.url)
        assertEquals("application/json, application/problem+json", request.header(HttpHeaders.Accept))
        assertEquals("OpenVerify-$PLATFORM_NAME/${FlowHttp.SDK_VERSION}", request.header(HttpHeaders.UserAgent))
        assertEquals("Bearer $TOKEN", request.header(HttpHeaders.Authorization))
        // No Accept-Charset, as with OkHttp: Ktor 3.5 sends it only for charsets other than UTF-8 (RFC 9110).
        assertNull(request.header("Accept-Charset"))
        assertEquals(InquiryStatus.PENDING, session.inquiry.status)
    }

    @Test
    fun requestPathsGoUnderThePathPrefixWithOrWithoutItsSlash() = runTest {
        answer = { request -> if (request.url.encodedPath.endsWith("/session")) json(200, SESSION) else json(200, verificationJson("passed")) }

        client("$BASE/openverify/").getSession()
        client("$BASE/openverify").getVerification(VERIFICATION_ID)

        assertEquals(listOf("$BASE/openverify/api/v1/flow/session", "$BASE/openverify/api/v1/flow/verifications/$VERIFICATION_ID"), requests.map { it.url })
    }

    @Test
    fun acceptConsentPostsJsonWithTheExactContentType() = runTest {
        answer = { json(200, """{"consent":{"accepted-at":"2026-10-20T12:00:30.000Z"}}""") }

        val consent = client().acceptConsent(listOf("consent.biometric"), "en")
        client().acceptConsent(listOf("consent.biometric"), "es", listOf("consent.biometric-matching"))

        val (plain, optional) = requests
        assertEquals("POST", plain.method)
        assertEquals("$BASE/api/v1/flow/consent", plain.url)
        assertEquals("application/json; charset=utf-8", plain.contentType)
        assertEquals(
            buildJsonObject {
                put("accepted", true)
                put("text-keys", buildJsonArray { add(JsonPrimitive("consent.biometric")) })
                put("locale", "en")
            },
            plain.json(),
        )
        assertEquals(
            buildJsonObject {
                put("accepted", true)
                put("text-keys", buildJsonArray { add(JsonPrimitive("consent.biometric")) })
                put("optional-text-keys", buildJsonArray { add(JsonPrimitive("consent.biometric-matching")) })
                put("locale", "es")
            },
            optional.json(),
        )
        assertEquals(FlowConsent("2026-10-20T12:00:30.000Z"), consent)
    }

    @Test
    fun createVerificationAndCreateSelfieCapturePostTheirOptions() = runTest {
        answer = { request -> if (request.url.encodedPath.endsWith("/selfies")) json(201, CAPTURE) else json(201, verificationJson("initiated")) }

        val created = client().createVerification(VerificationType.GOVERNMENT_ID, country = "US", idClass = "passport")
        client().createVerification(VerificationType.SELFIE)
        val capture = client().createSelfieCapture(VERIFICATION_ID, CaptureMethod.CAMERA)

        assertEquals(
            listOf(
                """{"type":"government-id","country":"US","id-class":"passport"}""",
                """{"type":"selfie"}""",
                """{"method":"camera"}""",
            ),
            requests.map { it.body.decodeToString() },
        )
        assertEquals("$BASE/api/v1/flow/verifications/$VERIFICATION_ID/selfies", requests.last().url)
        assertEquals(VerificationStatus.INITIATED, created.attributes.status)
        assertEquals(listOf(SelfiePose.CENTER, SelfiePose.RIGHT, SelfiePose.LEFT), capture.attributes.prompts)
    }

    @Test
    fun submitSendsAnEmptyObjectOrTheCaptureItConsumes() = runTest {
        answer = { json(202, verificationJson("submitted")) }

        client().submitVerification(VERIFICATION_ID)
        client().submitVerification(VERIFICATION_ID, FlowSubmitCapture(CAPTURE_ID, NONCE, SelfieDeviceSnapshot(imageMirrored = false)))

        val (empty, capture) = requests
        assertEquals("$BASE/api/v1/flow/verifications/$VERIFICATION_ID/submit", empty.url)
        assertEquals("{}", empty.body.decodeToString())
        assertEquals("application/json; charset=utf-8", empty.contentType)
        assertEquals("""{"capture":{"id":"$CAPTURE_ID","nonce":"$NONCE","device":{"image-mirrored":false}}}""", capture.body.decodeToString())
    }

    @Test
    fun uploadFileSendsQuotedMultipartPartsInOrderWithAKnownLength() = runTest {
        answer = { json(201, fileJson("selfie-right")) }

        client().uploadFile(VERIFICATION_ID, FileKind.SELFIE_RIGHT, CapturedImage(JPEG, "image/jpeg"), SelfieCaptureUpload(CAPTURE_ID, NONCE, 4_250))

        val request = requests.single()
        assertEquals("$BASE/api/v1/flow/verifications/$VERIFICATION_ID/files", request.url)
        val parts = request.multipartParts()
        assertEquals(
            listOf(
                "form-data; name=\"kind\"" to "selfie-right",
                "form-data; name=\"capture-id\"" to CAPTURE_ID,
                "form-data; name=\"nonce\"" to NONCE,
                "form-data; name=\"client-elapsed-ms\"" to "4250",
            ),
            parts.dropLast(1).map { it.header(HttpHeaders.ContentDisposition) to it.content.decodeToString() },
        )
        val file = parts.last()
        assertEquals("form-data; name=\"file\"; filename=\"selfie-right.jpg\"", file.header(HttpHeaders.ContentDisposition))
        assertEquals("image/jpeg", file.header(HttpHeaders.ContentType))
        assertContentEquals(JPEG, file.content)
        // K4's accepted difference: every part declares its length, so the upload is not chunked.
        for (part in parts) assertEquals(part.content.size.toString(), part.header(HttpHeaders.ContentLength))
        assertEquals(request.body.size.toLong(), request.contentLength)
    }

    @Test
    fun aGovernmentIdSideSendsNoCaptureFieldsAndItsImageType() = runTest {
        answer = { json(201, fileJson("front")) }

        client().uploadFile(VERIFICATION_ID, FileKind.FRONT, CapturedImage(JPEG, "image/png"))
        client().uploadFile(VERIFICATION_ID, FileKind.BACK, CapturedImage(JPEG, "image/webp"))

        val (png, webp) = requests.map { it.multipartParts() }
        assertEquals(listOf("form-data; name=\"kind\"", "form-data; name=\"file\"; filename=\"front.png\""), png.map { it.header(HttpHeaders.ContentDisposition) })
        assertEquals("image/png", png.last().header(HttpHeaders.ContentType))
        assertEquals("form-data; name=\"file\"; filename=\"back.webp\"", webp.last().header(HttpHeaders.ContentDisposition))
    }

    @Test
    fun uploadDocumentSendsTheDocumentKindAndItsBytesNamedAfterItsTypeNeverTheUsersName() = runTest {
        answer = { json(201, fileJson("document")) }
        val pdf = "%PDF-1.7\n%synthetic\n".encodeToByteArray()

        client().uploadDocument(VERIFICATION_ID, DocumentFile(pdf, "application/pdf"))
        client().uploadDocument(VERIFICATION_ID, DocumentFile(JPEG, "image/jpeg"))

        val (document, photo) = requests.map { it.multipartParts() }
        assertEquals("$BASE/api/v1/flow/verifications/$VERIFICATION_ID/files", requests.first().url)
        assertEquals(
            listOf("form-data; name=\"kind\"" to "document"),
            document.dropLast(1).map { it.header(HttpHeaders.ContentDisposition) to it.content.decodeToString() },
        )
        assertEquals("form-data; name=\"file\"; filename=\"document.pdf\"", document.last().header(HttpHeaders.ContentDisposition))
        assertEquals("application/pdf", document.last().header(HttpHeaders.ContentType))
        assertContentEquals(pdf, document.last().content)
        assertEquals("form-data; name=\"file\"; filename=\"document.jpg\"", photo.last().header(HttpHeaders.ContentDisposition))
        assertEquals("image/jpeg", photo.last().header(HttpHeaders.ContentType))
        for (part in document) assertEquals(part.content.size.toString(), part.header(HttpHeaders.ContentLength))
    }

    @Test
    fun verificationIdsThatAreNotVerUlidsAreRefusedBeforeAnyRequest() = runTest {
        for (id in listOf("..", "../session", "ver_short", "ver_01m5ck16p0d13fxhzss4tcfbvh", "")) {
            assertFailsWith<IllegalArgumentException>(id) { client().getVerification(id) }
            assertFailsWith<IllegalArgumentException>(id) { client().submitVerification(id) }
            assertFailsWith<IllegalArgumentException>(id) { client().createSelfieCapture(id, CaptureMethod.CAMERA) }
            assertFailsWith<IllegalArgumentException>(id) { client().uploadFile(id, FileKind.FRONT, CapturedImage(JPEG, "image/jpeg")) }
            assertFailsWith<IllegalArgumentException>(id) { client().uploadDocument(id, DocumentFile(JPEG, "image/jpeg")) }
        }
        assertFailsWith<IllegalArgumentException> { client().createVerification(VerificationType.UNKNOWN) }
        assertEquals(0, requests.size)
    }

    @Test
    fun malformedArgumentsAreRefusedWithoutEchoingTheToken() {
        val serverOnly = "key_01M5CJXHG07XPHF3HRM6NREDH7.secret" // the shape of an API key, never sent by an app
        val error = assertFailsWith<IllegalArgumentException> { FlowApiClient(BASE, serverOnly, flowHttpClient(engine)) }

        assertTrue(serverOnly !in error.message!!, error.message)
        for (url in listOf("http://api.example.com", "https://api.example.com/?tenant=1", "https://exämple.com")) {
            assertFailsWith<IllegalArgumentException>(url) { FlowApiClient(url, TOKEN, flowHttpClient(engine)) }
        }
    }

    // Responses --------------------------------------------------------------------------------

    @Test
    fun errorStatusesMapToFlowApiExceptionsWithTheProblemAndRequestId() = runTest {
        val expected = listOf(
            400 to "Rejected", 401 to "Unauthorized", 403 to "Forbidden", 404 to "NotFound", 409 to "Conflict", 410 to "Redacted",
            413 to "Rejected", 415 to "Rejected", 422 to "Rejected", 429 to "RateLimited", 500 to "ServerError", 503 to "ServerError",
            418 to "UnexpectedStatus", 304 to "UnexpectedStatus",
        )
        for ((status, kind) in expected) {
            answer = { json(status, problemJson(status), PROBLEM_JSON, "x-request-id" to "req-from-header") }

            val error = assertIs<FlowApiException.Http>(runCatching { client().getSession() }.exceptionOrNull(), "$status")

            assertEquals(kind, error::class.simpleName, "$status")
            assertEquals(status, error.status)
            assertEquals(PROBLEM.copy(status = status), error.problem, "$status")
            assertEquals("req-from-header", error.requestId, "$status")
        }
    }

    @Test
    fun theRequestIdFallsBackToTheProblemAndTheLastHeaderWins() = runTest {
        answer = { json(409, problemJson(409), PROBLEM_JSON) }
        val fallback = assertFailsWith<FlowApiException.Conflict> { client().getSession() }

        answer = { json(409, problemJson(409), PROBLEM_JSON, "x-request-id" to "first", "x-request-id" to "second") }
        val repeated = assertFailsWith<FlowApiException.Conflict> { client().getSession() }

        assertEquals(PROBLEM.requestId, fallback.requestId)
        // C213.3: the message is fixed; the problem's title stays out of it.
        assertEquals("HTTP 409", fallback.message)
        assertEquals("second", repeated.requestId)
    }

    @Test
    fun aProblemIsReadFromAnyJsonMediaTypeAndOnlyFromOne() = runTest {
        for (type in listOf("application/json", "application/problem+json; charset=utf-8", "Application/Problem+JSON", "application/vnd.api+json")) {
            answer = { json(404, problemJson(404), type) }
            assertNotNull(assertFailsWith<FlowApiException.NotFound>(type) { client().getSession() }.problem, type)
        }
        for (type in listOf("text/html", "text/plain", "application/json-seq", "application/json; charset")) {
            answer = { json(404, problemJson(404), type) }
            assertNull(assertFailsWith<FlowApiException.NotFound>(type) { client().getSession() }.problem, type)
        }
    }

    @Test
    fun anErrorWithoutAJsonBodyMapsByStatusAlone() = runTest {
        answer = { json(502, "<h1>Bad gateway</h1>", "text/html") }

        val error = assertFailsWith<FlowApiException.ServerError> { client().getSession() }

        assertNull(error.problem)
        assertNull(error.requestId)
        assertEquals("HTTP 502", error.message)
    }

    @Test
    fun retryAfterIsExposedOn429WhenItHoldsSeconds() = runTest {
        answer = { json(429, problemJson(429), PROBLEM_JSON, HttpHeaders.RetryAfter to "30") }
        assertEquals(30L, assertFailsWith<FlowApiException.RateLimited> { client().getSession() }.retryAfterSeconds)

        answer = { json(429, problemJson(429), PROBLEM_JSON, HttpHeaders.RetryAfter to "Wed, 21 Oct 2026 07:28:00 GMT") }
        assertNull(assertFailsWith<FlowApiException.RateLimited> { client().getSession() }.retryAfterSeconds)
    }

    @Test
    fun aSuccessBodyThatIsNotTheContractIsAnInvalidResponse() = runTest {
        for (body in listOf("""{"unexpected":true}""", "not json", "")) {
            answer = { json(200, body) }
            assertFailsWith<FlowApiException.InvalidResponse>(body) { client().getSession() }
        }
        answer = { json(201, """{"data":{"type":"verification/government-id","id":"$VERIFICATION_ID"}}""") }
        assertFailsWith<FlowApiException.InvalidResponse> { client().createVerification(VerificationType.GOVERNMENT_ID) }
    }

    /** JSON is UTF-8 (RFC 8259 §8.1): a byte order mark is skipped, as OkHttp skipped it, and a charset label is not followed. */
    @Test
    fun aJsonBodyIsReadAsUtf8() = runTest {
        answer = { respond(byteArrayOf(0xEF.toByte(), 0xBB.toByte(), 0xBF.toByte()) + SESSION.encodeToByteArray(), HttpStatusCode.OK, headers(ContentType.Application.Json.toString())) }
        assertEquals(InquiryStatus.PENDING, client().getSession().inquiry.status)

        val title = "Conflicto: falta el consentimiento ñ"
        answer = { json(409, problemJson(409).replace("\"Conflict\"", "\"$title\""), "application/problem+json; charset=iso-8859-1") }
        assertEquals(title, assertFailsWith<FlowApiException.Conflict> { client().getSession() }.problem?.title)
    }

    // The exchange ----------------------------------------------------------------------------

    @Test
    fun redirectsAreNotFollowedSoTheTokenNeverLeavesTheApiOrigin() = runTest {
        answer = { respond("", HttpStatusCode.Found, Headers.build { append(HttpHeaders.Location, "https://elsewhere.example/") }) }

        val error = assertFailsWith<FlowApiException.UnexpectedStatus> { client().getSession() }

        assertEquals(302, error.status)
        assertEquals(listOf("$BASE/api/v1/flow/session"), requests.map { it.url })
    }

    @Test
    fun anIoFailureIsANetworkErrorCarryingIt() = runTest {
        val offline = IOException("offline")
        answer = { throw offline }

        val error = assertFailsWith<FlowApiException.Network> { client().getSession() }

        // The same exception, or the copy coroutine stack-trace recovery makes of it.
        assertEquals("offline", assertIs<IOException>(error.cause).message)
    }

    @Test
    fun cancellingTheCallerCancelsTheExchangeAndIsNeverWrapped() = runTest {
        val started = CompletableDeferred<Unit>()
        val engineCanceled = CompletableDeferred<Unit>()
        answer = {
            started.complete(Unit)
            try {
                awaitCancellation()
            } finally {
                engineCanceled.complete(Unit)
            }
        }
        var thrown: Throwable? = null
        val call = launch(Dispatchers.Default) {
            try {
                client().getSession()
            } catch (e: Throwable) {
                thrown = e
                throw e
            }
        }

        withContext(Dispatchers.Default) { withTimeout(5.seconds) { started.await() } }
        call.cancelAndJoin()

        assertIs<CancellationException>(thrown)
        withContext(Dispatchers.Default) { withTimeout(5.seconds) { engineCanceled.await() } }
    }

    // The Phase 5 calls (C52.3, C55, C57) -----------------------------------------------------

    @Test
    fun sendOtpPostsThePhoneNumberOrTheEmailAddressToItsRoute() = runTest {
        answer = { json(200, verificationJson("initiated", "verification/phone-number", OPEN_CODE_GUIDANCE)) }

        val sent = client().sendOtp(VERIFICATION_ID, OtpDestination.Phone("+1 555 555 0100"))
        client().sendOtp(VERIFICATION_ID, OtpDestination.Email("jane@example.test"))

        val (phone, email) = requests
        assertEquals("POST", phone.method)
        assertEquals("$BASE/api/v1/flow/verifications/$VERIFICATION_ID/otp", phone.url)
        assertEquals("application/json; charset=utf-8", phone.contentType)
        assertEquals("""{"phone-number":"+1 555 555 0100"}""", phone.body.decodeToString())
        assertEquals("""{"email-address":"jane@example.test"}""", email.body.decodeToString())
        assertEquals(4, sent.guidanceAs(PhoneNumberGuidance.serializer())?.otp?.sendsRemaining)
    }

    @Test
    fun confirmOtpPostsTheCodeAsItsOnlyMember() = runTest {
        answer = { json(200, verificationJson("confirmed", "verification/phone-number")) }

        val confirmed = client().confirmOtp(VERIFICATION_ID, "0123456789")

        val request = requests.single()
        assertEquals("$BASE/api/v1/flow/verifications/$VERIFICATION_ID/otp/confirm", request.url)
        assertEquals("""{"code":"0123456789"}""", request.body.decodeToString())
        assertEquals(VerificationStatus.CONFIRMED, confirmed.attributes.status)
    }

    @Test
    fun enterInputsPostsTheEnteredValuesKebabCaseLeavingOutTheAbsentOnes() = runTest {
        answer = { json(200, verificationJson("initiated", "verification/database", ""","inputs-received":true""")) }

        val entered = client().enterInputs(
            VERIFICATION_ID,
            DatabaseInputs(nameFirst = "Jane", nameLast = "Example", birthdate = "1990-04-23", addressCountryCode = "US"),
        )
        client().enterInputs(VERIFICATION_ID, AamvaInputs("Jane", "Example", "1990-04-23", "D1234567", "CA"))

        val (database, aamva) = requests
        assertEquals("$BASE/api/v1/flow/verifications/$VERIFICATION_ID/inputs", database.url)
        assertEquals("application/json; charset=utf-8", database.contentType)
        assertEquals("""{"name-first":"Jane","name-last":"Example","birthdate":"1990-04-23","address-country-code":"US"}""", database.body.decodeToString())
        assertEquals(
            """{"name-first":"Jane","name-last":"Example","birthdate":"1990-04-23","identification-number":"D1234567","issuing-authority":"CA"}""",
            aamva.body.decodeToString(),
        )
        assertEquals(true, entered.attributes.inputsReceived)
    }

    @Test
    fun enterInputsPostsTheBusinessAndWebsiteBodiesKebabCase() = runTest {
        answer = { json(200, verificationJson("initiated", "verification/database-business", ""","inputs-received":true""")) }

        client().enterInputs(
            VERIFICATION_ID,
            DatabaseBusinessInputs(
                "Example Widgets Ltd",
                "GB",
                registrationNumber = "01234567",
                associatedPersons = listOf(AssociatedPersonInputs("Robin", "Sample", "1980-04")),
            ),
        )
        client().enterInputs(VERIFICATION_ID, BusinessWebsiteInputs("https://www.example.com", businessName = "Example Widgets Ltd"))

        val (business, website) = requests
        assertEquals("$BASE/api/v1/flow/verifications/$VERIFICATION_ID/inputs", business.url)
        assertEquals(
            """{"business-name":"Example Widgets Ltd","country-code":"GB","registration-number":"01234567",""" +
                """"associated-persons":[{"name-first":"Robin","name-last":"Sample","birthdate":"1980-04"}]}""",
            business.body.decodeToString(),
        )
        assertEquals("""{"website-url":"https://www.example.com","business-name":"Example Widgets Ltd"}""", website.body.decodeToString())
    }

    @Test
    fun businessAndWebsiteValuesOutsideTheirContractAreRefusedBeforeAnyRequest() = runTest {
        val refused = listOf(
            DatabaseBusinessInputs("Example Widgets Ltd", "GB", registrationNumber = "12345"),
            DatabaseBusinessInputs("Example Widgets Ltd", "FR", lei = "OPENVERIFYSYNTH00100"),
            DatabaseBusinessInputs("Example Widgets Ltd", "FR", associatedPersons = listOf(AssociatedPersonInputs("Robin", "Sample", "04/1980"))),
            DatabaseBusinessInputs("Example Widgets Ltd", "FR", associatedPersons = List(11) { AssociatedPersonInputs("Robin", "Sample") }),
            BusinessWebsiteInputs("www.example.com"),
        )

        for (inputs in refused) {
            assertFailsWith<IllegalArgumentException>(inputs.toString()) { client().enterInputs(VERIFICATION_ID, inputs) }
        }
        assertEquals(0, requests.size)
    }

    @Test
    fun createCryptoChallengePostsTheChainAndAddressAndReadsTheMessageFromThe201() = runTest {
        answer = { json(201, """{"id":"$CHALLENGE_ID","message":"Sign in\nNonce: 0123456789abcdef","expires-at":"2026-10-20T12:10:00.000Z"}""") }

        val challenge = client().createCryptoChallenge(VERIFICATION_ID, "eip155:1", WALLET)

        val request = requests.single()
        assertEquals("$BASE/api/v1/flow/verifications/$VERIFICATION_ID/crypto-challenges", request.url)
        assertEquals("""{"chain-id":"eip155:1","wallet-address":"$WALLET"}""", request.body.decodeToString())
        assertEquals(FlowCryptoChallenge(CHALLENGE_ID, "Sign in\nNonce: 0123456789abcdef", "2026-10-20T12:10:00.000Z"), challenge)
    }

    @Test
    fun aWalletChallengeAnswerThatBreaksTheContractIsAnInvalidResponse() = runTest {
        for (body in listOf("""{"id":"$VERIFICATION_ID","message":"m","expires-at":"2026-10-20T12:10:00.000Z"}""", """{"data":{"id":"$CHALLENGE_ID"}}""")) {
            answer = { json(201, body) }
            assertFailsWith<FlowApiException.InvalidResponse>(body) { client().createCryptoChallenge(VERIFICATION_ID, "eip155:1", WALLET) }
        }
    }

    @Test
    fun submitCryptoSignaturePostsTheCryptoMemberToSubmit() = runTest {
        answer = { json(202, verificationJson("submitted", "verification/crypto-wallet")) }
        val signature = "0x" + "ab".repeat(65)

        val submitted = client().submitCryptoSignature(VERIFICATION_ID, FlowCryptoSubmit(CHALLENGE_ID, signature))
        client().submitCryptoSignature(VERIFICATION_ID, FlowCryptoSubmit(CHALLENGE_ID, "c2ln", "wrapped", CryptoSignatureScheme.SOLANA_ED25519))

        val (plain, wrapped) = requests
        assertEquals("$BASE/api/v1/flow/verifications/$VERIFICATION_ID/submit", plain.url)
        assertEquals("""{"crypto":{"challenge-id":"$CHALLENGE_ID","signature":"$signature"}}""", plain.body.decodeToString())
        assertEquals(
            """{"crypto":{"challenge-id":"$CHALLENGE_ID","signature":"c2ln","signed-message":"wrapped","scheme":"solana-ed25519"}}""",
            wrapped.body.decodeToString(),
        )
        assertEquals(VerificationStatus.SUBMITTED, submitted.attributes.status)
    }

    @Test
    fun thePhase5CallsRefuseAVerificationIdThatIsNotAVerUlidBeforeAnyRequest() = runTest {
        for (id in listOf("..", "ver_short", CHALLENGE_ID)) {
            assertFailsWith<IllegalArgumentException>(id) { client().sendOtp(id, OtpDestination.Phone("+15555550100")) }
            assertFailsWith<IllegalArgumentException>(id) { client().confirmOtp(id, "123456") }
            assertFailsWith<IllegalArgumentException>(id) { client().enterInputs(id, DatabaseInputs(nameFirst = "Jane")) }
            assertFailsWith<IllegalArgumentException>(id) { client().createCryptoChallenge(id, "eip155:1", WALLET) }
            assertFailsWith<IllegalArgumentException>(id) { client().submitCryptoSignature(id, FlowCryptoSubmit(CHALLENGE_ID, "0xab")) }
        }
        assertEquals(0, requests.size)
    }

    @Test
    fun aDestinationOrCodeOutsideItsBodyIsRefusedBeforeAnyRequest() = runTest {
        // C55: the send body caps a phone number at 32 characters and an email address at 3 to 254.
        val destinations = listOf(
            OtpDestination.Phone(""),
            OtpDestination.Phone("+1" + "5".repeat(31)),
            OtpDestination.Email("a@"),
            OtpDestination.Email("a".repeat(250) + "@x.io"),
        )
        for (destination in destinations) {
            assertFailsWith<IllegalArgumentException>(destination.toString()) { client().sendOtp(VERIFICATION_ID, destination) }
        }
        // C55.2 `otpCodeSchema`: six to ten ASCII digits.
        for (code in listOf("12345", "12345678901", "12345a", " 123456", "١٢٣٤٥٦", "")) {
            assertFailsWith<IllegalArgumentException>(code) { client().confirmOtp(VERIFICATION_ID, code) }
        }
        assertEquals(0, requests.size)
    }

    @Test
    fun enteredValuesOutsideTheirContractAreRefusedBeforeAnyRequest() = runTest {
        val refused = listOf(
            DatabaseInputs(birthdate = "1990-02-30"),
            DatabaseInputs(phoneNumber = "555 0100"),
            DatabaseInputs(nameFirst = ""),
            AamvaInputs("Jane", "Example", "1990-04-23", "D1234567", "ON"),
        )

        for (inputs in refused) {
            assertFailsWith<IllegalArgumentException>(inputs.toString()) { client().enterInputs(VERIFICATION_ID, inputs) }
        }
        assertEquals(0, requests.size)
    }

    @Test
    fun aWalletRequestOutsideItsContractIsRefusedBeforeAnyRequest() = runTest {
        // C57.1: a chain the contracts know, in its canonical form; the C57 input limits.
        for (chain in listOf("ethereum", "eip155:", "eip155:01", "EIP155:1", "eip155:1:extra", "tron:0x2b6653dc", "bip122:0000")) {
            assertFailsWith<IllegalArgumentException>(chain) { client().createCryptoChallenge(VERIFICATION_ID, chain, WALLET) }
        }
        for (address in listOf("", "a".repeat(129))) {
            assertFailsWith<IllegalArgumentException>(address) { client().createCryptoChallenge(VERIFICATION_ID, "eip155:1", address) }
        }
        val refused = listOf(
            FlowCryptoSubmit("cwc_short", "0xab"),
            FlowCryptoSubmit(CHALLENGE_ID, ""),
            FlowCryptoSubmit(CHALLENGE_ID, "a".repeat(1025)),
            FlowCryptoSubmit(CHALLENGE_ID, "0xab", signedMessage = ""),
            // 4,098 UTF-8 bytes in 2,049 characters: the message cap counts bytes.
            FlowCryptoSubmit(CHALLENGE_ID, "0xab", signedMessage = "é".repeat(2049)),
        )
        for (crypto in refused) {
            assertFailsWith<IllegalArgumentException>(crypto.toString()) { client().submitCryptoSignature(VERIFICATION_ID, crypto) }
        }
        assertEquals(0, requests.size)
    }

    @Test
    fun theWalletLimitsThemselvesAreAccepted() = runTest {
        answer = { request ->
            if (request.url.encodedPath.endsWith("/crypto-challenges")) {
                json(201, """{"id":"$CHALLENGE_ID","message":"m","expires-at":"2026-10-20T12:10:00.000Z"}""")
            } else {
                json(202, verificationJson("submitted", "verification/crypto-wallet"))
            }
        }

        for (chain in listOf("eip155:1", "eip155:8453", "tron:728126428", "xrpl:0", "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp")) {
            client().createCryptoChallenge(VERIFICATION_ID, chain, "a".repeat(128))
        }
        client().submitCryptoSignature(VERIFICATION_ID, FlowCryptoSubmit(CHALLENGE_ID, "a".repeat(1024), signedMessage = "é".repeat(2048)))

        assertEquals(6, requests.size)
    }

    @Test
    fun anOtpProblemKeepsItsCodeAndMembers() = runTest {
        answer = { json(422, """{"title":"Unprocessable Content","status":422,"code":"otp_incorrect","attempts-remaining":3}""", PROBLEM_JSON) }
        val incorrect = assertFailsWith<FlowApiException.Rejected> { client().confirmOtp(VERIFICATION_ID, "123456") }

        answer = { json(429, """{"status":429,"code":"otp_resend_too_soon","resend-available-at":"2026-10-20T12:01:00.000Z"}""", PROBLEM_JSON) }
        val tooSoon = assertFailsWith<FlowApiException.RateLimited> { client().sendOtp(VERIFICATION_ID, OtpDestination.Email("jane@example.test")) }

        answer = { json(503, """{"status":503,"code":"otp_rate_limited"}""", PROBLEM_JSON) }
        val storeDown = assertFailsWith<FlowApiException.ServerError> { client().sendOtp(VERIFICATION_ID, OtpDestination.Email("jane@example.test")) }

        assertEquals("otp_incorrect", incorrect.problem?.code)
        assertEquals(3, incorrect.problem?.attemptsRemaining)
        assertEquals("2026-10-20T12:01:00.000Z", tooSoon.problem?.resendAvailableAt)
        assertEquals("otp_rate_limited", storeDown.problem?.code)
    }

    @Test
    fun aRefusedFormKeepsTheJsonPointerOfEachField() = runTest {
        answer = {
            json(
                422,
                """{"status":422,"title":"Unprocessable Content","errors":[{"location":"body","pointer":"/birthdate","detail":"is required"},""" +
                    """{"pointer":"/address-street-1","detail":"is not collected"}]}""",
                PROBLEM_JSON,
            )
        }

        val refused = assertFailsWith<FlowApiException.Rejected> { client().enterInputs(VERIFICATION_ID, DatabaseInputs(nameFirst = "Jane")) }

        assertEquals(listOf("/birthdate", "/address-street-1"), refused.problem?.errors?.map { it.pointer })
    }

    // Helpers ----------------------------------------------------------------------------------

    private class Recorded(request: HttpRequestData, val body: ByteArray) {
        val method = request.method.value
        val url = request.url.toString()
        val headers = request.headers
        val contentType = request.body.contentType?.toString()
        val contentLength = request.body.contentLength

        fun header(name: String): String? = headers[name]

        fun json(): JsonElement = OpenVerifyJson.parseToJsonElement(body.decodeToString())

        fun multipartParts(): List<Part> {
            val boundary = assertNotNull(ContentType.parse(assertNotNull(contentType)).parameter("boundary"))
            assertTrue(contentType.startsWith("multipart/form-data;"), contentType)
            val delimiter = "\r\n--$boundary".encodeToByteArray()
            val all = "\r\n".encodeToByteArray() + body
            val parts = mutableListOf<Part>()
            var at = all.indexOf(delimiter, 0)
            while (all.decodeToString(at + delimiter.size, at + delimiter.size + 2) != "--") {
                val headersStart = at + delimiter.size + 2
                val headersEnd = all.indexOf("\r\n\r\n".encodeToByteArray(), headersStart)
                val headers = all.decodeToString(headersStart, headersEnd).split("\r\n").map { it.substringBefore(": ") to it.substringAfter(": ") }
                val next = all.indexOf(delimiter, headersEnd + 4)
                parts += Part(headers, all.copyOfRange(headersEnd + 4, next))
                at = next
            }
            return parts
        }
    }

    class Part(private val headers: List<Pair<String, String>>, val content: ByteArray) {
        fun header(name: String): String? = headers.singleOrNull { it.first.equals(name, ignoreCase = true) }?.second
    }

    private companion object {
        const val BASE = "https://api.example.com"

        /** Synthetic session token: the `ovs_` prefix plus 43 base64url characters. */
        val TOKEN = "ovs_" + "t".repeat(43)
        const val VERIFICATION_ID = "ver_01M5CK16P0D13FXHZSS4TCFBVH"
        const val CAPTURE_ID = "self_01M5CJXHG07XPHF3HRM6NREDH9"
        const val NONCE = "E2eSyntheticNonce00000"
        val JPEG = byteArrayOf(0xFF.toByte(), 0xD8.toByte(), 0xFF.toByte(), 0xE0.toByte(), 0x00, 0x10)
        const val PROBLEM_JSON = "application/problem+json; charset=utf-8"
        val PROBLEM = Problem(
            type = "about:blank",
            title = "Conflict",
            status = 409,
            detail = "Consent is required before uploading files.",
            instance = "/api/v1/flow/consent",
            requestId = "00000000-0000-4000-8000-000000000002",
        )

        const val SESSION = """{"inquiry":{"id":"inq_01M5CJXHG07XPHF3HRM6NREDH7","status":"pending"},""" +
            """"flow":{"metadata":{"specVersion":1,"id":"default","version":1,"name":"Default"},""" +
            """"steps":[{"id":"completion","type":"completion","messageKey":"flow.completion"}]}}"""
        const val CAPTURE = """{"data":{"type":"selfie","id":"$CAPTURE_ID","attributes":{"prompts":["center","right","left"],""" +
            """"expires-at":"2026-10-21T12:03:00.000Z","nonce":"$NONCE",""" +
            """"guidance":{"max-center-yaw-ratio":0.021,"min-side-yaw-ratio-change":0.077,"hold-ms":500}}}}"""

        fun verificationJson(status: String, type: String = "verification/government-id", extra: String = ""): String =
            """{"data":{"type":"$type","id":"$VERIFICATION_ID","attributes":{"status":"$status",""" +
                """"retry-hints":[],"created-at":"2026-10-20T12:02:00.000Z","updated-at":"2026-10-20T12:02:00.000Z"$extra}}}"""

        const val CHALLENGE_ID = "cwc_01M5CK16P0D13FXHZSS4TCFBVH"

        /** A synthetic EVM address, not a real wallet's. */
        const val WALLET = "0x000000000000000000000000000000000000dEaD"

        /** A phone verification's guidance once a code was sent (C52.2). */
        const val OPEN_CODE_GUIDANCE = ""","guidance":{"allowed-countries":["US"],"code-length":6,"otp":{""" +
            """"masked-destination":"+1 ••• ••• ••00","expires-at":"2026-10-20T12:12:00.000Z",""" +
            """"resend-available-at":"2026-10-20T12:02:30.000Z","sends-remaining":4,"attempts-remaining":5}}"""

        fun fileJson(kind: String): String =
            """{"data":{"type":"file","id":"file_01M5CK3288G5K9T8DC51K68DDZ","attributes":{"kind":"$kind",""" +
                """"mime-type":"image/jpeg","byte-size":6,"created-at":"2026-10-20T12:03:01.000Z"},""" +
                """"relationships":{"verification":{"data":{"type":"verification/selfie","id":"$VERIFICATION_ID"}}}}}"""

        fun problemJson(status: Int): String = OpenVerifyJson.encodeToString(Problem.serializer(), PROBLEM.copy(status = status))

        fun headers(contentType: String, vararg extra: Pair<String, String>): Headers = Headers.build {
            append(HttpHeaders.ContentType, contentType)
            for ((name, value) in extra) append(name, value)
        }

        fun MockRequestHandleScope.json(status: Int, body: String, contentType: String = "application/json; charset=utf-8", vararg extra: Pair<String, String>) =
            respond(body, HttpStatusCode.fromValue(status), headers(contentType, *extra))

        fun ByteArray.indexOf(pattern: ByteArray, from: Int): Int =
            (from..size - pattern.size).first { start -> pattern.indices.all { this[start + it] == pattern[it] } }
    }
}
