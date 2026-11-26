package dev.openverify.sdk.api

import dev.openverify.sdk.camera.CapturedImage
import dev.openverify.sdk.model.AamvaInputs
import dev.openverify.sdk.model.CaptureMethod
import dev.openverify.sdk.model.FileKind
import dev.openverify.sdk.model.DocumentFile
import dev.openverify.sdk.model.CaptureTrigger
import dev.openverify.sdk.model.Fixtures
import dev.openverify.sdk.model.FlowConsent
import dev.openverify.sdk.model.FlowCryptoSubmit
import dev.openverify.sdk.model.FlowSubmitVerificationBody
import dev.openverify.sdk.model.InquiryStatus
import dev.openverify.sdk.model.OpenVerifyJson
import dev.openverify.sdk.model.OtpDestination
import dev.openverify.sdk.model.Problem
import dev.openverify.sdk.model.SelfieCaptureGuidance
import dev.openverify.sdk.model.SelfieCaptureUpload
import dev.openverify.sdk.model.SelfiePose
import dev.openverify.sdk.model.SessionCanceledReason
import dev.openverify.sdk.model.VerificationStatus
import dev.openverify.sdk.model.VerificationType
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.withTimeout
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import mockwebserver3.RecordedRequest
import okhttp3.Call
import okhttp3.EventListener
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.MultipartReader
import okhttp3.OkHttpClient
import okio.Buffer
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.assertArrayEquals
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertInstanceOf
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.assertThrows
import org.junit.jupiter.params.ParameterizedTest
import org.junit.jupiter.params.provider.CsvSource
import org.junit.jupiter.params.provider.ValueSource
import java.util.concurrent.TimeUnit
import kotlin.time.Duration.Companion.milliseconds
import kotlin.time.Duration.Companion.seconds

internal class FlowApiClientTest {

    private lateinit var server: MockWebServer
    private lateinit var client: FlowApiClient

    @BeforeEach
    fun startServer() {
        server = MockWebServer()
        server.start()
        client = FlowApiClient(server.url("/").toString(), TOKEN)
    }

    @AfterEach
    fun stopServer() {
        server.close()
    }

    // Requests ------------------------------------------------------------------------------

    @Test
    fun `getSession sends the session token and decodes the session`() = runTest {
        server.enqueue(json(200, Fixtures.read("api/flow-session.json")))

        val session = client.getSession()

        val request = server.takeRequest()
        assertEquals("GET", request.method)
        assertEquals("/api/v1/flow/session", request.url.encodedPath)
        assertEquals("Bearer $TOKEN", request.headers["Authorization"])
        assertEquals("application/json, application/problem+json", request.headers["Accept"])
        assertTrue(request.headers["User-Agent"]!!.startsWith("OpenVerify-Android/"), request.headers["User-Agent"])
        assertEquals("inq_01M5CJXHG07XPHF3HRM6NREDH7", session.inquiry.id)
        assertEquals(InquiryStatus.PENDING, session.inquiry.status)
    }

    @ParameterizedTest
    @ValueSource(strings = ["/openverify/", "/openverify"])
    fun `a path prefix in the base URL is kept`(prefix: String) = runTest {
        server.enqueue(json(200, Fixtures.read("api/flow-session.json")))

        FlowApiClient(server.url(prefix).toString(), TOKEN).getSession()

        assertEquals("/openverify/api/v1/flow/session", server.takeRequest().url.encodedPath)
    }

    @Test
    fun `acceptConsent posts the text keys and the locale`() = runTest {
        server.enqueue(json(200, """{"consent":{"accepted-at":"2026-10-20T12:00:30.000Z"}}"""))

        val consent = client.acceptConsent(listOf("consent.biometric", "consent.processing"), "en")

        val request = server.takeRequest()
        assertEquals("POST", request.method)
        assertEquals("/api/v1/flow/consent", request.url.encodedPath)
        assertEquals("application/json; charset=utf-8", request.headers["Content-Type"])
        assertEquals(
            buildJsonObject {
                put("accepted", true)
                put("text-keys", buildJsonArray { add(JsonPrimitive("consent.biometric")); add(JsonPrimitive("consent.processing")) })
                put("locale", "en")
            },
            request.jsonBody(),
        )
        assertEquals(FlowConsent("2026-10-20T12:00:30.000Z"), consent)
    }

