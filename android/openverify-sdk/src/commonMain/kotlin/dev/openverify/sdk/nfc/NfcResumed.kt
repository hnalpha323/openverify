package dev.openverify.sdk.nfc

import androidx.compose.runtime.Composable

/**
 * C207.5: calls [onResumed] each time the screen that holds this is resumed, and [onPaused] when it
 * no longer is or leaves composition, so the chip reader is on only while the tap screen is the
 * resumed screen. Android follows the activity's lifecycle; iOS (nothing is built for it in this
 * release) follows composition only.
 */
@Composable
internal expect fun WhileResumed(onResumed: () -> Unit, onPaused: () -> Unit)
