package dev.openverify.demo

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import dev.openverify.sdk.OpenVerifyAndroid
import dev.openverify.sdk.OpenVerifyComponents
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

/**
 * C218.1, KP10-45: the demo installs each optional artifact this build includes, through the
 * artifact's hook, and nothing for an artifact it leaves out. The gate runs this once per
 * configuration (`-PopenverifyDemoArtifacts=sdk`, `sdk,nfc`, `sdk,face`, `sdk,nfc,face`), so each
 * case below is checked for every build the demo has. No integrity token provider is ever installed
 * (Phase 10 P3, declined: a host implements `IntegrityTokenProvider` itself).
 */
@RunWith(RobolectricTestRunner::class)
class DemoArtifactComponentsTest {

    private val context: Context = ApplicationProvider.getApplicationContext()
    private val log = EventLog()

    @After
    fun reset() {
        OpenVerifyAndroid.install(OpenVerifyComponents())
    }

    @Test
    fun `the chip reader is installed exactly when the build includes openverify-nfc`() {
        DemoComponents.attach(context)

        val components = DemoComponents.of(SandboxOutcomeChoice.NONE, log)

        assertEquals("nfc" in DemoArtifacts.included, components.chipReader != null)
    }

    @Test
    fun `the face detector is installed exactly when the build includes openverify-face`() {
        DemoComponents.attach(context)

        val components = DemoComponents.of(SandboxOutcomeChoice.NONE, log)

        assertEquals("face" in DemoArtifacts.included, components.faceDetectorFactory != null)
    }

    @Test
    fun `the application attaches the artifacts when the process starts, so the first launch has them`() {
        // Robolectric made DemoApplication, whose onCreate attached and installed.
        val installed = OpenVerifyAndroid.installed()

        assertEquals("nfc" in DemoArtifacts.included, installed.chipReader != null)
        assertEquals("face" in DemoArtifacts.included, installed.faceDetectorFactory != null)
    }

    @Test
    fun `the artifacts stay installed when a launch installs the picked outcome, and no token provider or transport comes with them`() {
        DemoComponents.attach(context)
        val first = DemoComponents.of(SandboxOutcomeChoice.NONE, log)

        DemoComponents.install(SandboxOutcomeChoice.BOT, log)

        val installed = OpenVerifyAndroid.installed()
        assertSame(first.chipReader, installed.chipReader)
        assertSame(first.faceDetectorFactory, installed.faceDetectorFactory)
        assertSame(log, installed.eventListener)
        assertNull(installed.integrityTokenProvider)
        assertNull(installed.transport)
    }
}