    @Test
    fun `createVerification sends the API type and leaves out absent options`() = runTest {
        server.enqueue(json(201, verificationJson("initiated")))
        server.enqueue(json(201, verificationJson("initiated")))
        server.enqueue(json(201, verificationJson("initiated", "verification/selfie")))

        val created = client.createVerification(VerificationType.GOVERNMENT_ID)
        client.createVerification(VerificationType.GOVERNMENT_ID, country = "US", idClass = "passport")
        client.createVerification(VerificationType.SELFIE)

        val first = server.takeRequest()
        assertEquals("/api/v1/flow/verifications", first.url.encodedPath)
        assertEquals(buildJsonObject { put("type", "government-id") }, first.jsonBody())
        assertEquals(
            buildJsonObject {
                put("type", "government-id")
                put("country", "US")
                put("id-class", "passport")
            },
            server.takeRequest().jsonBody(),
        )
        assertEquals(buildJsonObject { put("type", "selfie") }, server.takeRequest().jsonBody())
        assertEquals(VERIFICATION_ID, created.id)
        assertEquals(VerificationStatus.INITIATED, created.attributes.status)
    }

    @Test
    fun `createVerification refuses a type the flow API does not create`() = runTest {
        assertThrows<IllegalArgumentException> { client.createVerification(VerificationType.UNKNOWN) }
        assertEquals(0, server.requestCount)
    }

    @Test
    fun `uploadFile sends the kind and the image as multipart form data`() = runTest {
        server.enqueue(json(201, fileJson("selfie-center")))
        val image = CapturedImage(JPEG_BYTES, "image/jpeg")

        val file = client.uploadFile(VERIFICATION_ID, FileKind.SELFIE_CENTER, image)

        val request = server.takeRequest()
        assertEquals("POST", request.method)
        assertEquals("/api/v1/flow/verifications/$VERIFICATION_ID/files", request.url.encodedPath)
        val contentType = request.headers["Content-Type"]!!.toMediaType()
        assertEquals("multipart/form-data", "${contentType.type}/${contentType.subtype}")
        val parts = MultipartReader(Buffer().write(request.body!!), contentType.parameter("boundary")!!).use { reader ->
            generateSequence { reader.nextPart() }.map { part ->
                part.headers["Content-Disposition"]!! to (part.headers["Content-Type"] to part.body.readByteArray())
            }.toList()
        }
        assertEquals(2, parts.size)
        val (kindDisposition, kind) = parts[0]
        assertEquals("form-data; name=\"kind\"", kindDisposition)
        assertEquals("selfie-center", String(kind.second))
        val (fileDisposition, filePart) = parts[1]
        assertEquals("form-data; name=\"file\"; filename=\"selfie-center.jpg\"", fileDisposition)
        assertEquals("image/jpeg", filePart.first)
        assertArrayEquals(JPEG_BYTES, filePart.second)
        assertEquals(FileKind.SELFIE_CENTER, file.attributes.kind)
    }

    @Test
    fun `uploadFile refuses the UNKNOWN placeholder kind and sends nothing (C50_6)`() = runTest {
        server.enqueue(json(422, "{}"))
        val image = CapturedImage(JPEG_BYTES, "image/jpeg")

        assertThrows<IllegalArgumentException> { client.uploadFile(VERIFICATION_ID, FileKind.UNKNOWN, image) }
        assertEquals(0, server.requestCount)
    }

    @Test
    fun `submitVerification posts an empty JSON object to submit`() = runTest {
        server.enqueue(json(200, verificationJson("submitted")))

        val submitted = client.submitVerification(VERIFICATION_ID)

        val request = server.takeRequest()
        assertEquals("POST", request.method)
        assertEquals("/api/v1/flow/verifications/$VERIFICATION_ID/submit", request.url.encodedPath)
        assertEquals("{}", request.body!!.utf8())
        assertEquals(VerificationStatus.SUBMITTED, submitted.attributes.status)
    }

    // Matching consent (C42.3) ------------------------------------------------------------------

    @Test
    fun `acceptConsent sends the optional texts the user ticked apart from the required ones`() = runTest {
        server.enqueue(json(200, """{"consent":{"accepted-at":"2026-10-20T12:00:30.000Z"}}"""))

        client.acceptConsent(listOf("consent.biometric", "consent.processing"), "es", listOf("consent.biometric-matching"))

        assertEquals(
            buildJsonObject {
                put("accepted", true)
                put("text-keys", buildJsonArray { add(JsonPrimitive("consent.biometric")); add(JsonPrimitive("consent.processing")) })
                put("optional-text-keys", buildJsonArray { add(JsonPrimitive("consent.biometric-matching")) })
                put("locale", "es")
            },
            server.takeRequest().jsonBody(),
        )
    }

