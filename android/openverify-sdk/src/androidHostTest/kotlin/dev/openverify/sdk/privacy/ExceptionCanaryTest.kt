package dev.openverify.sdk.privacy

import android.content.Intent
import dev.openverify.sdk.ExperimentalOpenVerifyApi
import dev.openverify.sdk.InquiryResult
import dev.openverify.sdk.InquiryResults
import dev.openverify.sdk.OpenVerifyInquiry
import dev.openverify.sdk.api.FlowApi
import dev.openverify.sdk.api.FlowApiClient
import dev.openverify.sdk.api.FlowApiException
import dev.openverify.sdk.api.OneTimeLinkClient
import dev.openverify.sdk.api.flowHttpClient
import dev.openverify.sdk.camera.CapturedImage
import dev.openverify.sdk.chip.ChipReadException
import dev.openverify.sdk.chip.ChipReadFailure
import dev.openverify.sdk.model.CaptureMethod
import dev.openverify.sdk.model.ClientUnableReason
import dev.openverify.sdk.model.DatabaseInputs
import dev.openverify.sdk.model.DocumentFile
import dev.openverify.sdk.model.FileKind
import dev.openverify.sdk.model.FlowChipSubmit
import dev.openverify.sdk.model.FlowCryptoSubmit
import dev.openverify.sdk.model.FlowSignals
import dev.openverify.sdk.model.FlowValue
import dev.openverify.sdk.model.InquiryStatus
import dev.openverify.sdk.model.OtpDestination
import dev.openverify.sdk.model.VerificationType
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.headersOf
import kotlinx.coroutines.test.runTest
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.DynamicTest
import org.junit.jupiter.api.DynamicTest.dynamicTest
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.TestFactory
import java.io.File

/**
 * C213.3 (review P06, V03), over every module now present: every exception the SDK creates or lets
 * reach a host carries a code and a fixed message. 10A's `FlowApiExceptionCanaryTest` feeds a session
 * through every kind of decoding failure; this test feeds a canary through **every call** of the flow
 * API client, in what the person typed (the arguments) and in what the server answers (a broken body,
 * a wrong type, an unknown enum value, a problem's title and detail, a body that is no JSON), and
 * through the one-time-link redemption, the chip reader's exception and a result intent. The canary
 * is in no message, `toString`, trace, cause or suppressed exception of anything thrown.
 *
 * The modules: `:openverify-sdk`, whose calls are the table below, held to `FlowApiClient`'s own list;
 * each optional artifact (`openverify-nfc`, `openverify-face`), whose own table of the exceptions its
 * sources create or throw on ([SdkModule.exceptionRows], in the artifact's test resources, filled by
 * its builder) is held to its sources and to the fixed-message rule by [ModuleExceptions] (KP10-42):
 * a module that gains a throwing line without its row fails, and so does a row that carries a value.
 */
@OptIn(ExperimentalOpenVerifyApi::class)
internal class ExceptionCanaryTest {

    private class Call(val name: String, val decodes: Boolean, val run: suspend (FlowApi) -> Any?)

