package dev.openverify.sdk

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.content.pm.ApplicationInfo
import android.view.WindowManager
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.junit4.v2.createEmptyComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.lifecycle.Lifecycle
import androidx.test.core.app.ActivityScenario
import androidx.test.core.app.ApplicationProvider
import dev.openverify.sdk.OpenVerifyInquiryRequestTest.Companion.INQUIRY_ID
import dev.openverify.sdk.OpenVerifyInquiryRequestTest.Companion.TOKEN
import dev.openverify.sdk.api.LoopbackHttp
import dev.openverify.sdk.generated.resources.*
import dev.openverify.sdk.i18n.sdkStringTable
import dev.openverify.sdk.log.HostDebuggable
import dev.openverify.sdk.model.Fixtures
import dev.openverify.sdk.model.OpenVerifyJson
import dev.openverify.sdk.ui.TestTags
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.JsonArray
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
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import java.util.concurrent.TimeUnit

@RunWith(RobolectricTestRunner::class)
class OpenVerifyInquiryActivityTest {

    @get:Rule
    val compose = createEmptyComposeRule()

    private val context: Context = ApplicationProvider.getApplicationContext()
    private val server = MockWebServer()
    private val contract = OpenVerifyInquiry.Contract()

    private companion object {
        /** Synthetic tokens: a prefix plus 43 base64url characters. */
        val ONE_TIME_TOKEN = "ovo_" + "o".repeat(43)
        val REDEEMED_TOKEN = "ovs_" + "r".repeat(43)
    }

    /**
     * The flow API here is a loopback MockWebServer over plain http, which C190.2 allows only in a
     * debuggable host or under the SDK's own test override; the tests of the rule itself clear it.
     */
    @Before
    fun startServer() {
        LoopbackHttp.testOverride = true
        HostDebuggable.forget()
        server.start()
    }

    @After
    fun stopServer() {
        LoopbackHttp.testOverride = null
        HostDebuggable.forget()
        server.close()
    }

    private fun launchIntent(): Intent =
        contract.createIntent(context, OpenVerifyInquiry.Request(INQUIRY_ID, TOKEN, server.url("/").toString()))

    /** A session for a new inquiry: consent not given yet, no verifications. */
    private fun newSession(): MockResponse {
        val session = OpenVerifyJson.parseToJsonElement(Fixtures.read("api/flow-session.json")).jsonObject
        val body = positioned(JsonObject(session + mapOf("consent" to JsonNull, "verifications" to JsonArray(emptyList()))), "consent")
        return MockResponse.Builder().code(200).addHeader("Content-Type", "application/json").body(body.toString()).build()
    }

    /**
     * [session] as a Phase 9 server answers a spec-2 client (C193.2): its position on [stepId], active,
     * with that step's client view from the session's own flow.
     */
    private fun positioned(session: JsonObject, stepId: String): JsonObject {
        val step = session.getValue("flow").jsonObject.getValue("steps").jsonArray.single { it.jsonObject.getValue("id").jsonPrimitive.content == stepId }
        val position = OpenVerifyJson.parseToJsonElement("""{"step-id":"$stepId","state":"active","previous-step-id":null}""")
        return JsonObject(session + mapOf("spec-version" to JsonPrimitive(2), "position" to position, "step" to step))
    }

    private fun text(res: StringResource) = runBlocking { getString(res) }

    private fun waitForText(text: String) {
        compose.waitUntil(timeoutMillis = 10_000) { compose.onAllNodesWithText(text).fetchSemanticsNodes().isNotEmpty() }
    }

    private fun ActivityScenario<OpenVerifyInquiryActivity>.inquiryResult(): InquiryResult =
        contract.parseResult(result.resultCode, result.resultData)

    @Test
    fun `the consent step from the session is shown`() {
        server.enqueue(newSession())

        ActivityScenario.launchActivityForResult<OpenVerifyInquiryActivity>(launchIntent()).use {
            waitForText(text(Res.string.openverify_consent_title))

            val request = server.takeRequest(5, TimeUnit.SECONDS)!!
            assertEquals("/api/v1/flow/session", request.url.encodedPath)
            assertEquals("Bearer $TOKEN", request.headers["Authorization"])
        }
    }