    @Test
    fun `acceptConsent leaves optional-text-keys out when none was ticked, as servers before Phase 4 expect`() = runTest {
        server.enqueue(json(200, """{"consent":{"accepted-at":"2026-10-20T12:00:30.000Z"}}"""))

        client.acceptConsent(listOf("consent.biometric"), "en", emptyList())

        assertFalse(server.takeRequest().body!!.utf8().contains("optional-text-keys"))
    }

    // Selfie captures (C40.2-C40.4) ---------------------------------------------------------------

    @ParameterizedTest
    @CsvSource("CAMERA, camera", "UPLOAD, upload")
    fun `createSelfieCapture posts the method and decodes the golden capture`(method: CaptureMethod, wire: String) = runTest {
        server.enqueue(json(201, Fixtures.read("flow/selfie-capture-created.json")))

        val capture = client.createSelfieCapture(VERIFICATION_ID, method)

        val request = server.takeRequest()
        assertEquals("POST", request.method)
        assertEquals("/api/v1/flow/verifications/$VERIFICATION_ID/selfies", request.url.encodedPath)
        assertEquals("Bearer $TOKEN", request.headers["Authorization"])
        assertEquals(buildJsonObject { put("method", wire) }, request.jsonBody())
        assertEquals("selfie", capture.type)
        assertEquals(CAPTURE_ID, capture.id)
        assertEquals(listOf(SelfiePose.CENTER, SelfiePose.RIGHT, SelfiePose.LEFT), capture.attributes.prompts)
        assertEquals(NONCE, capture.attributes.nonce)
        assertEquals("2026-10-21T12:03:00.000Z", capture.attributes.expiresAt)
        assertEquals(SelfieCaptureGuidance(0.021, 0.077, 500), capture.attributes.guidance)
    }

    @ParameterizedTest(name = "{0}")
    @CsvSource(
        delimiter = '|',
        value = [
            "an id that is not self_ and a ULID | ver_01M5CJXHG07XPHF3HRM6NREDH9 | E2eSyntheticNonce00000 | \"center\",\"left\"",
            "a nonce of the wrong length | self_01M5CJXHG07XPHF3HRM6NREDH9 | short | \"center\"",
            "a nonce that is not base64url | self_01M5CJXHG07XPHF3HRM6NREDH9 | E2eSyntheticNonce0000/ | \"center\"",
            "no prompt | self_01M5CJXHG07XPHF3HRM6NREDH9 | E2eSyntheticNonce00000 | ''",
            "a first prompt other than center | self_01M5CJXHG07XPHF3HRM6NREDH9 | E2eSyntheticNonce00000 | \"left\",\"center\"",
            "a pose prompted twice | self_01M5CJXHG07XPHF3HRM6NREDH9 | E2eSyntheticNonce00000 | \"center\",\"left\",\"left\"",
        ],
    )
    fun `a created capture that breaks the contract is an InvalidResponse`(case: String, id: String, nonce: String, prompts: String) =
        runTest {
            server.enqueue(
                json(
                    201,
                    """{"data":{"type":"selfie","id":"$id","attributes":{"prompts":[$prompts],""" +
                        """"expires-at":"2026-10-21T12:03:00.000Z","nonce":"$nonce",""" +
                        """"guidance":{"max-center-yaw-ratio":0.021,"min-side-yaw-ratio-change":0.077,"hold-ms":500}}}}""",
                ),
            )

            assertThrows<FlowApiException.InvalidResponse>(case) { client.createSelfieCapture(VERIFICATION_ID, CaptureMethod.CAMERA) }
        }

    @Test
    fun `uploadFile sends the client-reported capture-method and capture-trigger after the capture fields and before the file (C206)`() = runTest {
        server.enqueue(json(201, fileJson("selfie-right")))
        val image = CapturedImage(JPEG_BYTES, "image/jpeg")

        client.uploadFile(VERIFICATION_ID, FileKind.SELFIE_RIGHT, image, SelfieCaptureUpload(CAPTURE_ID, NONCE, 4_250), CaptureMethod.CAMERA, CaptureTrigger.AUTO)

        val parts = server.takeRequest().multipartParts()
        assertEquals(
            listOf(
                "form-data; name=\"kind\"" to "selfie-right",
                "form-data; name=\"capture-id\"" to CAPTURE_ID,
                "form-data; name=\"nonce\"" to NONCE,
                "form-data; name=\"client-elapsed-ms\"" to "4250",
                "form-data; name=\"capture-method\"" to "camera",
                "form-data; name=\"capture-trigger\"" to "auto",
            ),
            parts.dropLast(1).map { (disposition, part) -> disposition to String(part.second) },
        )
        assertEquals("form-data; name=\"file\"; filename=\"selfie-right.jpg\"", parts.last().first)
    }

