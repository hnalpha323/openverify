package dev.openverify.sdk.signals

import android.content.Context
import android.content.pm.ApplicationInfo
import android.os.Looper
import android.provider.Settings
import androidx.test.core.app.ActivityScenario
import androidx.test.core.app.ApplicationProvider
import dev.openverify.sdk.OpenVerifyInquiry
import dev.openverify.sdk.OpenVerifyInquiryActivity
import dev.openverify.sdk.api.LoopbackHttp
import dev.openverify.sdk.model.Fixtures
import dev.openverify.sdk.model.OpenVerifyJson
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import mockwebserver3.Dispatcher
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import mockwebserver3.RecordedRequest
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import java.util.concurrent.TimeUnit

/**
 * C94.7 through the activity a host app launches: a session that may collect gets one Android body
 * on `POST /api/v1/flow/signals`, with only the members its tiers allow.
 */
@RunWith(RobolectricTestRunner::class)
@Config(qualifiers = "sw411dp")
class OpenVerifyInquiryActivitySignalsTest {

    private val context: Context = ApplicationProvider.getApplicationContext()
    private val server = MockWebServer()

    /** C190.2: the loopback MockWebServer is plain http, allowed here by the SDK's own test override. */
    @Before
    fun startServer() {
        LoopbackHttp.testOverride = true
        server.start()
    }

    @After
    fun stopServer() {
        LoopbackHttp.testOverride = null
        server.close()
    }

    private fun launchIntent() = OpenVerifyInquiry.Contract()
        .createIntent(context, OpenVerifyInquiry.Request(INQUIRY_ID, TOKEN, server.url("/").toString()))

    /**
     * Answers by path, since the body goes out beside the flow's own calls: the golden session
     * (consent recorded, with [tiers] or the fixture's: integrity on, recognition off) as a Phase 9
     * server answers a spec-2 client, its position on the government ID with that step's client view
     * (C193.2), and 202 to the signals call.
     */
    private fun serve(tiers: String? = null) {
        val golden = OpenVerifyJson.parseToJsonElement(Fixtures.read("api/flow-session.json")).jsonObject
        val idStep = golden.getValue("flow").jsonObject.getValue("steps").jsonArray[1]
        val session = JsonObject(
            golden + mapOf(
                "spec-version" to JsonPrimitive(2),
                "position" to OpenVerifyJson.parseToJsonElement("""{"step-id":"government_id","state":"active","previous-step-id":"consent"}"""),
                "step" to idStep,
            ),
        )
        val body = tiers?.let { JsonObject(session + ("signals" to OpenVerifyJson.parseToJsonElement(it))) } ?: session
        server.dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest): MockResponse = when (request.url.encodedPath) {
                "/api/v1/flow/session" ->
                    MockResponse.Builder().code(200).addHeader("Content-Type", "application/json").body(body.toString()).build()
                "/api/v1/flow/signals" -> MockResponse.Builder().code(202).build()
                else -> MockResponse.Builder().code(404).build()
            }
        }
    }

    /**
     * The first signals call the server received, within a few seconds. Since Workflow 10B (C210.3) the
     * body is read off the main thread and the flow resumes on it to send, so the main looper is idled
     * between short waits: blocking it would leave the send waiting on whether the reads ended before
     * the activity's launch did.
     */
    private fun signalsRequest(): RecordedRequest {
        var seen = 0
        repeat(WAIT_ROUNDS) {
            shadowOf(Looper.getMainLooper()).idle()
            val request = server.takeRequest(WAIT_STEP_MS, TimeUnit.MILLISECONDS) ?: return@repeat
            if (request.url.encodedPath == "/api/v1/flow/signals") return request
            check(++seen < MAX_REQUESTS) { "no signals call among the first $MAX_REQUESTS requests" }
        }
        error("no signals call")
    }

    @Test
    fun `a consented session sends its integrity facts and device class, and no ANDROID_ID without recognition`() {
        Settings.Secure.putString(context.contentResolver, Settings.Secure.ANDROID_ID, ANDROID_ID)
        context.applicationInfo.flags = context.applicationInfo.flags or ApplicationInfo.FLAG_DEBUGGABLE
        serve()

        ActivityScenario.launchActivityForResult<OpenVerifyInquiryActivity>(launchIntent()).use {
            assertEquals("/api/v1/flow/session", server.takeRequest(5, TimeUnit.SECONDS)!!.url.encodedPath)
            val signals = signalsRequest()

            assertEquals("POST", signals.method)
            assertEquals("/api/v1/flow/signals", signals.url.encodedPath)
            assertEquals("Bearer $TOKEN", signals.headers["Authorization"])
            val body = OpenVerifyJson.parseToJsonElement(signals.body!!.utf8()).jsonObject
            assertEquals("android", body.getValue("platform").jsonPrimitive.content)
            // C193.3: the step the server's position names.
            assertEquals("government_id", body.getValue("screen").jsonPrimitive.content)
            assertEquals("smartphone", body.getValue("device-class").jsonPrimitive.content)
            assertEquals("true", body.getValue("android-integrity").jsonObject.getValue("app-debuggable").jsonPrimitive.content)
            assertFalse(body.toString(), "android-recognition" in body)
            assertFalse(body.toString(), ANDROID_ID in body.toString())
        }
    }

    @Test
    fun `with device recognition the ANDROID_ID is sent`() {
        Settings.Secure.putString(context.contentResolver, Settings.Secure.ANDROID_ID, ANDROID_ID)
        serve("""{"integrity":true,"recognition":true}""")

        ActivityScenario.launchActivityForResult<OpenVerifyInquiryActivity>(launchIntent()).use {
            val signals = signalsRequest()

            val body = OpenVerifyJson.parseToJsonElement(signals.body!!.utf8()).jsonObject
            assertEquals(ANDROID_ID, body.getValue("android-recognition").jsonObject.getValue("android-id").jsonPrimitive.content)
        }
    }

    private companion object {
        /** How many requests the flow makes, at most, before its signals call in these tests. */
        const val MAX_REQUESTS = 5

        /** At most 10 s in 50 ms waits, the main looper idled between them. */
        const val WAIT_ROUNDS = 200
        const val WAIT_STEP_MS = 50L
        const val INQUIRY_ID = "inq_01M5CJXHG07XPHF3HRM6NREDH7"

        /** Synthetic session token: the `ovs_` prefix plus 43 base64url characters. */
        val TOKEN = "ovs_" + "t".repeat(43)

        /** A synthetic ANDROID_ID: 16 lowercase hex digits, never a real device's. */
        const val ANDROID_ID = "0f1e2d3c4b5a6978"
    }
}