    /** Every call of the flow API client, with the canary wherever the call carries what a person typed or a device read. */
    private val calls: List<Call> = listOf(
        Call("getSession", true) { it.getSession() },
        Call("acceptConsent", true) { it.acceptConsent(listOf("consent.checkbox"), "en", listOf(CANARY)) },
        Call("sendSignals", false) { it.sendSignals(FlowSignals(collectorVersion = 1, screen = CANARY, sequence = 0)) },
        Call("submitScreen", true) { it.submitScreen("about", mapOf("nickname" to FlowValue.Text(CANARY)), null) },
        Call("extendSelfieCapture", true) { it.extendSelfieCapture(CAPTURE) },
        Call("createIntegrityChallenge", true) { it.createIntegrityChallenge() },
        Call("sendIntegrityToken", false) { it.sendIntegrityToken(INTEGRITY_CHALLENGE, CANARY) },
        Call("createChipChallenge", true) { it.createChipChallenge(VERIFICATION) },
        Call("uploadChipFile", true) { it.uploadChipFile(VERIFICATION, FileKind.CHIP_DG1, CANARY.encodeToByteArray()) },
        Call("submitChip", true) { it.submitChip(VERIFICATION, FlowChipSubmit(CHIP_CHALLENGE, "0123456789abcdef")) },
        Call("reportClientUnable", true) { it.reportClientUnable(VERIFICATION, ClientUnableReason.NFC_UNAVAILABLE) },
        Call("requestSandboxChip", true) { it.requestSandboxChip(VERIFICATION, CHIP_CHALLENGE) },
        // C238.4, C237.6 (Workflow 11A, clients-connect): the share-consent exits carry digests and a step id only.
        Call("acceptShareConsent", true) { it.acceptShareConsent("share_back", "0".repeat(64), null, explicitBiometric = false) },
        Call("declineShareConsent", true) { it.declineShareConsent("share_back") },
        Call("withdrawShareConsent", true) { it.withdrawShareConsent("share_back") },
        // The asset's bytes are returned as they come: nothing is decoded.
        Call("fetchThemeAsset", false) { it.fetchThemeAsset(THEME_ASSET) },
        Call("createVerification", true) { it.createVerification(VerificationType.GOVERNMENT_ID, CANARY, CANARY) },
        Call("createSelfieCapture", true) { it.createSelfieCapture(VERIFICATION, CaptureMethod.CAMERA) },
        Call("uploadFile", true) { it.uploadFile(VERIFICATION, FileKind.FRONT, CapturedImage(CANARY.encodeToByteArray(), "image/jpeg")) },
        Call("uploadDocument", true) { it.uploadDocument(VERIFICATION, DocumentFile(CANARY.encodeToByteArray(), "application/pdf")) },
        Call("submitVerification", true) { it.submitVerification(VERIFICATION) },
        Call("getVerification", true) { it.getVerification(VERIFICATION) },
        Call("sendOtp", true) { it.sendOtp(VERIFICATION, OtpDestination.Email("$CANARY@example.com")) },
        Call("confirmOtp", true) { it.confirmOtp(VERIFICATION, CANARY) },
        Call("enterInputs", true) { it.enterInputs(VERIFICATION, DatabaseInputs(nameFirst = CANARY)) },
        Call("createCryptoChallenge", true) { it.createCryptoChallenge(VERIFICATION, "eip155:1", CANARY) },
        Call("submitCryptoSignature", true) { it.submitCryptoSignature(VERIFICATION, FlowCryptoSubmit(CRYPTO_CHALLENGE, CANARY)) },
    )

    private class Answer(val name: String, val status: Int, val body: String, val contentType: String = "application/json", val decodable: Boolean = false)

    /** What a server, or something in its place, can answer, each with the canary in it. */
    private val answers: List<Answer> = listOf(
        Answer("malformed JSON", 200, """{"data":{"id":"$CANARY","""),
        Answer("a JSON string", 200, "\"$CANARY\""),
        Answer(
            "every member the canary, where an id, an enum value, a time or a list is read",
            200,
            """{"data":{"type":"$CANARY","id":"$CANARY","attributes":{"status":"$CANARY","expires-at":"$CANARY","nonce":"$CANARY","prompts":["$CANARY"]}},""" +
                """"inquiry":{"id":"$CANARY","status":"$CANARY"},"flow":"$CANARY","verifications":"$CANARY","accepted-at":"$CANARY","id":"$CANARY",""" +
                """"request-hash":"$CANARY","expires-at":"$CANARY","files":[{"kind":"$CANARY","content":"$CANARY"}],"dg2-attached":"$CANARY",""" +
                """"verification-id":"$CANARY","status":"$CANARY","$CANARY":{"$CANARY":["$CANARY"]}}""",
            decodable = true,
        ),
        Answer("a page that is no JSON", 200, "<html><body>$CANARY</body></html>", "text/html"),
        Answer("a problem whose title, detail and code hold the canary", 422, """{"type":"about:blank","title":"$CANARY","status":422,"detail":"$CANARY","code":"$CANARY"}""", "application/problem+json"),
        Answer("a conflict", 409, """{"type":"about:blank","title":"Conflict","status":409,"detail":"$CANARY","code":"synthetic_code"}""", "application/problem+json"),
        Answer("a server error that is no problem", 500, CANARY, "text/plain"),
    )

    private fun engine(answer: Answer) = MockEngine { respond(answer.body, HttpStatusCode.fromValue(answer.status), headersOf(HttpHeaders.ContentType, answer.contentType)) }

    private suspend fun thrownBy(run: suspend () -> Any?): Throwable? = try {
        run()
        null
    } catch (error: Throwable) {
        error
    }

