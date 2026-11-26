package dev.openverify.face

import ai.onnxruntime.OrtEnvironment
import ai.onnxruntime.OrtException
import ai.onnxruntime.OrtSession
import android.content.Context
import android.content.pm.ApplicationInfo
import androidx.test.core.app.ApplicationProvider
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.shadows.ShadowLog

/**
 * C205.2, second and third layers (reviews P09, H06), over the real ONNX Runtime of the host JVM (the
 * same version as the Android AAR's): the telemetry variable is set before the first environment,
 * telemetry is switched off before every session, and an environment that existed first is detected.
 */
@RunWith(RobolectricTestRunner::class)
class OrtEnvironmentsTest {

    private val context: Context = ApplicationProvider.getApplicationContext()

    private fun written(): List<String> = ShadowLog.getLogsForTag("OpenVerifyFace").map { it.msg }

    /** An access whose environment cannot be created, for [failure]'s reason. */
    private fun failing(failure: () -> Nothing): OrtAccess = object : OrtAccess {
        override fun setVariable(name: String, value: String) = Unit
        override fun createEnvironment(): OrtEnvironment = failure()
        override fun existingEnvironment(): OrtEnvironment = error("not asked for")
        override fun disableTelemetry(environment: OrtEnvironment) = error("not asked for")
        override fun createSession(environment: OrtEnvironment, model: ByteArray, threads: Int): OrtSession = error("not asked for")
    }

    @Before
    fun firstEnvironmentAndDebuggableHost() {
        HostOrt.first
        ShadowLog.clear()
        context.applicationInfo.flags = context.applicationInfo.flags or ApplicationInfo.FLAG_DEBUGGABLE
        FaceLog.attach(context)
    }

    @Test
    fun `the telemetry variable is set before the first environment is created, by this module`() {
        assertEquals(listOf("setVariable ORT_DISABLE_TELEMETRY=1", "createEnvironment"), HostOrt.callsAtCreation)
        assertFalse(HostOrt.environments.hostCreated)
        assertSame(HostOrt.first, HostOrt.environments.environment())
        // Asked again, nothing is set or created again.
        assertEquals(1, HostOrt.access.calls.count { it == "createEnvironment" })
        assertEquals(1, HostOrt.access.calls.count { it.startsWith("setVariable") })
    }

    @Test
    fun `telemetry is switched off before every session, on two threads`() {
        val model = HostFiles.model().readBytes()
        val from = HostOrt.access.calls.size

        HostOrt.environments.openSession(model).close()
        HostOrt.environments.openSession(model).close()

        assertEquals(
            listOf("disableTelemetry", "createSession threads=2", "disableTelemetry", "createSession threads=2"),
            HostOrt.access.calls.drop(from),
        )
    }

    @Test
    fun `an environment that existed first is detected, logged once as a code and used`() {
        // HostOrt's environment stands for one the host app created before this module's first call.
        val access = RecordingAccess()
        val later = OrtEnvironments(access)

        val found = later.environment()
        later.environment()

        assertTrue(later.hostCreated)
        assertSame(HostOrt.first, found)
        assertEquals(listOf("setVariable ORT_DISABLE_TELEMETRY=1", "existingEnvironment"), access.calls)
        assertEquals(listOf("face.ort_environment_host_created"), written())
    }

    @Test
    fun `on an environment the host created, telemetry is still switched off before each session`() {
        val access = RecordingAccess()
        val later = OrtEnvironments(access)

        later.openSession(HostFiles.model().readBytes()).close()

        assertTrue(later.hostCreated)
        assertEquals(listOf("disableTelemetry", "createSession threads=2"), access.calls.takeLast(2))
    }

    @Test
    fun `an environment that cannot be created is refused with a fixed message and no cause`() {
        val broken = OrtEnvironments(failing { throw IllegalStateException("Failed to create OrtEnvironment", OrtException("synthetic native detail")) })

        val refused = assertThrows(IllegalStateException::class.java) { broken.environment() }

        assertEquals("openverify-face: ONNX Runtime did not start", refused.message)
        assertNull(refused.cause)
        assertFalse(broken.hostCreated)
        assertEquals(listOf("face.ort_environment_failed"), written())
    }

    @Test
    fun `a failure of ONNX Runtime while the environment is made is refused the same way`() {
        val broken = OrtEnvironments(failing { throw OrtException("synthetic native detail") })

        val refused = assertThrows(IllegalStateException::class.java) { broken.environment() }

        assertEquals("openverify-face: ONNX Runtime did not start", refused.message)
        assertNull(refused.cause)
        assertEquals(listOf("face.ort_environment_failed"), written())
    }

    @Test
    fun `a native library that is not in the app is an exception with a fixed message, never an error`() {
        val broken = OrtEnvironments(failing { throw UnsatisfiedLinkError("dlopen failed: synthetic path libonnxruntime4j_jni.so") })

        val refused = assertThrows(IllegalStateException::class.java) { broken.environment() }

        assertEquals("openverify-face: ONNX Runtime's native library did not load", refused.message)
        assertNull(refused.cause)
        assertEquals(listOf("face.ort_library_unavailable"), written())
    }

    @Test
    fun `bytes that are not a model are refused with a fixed message and no cause`() {
        val refused = assertThrows(IllegalStateException::class.java) { HostOrt.environments.openSession(byteArrayOf(1, 2, 3, 4)) }

        assertEquals("openverify-face: ONNX Runtime did not open the model", refused.message)
        assertNull(refused.cause)
        assertEquals(listOf("face.ort_session_failed"), written())
    }
}