    @Test
    fun `a document step can choose a file through the system document picker (C64_2)`() {
        val session = OpenVerifyJson.parseToJsonElement(Fixtures.read("api/flow-session.json")).jsonObject
        val flow = OpenVerifyJson.parseToJsonElement(
            """{"metadata":{"specVersion":1,"id":"proof","version":1,"name":"Proof"},"steps":[""" +
                """{"id":"proof","type":"document","documentTypes":["utility_bill"],"captureMethods":["upload"]},""" +
                """{"id":"completion","type":"completion"}],"transitions":[]}""",
        )
        val initiated = OpenVerifyJson.parseToJsonElement(
            """{"type":"verification/document","id":"ver_01M5CK16P0D13FXHZSS4TCFBV0","attributes":{"status":"initiated",""" +
                """"retry-hints":[],"created-at":"2026-10-20T12:00:00.000Z","updated-at":"2026-10-20T12:00:00.000Z",""" +
                """"guidance":{"accepted-types":["utility_bill"],"max-age-days":90,"max-pages":50,"accepted-mime-types":["application/pdf"]}}}""",
        )
        val body = positioned(JsonObject(session + mapOf("flow" to flow, "verifications" to JsonArray(listOf(initiated)))), "proof")
        server.enqueue(MockResponse.Builder().code(200).addHeader("Content-Type", "application/json").body(body.toString()).build())

        ActivityScenario.launchActivityForResult<OpenVerifyInquiryActivity>(launchIntent()).use {
            waitForText(text(Res.string.openverify_document_title))

            compose.onNodeWithTag(TestTags.DOCUMENT_CHOOSE).assertExists()
            compose.onAllNodesWithText(text(Res.string.openverify_document_unavailable)).assertCountEquals(0)
        }
    }

    @Test
    fun `back before the end returns Canceled with the inquiry ID`() {
        server.enqueue(newSession())

        ActivityScenario.launchActivityForResult<OpenVerifyInquiryActivity>(launchIntent()).use { scenario ->
            waitForText(text(Res.string.openverify_consent_title))
            scenario.onActivity { it.onBackPressedDispatcher.onBackPressed() }

            assertEquals(Activity.RESULT_CANCELED, scenario.result.resultCode)
            assertEquals(InquiryResult.Canceled(INQUIRY_ID), scenario.inquiryResult())
        }
    }

    @Test
    fun `an expired session ends as Failed SESSION_EXPIRED when closed`() {
        server.enqueue(
            MockResponse.Builder().code(401).addHeader("Content-Type", "application/problem+json")
                .body("""{"type":"about:blank","title":"Unauthorized","status":401}""").build(),
        )

        ActivityScenario.launchActivityForResult<OpenVerifyInquiryActivity>(launchIntent()).use { scenario ->
            waitForText(text(Res.string.openverify_error_session_expired))
            compose.onNodeWithText(text(Res.string.openverify_close)).performClick()

            assertEquals(InquiryResult.Failed(INQUIRY_ID, FailureReason.SESSION_EXPIRED), scenario.inquiryResult())
        }
    }

    // C19 --------------------------------------------------------------------------------

    private fun oneTimeLinkIntent(): Intent = OpenVerifyInquiry.OneTimeLinkContract().createIntent(
        context,
        OpenVerifyInquiry.fromOneTimeLink("${server.url("/")}#inquiry-id=$INQUIRY_ID&one-time-token=$ONE_TIME_TOKEN", server.url("/").toString()),
    )

    private fun redeemed(): MockResponse = MockResponse.Builder().code(200).addHeader("Content-Type", "application/json")
        .body("""{"session-token":"$REDEEMED_TOKEN","expires-at":"2026-10-21T12:00:00.000Z"}""").build()

