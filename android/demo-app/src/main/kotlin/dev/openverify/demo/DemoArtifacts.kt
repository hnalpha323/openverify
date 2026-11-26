package dev.openverify.demo

import androidx.annotation.StringRes

/**
 * Which optional artifacts this build includes (C218.1), from the Gradle property
 * `openverifyDemoArtifacts` through `BuildConfig.OPENVERIFY_DEMO_ARTIFACTS`: `sdk`, `sdk-nfc`,
 * `sdk-face` or `sdk-nfc-face`.
 */
object DemoArtifacts {
    /** The artifacts a configuration name such as `sdk-nfc` lists. */
    fun parse(configuration: String): Set<String> = configuration.split('-').filter(String::isNotEmpty).toSet()

    /** The line the screen shows for a build with [included]. */
    @StringRes
    fun description(included: Set<String>): Int = when {
        "nfc" in included && "face" in included -> R.string.artifacts_sdk_nfc_face
        "nfc" in included -> R.string.artifacts_sdk_nfc
        "face" in included -> R.string.artifacts_sdk_face
        else -> R.string.artifacts_sdk
    }

    /** What this build includes. */
    val included: Set<String> = parse(BuildConfig.OPENVERIFY_DEMO_ARTIFACTS)
}
