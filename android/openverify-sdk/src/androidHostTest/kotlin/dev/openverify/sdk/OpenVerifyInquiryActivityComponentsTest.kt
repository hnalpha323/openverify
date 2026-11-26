package dev.openverify.sdk

import android.content.Context
import android.os.Looper
import androidx.compose.ui.test.junit4.v2.createEmptyComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.test.core.app.ActivityScenario
import androidx.test.core.app.ApplicationProvider
import dev.openverify.sdk.OpenVerifyInquiryRequestTest.Companion.INQUIRY_ID
import dev.openverify.sdk.OpenVerifyInquiryRequestTest.Companion.TOKEN
import dev.openverify.sdk.api.LoopbackHttp
import dev.openverify.sdk.generated.resources.*
import dev.openverify.sdk.model.Fixtures
import dev.openverify.sdk.model.OpenVerifyJson
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import mockwebserver3.Dispatcher
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import mockwebserver3.RecordedRequest
import okhttp3.Interceptor
import okhttp3.OkHttpClient
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
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import java.util.Collections
import java.util.concurrent.TimeUnit

/**
 * C191 and C192 through the activity a host launches: the components installed in
 * `OpenVerifyAndroid` (the transport, the event listener, the sandbox outcome), and what the flow
 * does without them.
 */
@RunWith(RobolectricTestRunner::class)
@Config(qualifiers = "sw411dp")
class OpenVerifyInquiryActivityComponentsTest {

    @get:Rule
    val compose = createEmptyComposeRule()

    private val context: Context = ApplicationProvider.getApplicationContext()
    private val server = MockWebServer()

    /** Paths the host's interceptor saw, in order. */
    private val intercepted: MutableList<String> = Collections.synchronizedList(mutableListOf())

    /** Events the host's listener received, each with whether it ran on the main thread. */
    private val received: MutableList<Pair<OpenVerifyEvent, Boolean>> = Collections.synchronizedList(mutableListOf())

    private val hostClient: OkHttpClient = OkHttpClient.Builder()
        .followRedirects(true)
        .addInterceptor(Interceptor { chain -> chain.proceed(chain.request()).also { intercepted += chain.request().url.encodedPath } })
        .build()

    @Before
    fun start() {
        LoopbackHttp.testOverride = true
        server.start()
    }

    @After
    fun stop() {
        LoopbackHttp.testOverride = null
        OpenVerifyAndroid.install(OpenVerifyComponents())
        server.close()
    }

    private fun launchIntent() = OpenVerifyInquiry.Contract()
        .createIntent(context, OpenVerifyInquiry.Request(INQUIRY_ID, TOKEN, server.url("/").toString()))

    private fun linkIntent() = OpenVerifyInquiry.OneTimeLinkContract().createIntent(
        context,
        OpenVerifyInquiry.fromOneTimeLink("https://links.example.net/#inquiry-id=$INQUIRY_ID&one-time-token=$ONE_TIME_TOKEN", server.url("/").toString()),
    )

    /** The golden session as a Phase 9 server answers it: positioned on [stepId], with [members] replaced. */
    private fun session(stepId: String, members: Map<String, kotlinx.serialization.json.JsonElement> = emptyMap()): String {
        val golden = OpenVerifyJson.parseToJsonElement(Fixtures.read("api/flow-session.json")).jsonObject
        val step = golden.getValue("flow").jsonObject.getValue("steps").jsonArray.single { it.jsonObject.getValue("id").jsonPrimitive.content == stepId }
        val position = OpenVerifyJson.parseToJsonElement("""{"step-id":"$stepId","state":"active","previous-step-id":null}""")
        return JsonObject(golden + mapOf("spec-version" to JsonPrimitive(2), "position" to position, "step" to step) + members).toString()
    }

    private fun json(body: String) = MockResponse.Builder().code(200).addHeader("Content-Type", "application/json").body(body).build()

    /** A new inquiry at its consent step. */
    private fun newSession() = json(session("consent", mapOf("consent" to JsonNull, "verifications" to JsonArray(emptyList()))))

