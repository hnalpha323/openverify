package dev.openverify.sdk

import android.os.Looper
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import java.util.concurrent.TimeUnit
import kotlin.concurrent.thread

/** C192.1: an event reaches the host's listener on the main thread, wherever it was emitted. */
@RunWith(RobolectricTestRunner::class)
internal class MainThreadDeliveryTest {

    @Test
    fun `a delivery from another thread runs on the main thread`() {
        val ranOn = mutableListOf<Looper?>()

        thread { MainThreadDelivery.deliver { ranOn += Looper.myLooper() } }.join(TimeUnit.SECONDS.toMillis(5))
        shadowOf(Looper.getMainLooper()).idle()

        assertEquals(listOf(Looper.getMainLooper()), ranOn)
    }

    @Test
    fun `a delivery on the main thread runs at once`() {
        var ran = false

        MainThreadDelivery.deliver { ran = true }

        assertTrue(ran)
    }
}