    private fun unauthorized(code: String? = null): MockResponse = MockResponse.Builder().code(401)
        .addHeader("Content-Type", "application/problem+json")
        .body("""{"type":"about:blank","title":"Unauthorized","status":401${code?.let { ",\"code\":\"$it\"" } ?: ""}}""")
        .build()

    @Test
    fun `a one-time link is redeemed once, then the flow runs with the session it got`() {
        server.enqueue(redeemed())
        server.enqueue(newSession())

        ActivityScenario.launchActivityForResult<OpenVerifyInquiryActivity>(oneTimeLinkIntent()).use {
            waitForText(text(Res.string.openverify_consent_title))

            val redeem = server.takeRequest(5, TimeUnit.SECONDS)!!
            assertEquals("POST", redeem.method)
            assertEquals("/api/v1/flow/one-time-links/redeem", redeem.url.encodedPath)
            assertNull(redeem.headers["Authorization"])
            val session = server.takeRequest(5, TimeUnit.SECONDS)!!
            assertEquals("/api/v1/flow/session", session.url.encodedPath)
            assertEquals("Bearer $REDEEMED_TOKEN", session.headers["Authorization"])
        }
    }

    @Test
    fun `the redeemed session lives in memory and survives a rotation without a second redeem`() {
        server.enqueue(redeemed())
        server.enqueue(newSession())

        ActivityScenario.launchActivityForResult<OpenVerifyInquiryActivity>(oneTimeLinkIntent()).use { scenario ->
            waitForText(text(Res.string.openverify_consent_title))
            scenario.recreate()
            waitForText(text(Res.string.openverify_consent_title))

            assertEquals(2, server.requestCount)
        }
    }

    @Test
    fun `a used one-time link ends on the used-link screen and reports LINK_INVALID`() {
        server.enqueue(unauthorized())

        ActivityScenario.launchActivityForResult<OpenVerifyInquiryActivity>(oneTimeLinkIntent()).use { scenario ->
            waitForText(text(Res.string.openverify_link_refused_title))
            compose.onNodeWithText(text(Res.string.openverify_close)).performClick()

            assertEquals(InquiryResult.Failed(INQUIRY_ID, FailureReason.LINK_INVALID), scenario.inquiryResult())
        }
        assertEquals(1, server.requestCount)
    }

    @Test
    fun `an inactive session ends on its own screen and reports why`() {
        server.enqueue(unauthorized("session_canceled"))

        ActivityScenario.launchActivityForResult<OpenVerifyInquiryActivity>(launchIntent()).use { scenario ->
            waitForText(text(Res.string.openverify_session_canceled_title))
            compose.onNodeWithText(text(Res.string.openverify_try_again)).assertDoesNotExist()
            compose.onNodeWithText(text(Res.string.openverify_close)).performClick()

            assertEquals(InquiryResult.Failed(INQUIRY_ID, FailureReason.SESSION_CANCELED), scenario.inquiryResult())
        }
    }

    @Test
    fun `a sandbox session shows the sandbox banner`() {
        server.enqueue(newSession())

        ActivityScenario.launchActivityForResult<OpenVerifyInquiryActivity>(launchIntent()).use {
            waitForText(text(Res.string.openverify_consent_title))

            compose.onNodeWithTag(TestTags.SANDBOX_BANNER).assertExists()
        }
    }

    @Test
    fun `a malformed request fails without contacting the server`() {
        val intent = launchIntent().apply { removeExtra(InquiryResults.EXTRA_SESSION_TOKEN) }

        ActivityScenario.launchActivityForResult<OpenVerifyInquiryActivity>(intent).use { scenario ->
            assertEquals(InquiryResult.Failed(INQUIRY_ID, FailureReason.INVALID_REQUEST), scenario.inquiryResult())
        }
        assertEquals(0, server.requestCount)
    }

    @Test
    fun `identity documents and selfies are kept out of screenshots and recents`() {
        server.enqueue(newSession())

        ActivityScenario.launchActivityForResult<OpenVerifyInquiryActivity>(launchIntent()).use { scenario ->
            scenario.onActivity { activity ->
                assertNotEquals(0, activity.window.attributes.flags and WindowManager.LayoutParams.FLAG_SECURE)
            }
        }
    }

