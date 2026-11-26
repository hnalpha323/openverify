package dev.openverify.demo.smoke

import android.content.Context
import android.content.pm.PackageManager
import androidx.test.core.app.ApplicationProvider
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

/**
 * C209.6 (decision 48): the reader check is a debug-only screen. The minifiedSmoke build is the
 * release build signed for the device test, so what holds for it here holds for release: neither
 * holds the screen's class or declares its activity, in any configuration of the demo.
 */
@RunWith(RobolectricTestRunner::class)
class ReaderCheckAbsentTest {

    private val context: Context = ApplicationProvider.getApplicationContext()

    @Test
    fun `the minified build holds no reader check, with or without the NFC module`() {
        val declared = context.packageManager.getPackageInfo(context.packageName, PackageManager.GET_ACTIVITIES).activities.orEmpty().map { it.name }

        assertEquals(emptyList<String>(), declared.filter { "readercheck" in it.lowercase() })
        assertThrows(ClassNotFoundException::class.java) { Class.forName("dev.openverify.demo.readercheck.ReaderCheckActivity") }
        assertThrows(ClassNotFoundException::class.java) { Class.forName("dev.openverify.demo.readercheck.ReaderCheck") }
    }
}
