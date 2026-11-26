package dev.openverify.sdk.api

import dev.openverify.sdk.OPENVERIFY_SDK_VERSION
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.headersOf
import kotlinx.coroutines.test.runTest
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import java.io.File
import java.util.Properties

/**
 * C214.3, C193.7 (behaviour K10): one version property, `openverifyVersion` in
 * `android/gradle.properties`, generates the SDK's constant, and the `User-Agent` of every flow
 * request is exactly `OpenVerify-Android/<that version>`.
 */
internal class SdkVersionTest {

    /** Gradle runs host tests from the module directory. */
    private val property: String =
        File("../gradle.properties").inputStream().use { input -> Properties().apply { load(input) } }.getProperty("openverifyVersion")

    @Test
    fun `the generated constant is the openverifyVersion property, a semantic version`() {
        assertTrue(Regex("""\d+\.\d+\.\d+(-[0-9A-Za-z.]+)?""").matches(property), property)
        assertEquals(property, OPENVERIFY_SDK_VERSION)
        assertEquals(property, FlowHttp.SDK_VERSION)
    }

    @Test
    fun `every flow request's User-Agent carries the property's version`() = runTest {
        var userAgent: String? = null
        val engine = MockEngine { request ->
            userAgent = request.headers[HttpHeaders.UserAgent]
            respond("""{"consent":{"accepted-at":"2026-10-20T12:00:30.000Z"}}""", HttpStatusCode.OK, headersOf(HttpHeaders.ContentType, "application/json"))
        }
        val client = FlowApiClient("https://api.example.com", "ovs_synthetic" + "v".repeat(34), flowHttpClient(engine))

        client.acceptConsent(listOf("consent.biometric"), "en")

        assertEquals("OpenVerify-Android/$property", userAgent)
    }
}