    @Test
    fun `uploadDocument sends its capture-method before the file, and no trigger (C206_1)`() = runTest {
        server.enqueue(json(201, fileJson("document")))

        client.uploadDocument(VERIFICATION_ID, DocumentFile("%PDF-1.7\n%synthetic\n".encodeToByteArray(), "application/pdf"), CaptureMethod.UPLOAD)

        val parts = server.takeRequest().multipartParts()
        assertEquals(
            listOf("form-data; name=\"kind\"" to "document", "form-data; name=\"capture-method\"" to "upload"),
            parts.dropLast(1).map { (disposition, part) -> disposition to String(part.second) },
        )
    }

    @Test
    fun `uploadFile sends a selfie pose with its capture id, nonce and elapsed time, all before the file`() = runTest {
        server.enqueue(json(201, fileJson("selfie-right")))
        val image = CapturedImage(JPEG_BYTES, "image/jpeg")

        client.uploadFile(VERIFICATION_ID, FileKind.SELFIE_RIGHT, image, SelfieCaptureUpload(CAPTURE_ID, NONCE, 4_250))

        val parts = server.takeRequest().multipartParts()
        assertEquals(
            listOf(
                "form-data; name=\"kind\"" to "selfie-right",
                "form-data; name=\"capture-id\"" to CAPTURE_ID,
                "form-data; name=\"nonce\"" to NONCE,
                "form-data; name=\"client-elapsed-ms\"" to "4250",
            ),
            parts.dropLast(1).map { (disposition, part) -> disposition to String(part.second) },
        )
        assertEquals("form-data; name=\"file\"; filename=\"selfie-right.jpg\"", parts.last().first)
        assertArrayEquals(JPEG_BYTES, parts.last().second.second)
    }

    @Test
    fun `uploadFile sends no capture fields for a government ID side`() = runTest {
        server.enqueue(json(201, fileJson("front")))

        client.uploadFile(VERIFICATION_ID, FileKind.FRONT, CapturedImage(JPEG_BYTES, "image/jpeg"))

        assertEquals(listOf("form-data; name=\"kind\"", "form-data; name=\"file\"; filename=\"front.jpg\""), server.takeRequest().multipartParts().map { it.first })
    }

    @Test
    fun `submitVerification names the capture it consumes, with the device snapshot, as the golden body`() = runTest {
        server.enqueue(json(202, verificationJson("submitted", "verification/selfie")))
        val golden = Fixtures.read("flow/selfie-capture-submit.json")
        val capture = OpenVerifyJson.decodeFromString<FlowSubmitVerificationBody>(golden).capture!!

        val submitted = client.submitVerification(VERIFICATION_ID, capture)

        val request = server.takeRequest()
        assertEquals("/api/v1/flow/verifications/$VERIFICATION_ID/submit", request.url.encodedPath)
        assertEquals(OpenVerifyJson.parseToJsonElement(golden).withWholeNumbers(), request.jsonBody().withWholeNumbers())
        assertEquals(VerificationStatus.SUBMITTED, submitted.attributes.status)
    }

    @Test
    fun `getVerification reads one verification`() = runTest {
        server.enqueue(json(200, verificationJson("passed")))

        val verification = client.getVerification(VERIFICATION_ID)

        val request = server.takeRequest()
        assertEquals("GET", request.method)
        assertEquals("/api/v1/flow/verifications/$VERIFICATION_ID", request.url.encodedPath)
        assertEquals(VerificationStatus.PASSED, verification.attributes.status)
    }

    @ParameterizedTest
    @ValueSource(strings = ["..", "../session", "ver_short", "ver_01M5CK16P0D13FXHZSS4TCFBVU", ""])
    fun `verification IDs that are not ver_ ULIDs are refused before any request`(id: String) = runTest {
        assertThrows<IllegalArgumentException> { client.getVerification(id) }
        assertThrows<IllegalArgumentException> { client.submitVerification(id) }
        assertThrows<IllegalArgumentException> { client.createSelfieCapture(id, CaptureMethod.CAMERA) }
        assertEquals(0, server.requestCount)
    }

    // Polling -------------------------------------------------------------------------------

    @Test
    fun `pollVerification returns as soon as the verification is decided`() = runTest {
        server.enqueue(json(200, verificationJson("submitted")))
        server.enqueue(json(200, verificationJson("submitted")))
        server.enqueue(json(200, verificationJson("failed")))

        val verification = client.pollVerification(VERIFICATION_ID, interval = 10.milliseconds, maxAttempts = 5)

        assertEquals(VerificationStatus.FAILED, verification.attributes.status)
        assertEquals(3, server.requestCount)
    }

