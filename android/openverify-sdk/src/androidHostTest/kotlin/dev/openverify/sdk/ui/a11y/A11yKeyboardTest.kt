package dev.openverify.sdk.ui.a11y

import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.junit4.v2.createComposeRule
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/**
 * C212.2 (Workflow 10D, android-a11y-audit): a hardware keyboard, as far as the host can tell
 * (WCAG 2.1.1, 2.4.3). Under Robolectric the window holds no input focus: a Tab sent through
 * Compose's test key input, a move of the focus manager and a focus request all leave every node
 * unfocused (tried in this Workflow, recorded in the TDD file), so the keys themselves are a line of
 * the manual pass (C212.4). What the host can hold is the precondition: on every state, every
 * control that can be used is focusable. The order focus moves in cannot be read here either: the
 * semantics tree lists nodes as they are drawn, not as focus visits them, and on the selfie screen
 * the time warning's "More time" is drawn over the top of a screen composed before it. Whether Tab
 * reaches it in time is a line of the manual pass.
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(qualifiers = "w360dp-h4000dp-mdpi")
internal class A11yKeyboardTest {

    @get:Rule
    val rule = createComposeRule()

    private val stage by lazy { A11yStageDriver(rule) }

    @Test
    fun `every usable control of every state can take focus`() {
        var controls = 0
        val problems = A11yCatalog.STATES.flatMap { state ->
            stage.show(state)
            val usable = stage.nodes(merged = true).filter { it.actionable && it.enabled }
            controls += usable.size
            usable.filter { SemanticsProperties.Focused !in it.config }.map { "${state.name}: ${it.label()} cannot take focus" }
        }

        assertTrue("no control was read", controls > 500)
        assertEquals("", problems.joinToString("\n"))
    }
}