    private fun text(res: StringResource) = runBlocking { getString(res) }

    private fun waitForText(text: String) {
        compose.waitUntil(timeoutMillis = 10_000) { compose.onAllNodesWithText(text).fetchSemanticsNodes().isNotEmpty() }
    }

    private fun events(): List<OpenVerifyEvent> {
        shadowOf(Looper.getMainLooper()).idle()
        return received.map { it.first }
    }

    // C191.1: the transport -------------------------------------------------------------------

    @Test
    fun `an installed transport carries every flow request, through the host's interceptors`() {
        OpenVerifyAndroid.install(OpenVerifyComponents(transport = OpenVerifyAndroidTransport.okHttp(hostClient)))
        server.enqueue(newSession())

        ActivityScenario.launchActivityForResult<OpenVerifyInquiryActivity>(launchIntent()).use {
            waitForText(text(Res.string.openverify_consent_title))

            assertEquals(listOf("/api/v1/flow/session"), intercepted.toList())
        }
    }

    @Test
    fun `the one-time-link redemption goes through the installed transport too`() {
        OpenVerifyAndroid.install(OpenVerifyComponents(transport = OpenVerifyAndroidTransport.okHttp(hostClient)))
        server.enqueue(json("""{"session-token":"$REDEEMED_TOKEN","expires-at":"2026-10-21T12:00:00.000Z"}"""))
        server.enqueue(newSession())

        ActivityScenario.launchActivityForResult<OpenVerifyInquiryActivity>(linkIntent()).use {
            waitForText(text(Res.string.openverify_consent_title))

            assertEquals(listOf("/api/v1/flow/one-time-links/redeem", "/api/v1/flow/session"), intercepted.toList())
        }
    }

    @Test
    fun `a redirect is never followed, though the host's client would follow it`() {
        OpenVerifyAndroid.install(OpenVerifyComponents(transport = OpenVerifyAndroidTransport.okHttp(hostClient)))
        server.enqueue(MockResponse.Builder().code(302).addHeader("Location", server.url("/elsewhere").toString()).build())
        server.enqueue(newSession())

        ActivityScenario.launchActivityForResult<OpenVerifyInquiryActivity>(launchIntent()).use {
            waitForText(text(Res.string.openverify_error_title))

            assertEquals("/api/v1/flow/session", server.takeRequest(5, TimeUnit.SECONDS)!!.url.encodedPath)
            assertEquals(1, server.requestCount)
        }
    }

    @Test
    fun `with nothing installed the flow runs on the SDK's own client, and no interceptor of the host sees it`() {
        server.enqueue(newSession())

        ActivityScenario.launchActivityForResult<OpenVerifyInquiryActivity>(launchIntent()).use {
            waitForText(text(Res.string.openverify_consent_title))

            assertEquals(emptyList<String>(), intercepted.toList())
            assertEquals("/api/v1/flow/session", server.takeRequest(5, TimeUnit.SECONDS)!!.url.encodedPath)
        }
    }

    // C192: events ----------------------------------------------------------------------------

    private fun listen() = OpenVerifyAndroid.install(
        OpenVerifyComponents(eventListener = { event -> received += event to (Looper.myLooper() == Looper.getMainLooper()) }),
    )

    @Test
    fun `an installed listener hears the flow start and the step shown, on the main thread`() {
        listen()
        server.enqueue(newSession())

        ActivityScenario.launchActivityForResult<OpenVerifyInquiryActivity>(launchIntent()).use {
            waitForText(text(Res.string.openverify_consent_title))

            assertEquals(listOf(OpenVerifyEvent.Started(INQUIRY_ID), OpenVerifyEvent.StepShown("consent")), events())
            assertTrue(received.all { it.second })
        }
    }

    @Test
    fun `a rotation repeats no event`() {
        listen()
        server.enqueue(newSession())

        ActivityScenario.launchActivityForResult<OpenVerifyInquiryActivity>(launchIntent()).use { scenario ->
            waitForText(text(Res.string.openverify_consent_title))
            scenario.recreate()
            waitForText(text(Res.string.openverify_consent_title))

            assertEquals(listOf(OpenVerifyEvent.Started(INQUIRY_ID), OpenVerifyEvent.StepShown("consent")), events())
        }
    }