    @Test
    fun `pollVerification gives up after the last attempt`() = runTest {
        repeat(3) { server.enqueue(json(200, verificationJson("submitted"))) }

        val error = assertThrows<FlowApiException.StillProcessing> {
            client.pollVerification(VERIFICATION_ID, interval = 1.seconds, maxAttempts = 3)
        }

        assertEquals(VERIFICATION_ID, error.verificationId)
        assertEquals(3, server.requestCount)
    }

    @ParameterizedTest
    @ValueSource(strings = ["passed", "failed", "requires_retry", "canceled", "skipped"])
    fun `these verification statuses end polling`(status: String) = runTest {
        server.enqueue(json(200, verificationJson(status)))

        client.pollVerification(VERIFICATION_ID, maxAttempts = 1)

        assertEquals(1, server.requestCount)
    }

    // Errors --------------------------------------------------------------------------------

    @ParameterizedTest(name = "HTTP {0} -> {1}")
    @CsvSource(
        "400, Rejected",
        "401, Unauthorized",
        "403, Forbidden",
        "404, NotFound",
        "409, Conflict",
        "410, Redacted",
        "413, Rejected",
        "415, Rejected",
        "422, Rejected",
        "429, RateLimited",
        "500, ServerError",
        "503, ServerError",
        "418, UnexpectedStatus",
    )
    fun `error statuses map to FlowApiException with the problem body`(status: Int, expected: String) = runTest {
        server.enqueue(problem(status).newBuilder().addHeader("x-request-id", "req-from-header").build())

        val error = runCatching { client.getSession() }.exceptionOrNull()

        val http = assertInstanceOf(FlowApiException.Http::class.java, error)
        assertEquals(expected, http::class.simpleName)
        assertEquals(status, http.status)
        assertEquals(PROBLEM.copy(status = status), http.problem)
        assertEquals("req-from-header", http.requestId)
    }

    @Test
    fun `an inactive session's 401 keeps its code (C10)`() = runTest {
        server.enqueue(
            MockResponse.Builder().code(401).addHeader("Content-Type", "application/problem+json")
                .body("""{"type":"about:blank","title":"Unauthorized","status":401,"code":"session_canceled"}""")
                .build(),
        )

        val error = assertThrows<FlowApiException.Unauthorized> { client.getSession() }

        assertEquals("session_canceled", error.problem?.code)
    }

    @Test
    fun `a canceled session's 401 keeps its reason, from the golden problem (C25)`() = runTest {
        server.enqueue(
            MockResponse.Builder().code(401).addHeader("Content-Type", "application/problem+json")
                .body(Fixtures.read("problems/session-canceled-inquiry-expired.json"))
                .build(),
        )

        val error = assertThrows<FlowApiException.Unauthorized> { client.getSession() }

        assertEquals("session_canceled", error.problem?.code)
        assertEquals(SessionCanceledReason.INQUIRY_EXPIRED, error.problem?.reason)
    }

    @Test
    fun `the request ID falls back to the problem body`() = runTest {
        server.enqueue(problem(409))

        val error = assertThrows<FlowApiException.Conflict> { client.acceptConsent(listOf("consent.biometric"), "en") }

        assertEquals(PROBLEM.requestId, error.requestId)
        // C213.3: the message is fixed; the problem's title stays out of it.
        assertEquals("HTTP 409", error.message)
    }

    @Test
    fun `an error without a JSON body maps by status alone`() = runTest {
        server.enqueue(
            MockResponse.Builder().code(502).addHeader("Content-Type", "text/html").body("<h1>Bad gateway</h1>").build(),
        )

        val error = assertThrows<FlowApiException.ServerError> { client.getSession() }

        assertNull(error.problem)
        assertNull(error.requestId)
        assertEquals("HTTP 502", error.message)
    }

    @Test
    fun `Retry-After seconds are exposed on 429`() = runTest {
        server.enqueue(problem(429).newBuilder().addHeader("Retry-After", "30").build())

        val error = assertThrows<FlowApiException.RateLimited> { client.getSession() }

        assertEquals(30L, error.retryAfterSeconds)
    }

    @Test
    fun `a success body that is not the contract JSON is an InvalidResponse`() = runTest {
        server.enqueue(json(200, """{"unexpected":true}"""))

        assertThrows<FlowApiException.InvalidResponse> { client.getSession() }
    }