    // C190.2 (decision 65; review P03, V01) ----------------------------------------------------

    private fun host(debuggable: Boolean) {
        LoopbackHttp.testOverride = null
        val info = context.applicationInfo
        info.flags = if (debuggable) info.flags or ApplicationInfo.FLAG_DEBUGGABLE else info.flags and ApplicationInfo.FLAG_DEBUGGABLE.inv()
    }

    @Test
    fun `a host that is not debuggable never sends the session over plain http, and the flow ends INVALID_REQUEST`() {
        host(debuggable = false)
        server.enqueue(newSession())

        ActivityScenario.launchActivityForResult<OpenVerifyInquiryActivity>(launchIntent()).use { scenario ->
            assertEquals(InquiryResult.Failed(INQUIRY_ID, FailureReason.INVALID_REQUEST), scenario.inquiryResult())
        }
        assertEquals(0, server.requestCount)
    }

    @Test
    fun `a debuggable host runs the flow over plain http to its loopback server`() {
        host(debuggable = true)
        server.enqueue(newSession())

        ActivityScenario.launchActivityForResult<OpenVerifyInquiryActivity>(launchIntent()).use {
            waitForText(text(Res.string.openverify_consent_title))

            assertEquals("/api/v1/flow/session", server.takeRequest(5, TimeUnit.SECONDS)!!.url.encodedPath)
        }
    }

    @Test
    fun `a link on another origin is redeemed at the API compiled into the host`() {
        server.enqueue(redeemed())
        server.enqueue(newSession())
        val link = OpenVerifyInquiry.fromOneTimeLink(
            "https://links.example.net/#inquiry-id=$INQUIRY_ID&one-time-token=$ONE_TIME_TOKEN",
            server.url("/").toString(),
        )

        ActivityScenario.launchActivityForResult<OpenVerifyInquiryActivity>(OpenVerifyInquiry.OneTimeLinkContract().createIntent(context, link)).use {
            waitForText(text(Res.string.openverify_consent_title))

            assertEquals("/api/v1/flow/one-time-links/redeem", server.takeRequest(5, TimeUnit.SECONDS)!!.url.encodedPath)
        }
    }

    @Test
    fun `the activity reads whether the host is debuggable when it starts, so the SDK's log codes follow it (C213_3)`() {
        host(debuggable = true)
        server.enqueue(newSession())

        ActivityScenario.launchActivityForResult<OpenVerifyInquiryActivity>(launchIntent()).use {
            waitForText(text(Res.string.openverify_consent_title))

            assertTrue(HostDebuggable.debuggable)
        }
    }

    @Test
    fun `the request's locale is the flow's language`() {
        server.enqueue(newSession())
        val intent = contract.createIntent(context, OpenVerifyInquiry.Request(INQUIRY_ID, TOKEN, server.url("/").toString(), locale = "es-MX"))

        ActivityScenario.launchActivityForResult<OpenVerifyInquiryActivity>(intent).use {
            waitForText(checkNotNull(sdkStringTable("es")).strings.getValue("openverify_consent_title"))
        }
    }

    // C213.1 (decision 70; review P08, V03) ----------------------------------------------------

    @Test
    fun `while the flow is resumed its window hides other apps' overlays, and shows them again when it pauses`() {
        OverlayWindowsTest.grantInstallTimePermission()
        server.enqueue(newSession())

        ActivityScenario.launchActivityForResult<OpenVerifyInquiryActivity>(launchIntent()).use { scenario ->
            scenario.onActivity { assertTrue(OverlayWindowsTest.hidesOverlays(it.window)) }

            scenario.moveToState(Lifecycle.State.STARTED)
            scenario.onActivity { assertFalse(OverlayWindowsTest.hidesOverlays(it.window)) }

            scenario.moveToState(Lifecycle.State.RESUMED)
            scenario.onActivity { assertTrue(OverlayWindowsTest.hidesOverlays(it.window)) }
        }
    }
}