    @Test
    fun `leaving the flow is its end, by kind only`() {
        listen()
        server.enqueue(newSession())

        ActivityScenario.launchActivityForResult<OpenVerifyInquiryActivity>(launchIntent()).use { scenario ->
            waitForText(text(Res.string.openverify_consent_title))
            scenario.onActivity { it.onBackPressedDispatcher.onBackPressed() }

            assertEquals(OpenVerifyEvent.Ended(InquiryResultKind.CANCELED), events().last())
        }
    }

    @Test
    fun `a listener that throws never stops the flow`() {
        OpenVerifyAndroid.install(OpenVerifyComponents(eventListener = { throw IllegalStateException("the host's own bug") }))
        server.enqueue(newSession())

        ActivityScenario.launchActivityForResult<OpenVerifyInquiryActivity>(launchIntent()).use {
            waitForText(text(Res.string.openverify_consent_title))
        }
    }

    // C90.9 (Phase 7, owner decisions after Workflow 7A): the sandbox outcome -----------------------

    /** A consented session on the government ID, under session integrity, in [environment]; 202 to the signals call. */
    private fun serveConsented(environment: String) {
        val body = session(
            "government_id",
            mapOf(
                "environment" to OpenVerifyJson.parseToJsonElement("""{"kind":"$environment"}"""),
                "signals" to OpenVerifyJson.parseToJsonElement("""{"integrity":true,"recognition":false}"""),
            ),
        )
        server.dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest): MockResponse = when (request.url.encodedPath) {
                "/api/v1/flow/session" -> json(body)
                "/api/v1/flow/signals" -> MockResponse.Builder().code(202).build()
                else -> MockResponse.Builder().code(404).build()
            }
        }
    }

    /**
     * The probes read on Dispatchers.IO since Workflow 10B (C210.3), so the send resumes on the main
     * looper, which Robolectric keeps paused: wait in short steps and idle the looper between them,
     * never blocking it for the whole wait (the same recipe as signals/OpenVerifyInquiryActivitySignalsTest).
     */
    private fun signalsBody(): JsonObject {
        var seen = 0
        repeat(200) {
            shadowOf(Looper.getMainLooper()).idle()
            val request = server.takeRequest(50, TimeUnit.MILLISECONDS) ?: return@repeat
            if (request.url.encodedPath == "/api/v1/flow/signals") return OpenVerifyJson.parseToJsonElement(request.body!!.utf8()).jsonObject
            check(++seen < 5) { "no signals call" }
        }
        error("no signals call")
    }

    @Test
    fun `in a sandbox the installed outcome rides on the signals body`() {
        OpenVerifyAndroid.install(OpenVerifyComponents(sandboxSignalOutcome = SandboxSignalOutcome.HUMAN))
        serveConsented("sandbox")

        ActivityScenario.launchActivityForResult<OpenVerifyInquiryActivity>(launchIntent()).use {
            assertEquals("human", signalsBody().getValue("sandbox-outcome").jsonPrimitive.content)
        }
    }

    @Test
    fun `in production it is never sent, and the body still is`() {
        OpenVerifyAndroid.install(OpenVerifyComponents(sandboxSignalOutcome = SandboxSignalOutcome.BOT))
        serveConsented("production")

        ActivityScenario.launchActivityForResult<OpenVerifyInquiryActivity>(launchIntent()).use {
            val body = signalsBody()
            assertFalse(body.toString(), "sandbox-outcome" in body)
            assertTrue(body.toString(), "android-integrity" in body)
        }
    }

    private companion object {
        /** Synthetic tokens: a prefix plus 43 base64url characters. */
        val ONE_TIME_TOKEN = "ovo_" + "o".repeat(43)
        val REDEEMED_TOKEN = "ovs_" + "r".repeat(43)
    }
}
