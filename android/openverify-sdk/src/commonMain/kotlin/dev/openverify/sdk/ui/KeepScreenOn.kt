package dev.openverify.sdk.ui

import androidx.compose.runtime.Composable

/**
 * C201.5 (review H20): keeps the device's screen on while this is composed and releases it when it
 * leaves composition, so a screen timeout cannot lock the phone while the person waits for the server
 * or holds still for a capture. Android sets `keepScreenOn` on the composition's view; iOS keeps
 * nothing (rule 19: it claims nothing until the next release).
 */
@Composable
internal expect fun KeepScreenOn()
