package dev.openverify.sdk.ui.screen

import androidx.compose.ui.Modifier

/** iOS has no Android API level: none of the Android protections applies, and none is claimed. */
internal actual fun platformApiLevel(): Int = 0

/** Nothing on iOS marks a touch as delivered through an obscuring window: the modifier is unchanged. */
internal actual fun Modifier.dropObscuredTouches(): Modifier = this