    @TestFactory
    fun `no call of the flow API client lets the canary into anything it throws`(): List<DynamicTest> = calls.map { call ->
        dynamicTest(call.name) {
            runTest {
                answers.forEach { answer ->
                    val what = "${call.name}, ${answer.name}"
                    val error = thrownBy { call.run(FlowApiClient(BASE, TOKEN, flowHttpClient(engine(answer)))) }

                    error?.let { assertNoCanary(it, CANARY, what) }
                    // A body no decoder can read never comes back as an answer.
                    if (call.decodes && !answer.decodable) assertTrue(error != null, "$what: an answer was returned")
                    if (error is FlowApiException.InvalidResponse) {
                        assertEquals("flow_api.invalid_response", error.code, what)
                        assertEquals("Unexpected response body", error.message, what)
                        assertNull(error.cause, what)
                    }
                    if (error is FlowApiException) assertTrue(CODE.matches(error.code), "$what: ${error.code}")
                }
            }
        }
    }

    @Test
    fun `the check sees a canary in a message, a toString, a cause and a suppressed exception`() {
        class Telling(private val text: String) : Exception("fixed") {
            override fun toString(): String = text
        }
        val carriers: Map<String, Throwable> = mapOf(
            "a message" to IllegalStateException("no value \"$CANARY\""),
            "a toString" to Telling("Telling($CANARY)"),
            "a cause" to IllegalStateException("fixed", IllegalArgumentException(CANARY)),
            "a cause's cause" to IllegalStateException("fixed", RuntimeException("fixed", IllegalArgumentException(CANARY))),
            "a suppressed exception" to IllegalStateException("fixed").apply { addSuppressed(IllegalArgumentException(CANARY)) },
        )

        carriers.forEach { (where, error) ->
            val seen = runCatching { assertNoCanary(error, CANARY, where) }.exceptionOrNull()

            assertTrue(seen is AssertionError, "$where: the canary was not seen")
        }
        assertNull(runCatching { assertNoCanary(IllegalStateException("fixed", IllegalArgumentException("fixed too")), CANARY, "clean") }.exceptionOrNull())
    }

    @Test
    fun `the table holds every call the client makes`() {
        val client = File("src/commonMain/kotlin/dev/openverify/sdk/api/FlowApiClient.kt").readText()
        val declared = Regex("""override suspend fun (\w+)\(""").findAll(client).map { it.groupValues[1] }.toList()

        assertEquals(declared.sorted(), calls.map { it.name }.sorted())
        assertTrue(declared.size >= 24, declared.toString())
    }

    @Test
    fun `the one-time-link redemption carries neither the answer's canary nor the token`() = runTest {
        val token = "ovo_" + "o".repeat(43)
        answers.forEach { answer ->
            val error = thrownBy { OneTimeLinkClient(BASE, flowHttpClient(engine(answer))).redeem(INQUIRY, token) }

            assertTrue(error != null, answer.name)
            assertNoCanary(error!!, CANARY, "redeem, ${answer.name}")
            assertNoCanary(error, token, "redeem, ${answer.name}: the token")
        }
        // A token that is not one is refused before any request, unechoed.
        val refused = thrownBy { OneTimeLinkClient(BASE, flowHttpClient(engine(answers.first()))).redeem(INQUIRY, CANARY) }
        assertNoCanary(refused!!, CANARY, "redeem, a malformed token")
    }

    @Test
    fun `a session token or an API address that is refused is never echoed`() {
        listOf<() -> Any>(
            { FlowApiClient(BASE, "ovs_$CANARY", flowHttpClient(engine(answers.first()))) },
            { FlowApiClient("https://$CANARY.example.com/a?b=$CANARY", TOKEN, flowHttpClient(engine(answers.first()))) },
            { OpenVerifyInquiry.Request(INQUIRY, "ovs_$CANARY", BASE) },
            { OpenVerifyInquiry.Request("inq_$CANARY", TOKEN, BASE) },
            { OpenVerifyInquiry.Request(INQUIRY, TOKEN, "http://$CANARY.example.com") },
            { OpenVerifyInquiry.fromOneTimeLink("https://links.example.net/#inquiry-id=$INQUIRY&one-time-token=$CANARY", BASE) },
        ).forEachIndexed { index, make ->
            val error = runCatching(make).exceptionOrNull()

            error?.let { assertNoCanary(it, CANARY, "case $index") }
        }
    }

    @Test
    fun `every chip read failure has its fixed message and no cause`() {
        ChipReadFailure.entries.forEach { failure ->
            val error = ChipReadException(failure)

            assertEquals("Chip read failed: ${failure.name.lowercase()}", error.message)
            assertNull(error.cause)
            assertTrue(Regex("Chip read failed: [a-z_]{3,32}").matches(error.message.orEmpty()), error.message)
        }
        assertEquals(6, ChipReadFailure.entries.size)
    }

