package dev.openverify.sdk.ui

import androidx.compose.runtime.Composable

/** Until Phase 10 the iOS build claims no clipboard (ADR 0004); the message stays selectable. */
@Composable
internal actual fun rememberTextCopier(): ((String) -> Unit)? = null
