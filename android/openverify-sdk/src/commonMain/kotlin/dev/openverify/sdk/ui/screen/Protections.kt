package dev.openverify.sdk.ui.screen

import androidx.compose.runtime.Composable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.SemanticsPropertyKey
import androidx.compose.ui.semantics.SemanticsPropertyReceiver
import androidx.compose.ui.semantics.isSensitiveData
import androidx.compose.ui.semantics.semantics

// C213.1 (decision 70; review P08, taken in part; review V03): android-screens' part of the
// protections, on the form components of `ui/screen/` and the typed-value fields and submit controls
// of the verification steps in `ui/steps/`. The whole view tree is never marked: that would hide
// every navigation control from assistive apps that are not declared accessibility tools.

/** The Android API level the protections are chosen for; iOS has none (0) and claims nothing. */
internal expect fun platformApiLevel(): Int

/** The API level the screens below choose their protections for: the device's, or a test's. */
internal val LocalPlatformApiLevel = staticCompositionLocalOf { platformApiLevel() }

/**
 * API 26 to 30: the platform blocks a touch through an untrusted overlay only from API 31, so a
 * submit control drops a touch delivered while another window obscured it (`filterTouchesWhenObscured`).
 */
internal fun filtersObscuredTouches(apiLevel: Int): Boolean = apiLevel in 26..30

/**
 * API 34 and later: a typed-value field is accessibility-data-sensitive, hidden from services that
 * are not declared accessibility tools, while TalkBack still reads it.
 */
internal fun marksDataSensitive(apiLevel: Int): Boolean = apiLevel >= 34

/** Test-only semantics: whether a control drops obscured touches (Compose has no semantics of its own for it). */
internal val ObscuredTouchesFiltered: SemanticsPropertyKey<Boolean> = SemanticsPropertyKey("OpenVerifyObscuredTouchesFiltered")

private var SemanticsPropertyReceiver.obscuredTouchesFiltered by ObscuredTouchesFiltered

/** C213.1: a typed-value field on API 34+ is accessibility-data-sensitive (`ACCESSIBILITY_DATA_SENSITIVE_YES`). */
@Composable
internal fun Modifier.typedValueProtection(): Modifier =
    if (marksDataSensitive(LocalPlatformApiLevel.current)) semantics { isSensitiveData = true } else this

/** C213.1: a submit control on API 26-30 drops touches delivered through another window. */
@Composable
internal fun Modifier.submitProtection(): Modifier =
    if (filtersObscuredTouches(LocalPlatformApiLevel.current)) semantics { obscuredTouchesFiltered = true }.dropObscuredTouches() else this

/** Drops every pointer event the platform marks as delivered through an obscuring window; iOS: nothing to drop. */
internal expect fun Modifier.dropObscuredTouches(): Modifier
