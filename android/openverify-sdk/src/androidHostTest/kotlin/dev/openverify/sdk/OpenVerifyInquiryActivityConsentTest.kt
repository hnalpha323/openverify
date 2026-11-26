package dev.openverify.sdk

import android.content.Context
import android.content.pm.ApplicationInfo
import androidx.compose.ui.test.junit4.v2.createEmptyComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.test.core.app.ActivityScenario
import androidx.test.core.app.ApplicationProvider
import dev.openverify.sdk.OpenVerifyInquiryRequestTest.Companion.INQUIRY_ID
import dev.openverify.sdk.OpenVerifyInquiryRequestTest.Companion.TOKEN
import dev.openverify.sdk.api.LoopbackHttp
import dev.openverify.sdk.generated.resources.*
import dev.openverify.sdk.log.HostDebuggable
import dev.openverify.sdk.model.Fixtures
import dev.openverify.sdk.model.OpenVerifyJson
import dev.openverify.sdk.ui.TestTags
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import org.jetbrains.compose.resources.StringResource
import org.jetbrains.compose.resources.getString
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.shadows.ShadowLog
import java.util.concurrent.TimeUnit

/**
 * C200 through the activity a host launches: the consent screen shows the session's operator copy
 * with the organisation's name (the activity provides the session's look, C198, C199.6), and a consent
 * the server cannot match (422 `consent_text_mismatch`, C200.5) is shown again after a fresh read of
 * the session with a notice that its wording changed (KP10-6), with a PII-free log code, never
 * recorded silently.
 */
@RunWith(RobolectricTestRunner::class)
@Config(qualifiers = "w411dp-h2000dp")
class OpenVerifyInquiryActivityConsentTest {

    @get:Rule
    val compose = createEmptyComposeRule()

    private val context: Context = ApplicationProvider.getApplicationContext()
    private val server = MockWebServer()

    @Before
    fun start() {
        LoopbackHttp.testOverride = true
        HostDebuggable.forget()
        server.start()
    }

    @After
    fun stop() {
        LoopbackHttp.testOverride = null
        HostDebuggable.forget()
        server.close()
    }

    private fun launchIntent() = OpenVerifyInquiry.Contract()
        .createIntent(context, OpenVerifyInquiry.Request(INQUIRY_ID, TOKEN, server.url("/").toString()))

    /** A new inquiry at its consent step, as a Phase 9 server answers it, with [members] added. */
    private fun consentSession(members: Map<String, JsonElement> = emptyMap()): MockResponse {
        val golden = OpenVerifyJson.parseToJsonElement(Fixtures.read("api/flow-session.json")).jsonObject
        val step = golden.getValue("flow").jsonObject.getValue("steps").jsonArray.single { it.jsonObject.getValue("id").jsonPrimitive.content == "consent" }
        val position = OpenVerifyJson.parseToJsonElement("""{"step-id":"consent","state":"active","previous-step-id":null}""")
        val body = JsonObject(
            golden + mapOf(
                "consent" to JsonNull,
                "verifications" to JsonArray(emptyList()),
                "spec-version" to JsonPrimitive(2),
                "position" to position,
                "step" to step,
            ) + members,
        )
        return MockResponse.Builder().code(200).addHeader("Content-Type", "application/json").body(body.toString()).build()
    }

    private fun text(res: StringResource) = runBlocking { getString(res) }

    private fun waitForText(text: String) {
        compose.waitUntil(timeoutMillis = 10_000) { compose.onAllNodesWithText(text).fetchSemanticsNodes().isNotEmpty() }
    }

    @Test
    fun `the consent screen shows the session's operator copy with the organisation's name`() {
        val copy = OpenVerifyJson.parseToJsonElement(
            """{"messages":{"en":{"consent.biometric":"{organization} compares your selfie with your ID.","consent.processing":"{organization} keeps your photos for this verification only."}}}""",
        )
        server.enqueue(consentSession(mapOf("copy" to copy, "organization-display-name" to JsonPrimitive("Example Verification Ltd"))))

        ActivityScenario.launchActivityForResult<OpenVerifyInquiryActivity>(launchIntent()).use {
            // The organisation's name is isolated for display (C199.5).
            waitForText("\u2068Example Verification Ltd\u2069 compares your selfie with your ID.")

            compose.onNodeWithText("\u2068Example Verification Ltd\u2069 keeps your photos for this verification only.").assertExists()
        }
    }

    @Test
    fun `a consent the server cannot match is shown again after a fresh read with its changed-wording notice, with a log code that names nothing`() {
        context.applicationInfo.flags = context.applicationInfo.flags or ApplicationInfo.FLAG_DEBUGGABLE
        ShadowLog.clear()
        server.enqueue(consentSession())
        server.enqueue(
            MockResponse.Builder().code(422).addHeader("Content-Type", "application/problem+json")
                .body(Fixtures.read("problems/flow-engine/consent-text-mismatch.json")).build(),
        )
        server.enqueue(consentSession())

        ActivityScenario.launchActivityForResult<OpenVerifyInquiryActivity>(launchIntent()).use {
            waitForText(text(Res.string.openverify_consent_title))
            compose.onNodeWithTag(TestTags.CONSENT_CHECKBOX).performScrollTo().performClick()
            compose.onNodeWithText(text(Res.string.openverify_consent_continue)).performScrollTo().performClick()

            // C200.5 (KP10-6): no "out of sync" retry; the consent again, from the fresh session, with its notice.
            waitForText(text(Res.string.openverify_consent_text_changed))
            compose.onNodeWithText(text(Res.string.openverify_consent_title)).assertExists()

            assertEquals("/api/v1/flow/session", server.takeRequest(5, TimeUnit.SECONDS)!!.url.encodedPath)
            assertEquals("/api/v1/flow/consent", server.takeRequest(5, TimeUnit.SECONDS)!!.url.encodedPath)
            assertEquals("/api/v1/flow/session", server.takeRequest(5, TimeUnit.SECONDS)!!.url.encodedPath)
            assertEquals(3, server.requestCount)
        }
        val logged = ShadowLog.getLogsForTag("OpenVerify").map { it.msg }
        assertTrue(logged.toString(), "consent.text_mismatch" in logged)
        assertFalse(logged.toString(), logged.any { "consent.biometric" in it || "digest" in it })
    }
}
