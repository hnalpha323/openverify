package dev.openverify.sdk.ui.a11y

import androidx.compose.ui.test.junit4.v2.createComposeRule
import dev.openverify.sdk.flow.FlowState
import dev.openverify.sdk.ui.TestTags
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/**
 * C212.3, C202.4, C204.3 (Workflow 10D, android-a11y-audit): the manual shutter. In every state of
 * a capture screen that shows the preview (whatever hint, warning or problem it also shows) the
 * shutter is there and can be pressed: wholly inside a 360 x 800 dp window at font scale 1.0 in the
 * five languages, and at twice the font size on the screen's scrolling page, where it may need a
 * scroll (the preview keeps the height its guidance needs).
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(qualifiers = "w360dp-h800dp-mdpi")
internal class A11yShutterTest {

    @get:Rule
    val rule = createComposeRule()

    private val stage by lazy { A11yStageDriver(rule) }

    private val previews = A11yCatalog.STATES.filter { state -> (state.flowState as? FlowState.Capture)?.image == null && state.flowState is FlowState.Capture }

    private fun shutterProblems(look: A11yLook, onScreen: Boolean): List<String> = previews.flatMap { state ->
        stage.show(state, look)
        val nodes = stage.nodes(merged = true)
        val shutter = nodes.firstOrNull { it.tag == TestTags.CAPTURE_SHUTTER } ?: return@flatMap listOf("${state.name} ($look): no shutter")
        val window = shutter.lineage.last().frame
        listOfNotNull(
            "${state.name} ($look): the shutter cannot be pressed".takeIf { !shutter.enabled },
            "${state.name} ($look): the shutter says nothing".takeIf { shutter.spoken.isBlank() },
            "${state.name} ($look): the shutter is not on the screen's scrolling page".takeIf { !shutter.scrolls },
            "${state.name} ($look): the shutter at ${shutter.frame.describe()} is not wholly inside the window"
                .takeIf { onScreen && (shutter.frame.top < window.top || shutter.frame.bottom > window.bottom) },
        )
    }

    @Test
    fun `at font scale 1 the shutter is wholly on screen in every preview state, in the five languages`() {
        assertTrue("the inventory holds few preview states: ${previews.size}", previews.size >= 30)
        assertEquals("", listOf("en", "es", "fr", "de", "ar").flatMap { shutterProblems(A11yLook(language = it), onScreen = true) }.joinToString("\n"))
    }

    @Test
    fun `at twice the font size the shutter is still on the screen's page and can be pressed`() {
        assertEquals("", A11Y_LANGUAGES.flatMap { shutterProblems(A11yLook(language = it, fontScale = 2f), onScreen = false) }.joinToString("\n"))
    }
}
