package dev.openverify.sdk.ui.steps

import androidx.compose.ui.test.isRoot
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onLast
import dev.openverify.sdk.testing.GoldenOwner
import dev.openverify.sdk.testing.ScreenshotTests
import dev.openverify.sdk.testing.verifyGolden
import dev.openverify.sdk.ui.a11y.A11yCatalog
import dev.openverify.sdk.ui.a11y.A11yLook
import dev.openverify.sdk.ui.a11y.A11yStageDriver
import dev.openverify.sdk.ui.a11y.A11yState
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
 * C256.1, C219.3 (Phase 11, Workflow 11A; `clients-connect`): the share-consent screen's and the
 * withdrawal affordance's goldens, each state of the inventory (`A11yCatalog`) that names one in
 * `clients-connect/`, drawn as the activity draws it (`A11yStageDriver`) from synthetic content
 * only (no face, no person), and each through `verifyGolden`, which runs Google's Accessibility Test
 * Framework over it. A name's ending says its look: none is English, light, at 1.0;
 * `-ar-dark-2x` Arabic, dark, at 2.0; `-operator-light` and `-operator-dark` an operator's palette.
 * Recorded only by an explicit record call.
 */
internal abstract class ShareConsentGoldens {

    @get:Rule
    val rule = createComposeRule()

    /** Each golden of the inventory in `clients-connect/`, with its state and its look. */
    protected fun goldens(): List<Triple<String, A11yState, A11yLook>> = A11yCatalog.STATES.flatMap { state ->
        state.goldens.filter { it.startsWith(FOLDER) }.map { it.removePrefix(FOLDER) }.map { name -> Triple(name, state, lookOf(name)) }
    }

    protected fun verify(goldens: List<Triple<String, A11yState, A11yLook>>) {
        assertTrue("the inventory names no golden for this window", goldens.isNotEmpty())
        val stage = A11yStageDriver(rule)
        val failures = goldens.mapNotNull { (name, state, look) ->
            stage.show(state, look)
            try {
                rule.onAllNodes(isRoot()).onLast().verifyGolden(GoldenOwner.CLIENTS_CONNECT, name)
                null
            } catch (failure: Throwable) {
                "$name: ${failure.message}"
            }
        }
        assertEquals("${failures.size} of ${goldens.size} goldens", "", failures.joinToString("\n\n"))
    }

    private companion object {
        val FOLDER = "${GoldenOwner.CLIENTS_CONNECT.folder}/"

        fun lookOf(name: String): A11yLook = when {
            name.endsWith("-ar-dark-2x") -> A11yLook("ar", 2f, dark = true)
            name.endsWith("-operator-light") -> A11yLook(theme = ThemeFixtures.theme())
            name.endsWith("-operator-dark") -> A11yLook(dark = true, theme = ThemeFixtures.theme())
            else -> A11yLook()
        }
    }
}

/** At font scale 1.0, on a 360 x 800 dp phone. */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Category(ScreenshotTests::class)
@Config(qualifiers = "w360dp-h800dp-mdpi")
internal class ShareConsentScreenshotTest : ShareConsentGoldens() {
    @Test
    fun `every share-consent state at font scale 1 matches its golden and passes the accessibility checks`() =
        verify(goldens().filter { it.third.fontScale == 1f })
}

/** In Arabic, dark, at font scale 2.0, on a window tall enough to show the whole screen (C219.3). */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Category(ScreenshotTests::class)
@Config(qualifiers = "w360dp-h1800dp-mdpi")
internal class ShareConsentLargeFontScreenshotTest : ShareConsentGoldens() {
    @Test
    fun `every share-consent state at font scale 2 matches its golden and passes the accessibility checks`() =
        verify(goldens().filter { it.third.fontScale != 1f })
}
