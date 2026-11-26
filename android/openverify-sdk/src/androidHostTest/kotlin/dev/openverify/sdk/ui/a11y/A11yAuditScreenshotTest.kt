package dev.openverify.sdk.ui.a11y

import androidx.compose.ui.test.isRoot
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onLast
import dev.openverify.sdk.testing.GoldenOwner
import dev.openverify.sdk.testing.ScreenshotTests
import dev.openverify.sdk.testing.verifyGolden
import dev.openverify.sdk.ui.theme.ThemeFixtures
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.experimental.categories.Category
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/**
 * One of the audit's goldens: the state it shows, and the look its name asks for. A name's ending says
 * the look: `-ar-dark-2x` Arabic, dark, at twice the font size; `-operator-light` and
 * `-operator-dark` an operator's palette; `-<language>` a language at 1.0 and `-<language>-2x` at 2.0;
 * no ending English, light, at 1.0 (C219.3's budget).
 */
internal class A11yGolden(val name: String, val state: A11yState, val look: A11yLook) {
    override fun toString(): String = name

    internal companion object {
        private val FOLDER = "${GoldenOwner.A11Y_AUDIT.folder}/"
        private val operator = ThemeFixtures.theme()

        private fun lookOf(name: String): A11yLook = when {
            name.endsWith("-ar-dark-2x") -> A11yLook("ar", 2f, dark = true)
            name.endsWith("-operator-light") -> A11yLook(theme = operator)
            name.endsWith("-operator-dark") -> A11yLook(dark = true, theme = operator)
            else -> {
                val large = name.endsWith("-2x")
                val language = name.removeSuffix("-2x").substringAfterLast('-').takeIf { it in setOf("en", "es", "fr", "de", "ar") && (large || it != "en") }
                A11yLook(language ?: "en", if (large) 2f else 1f)
            }
        }

        /** The audit's own goldens, as the inventory names them. */
        internal val ALL: List<A11yGolden> = A11yCatalog.STATES.flatMap { state ->
            state.goldens.filter { it.startsWith(FOLDER) }.map { it.removePrefix(FOLDER) }.map { A11yGolden(it, state, lookOf(it)) }
        }
    }
}

/**
 * C212.2, C219.3 (Workflow 10D, android-a11y-audit): a golden for every screen state that had none
 * after 10C (consent, the camera permission, the capture screen and its review, the one-time codes,
 * the entered values, the supporting document, the wallet, waiting, completion, the closed and
 * error screens, the open menus), from synthetic content only (a grey box for a photo, no face),
 * each drawn as the activity draws it and each through `verifyGolden`, which runs Google's
 * Accessibility Test Framework over it. Recorded only by an explicit record call.
 *
 * Each test draws its goldens one after another in one composition and reports every golden that
 * differs or fails a check, not only the first (a parameterized Robolectric class is not found by
 * the screenshot task's category).
 */
internal abstract class A11yGoldens {

    @get:Rule
    val rule = createComposeRule()

    protected fun verify(goldens: List<A11yGolden>) {
        assertTrue("the inventory names no golden for this window", goldens.isNotEmpty())
        val stage = A11yStageDriver(rule)
        val failures = goldens.mapNotNull { golden ->
            stage.show(golden.state, golden.look)
            try {
                // A state with a menu open has two windows: the golden is the menu's.
                rule.onAllNodes(isRoot()).onLast().verifyGolden(GoldenOwner.A11Y_AUDIT, golden.name)
                null
            } catch (failure: Throwable) {
                "${golden.name}: ${failure.message}"
            }
        }
        assertEquals("${failures.size} of ${goldens.size} goldens", "", failures.joinToString("\n\n"))
    }
}

/** At font scale 1.0, on a 360 x 800 dp phone. */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Category(ScreenshotTests::class)
@Config(qualifiers = "w360dp-h800dp-mdpi")
internal class A11yAuditScreenshotTest : A11yGoldens() {
    @Test
    fun `every state at font scale 1 matches its golden and passes the accessibility checks`() = verify(A11yGolden.ALL.filter { it.look.fontScale == 1f })
}

/** At font scale 2.0, on a window tall enough to show the whole screen (C219.3). */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Category(ScreenshotTests::class)
@Config(qualifiers = "w360dp-h1800dp-mdpi")
internal class A11yAuditLargeFontScreenshotTest : A11yGoldens() {
    @Test
    fun `every state at font scale 2 matches its golden and passes the accessibility checks`() = verify(A11yGolden.ALL.filter { it.look.fontScale != 1f })
}
