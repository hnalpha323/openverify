@file:OptIn(ExperimentalOpenVerifyApi::class)

package dev.openverify.sdk.nfc

import android.content.Context
import android.util.Log
import androidx.compose.ui.test.junit4.v2.createEmptyComposeRule
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.lifecycle.Lifecycle
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import dev.openverify.sdk.ExperimentalOpenVerifyApi
import dev.openverify.sdk.OpenVerifyAndroid
import dev.openverify.sdk.OpenVerifyAndroidTransport
import dev.openverify.sdk.OpenVerifyComponents
import dev.openverify.sdk.OpenVerifyInquiry
import dev.openverify.sdk.OpenVerifyInquiryActivity
import dev.openverify.sdk.chip.ChipAccess
import dev.openverify.sdk.chip.ChipProgress
import dev.openverify.sdk.chip.ChipRead
import dev.openverify.sdk.chip.ChipReader
import dev.openverify.sdk.ui.steps.NfcStepTags
import kotlinx.coroutines.awaitCancellation
import okhttp3.Interceptor
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Protocol
import okhttp3.Response
import okhttp3.ResponseBody.Companion.toResponseBody
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import java.util.concurrent.atomic.AtomicInteger

/**
 * KP10-38 (C207.5): the tap screen's reader over a real activity lifecycle. The host twin is
 * `NfcActivityTest` (Robolectric); only a device shows that leaving the SDK's activity during a tap
 * turns the installed reader off and that coming back turns it on again.
 *
 * The flow's server is the host's own OkHttp client with an interceptor that answers from memory
 * (nothing reaches a network); the session is the contract's golden one at its `nfc` step, with
 * ICAO's Utopia specimen prefilled; the chip reader records its calls and reads no chip. On a device
 * whose NFC is off or absent the step never offers the tap, so the test asserts that instead: the
 * reader is never turned on. It changes no setting.
 */
@RunWith(AndroidJUnit4::class)
class NfcTapLifecycleDeviceTest {

    @get:Rule
    val compose = createEmptyComposeRule()

    private val context: Context = InstrumentationRegistry.getInstrumentation().targetContext.applicationContext

    /** A reader that waits for a document until it is stopped, counting its starts and stops. */
    private class RecordingReader : ChipReader {
        val started = AtomicInteger()
        val stopped = AtomicInteger()

        @Volatile
        var reading = false

        override suspend fun read(access: ChipAccess, challenge: ByteArray, progress: (ChipProgress) -> Unit): ChipRead {
            started.incrementAndGet()
            reading = true
            try {
                progress(ChipProgress.WaitingForDocument)
                awaitCancellation()
            } finally {
                reading = false
                stopped.incrementAndGet()
            }
        }
    }

    private val reader = RecordingReader()
    private val challenges = AtomicInteger()

    private val server = Interceptor { chain ->
        val request = chain.request()
        val path = request.url.encodedPath
        val (code, body) = when {
            path == "/api/v1/flow/session" -> 200 to session()
            path == "/api/v1/flow/signals" -> 202 to ""
            path == "/api/v1/flow/verifications" && request.method == "POST" -> 201 to CREATED
            path == "/api/v1/flow/verifications/$VERIFICATION_ID/chip-challenges" -> 201 to CHALLENGE.also { challenges.incrementAndGet() }
            else -> 404 to "{}"
        }
        Response.Builder().request(request).protocol(Protocol.HTTP_1_1).code(code).message("canned")
            .body(body.toResponseBody("application/json".toMediaType())).build()
    }

    private fun session(): String =
        checkNotNull(javaClass.classLoader?.getResourceAsStream("nfc/flow-session-nfc-sdk.json")) { "missing test resource" }
            .use { it.readBytes().decodeToString() }

    @After
    fun uninstall() {
        OpenVerifyAndroid.install(OpenVerifyComponents())
    }

    private fun shown(tag: String): Boolean = compose.onAllNodesWithTag(tag).fetchSemanticsNodes().isNotEmpty()

    @Test
    fun leavingTheAppDuringATapTurnsTheReaderOffAndComingBackTurnsItOnAgain() {
        OpenVerifyAndroid.install(
            OpenVerifyComponents(chipReader = reader, transport = OpenVerifyAndroidTransport.okHttp(OkHttpClient.Builder().addInterceptor(server).build())),
        )
        val availability = NfcPlatform(context).availability()
        Log.i(TAG, "availability=${availability.name}")
        val intent = OpenVerifyInquiry.Contract().createIntent(context, OpenVerifyInquiry.Request(INQUIRY_ID, TOKEN, "https://flow.example.com"))

        ActivityScenario.launch<OpenVerifyInquiryActivity>(intent).use { scenario ->
            if (availability != NfcAvailability.READY) {
                // NFC is off or absent: the step offers its way out and no tap, and the reader stays off.
                compose.waitUntil(WAIT_MS) { shown(NfcStepTags.CONTINUE_LATER) }
                assertEquals(false, shown(NfcStepTags.READY))
                assertEquals(0, reader.started.get())
                return
            }
            compose.waitUntil(WAIT_MS) { shown(NfcStepTags.READY) }
            compose.onNodeWithTag(NfcStepTags.READY).performScrollTo().performClick()
            compose.waitUntil(WAIT_MS) { reader.reading }
            assertEquals(1, reader.started.get())

            scenario.moveToState(Lifecycle.State.STARTED)
            compose.waitUntil(WAIT_MS) { !reader.reading }
            assertEquals("the read was stopped once", 1, reader.stopped.get())

            scenario.moveToState(Lifecycle.State.RESUMED)
            compose.waitUntil(WAIT_MS) { reader.reading }

            assertEquals("the reader was turned on again", 2, reader.started.get())
            assertEquals("with the challenge it had", 1, challenges.get())
        }
    }

    private companion object {
        const val TAG = "openverify-nfc"
        const val WAIT_MS = 20_000L
        const val INQUIRY_ID = "inq_01M5CJXHG07XPHF3HRM6NREDH7"

        /** Synthetic: a prefix plus 43 base64url characters. */
        val TOKEN = "ovs_" + "s".repeat(43)
        const val VERIFICATION_ID = "ver_01M5CK16P0D13FXHZSS4TCFBVN"

        /** The chip verification the fake server creates. */
        const val CREATED = """{"data":{"type":"verification/government-id-nfc","id":"$VERIFICATION_ID","attributes":{"status":"initiated",""" +
            """"retry-hints":[],"created-at":"2026-10-20T12:03:00.000Z","updated-at":"2026-10-20T12:03:00.000Z"}}}"""

        /** The contract's golden chip challenge (`contracts/fixtures/api/flow-chip-challenge.json`). */
        const val CHALLENGE = """{"id":"chc_01M5CK3190XEVBM5ZXA76E1JSM","nonce":"0123456789abcdef","expires-at":"2026-11-10T12:05:00.000Z"}"""
    }
}
