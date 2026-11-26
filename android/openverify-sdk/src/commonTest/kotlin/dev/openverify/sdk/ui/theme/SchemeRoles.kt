package dev.openverify.sdk.ui.theme

import androidx.compose.material3.ColorScheme
import androidx.compose.ui.graphics.Color

/**
 * Every role of Material 3's [ColorScheme] by its property name (48 in material3 1.4.0 /
 * Compose Multiplatform material3 1.9.0). `ColorSchemeRolesTest` (androidHostTest) proves by
 * reflection that this list is the whole class, so a role a later Material adds fails the build.
 */
internal fun schemeRoles(scheme: ColorScheme): Map<String, Color> = with(scheme) {
    mapOf(
    "primary" to primary,
    "onPrimary" to onPrimary,
    "primaryContainer" to primaryContainer,
    "onPrimaryContainer" to onPrimaryContainer,
    "inversePrimary" to inversePrimary,
    "secondary" to secondary,
    "onSecondary" to onSecondary,
    "secondaryContainer" to secondaryContainer,
    "onSecondaryContainer" to onSecondaryContainer,
    "tertiary" to tertiary,
    "onTertiary" to onTertiary,
    "tertiaryContainer" to tertiaryContainer,
    "onTertiaryContainer" to onTertiaryContainer,
    "background" to background,
    "onBackground" to onBackground,
    "surface" to surface,
    "onSurface" to onSurface,
    "surfaceVariant" to surfaceVariant,
    "onSurfaceVariant" to onSurfaceVariant,
    "surfaceTint" to surfaceTint,
    "inverseSurface" to inverseSurface,
    "inverseOnSurface" to inverseOnSurface,
    "error" to error,
    "onError" to onError,
    "errorContainer" to errorContainer,
    "onErrorContainer" to onErrorContainer,
    "outline" to outline,
    "outlineVariant" to outlineVariant,
    "scrim" to scrim,
    "surfaceBright" to surfaceBright,
    "surfaceDim" to surfaceDim,
    "surfaceContainer" to surfaceContainer,
    "surfaceContainerHigh" to surfaceContainerHigh,
    "surfaceContainerHighest" to surfaceContainerHighest,
    "surfaceContainerLow" to surfaceContainerLow,
    "surfaceContainerLowest" to surfaceContainerLowest,
    "primaryFixed" to primaryFixed,
    "primaryFixedDim" to primaryFixedDim,
    "onPrimaryFixed" to onPrimaryFixed,
    "onPrimaryFixedVariant" to onPrimaryFixedVariant,
    "secondaryFixed" to secondaryFixed,
    "secondaryFixedDim" to secondaryFixedDim,
    "onSecondaryFixed" to onSecondaryFixed,
    "onSecondaryFixedVariant" to onSecondaryFixedVariant,
    "tertiaryFixed" to tertiaryFixed,
    "tertiaryFixedDim" to tertiaryFixedDim,
    "onTertiaryFixed" to onTertiaryFixed,
    "onTertiaryFixedVariant" to onTertiaryFixedVariant,
    )
}
