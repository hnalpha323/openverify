package dev.openverify.demo.smoke

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.content.pm.ApplicationInfo
import android.os.Looper
import androidx.activity.ComponentActivity
import androidx.lifecycle.Lifecycle
import androidx.test.core.app.ActivityScenario
import androidx.test.core.app.ApplicationProvider
import dev.openverify.sdk.OpenVerifyAndroid
import dev.openverify.sdk.OpenVerifyComponents
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import java.io.File
import java.util.concurrent.BlockingQueue
import java.util.concurrent.TimeUnit

/**
 * C215.2 (review V01), host twin of the device test `MinifiedSmokeTest`: on the `minifiedSmoke`
 * variant (not debuggable, https only) the launcher installs a transport that trusts one certificate,
 * starts the session contract, and the flow loads its session over TLS from 127.0.0.1, shows the
 * consent step and returns its result through the contract. What only a device shows (that R8's
 * output does the same) is the device test's to prove.
 */
@RunWith(RobolectricTestRunner::class)
class SmokeLauncherActivityTest {

    private val context: Context = ApplicationProvider.getApplicationContext()
    private val session = File("src/androidTest/assets/smoke-session.json").readText()

    @Before
    fun start() = SmokeReport.reset()

    @After
    fun stop() {
        SmokeReport.reset()
        OpenVerifyAndroid.install(OpenVerifyComponents())
    }

    private fun launch(apiBaseUrl: String, certificatePem: String) = Intent(context, SmokeLauncherActivity::class.java)
        .putExtra(SmokeLauncherActivity.EXTRA_CERTIFICATE_PEM, certificatePem)
        .putExtra(SmokeLauncherActivity.EXTRA_INQUIRY_ID, INQUIRY_ID)
        .putExtra(SmokeLauncherActivity.EXTRA_SESSION_TOKEN, SESSION_TOKEN)
        .putExtra(SmokeLauncherActivity.EXTRA_API_BASE_URL, apiBaseUrl)

    /** Waits in short steps, idling the paused main looper between them (Workflow 10B Stage 3 amendment 1). */
    private fun <T> BlockingQueue<T>.await(): T? {
        repeat(400) {
            shadowOf(Looper.getMainLooper()).idle()
            poll(50, TimeUnit.MILLISECONDS)?.let { return it }
        }
        return null
    }

    /** Runs the flow the launcher asked for, as the system would, and hands its result back to the launcher. */
    private fun ActivityScenario<SmokeLauncherActivity>.runFlow(during: (ActivityScenario<Activity>) -> Unit) {
        var asked: Intent? = null
        var launcher: SmokeLauncherActivity? = null
        onActivity {
            launcher = it
            asked = shadowOf(it).nextStartedActivityForResult?.intent
        }
        val intent = checkNotNull(asked) { "the launcher starts no flow" }
        assertEquals("dev.openverify.sdk.OpenVerifyInquiryActivity", intent.component?.className)
        ActivityScenario.launchActivityForResult<Activity>(intent).use { flow ->
            during(flow)
            val result = flow.result
            shadowOf(launcher!!).receiveResult(intent, result.resultCode, result.resultData)
        }
        // The launcher's result callback runs once it is started again, as after a real flow.
        moveToState(Lifecycle.State.RESUMED)
    }

    @Test
    fun `the smoke build is not debuggable`() {
        assertEquals(0, context.applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE)
    }

    @Test
    fun `the flow loads its session over TLS through the installed transport and returns its result`() {
        SmokeTlsServer { path -> if (path == "/api/v1/flow/session") 200 to session else 404 to "{}" }.use { server ->
            ActivityScenario.launch<SmokeLauncherActivity>(launch(server.url, server.certificatePem)).use { launcher ->
                assertNotNull("a transport is installed", OpenVerifyAndroid.installed().transport)
                launcher.runFlow { flow ->
                    assertEquals("Started", SmokeReport.events.await())
                    assertEquals("StepShown consent", SmokeReport.events.await())
                    flow.onActivity { (it as ComponentActivity).onBackPressedDispatcher.onBackPressed() }
                }

                assertEquals("Canceled $INQUIRY_ID", SmokeReport.results.await())
                assertEquals("GET /api/v1/flow/session (bearer)", server.requests.first())
            }
        }
    }

    @Test
    fun `plain http to loopback is refused before any request, as in any app that is not debuggable`() {
        SmokeTlsServer { 200 to session }.use { server ->
            val plain = server.url.replace("https://", "http://")
            ActivityScenario.launch<SmokeLauncherActivity>(launch(plain, server.certificatePem)).use { launcher ->
                launcher.runFlow { }

                assertEquals("Failed $INQUIRY_ID INVALID_REQUEST", SmokeReport.results.await())
                assertEquals(emptyList<String>(), server.requests.toList())
            }
        }
    }

    @Test
    fun `a launch without its extras starts nothing`() {
        ActivityScenario.launch<SmokeLauncherActivity>(Intent(context, SmokeLauncherActivity::class.java)).use { launcher ->
            assertEquals(Lifecycle.State.DESTROYED, launcher.state)
            assertNull(OpenVerifyAndroid.installed().transport)
            assertNull(SmokeReport.results.poll())
        }
    }

    private companion object {
        const val INQUIRY_ID = "inq_01M5CJXHG07XPHF3HRM6NREDH7"

        /** Synthetic: the `ovs_` prefix plus 43 base64url characters. */
        const val SESSION_TOKEN = "ovs_ttttttttttttttttttttttttttttttttttttttttttt"
    }
}