    @Test
    fun `every shipped module has its rows, the SDK here and each optional artifact in its own table`() {
        assertEquals(listOf("openverify-sdk"), SdkModule.SHIPPED.filter { it.exceptionRows == null }.map { it.name })
        assertTrue(SdkModule.SHIPPED.count { it.exceptionRows != null } >= 2)
    }

    @TestFactory
    fun `an optional artifact's exception table is exactly what its sources create and throw on`(): List<DynamicTest> =
        SdkModule.SHIPPED.filter { it.exceptionRows != null }.map { module ->
            dynamicTest(module.name) {
                val sources = SourceScan.sourcesOf(module)
                val table = File(module.exceptionRows!!)
                // A module with no source yet can throw nothing; from its first source on it has its table.
                if (sources.isEmpty() && !table.isFile) return@dynamicTest
                assertTrue(table.isFile, "${module.name} has sources and no exception table: write ${SdkModule.EXCEPTION_ROWS} in the module")

                val written = ModuleExceptions.parse(table.readText()).map { it.toString() }.sorted()
                val found = ModuleExceptions.rowsOf(module).map { it.toString() }.sorted()

                assertEquals(found.joinToString("\n"), written.joinToString("\n"), "${module.name}: ${SdkModule.EXCEPTION_ROWS} is not what its sources hold")
            }
        }

    @TestFactory
    fun `every exception an optional artifact creates has a fixed message, and only a cancellation or a chip failure is thrown on`(): List<DynamicTest> =
        SdkModule.SHIPPED.filter { it.exceptionRows != null }.map { module ->
            dynamicTest(module.name) {
                val prefix = File(module.directory).invariantSeparatorsPath + "/"
                val broken = SourceScan.sourcesOf(module).flatMap { (path, text) ->
                    ModuleExceptions.rowsIn(path.removePrefix(prefix), text).mapNotNull { row -> ModuleExceptions.problem(row, text)?.let { "$row: $it" } }
                }

                assertEquals(emptyList<String>(), broken)
            }
        }

    private companion object {
        /** Synthetic, and distinct from any word of the contract or the SDK. */
        const val CANARY = PrivacyScreens.CANARY
        const val BASE = "https://verify.example.com"
        const val INQUIRY = "inq_01M5CJXHG07XPHF3HRM6NREDH7"
        const val VERIFICATION = "ver_01M5CK16P0D13FXHZSS4TCFBVH"
        const val CAPTURE = "self_01M5CK16P0D13FXHZSS4TCFBVH"
        const val INTEGRITY_CHALLENGE = "ich_01M5CK16P0D13FXHZSS4TCFBVH"
        const val CHIP_CHALLENGE = "chc_01M5CK16P0D13FXHZSS4TCFBVH"
        const val CRYPTO_CHALLENGE = "cwc_01M5CK16P0D13FXHZSS4TCFBVH"
        const val THEME_ASSET = "tsa_01M5CK16P0D13FXHZSS4TCFBVH"
        val TOKEN = "ovs_" + "t".repeat(43)

        /** A constant code: lower case, dotted. */
        val CODE = Regex("[a-z][a-z0-9_]*(\\.[a-z0-9_]+)+")
    }
}

/**
 * C213.3 at the host's side of the result: an intent whose extras were replaced by a canary (another
 * app cannot do this to an unexported activity, a test can) is read as a result without the canary
 * reaching an exception or the result's text.
 */
@org.junit.runner.RunWith(org.robolectric.RobolectricTestRunner::class)
internal class ResultIntentCanaryTest {

    @org.junit.Test
    fun `a result intent holding a canary gives a result that carries none of it`() {
        val canary = PrivacyScreens.CANARY
        val (_, completed) = InquiryResults.toActivityResult(InquiryResult.Completed("inq_01M5CJXHG07XPHF3HRM6NREDH7", InquiryStatus.COMPLETED))
        val tampered = Intent(completed)
        completed.extras!!.keySet().filterNot { it.endsWith(".RESULT") }.forEach { tampered.putExtra(it, canary) }

        val outcome = runCatching { InquiryResults.fromActivityResult(tampered) }

        outcome.exceptionOrNull()?.let { assertNoCanary(it, canary, "the result") }
        // The inquiry's id is the host's own value and comes back as it was sent; nothing else does.
        org.junit.Assert.assertEquals(InquiryResult.Completed(canary, InquiryStatus.UNKNOWN), outcome.getOrNull())
    }
}
