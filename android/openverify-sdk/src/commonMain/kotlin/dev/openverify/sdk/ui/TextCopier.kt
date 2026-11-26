package dev.openverify.sdk.ui

import androidx.compose.runtime.Composable

/**
 * Puts a text on the system clipboard (the wallet step's message, C64.1), or `null` where the
 * platform cannot yet: the screen then offers no copy button, and the text stays selectable.
 */
@Composable
internal expect fun rememberTextCopier(): ((String) -> Unit)?
