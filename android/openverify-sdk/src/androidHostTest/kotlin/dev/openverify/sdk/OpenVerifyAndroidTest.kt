package dev.openverify.sdk

import okhttp3.OkHttpClient
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertSame
import org.junit.jupiter.api.Test

/**
 * C191.1 (decision 6): one process-wide registry. A second [OpenVerifyAndroid.install] replaces the
 * first, whole; nothing is discovered or merged.
 */
internal class OpenVerifyAndroidTest {

    @AfterEach
    fun uninstall() = OpenVerifyAndroid.install(OpenVerifyComponents())

    @Test
    fun `what is installed is what installed returns`() {
        val components = OpenVerifyComponents(eventListener = {})

        OpenVerifyAndroid.install(components)

        assertSame(components, OpenVerifyAndroid.installed())
    }

    @Test
    fun `a second call replaces the first, whole`() {
        val first = OpenVerifyComponents(eventListener = {}, transport = OpenVerifyAndroidTransport.okHttp(OkHttpClient()))
        val second = OpenVerifyComponents(sandboxSignalOutcome = SandboxSignalOutcome.HUMAN)

        OpenVerifyAndroid.install(first)
        OpenVerifyAndroid.install(second)

        assertSame(second, OpenVerifyAndroid.installed())
        assertNull(OpenVerifyAndroid.installed().eventListener)
        assertNull(OpenVerifyAndroid.installed().transport)
    }

    @Test
    fun `the empty registry names no component`() {
        val empty = OpenVerifyAndroid.installed()

        listOf(empty.chipReader, empty.faceDetectorFactory, empty.integrityTokenProvider, empty.eventListener, empty.transport, empty.sandboxSignalOutcome)
            .forEach(::assertNull)
    }
}