    @Test
    fun `a create answered 201 without the contract's attributes is an InvalidResponse, which the coordinator takes as made (2E follow-up)`() = runTest {
        server.enqueue(json(201, """{"data":{"type":"verification/government-id","id":"ver_01M5CJZC301G4JHXZQ3PZBYH3Q"}}"""))

        assertThrows<FlowApiException.InvalidResponse> { client.createVerification(VerificationType.GOVERNMENT_ID) }
        assertEquals(1, server.requestCount)
    }

    @Test
    fun `redirects are not followed, so the token never leaves the API origin`() = runTest {
        server.enqueue(MockResponse.Builder().code(302).addHeader("Location", "https://elsewhere.example/").build())

        val error = assertThrows<FlowApiException.UnexpectedStatus> { client.getSession() }

        assertEquals(302, error.status)
        assertEquals(1, server.requestCount)
    }

    @Test
    fun `a connection failure is a Network error`() = runTest {
        val unreachable = server.url("/").toString()
        server.close()

        val error = assertThrows<FlowApiException.Network> { FlowApiClient(unreachable, TOKEN).getSession() }

        assertInstanceOf(java.io.IOException::class.java, error.cause)
    }

    @ParameterizedTest(name = "{0} timeout")
    @ValueSource(strings = ["read", "call"])
    fun `an OkHttp timeout is a Network error, which the flow treats as a lost answer (2D F018)`(kind: String): Unit = runBlocking {
        server.enqueue(json(201, "{}").newBuilder().headersDelay(30, TimeUnit.SECONDS).build())
        val http = OkHttpClient.Builder().apply {
            if (kind == "read") readTimeout(200, TimeUnit.MILLISECONDS) else callTimeout(200, TimeUnit.MILLISECONDS)
        }.build()

        val error = assertThrows<FlowApiException.Network> {
            FlowApiClient(server.url("/").toString(), TOKEN, http).createVerification(VerificationType.GOVERNMENT_ID)
        }

        assertInstanceOf(java.io.InterruptedIOException::class.java, error.cause)
    }

    @Test
    fun `cancelling the caller cancels the HTTP call`() = runBlocking {
        val canceled = CompletableDeferred<Unit>()
        val http = OkHttpClient.Builder()
            .eventListener(
                object : EventListener() {
                    override fun canceled(call: Call) {
                        canceled.complete(Unit)
                    }
                },
            )
            .build()
        server.enqueue(json(200, Fixtures.read("api/flow-session.json")).newBuilder().headersDelay(30, TimeUnit.SECONDS).build())
        val job = launch(Dispatchers.Default) { FlowApiClient(server.url("/").toString(), TOKEN, http).getSession() }

        server.takeRequest(5, TimeUnit.SECONDS)
        job.cancelAndJoin()

        withTimeout(5.seconds) { canceled.await() }
    }

    // Arguments -----------------------------------------------------------------------------

    @ParameterizedTest
    @ValueSource(
        strings = [
            "key_01M5CJXHG07XPHF3HRM6NREDH7.secret",
            "ovs_too-short",
            "ovs_tttttttttttttttttttttttttttttttttttttttttt!",
            "Bearer ovs_ttttttttttttttttttttttttttttttttttttttttttt",
            "",
        ],
    )
    fun `anything but an ovs_ session token is refused, without echoing it`(token: String) {
        val error = assertThrows<IllegalArgumentException> { FlowApiClient("https://api.example.com", token) }

        if (token.isNotEmpty()) assertFalse(error.message!!.contains(token), error.message)
    }

    @ParameterizedTest
    @ValueSource(
        strings = [
            "api.example.com",
            "ftp://api.example.com",
            "http://api.example.com",
            "http://192.168.1.20:3000",
            "https://api.example.com/?tenant=1",
            "https://user:pass@api.example.com",
        ],
    )
    fun `base URLs that are not https, or that carry a query or credentials, are refused`(url: String) {
        assertThrows<IllegalArgumentException> { FlowApiClient(url, TOKEN) }
    }

    @ParameterizedTest
    @ValueSource(
        strings = [
            "https://api.example.com",
            "http://10.0.2.2:3000",
            "http://localhost:3000",
            "http://127.0.0.1:3000/",
            "http://[::1]:3000",
        ],
    )
    fun `https and local development hosts are accepted`(url: String) {
        FlowApiClient(url, TOKEN)
    }

    // The Phase 5 calls on the wire (C52.3, C52.7, C55, C57) -------------------------------

