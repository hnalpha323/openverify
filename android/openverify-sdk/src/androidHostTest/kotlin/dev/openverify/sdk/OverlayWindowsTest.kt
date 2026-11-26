package dev.openverify.sdk

import android.Manifest
import android.app.Application
import android.content.Context
import android.content.pm.PackageManager
import android.view.Window
import android.view.WindowManager
import androidx.activity.ComponentActivity
import androidx.test.core.app.ApplicationProvider
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf

/**
 * C213.1 (decision 70; review P08, V03), android-sdk-api's part: on API 31 and later the flow's
 * window hides other apps' non-system overlays (`Window.setHideOverlayWindows`); below API 31 the
 * method does not exist and the window is left as it is (the consent controls filter obscured
 * touches there, `ConsentProtectionsTest`). Robolectric's only offline platform is API 36 (rule 9),
 * so the lower levels are the injected level, and API 36's real window is checked through its flag.
 */
@RunWith(RobolectricTestRunner::class)
internal class OverlayWindowsTest {

    private val window: Window = Robolectric.buildActivity(ComponentActivity::class.java).setup().get().window

    @Test
    fun `the SDK's merged manifest asks for the permission, which the platform grants at install`() {
        val context = ApplicationProvider.getApplicationContext<Context>()
        val requested = context.packageManager.getPackageInfo(context.packageName, PackageManager.GET_PERMISSIONS).requestedPermissions.orEmpty()

        assertTrue(requested.toList().toString(), Manifest.permission.HIDE_OVERLAY_WINDOWS in requested)
    }

    @Test
    fun `from API 31 the window hides other apps' overlays, and shows them again`() {
        grantInstallTimePermission()
        OverlayWindows.apply(window, hide = true, apiLevel = 31)
        assertTrue(hidesOverlays(window))

        OverlayWindows.apply(window, hide = false, apiLevel = 31)
        assertFalse(hidesOverlays(window))
    }

    @Test
    fun `a refused permission leaves the window as it is and never stops the flow`() {
        OverlayWindows.apply(window, hide = true, apiLevel = 31)

        assertFalse(hidesOverlays(window))
    }

    @Test
    fun `below API 31 the window is left as it is`() {
        grantInstallTimePermission()
        (26..30).forEach { level ->
            OverlayWindows.apply(window, hide = true, apiLevel = level)
            assertFalse("API $level", hidesOverlays(window))
        }
    }

    @Test
    fun `the first level is 31`() {
        assertEquals(31, OverlayWindows.FIRST_API_LEVEL)
    }

    companion object {
        /**
         * `HIDE_OVERLAY_WINDOWS` is a normal permission, which the platform grants when the host app
         * that merged the SDK's manifest is installed; Robolectric grants none by itself.
         */
        fun grantInstallTimePermission() {
            shadowOf(ApplicationProvider.getApplicationContext<Application>()).grantPermissions(Manifest.permission.HIDE_OVERLAY_WINDOWS)
        }

        /**
         * Whether [window] hides non-system overlays: `Window.setHideOverlayWindows` sets the hidden
         * private flag `SYSTEM_FLAG_HIDE_NON_SYSTEM_OVERLAY_WINDOWS`, read here by reflection.
         */
        fun hidesOverlays(window: Window): Boolean {
            val params = window.attributes
            val flag = WindowManager.LayoutParams::class.java.getField("SYSTEM_FLAG_HIDE_NON_SYSTEM_OVERLAY_WINDOWS").getInt(null)
            val privateFlags = WindowManager.LayoutParams::class.java.getField("privateFlags").getInt(params)
            return privateFlags and flag != 0
        }
    }
}
