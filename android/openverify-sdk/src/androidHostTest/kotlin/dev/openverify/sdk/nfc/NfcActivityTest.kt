@file:OptIn(ExperimentalOpenVerifyApi::class)

package dev.openverify.sdk.nfc

import android.content.Context
import android.content.pm.PackageManager
import android.nfc.NfcAdapter
import android.os.Looper
import androidx.compose.ui.test.junit4.v2.createEmptyComposeRule
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performTextInput
import androidx.lifecycle.Lifecycle
import androidx.test.core.app.ActivityScenario
import androidx.test.core.app.ApplicationProvider
import dev.openverify.sdk.ExperimentalOpenVerifyApi
import dev.openverify.sdk.OpenVerifyAndroid
import dev.openverify.sdk.OpenVerifyAndroidTransport
import dev.openverify.sdk.OpenVerifyComponents
import dev.openverify.sdk.OpenVerifyInquiry
import dev.openverify.sdk.OpenVerifyInquiryActivity
import dev.openverify.sdk.chip.ChipAccess
import dev.openverify.sdk.generated.resources.*
import dev.openverify.sdk.model.Fixtures
import dev.openverify.sdk.model.OpenVerifyJson
import dev.openverify.sdk.ui.steps.NfcStepTags
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonObject
import okhttp3.Interceptor
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Protocol
import okhttp3.Response
import okhttp3.ResponseBody.Companion.toResponseBody
import org.jetbrains.compose.resources.StringResource
import org.jetbrains.compose.resources.getString
import org.junit.After
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import org.robolectric.shadows.ShadowNfcAdapter
import java.io.File
import java.util.Collections

/**
 * KP10-38 (C191.3, C207.5, C207.12): the NFC step through the activity a host launches. What the
 * host installed in `OpenVerifyComponents` (the chip reader) and what the activity makes itself (the
 * phone's NFC seam, `NfcPlatform`) reach the NFC screens: the access-key screen shows, "I'm ready"
 * takes a challenge from the server and turns the installed reader on, leaving the app turns it off
 * and coming back turns it on again. Without a reader the step says so and asks the server nothing.
 *
 * The flow's server is the host's own OkHttp client with an interceptor that answers from memory, so
 * nothing reaches a network. The session is the golden one at its `nfc` step (ICAO's Utopia
 * specimen); the chip reader is the scripted fake, which reads no chip. The device tests
 * `NfcPlatformDeviceTest` and `NfcTapLifecycleDeviceTest` are this class's twins on a phone.
 */
@RunWith(RobolectricTestRunner::class)
@Config(qualifiers = "w360dp-h1800dp")
class NfcActivityTest {

    @get:Rule
    val compose = createEmptyComposeRule()

    private val context: Context = ApplicationProvider.getApplicationContext()
    private val reader = FakeChipReader()

    /** The session the fake server answers with. */
    @Volatile
    private var session: String = golden()

    /** Every request the flow sent, as `METHOD path`, in order. */
    private val requests: MutableList<String> = Collections.synchronizedList(mutableListOf())

    private val server = Interceptor { chain ->
        val request = chain.request()
        val path = request.url.encodedPath
        requests += "${request.method} $path"
        val (code, body) = when {
            path == "/api/v1/flow/session" -> 200 to session
            path == "/api/v1/flow/signals" -> 202 to ""
            path == "/api/v1/flow/verifications" && request.method == "POST" -> 201 to CREATED
            path == "/api/v1/flow/verifications/$VERIFICATION_ID/chip-challenges" -> 201 to Fixtures.read("api/flow-chip-challenge.json")
            else -> 404 to "{}"
        }
        Response.Builder().request(request).protocol(Protocol.HTTP_1_1).code(code).message("canned")
            .body(body.toResponseBody("application/json".toMediaType())).build()
    }

    private fun golden(): String = Fixtures.read("api/flow-session-nfc-sdk.json")

    /** The golden session with its step changed by [change] (a client view's members). */
    private fun withStep(change: (JsonObject) -> Map<String, JsonElement>): String {
        val whole = OpenVerifyJson.parseToJsonElement(golden()).jsonObject
        return JsonObject(whole + ("step" to JsonObject(change(whole.getValue("step").jsonObject)))).toString()
    }

    /** Without the prefilled MRZ, so the person types the access key. */
    private fun withoutPrefill(): String = withStep { it - "prefillMrz" }

    /** Without the server's sandbox test chip, so a host with no reader has nothing to read with. */
    private fun withoutSandboxChip(): String = withStep { it + ("sandboxChipAvailable" to JsonPrimitive(false)) }

    @Before
    fun nfcOn() {
        shadowOf(context.packageManager).setSystemFeature(PackageManager.FEATURE_NFC, true)
        ShadowNfcAdapter.setNfcHardwareExists(true)
        shadowOf(NfcAdapter.getDefaultAdapter(context)).setEnabled(true)
    }

    @After
    fun uninstall() {
        OpenVerifyAndroid.install(OpenVerifyComponents())
    }

    private fun install(chipReader: FakeChipReader?) = OpenVerifyAndroid.install(
        OpenVerifyComponents(chipReader = chipReader, transport = OpenVerifyAndroidTransport.okHttp(OkHttpClient.Builder().addInterceptor(server).build())),
    )