    @Test
    fun `a code is sent and confirmed as JSON, and the golden OTP problems map to the exceptions the flow branches on (C52_7)`() = runTest {
        server.enqueue(json(200, verificationJson("initiated", "verification/email-address")))
        server.enqueue(goldenProblem("otp-incorrect"))
        server.enqueue(goldenProblem("otp-resend-too-soon"))
        server.enqueue(goldenProblem("otp-delivery-failed"))
        server.enqueue(goldenProblem("otp-rate-limited"))
        server.enqueue(goldenProblem("otp-attempts-exhausted"))
        val email = OtpDestination.Email("jane@example.test")

        client.sendOtp(VERIFICATION_ID, email)
        val incorrect = assertThrows<FlowApiException.Rejected> { client.confirmOtp(VERIFICATION_ID, "000000") }
        val tooSoon = assertThrows<FlowApiException.RateLimited> { client.sendOtp(VERIFICATION_ID, email) }
        val undelivered = assertThrows<FlowApiException.ServerError> { client.sendOtp(VERIFICATION_ID, email) }
        val limited = assertThrows<FlowApiException.RateLimited> { client.sendOtp(VERIFICATION_ID, email) }
        val exhausted = assertThrows<FlowApiException.Conflict> { client.confirmOtp(VERIFICATION_ID, "000000") }

        val send = server.takeRequest()
        assertEquals("POST", send.method)
        assertEquals("/api/v1/flow/verifications/$VERIFICATION_ID/otp", send.url.encodedPath)
        assertEquals("application/json; charset=utf-8", send.headers["Content-Type"])
        assertEquals(buildJsonObject { put("email-address", "jane@example.test") }, send.jsonBody())
        val confirm = server.takeRequest()
        assertEquals("/api/v1/flow/verifications/$VERIFICATION_ID/otp/confirm", confirm.url.encodedPath)
        assertEquals(buildJsonObject { put("code", "000000") }, confirm.jsonBody())
        assertEquals("otp_incorrect" to 4, incorrect.problem?.code to incorrect.problem?.attemptsRemaining)
        assertEquals("2026-10-20T12:01:00.000Z", tooSoon.problem?.resendAvailableAt)
        assertEquals(502 to "otp_delivery_failed", undelivered.status to undelivered.problem?.code)
        assertEquals("otp_rate_limited", limited.problem?.code)
        assertEquals("otp_attempts_exhausted", exhausted.problem?.code)
    }

    @Test
    fun `values are entered, and a wallet challenge created and signed, as JSON (C52_3, C57)`() = runTest {
        server.enqueue(json(200, verificationJson("initiated", "verification/aamva")))
        server.enqueue(json(201, """{"id":"$CHALLENGE_ID","message":"Sign this","expires-at":"2026-10-20T12:10:00.000Z"}"""))
        server.enqueue(goldenProblem("crypto-challenge-invalid"))
        server.enqueue(json(202, verificationJson("submitted", "verification/crypto-wallet")))

        val entered = client.enterInputs(VERIFICATION_ID, AamvaInputs("Jane", "Example", "1990-04-23", "D1234567", "CA"))
        val challenge = client.createCryptoChallenge(VERIFICATION_ID, "eip155:1", "0x000000000000000000000000000000000000dEaD")
        val refused = assertThrows<FlowApiException.Conflict> { client.submitCryptoSignature(VERIFICATION_ID, FlowCryptoSubmit(CHALLENGE_ID, "0xab")) }
        val submitted = client.submitCryptoSignature(VERIFICATION_ID, FlowCryptoSubmit(CHALLENGE_ID, "0xcd"))

        val inputs = server.takeRequest()
        assertEquals("/api/v1/flow/verifications/$VERIFICATION_ID/inputs", inputs.url.encodedPath)
        assertEquals("application/json; charset=utf-8", inputs.headers["Content-Type"])
        assertEquals(
            buildJsonObject {
                put("name-first", "Jane")
                put("name-last", "Example")
                put("birthdate", "1990-04-23")
                put("identification-number", "D1234567")
                put("issuing-authority", "CA")
            },
            inputs.jsonBody(),
        )
        val created = server.takeRequest()
        assertEquals("/api/v1/flow/verifications/$VERIFICATION_ID/crypto-challenges", created.url.encodedPath)
        assertEquals(
            buildJsonObject {
                put("chain-id", "eip155:1")
                put("wallet-address", "0x000000000000000000000000000000000000dEaD")
            },
            created.jsonBody(),
        )
        server.takeRequest()
        val submit = server.takeRequest()
        assertEquals("/api/v1/flow/verifications/$VERIFICATION_ID/submit", submit.url.encodedPath)
        assertEquals(
            buildJsonObject {
                put("crypto", buildJsonObject {
                    put("challenge-id", CHALLENGE_ID)
                    put("signature", "0xcd")
                })
            },
            submit.jsonBody(),
        )
        assertEquals(VerificationStatus.INITIATED, entered.attributes.status)
        assertEquals("Sign this", challenge.message)
        assertEquals("crypto_challenge_invalid", refused.problem?.code)
        assertEquals(VerificationStatus.SUBMITTED, submitted.attributes.status)
    }

