package dev.openverify.sdk.ui

import kotlin.test.Test
import kotlin.test.assertFalse

/**
 * The camera permission of a platform with no capture yet (iOS until Phase 10, KMP plan K3): it
 * never claims the camera nor a refusal, whatever the user does, so no capture can start.
 */
class UnavailableCameraPermissionTest {

    private val permission: CameraPermission = CameraPermission.Unavailable

    @Test
    fun neverClaimsTheCameraNorARefusal() {
        assertFalse(permission.available)
        assertFalse(permission.granted)
        assertFalse(permission.denied)
    }

    @Test
    fun askingOrOpeningTheSettingsChangesNothing() {
        permission.request()
        permission.openSettings()

        assertFalse(permission.available)
        assertFalse(permission.granted)
        assertFalse(permission.denied)
    }
}
