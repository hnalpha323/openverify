package dev.openverify.sdk.api

import dev.openverify.sdk.model.FileKind
import dev.openverify.sdk.model.FlowValue
import dev.openverify.sdk.model.SelfieCaptureUpload
import dev.openverify.sdk.camera.CapturedImage
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import io.ktor.client.engine.mock.toByteArray
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.headersOf
import kotlinx.coroutines.test.runTest
import dev.openverify.sdk.model.Fixtures
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.params.ParameterizedTest
import org.junit.jupiter.params.provider.Arguments
import org.junit.jupiter.params.provider.MethodSource
import java.util.Locale

/**
 * C196.3 (review H08): the values the driver's client sends (a screen's numbers and dates, the OTP
 * code, a selfie pose's elapsed milliseconds, the consent's language tag) are ASCII whatever the
 * device's own locale formats digits in. The SDK leaves the JVM default alone, so each case runs
 * under `Locale.setDefault` for the five locales whose default digits are not ASCII, with the SDK's
 * chosen language both equal to the device's and different from it.
 */
internal class FlowRequestLocalesTest {

    private val original: Locale = Locale.getDefault()

    @AfterEach
    fun restore() = Locale.setDefault(original)

    private class Sent(val path: String, val body: String)

    private suspend fun encoded(call: suspend (FlowApiClient) -> Unit): List<Sent> {
        val sent = mutableListOf<Sent>()
        val engine = MockEngine { request ->
            sent += Sent(request.url.encodedPath, request.body.toByteArray().decodeToString())
            val answer = when {
                request.url.encodedPath.endsWith("/consent") -> """{"consent":{"accepted-at":"2026-10-20T12:00:30.000Z"}}"""
                request.url.encodedPath.endsWith("/files") -> FILE
                request.url.encodedPath.contains("/screens/") -> Fixtures.read("api/flow-session-v2.json")
                else -> VERIFICATION
            }
            respond(answer, HttpStatusCode.OK, headersOf(HttpHeaders.ContentType, "application/json"))
        }
        call(FlowApiClient("https://verify.example.com", TOKEN, flowHttpClient(engine)))
        return sent
    }

    @ParameterizedTest(name = "device {0}, SDK language {1}")
    @MethodSource("locales")
    fun `the values the client sends are ASCII under every device locale`(device: String, sdkLanguage: String) = runTest {
        Locale.setDefault(Locale.forLanguageTag(device))

        val sent = encoded { client ->
            client.submitScreen(
                "extra_details",
                linkedMapOf("household_size" to FlowValue.Number(1234.5), "start" to FlowValue.Text("2026-10-20"), "count" to FlowValue.Number(42.0)),
                button = null,
            )
            client.confirmOtp(VERIFICATION_ID, "123456")
            client.uploadFile(VERIFICATION_ID, FileKind.SELFIE_CENTER, PHOTO, SelfieCaptureUpload(CAPTURE_ID, NONCE, 98765))
            client.acceptConsent(listOf("consent.biometric"), sdkLanguage)
        }

        assertEquals("""{"values":{"household_size":1234.5,"start":"2026-10-20","count":42.0}}""", sent[0].body)
        assertEquals("""{"code":"123456"}""", sent[1].body)
        assertTrue("\r\n\r\n98765\r\n" in sent[2].body, "client-elapsed-ms in ASCII digits")
        assertEquals("""{"accepted":true,"text-keys":["consent.biometric"],"locale":"$sdkLanguage"}""", sent[3].body)
        for (request in sent) {
            assertTrue(request.body.none { it in '٠'..'٩' || it in '۰'..'۹' || it in '০'..'৯' || it in '०'..'९' || it in '၀'..'၉' }, request.path)
        }
    }

    private companion object {
        val TOKEN = "ovs_" + "t".repeat(43)
        const val VERIFICATION_ID = "ver_01M5CJZC301G4JHXZQ3PZBYH3Q"
        const val CAPTURE_ID = "self_01M5CJXHG07XPHF3HRM6NREDH9"
        const val NONCE = "AAAAAAAAAAAAAAAAAAAAAA"
        val PHOTO = CapturedImage(byteArrayOf(0xFF.toByte(), 0xD8.toByte(), 1), "image/jpeg")

        const val VERIFICATION =
            """{"data":{"type":"verification/selfie","id":"$VERIFICATION_ID","attributes":{"status":"confirmed","retry-hints":[],""" +
                """"created-at":"2026-10-20T12:01:00.000Z","updated-at":"2026-10-20T12:01:30.000Z"}}}"""

        const val FILE =
            """{"data":{"type":"file","id":"file_01M5CK3288G5K9T8DC51K68D01","attributes":{"kind":"selfie-center","mime-type":"image/jpeg","byte-size":3,""" +
                """"created-at":"2026-10-20T12:01:00.000Z"},"relationships":{"verification":{"data":{"type":"verification/selfie","id":"$VERIFICATION_ID"}}}}}"""

        /**
         * C196.3's device locales, each with two of the SDK's five languages: Arabic (the device's own
         * language for `ar-EG`, another one for the rest) and English.
         */
        @JvmStatic
        fun locales(): List<Arguments> = listOf("ar-EG", "fa-IR", "bn-BD", "mr-IN", "my-MM").flatMap { device ->
            listOf(Arguments.of(device, "ar"), Arguments.of(device, "en"))
        }
    }
}
