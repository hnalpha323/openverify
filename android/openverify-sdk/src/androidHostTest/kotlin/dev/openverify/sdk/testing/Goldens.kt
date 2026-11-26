package dev.openverify.sdk.testing

import androidx.compose.ui.test.SemanticsNodeInteraction
import com.github.takahirom.roborazzi.RoborazziATFAccessibilityCheckOptions
import com.github.takahirom.roborazzi.RoborazziATFAccessibilityChecker
import com.github.takahirom.roborazzi.captureRoboImage
import com.github.takahirom.roborazzi.checkRoboAccessibility
import com.google.android.apps.common.testing.accessibility.framework.AccessibilityCheckPreset

/**
 * Each owner's golden folder, under `src/androidHostTest/screenshots/` (C219.3; Workflow 10A Stage 1b).
 * An owner records into its own folder only, from synthetic content only (rule 3: no faces).
 */
internal enum class GoldenOwner(internal val folder: String) {
    FOUNDATION("foundation-10a"),
    DRIVER("android-driver"),
    SDK_API("android-sdk-api"),
    SCREENS("android-screens"),
    THEME("android-theme"),

    // Workflow 10B's golden owners (foundation-10b, the 10B decisions' item 10).
    CAPTURE_PIPELINE("capture-pipeline"),
    DOCUMENT_GUIDANCE("document-guidance"),
    PDF417_GUIDANCE("pdf417-guidance"),
    SELFIE_GUIDANCE("selfie-guidance"),

    // Workflow 10C's golden owner (contracts-10c): the NFC step's screens.
    NFC_SDK("nfc-sdk"),

    // Workflow 10D's golden owner (android-a11y-audit): every screen state that had no golden (C212.2).
    A11Y_AUDIT("android-a11y-audit"),

    // Workflow 11A's golden owner (clients-connect, orchestrator decision 19): the share-consent screen
    // and the withdrawal affordance (C256.1).
    CLIENTS_CONNECT("clients-connect"),
}

/**
 * The golden of this node as `<owner>/<name>.png`, and Google's Accessibility Test Framework over
 * the same node (C212.2, C219.3: the accessibility checks run on every golden). Call it from a
 * Robolectric test class that carries `@GraphicsMode(GraphicsMode.Mode.NATIVE)` and
 * `@Category(ScreenshotTests::class)`, so it runs in `screenshotTest`, which compares the image with
 * the committed golden unless `-Proborazzi.test.record=true` records it.
 *
 * The checks are [checkAccessibility]'s.
 */
internal fun SemanticsNodeInteraction.verifyGolden(owner: GoldenOwner, name: String) {
    require(GOLDEN_NAME.matches(name)) { "a golden name is kebab-case: $name" }
    captureRoboImage("src/androidHostTest/screenshots/${owner.folder}/$name.png")
    checkAccessibility()
}

/**
 * Google's Accessibility Test Framework over this node, with its latest preset, failing on what it
 * reports as an error (a missing label, a touch target under its minimum, and the rest of its error
 * results). Its warnings are printed, not failed: they include heuristics that need a person's
 * judgement (C212.4). This automated pass claims no conformance (C212.6).
 */
internal fun SemanticsNodeInteraction.checkAccessibility() {
    checkRoboAccessibility(
        RoborazziATFAccessibilityCheckOptions(
            RoborazziATFAccessibilityChecker(AccessibilityCheckPreset.LATEST),
            RoborazziATFAccessibilityChecker.CheckLevel.Error,
        ),
    )
}

private val GOLDEN_NAME = Regex("[a-z0-9]+(-[a-z0-9]+)*")