    private fun launchIntent() = OpenVerifyInquiry.Contract().createIntent(context, OpenVerifyInquiry.Request(INQUIRY_ID, TOKEN, "https://flow.example.com"))

    private fun text(res: StringResource) = runBlocking { getString(res) }

    /** Waits in short steps, idling the paused main looper between them (Workflow 10B Stage 3 amendment 1). */
    private fun waitUntil(what: String, condition: () -> Boolean) {
        repeat(400) {
            shadowOf(Looper.getMainLooper()).idle()
            compose.waitForIdle()
            if (condition()) return
            Thread.sleep(25)
        }
        error("never: $what (requests: $requests)")
    }

    private fun waitForTag(tag: String) = waitUntil("a node tagged $tag") { compose.onAllNodesWithTag(tag).fetchSemanticsNodes().isNotEmpty() }

    @Test
    fun `an installed reader and the phone's NFC reach the access-key screen, and I'm ready takes a challenge and turns the reader on`() {
        session = withoutPrefill()
        install(reader)

        ActivityScenario.launchActivityForResult<OpenVerifyInquiryActivity>(launchIntent()).use {
            waitForTag(NfcStepTags.DOCUMENT_NUMBER)
            compose.onNodeWithTag(NfcStepTags.DOCUMENT_NUMBER).performTextInput("L898902C3")
            compose.onNodeWithTag(NfcStepTags.BIRTH_DATE).performTextInput("740812")
            compose.onNodeWithTag(NfcStepTags.EXPIRY_DATE).performTextInput("120415")
            compose.onNodeWithTag(NfcStepTags.CONTINUE).performScrollTo().performClick()
            waitForTag(NfcStepTags.READY)
            assertEquals("nothing is asked of the server or the reader before I'm ready", emptyList<String>(), requests.filter { it.startsWith("POST /api/v1/flow/verifications") })
            assertEquals(0, reader.accesses.size)

            compose.onNodeWithTag(NfcStepTags.READY).performScrollTo().performClick()
            waitUntil("the installed reader is reading") { reader.reading }

            assertTrue(reader.accesses.single() is ChipAccess.Mrz)
            // The fixture's nonce, 0123456789abcdef, as the eight bytes the chip signs.
            assertArrayEquals(byteArrayOf(0x01, 0x23, 0x45, 0x67, 0x89.toByte(), 0xAB.toByte(), 0xCD.toByte(), 0xEF.toByte()), reader.challenges.single())
            assertEquals(
                listOf("POST /api/v1/flow/verifications", "POST /api/v1/flow/verifications/$VERIFICATION_ID/chip-challenges"),
                requests.filter { it.startsWith("POST /api/v1/flow/verifications") },
            )
        }
    }

    @Test
    fun `leaving the app during a tap turns the reader off, and coming back turns it on again with the same challenge`() {
        install(reader)

        ActivityScenario.launchActivityForResult<OpenVerifyInquiryActivity>(launchIntent()).use { scenario ->
            waitForTag(NfcStepTags.READY)
            compose.onNodeWithTag(NfcStepTags.READY).performScrollTo().performClick()
            waitUntil("the installed reader is reading") { reader.reading }

            scenario.moveToState(Lifecycle.State.STARTED)
            waitUntil("the read is stopped") { !reader.reading }
            assertEquals(1, reader.canceled)

            scenario.moveToState(Lifecycle.State.RESUMED)
            waitUntil("the reader is reading again") { reader.reading }

            assertEquals(2, reader.accesses.size)
            assertEquals(1, requests.count { it.endsWith("/chip-challenges") })
        }
    }

    @Test
    fun `with no reader installed the step says this app cannot read document chips, and asks the server for nothing`() {
        session = withoutSandboxChip()
        install(chipReader = null)

        ActivityScenario.launchActivityForResult<OpenVerifyInquiryActivity>(launchIntent()).use {
            waitUntil("the cannot-read screen") { compose.onAllNodesWithText(text(Res.string.openverify_nfc_unable_reader_title)).fetchSemanticsNodes().isNotEmpty() }

            assertEquals(emptyList<String>(), requests.filter { it.startsWith("POST /api/v1/flow/verifications") })
        }
    }

    @Test
    fun `the device tests' session is the contract's golden session at the nfc step`() {
        // NfcTapLifecycleDeviceTest reads its session from its own resources: a phone has no repository.
        assertEquals(golden(), File("src/androidDeviceTest/resources/nfc/flow-session-nfc-sdk.json").readText())
    }

    private companion object {
        const val INQUIRY_ID = "inq_01M5CJXHG07XPHF3HRM6NREDH7"

        /** Synthetic: a prefix plus 43 base64url characters. */
        val TOKEN = "ovs_" + "s".repeat(43)
        const val VERIFICATION_ID = "ver_01M5CK16P0D13FXHZSS4TCFBVN"

        /** The chip verification the fake server creates. */
        const val CREATED = """{"data":{"type":"verification/government-id-nfc","id":"$VERIFICATION_ID","attributes":{"status":"initiated",""" +
            """"retry-hints":[],"created-at":"2026-10-20T12:03:00.000Z","updated-at":"2026-10-20T12:03:00.000Z"}}}"""
    }
}