    // Helpers -------------------------------------------------------------------------------

    /** A golden `problems/flow/` answer (C52.7), with its own status. */
    private fun goldenProblem(name: String): MockResponse {
        val body = Fixtures.read("problems/flow/$name.json")
        val status = OpenVerifyJson.decodeFromString<Problem>(body).status!!
        return MockResponse.Builder().code(status).addHeader("Content-Type", "application/problem+json").body(body).build()
    }

    private fun RecordedRequest.jsonBody(): JsonElement = OpenVerifyJson.parseToJsonElement(body!!.utf8())

    /** Each multipart part as its `Content-Disposition` and its `Content-Type` and bytes, in order. */
    private fun RecordedRequest.multipartParts(): List<Pair<String, Pair<String?, ByteArray>>> {
        val contentType = headers["Content-Type"]!!.toMediaType()
        assertEquals("multipart/form-data", "${contentType.type}/${contentType.subtype}")
        return MultipartReader(Buffer().write(body!!), contentType.parameter("boundary")!!).use { reader ->
            generateSequence { reader.nextPart() }.map { part ->
                part.headers["Content-Disposition"]!! to (part.headers["Content-Type"] to part.body.readByteArray())
            }.toList()
        }
    }

    /** The same JSON with whole numbers written alike: `30` and `30.0` are one JSON number. */
    private fun JsonElement.withWholeNumbers(): JsonElement = when (this) {
        is JsonObject -> JsonObject(mapValues { (_, value) -> value.withWholeNumbers() })
        is JsonArray -> JsonArray(map { it.withWholeNumbers() })
        is JsonPrimitive -> {
            val number = if (isString) null else content.toDoubleOrNull()
            if (number != null && number % 1.0 == 0.0) JsonPrimitive(number.toLong()) else this
        }
    }

    private fun json(code: Int, body: String): MockResponse =
        MockResponse.Builder().code(code).addHeader("Content-Type", "application/json; charset=utf-8").body(body).build()

    private fun problem(status: Int): MockResponse =
        MockResponse.Builder()
            .code(status)
            .addHeader("Content-Type", "application/problem+json; charset=utf-8")
            .body(OpenVerifyJson.encodeToString(Problem.serializer(), PROBLEM.copy(status = status)))
            .build()

    private fun verificationJson(status: String, type: String = "verification/government-id"): String =
        """{"data":{"type":"$type","id":"$VERIFICATION_ID","attributes":{"status":"$status","retry-hints":[],""" +
            """"created-at":"2026-10-20T12:02:00.000Z","updated-at":"2026-10-20T12:02:00.000Z"}}}"""

    private fun fileJson(kind: String): String =
        """{"data":{"type":"file","id":"file_01M5CK3288G5K9T8DC51K68DDZ","attributes":{"kind":"$kind",""" +
            """"mime-type":"image/jpeg","byte-size":${JPEG_BYTES.size},"created-at":"2026-10-20T12:03:01.000Z"},""" +
            """"relationships":{"verification":{"data":{"type":"verification/selfie","id":"$VERIFICATION_ID"}}}}}"""

    companion object {
        /** Synthetic session token: the `ovs_` prefix plus 43 base64url characters. */
        val TOKEN = "ovs_" + "t".repeat(43)
        const val VERIFICATION_ID = "ver_01M5CK16P0D13FXHZSS4TCFBVH"
        const val CHALLENGE_ID = "cwc_01M5CK16P0D13FXHZSS4TCFBVH"

        /** The golden capture's id and synthetic nonce (`contracts/fixtures/flow/selfie-capture-created.json`). */
        const val CAPTURE_ID = "self_01M5CJXHG07XPHF3HRM6NREDH9"
        const val NONCE = "E2eSyntheticNonce00000"
        val JPEG_BYTES = byteArrayOf(0xFF.toByte(), 0xD8.toByte(), 0xFF.toByte(), 0xE0.toByte(), 0x00, 0x10)
        val PROBLEM = Problem(
            type = "about:blank",
            title = "Conflict",
            status = 409,
            detail = "Consent is required before uploading files.",
            instance = "/api/v1/flow/consent",
            requestId = "00000000-0000-4000-8000-000000000002",
        )
    }
}
