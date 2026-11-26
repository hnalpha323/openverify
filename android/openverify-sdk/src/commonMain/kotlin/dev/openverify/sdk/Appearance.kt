package dev.openverify.sdk

/**
 * The light or dark look of the flow's screens (C190.2, C198.5).
 *
 * ```
 * OpenVerifyInquiry.Request(inquiryId, sessionToken, apiBaseUrl, appearance = Appearance.DARK)
 * ```
 */
public enum class Appearance {
    /** Follows the device's dark-theme setting, as the session's theme mode allows. */
    SYSTEM,

    /** Always light. */
    LIGHT,

    /** Always dark; the built-in dark palette is used when the session's theme has none. */
    DARK,
}
