package dev.openverify.sdk.ui.theme

import androidx.compose.runtime.Composable

/**
 * C198.7: the status and navigation bar icons follow the palette's luminance: dark icons over a
 * light background (the surface the SDK draws behind the bars, edge to edge), light icons over a
 * dark one. Android sets the window's bar appearance; iOS does nothing yet (next release).
 */
@Composable
internal expect fun SystemBarIcons(lightBackground: Boolean)
