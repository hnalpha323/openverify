package dev.openverify.demo.smoke

import android.content.Context
import android.content.Intent
import android.content.pm.ApplicationInfo
import android.view.KeyEvent
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.runner.lifecycle.ActivityLifecycleCallback
import androidx.test.runner.lifecycle.ActivityLifecycleMonitorRegistry
import androidx.test.runner.lifecycle.Stage
import mockwebserver3.Dispatcher
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import mockwebserver3.RecordedRequest
import okhttp3.tls.HandshakeCertificates
import okhttp3.tls.HeldCertificate
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import java.net.InetAddress
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/**
 * C215.2 (reviews P16, F12, V01): the smoke test of the `minifiedSmoke` build, which R8 minified
 * exactly as `release`. It runs only on a device or an emulator; `SmokeLauncherActivityTest` (the
 * `minifiedSmoke` variant's host test) is its twin over the same session and the same launcher, on
 * code R8 has not touched.
 *
 * The flow's server is a `MockWebServer` on 127.0.0.1 over TLS, with an `okhttp-tls`
 * `HeldCertificate` made here at run time (no key is committed). The launcher, which exists only in
 * this build and is not exported, installs a transport that trusts that certificate alone and starts
 * the session contract. The app is not debuggable, so the SDK would refuse plain http to loopback.
 *
 * This test touches only the smoke package (`SmokeLauncherActivity`, `SmokeReport`), which one rule of
 * the smoke build keeps (`smoke-proguard-rules.pro`), and names no SDK class: its APK is built against
 * the minified app, where R8 may have removed any SDK member the app does not use.
 */
@RunWith(AndroidJUnit4::class)
class MinifiedSmokeTest {

    private val instrumentation = InstrumentationRegistry.getInstrumentation()
    private val context: Context = instrumentation.targetContext
    private val held: HeldCertificate = HeldCertificate.Builder()
        .commonName("127.0.0.1")
        .addSubjectAlternativeName("127.0.0.1")
        .build()
    private val server = MockWebServer()

    // The launcher finishes itself once its result is in. Closing the scenario reads the activity's
    // stage once and fails on one in passing (on the Pixel 9: "Current state was null unexpectedly.
    // Last stage = STARTED", KP10-32), so each test waits for the launcher to be destroyed first.
    private val launcherDestroyed = CountDownLatch(1)
    private val lifecycle = ActivityLifecycleCallback { activity, stage ->
        if (activity is SmokeLauncherActivity && stage == Stage.DESTROYED) launcherDestroyed.countDown()
    }

    @Before
    fun start() {
        SmokeReport.reset()
        ActivityLifecycleMonitorRegistry.getInstance().addLifecycleCallback(lifecycle)
        val session = instrumentation.context.assets.open("smoke-session.json").bufferedReader().use { it.readText() }
        server.dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest): MockResponse =
                if (request.url.encodedPath == "/api/v1/flow/session") {
                    MockResponse.Builder().code(200).addHeader("Content-Type", "application/json").body(session).build()
                } else {
                    MockResponse.Builder().code(404).addHeader("Content-Type", "application/json").body("{}").build()
                }
        }
        server.useHttps(HandshakeCertificates.Builder().heldCertificate(held).build().sslSocketFactory())
        server.start(InetAddress.getByName("127.0.0.1"), 0)
    }

    @After
    fun stop() {
        ActivityLifecycleMonitorRegistry.getInstance().removeLifecycleCallback(lifecycle)
        server.close()
        SmokeReport.reset()
    }

    private fun launch(apiBaseUrl: String) = Intent(context, SmokeLauncherActivity::class.java)
        .putExtra(SmokeLauncherActivity.EXTRA_CERTIFICATE_PEM, held.certificatePem())
        .putExtra(SmokeLauncherActivity.EXTRA_INQUIRY_ID, INQUIRY_ID)
        .putExtra(SmokeLauncherActivity.EXTRA_SESSION_TOKEN, SESSION_TOKEN)
        .putExtra(SmokeLauncherActivity.EXTRA_API_BASE_URL, apiBaseUrl)

    @Test
    fun theMinifiedFlowLoadsItsSessionOverTlsThroughTheInstalledTransportAndReturnsItsResult() {
        assertEquals("the smoke build is not debuggable", 0, context.applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE)

        ActivityScenario.launch<SmokeLauncherActivity>(launch("https://127.0.0.1:${server.port}")).use {
            // The session's models were decoded and the consent step is on the screen.
            assertEquals("Started", SmokeReport.events.poll(WAIT_SECONDS, TimeUnit.SECONDS))
            assertEquals("StepShown consent", SmokeReport.events.poll(WAIT_SECONDS, TimeUnit.SECONDS))

            val request = server.takeRequest(WAIT_SECONDS, TimeUnit.SECONDS)
            assertEquals("/api/v1/flow/session", request?.url?.encodedPath)
            assertEquals("Bearer $SESSION_TOKEN", request?.headers?.get("Authorization"))
            assertNotNull("the request came over TLS", request?.handshake)

            // Leaving the flow at its consent step cancels it; the result comes back through the contract.
            instrumentation.waitForIdleSync()
            instrumentation.sendKeyDownUpSync(KeyEvent.KEYCODE_BACK)
            assertEquals("Canceled $INQUIRY_ID", SmokeReport.results.poll(WAIT_SECONDS, TimeUnit.SECONDS))
            assertTrue("the launcher finished after its result", launcherDestroyed.await(WAIT_SECONDS, TimeUnit.SECONDS))
        }
    }

    @Test
    fun plainHttpToLoopbackIsRefusedBeforeAnyRequest() {
        ActivityScenario.launch<SmokeLauncherActivity>(launch("http://127.0.0.1:${server.port}")).use {
            assertEquals("Failed $INQUIRY_ID INVALID_REQUEST", SmokeReport.results.poll(WAIT_SECONDS, TimeUnit.SECONDS))
            assertNull("nothing reached the server", server.takeRequest(1, TimeUnit.SECONDS))
            assertTrue("the launcher finished after its result", launcherDestroyed.await(WAIT_SECONDS, TimeUnit.SECONDS))
        }
    }

    private companion object {
        /** The golden session's inquiry (contracts/fixtures/api/flow-session.json). */
        const val INQUIRY_ID = "inq_01M5CJXHG07XPHF3HRM6NREDH7"

        /** Synthetic: the `ovs_` prefix plus 43 base64url characters. */
        const val SESSION_TOKEN = "ovs_ttttttttttttttttttttttttttttttttttttttttttt"
        const val WAIT_SECONDS = 60L
    }
}
