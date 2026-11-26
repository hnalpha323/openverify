package dev.openverify.sdk.ui.a11y

import androidx.compose.ui.semantics.SemanticsNode
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.semantics.getOrNull
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.unit.dp
import dev.openverify.sdk.capture.document.DocumentGuidanceTags
import dev.openverify.sdk.i18n.SDK_PSEUDO_LANGUAGE
import dev.openverify.sdk.ui.screen.ScreenTags
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/**
 * C212.2 (Workflow 10D, android-a11y-audit): the host checks that run over every state of the
 * inventory ([A11yCatalog.STATES]), each drawn as the activity draws it, on a 360 x 800 dp phone.
 * Each test lists every state that breaks its rule, so one run shows them all. They read the
 * semantics tree a screen reader is given; they do not hear what TalkBack says (C212.6).
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(qualifiers = "w360dp-h800dp-mdpi")
internal class A11ySweepTest {

    @get:Rule
    val rule = createComposeRule()

    private val stage by lazy { A11yStageDriver(rule) }

    /** [check]'s findings over every state in [look], each prefixed with its state. */
    private fun sweep(look: A11yLook = A11yLook(), states: List<A11yState> = A11yCatalog.STATES, check: (A11yState) -> List<String>): List<String> =
        states.flatMap { state ->
            stage.show(state, look)
            check(state).map { "${state.name} ($look): $it" }
        }

    private fun assertNone(problems: List<String>) = assertEquals("${problems.size} problem(s)", "", problems.joinToString("\n"))

    /** The window the step is drawn in: with a menu open there are two, and the step's is the larger. */
    private fun mainWindow(nodes: List<SemanticsNode>): List<SemanticsNode> {
        val main = nodes.map { it.lineage.last() }.distinctBy { it.id }.maxByOrNull { it.size.width.toLong() * it.size.height }
        return nodes.filter { it.lineage.last().id == main?.id }
    }

    // A name on every control (WCAG 4.1.2, 1.1.1) -------------------------------------------------

    @Test
    fun `every control says what it is, in every state`() {
        assertNone(
            sweep { _ ->
                stage.nodes(merged = true).filter { it.actionable && it.spoken.isBlank() }.map { "a control with no text and no content description at ${it.frame.describe()}" }
            },
        )
    }

    // Touch targets (WCAG 2.5.8; Android's 48 dp) -------------------------------------------------

    /**
     * On a window tall enough to show every screen whole, so each control's touch area is the one
     * Compose gives it (a 40 dp button is given a 48 dp area by its minimum interactive size). An
     * option of a long menu that is scrolled out of view has no touch area yet and is not measured.
     */
    @Test
    @Config(qualifiers = "w360dp-h4000dp-mdpi")
    fun `every control's touch target is at least 48 dp wide and high, in every state`() {
        val minimum = with(stage.density) { 48.dp.toPx() }
        var measured = 0
        val problems = sweep { _ ->
            val shown = stage.nodes(merged = true).filter { it.actionable && !it.boundsInRoot.isEmpty }
            measured += shown.size
            shown
                .filter { it.touchBoundsInRoot.width < minimum - 0.5f || it.touchBoundsInRoot.height < minimum - 0.5f }
                .map { "${it.label()} has a touch target of ${it.touchBoundsInRoot.width.toInt()} x ${it.touchBoundsInRoot.height.toInt()} px, under ${minimum.toInt()}" }
        }
        assertTrue("no control was measured", measured > 500)
        assertNone(problems)
    }

    // Reading order (WCAG 1.3.2, 2.4.6) -----------------------------------------------------------

    private fun headingFirst(look: A11yLook) = sweep(look) { _ ->
        val content = mainWindow(stage.nodes(merged = true)).filter { !it.inChrome && it.readable }.inReadingOrder(rightToLeft = look.language == "ar")
        val first = content.firstOrNull()
        when {
            first == null -> listOf("nothing to read")
            !first.heading -> listOf("the first thing read is not a heading: ${first.label()}")
            else -> emptyList()
        }
    }

    @Test
    fun `the first thing read on every screen is its heading`() = assertNone(headingFirst(A11yLook()))

    @Test
    fun `the first thing read on every screen is its heading, right to left`() = assertNone(headingFirst(A11yLook(language = "ar")))

    @Test
    fun `an error summary comes after the heading and before every field`() {
        val withSummary = A11yCatalog.STATES.filter { ScreenTags.SUMMARY in it.announced }
        assertTrue("no state shows an error summary", withSummary.isNotEmpty())
        assertNone(
            sweep(states = withSummary) { _ ->
                val nodes = stage.nodes(merged = true).filter { !it.inChrome }
                val summary = nodes.firstOrNull { it.tag == ScreenTags.SUMMARY } ?: return@sweep listOf("no summary is shown")
                val heading = nodes.filter { it.heading }.inReadingOrder().first()
                val fields = nodes.filter { SemanticsProperties.EditableText in it.config || SemanticsProperties.ToggleableState in it.config }
                buildList {
                    if (fields.isEmpty()) add("no field is shown")
                    if (heading.frame.top > summary.frame.top) add("the summary is read before the heading")
                    fields.filter { it.frame.top < summary.frame.bottom }.forEach { add("the field ${it.label()} is read before the summary") }
                }
            },
        )
    }

    // Status and error nodes (WCAG 4.1.3, 1.4.1) --------------------------------------------------

    @Test
    fun `every status and error node is a live region that carries words`() {
        assertNone(
            sweep { state ->
                val nodes = stage.nodes(merged = true)
                val named = state.announced.flatMap { tag ->
                    val found = nodes.filter { it.tag == tag }
                    when {
                        found.isEmpty() -> listOf("no node is tagged $tag")
                        // The tag may sit on the region itself or on the box around it.
                        else -> found.flatMap { node ->
                            listOfNotNull(
                                "the status $tag is not a live region".takeIf { node.subtree.none { it.live } },
                                "the status $tag carries no words".takeIf { node.spokenWithin.isBlank() },
                            )
                        }
                    }
                }
                // The narrow colour-alone rule: whatever is announced, and whatever a field reports as
                // its error, is said in words. The document hint keeps its (empty) region in place
                // between hints, so the next hint is announced from a region that already exists.
                val wordless = nodes
                    .filter { it.live && it.spokenWithin.isBlank() && it.tag != DocumentGuidanceTags.HINT }
                    .map { "a live region with no words at ${it.frame.describe()}" }
                val fieldErrors = nodes
                    .filter { SemanticsProperties.Error in it.config && it.config.getOrNull(SemanticsProperties.Error).isNullOrBlank() }
                    .map { "the field ${it.label()} is marked as an error with no words" }
                named + wordless + fieldErrors
            },
        )
    }

    // Clipped text at twice the font size (WCAG 1.4.4, 1.4.10; review H19) ------------------------

    private fun nothingCutOff(language: String) = sweep(A11yLook(language = language, fontScale = 2f)) { _ ->
        val unmerged = stage.nodes(merged = false)
        val cut = unmerged.filter { it.clipped == true }.map { "the text \"${it.spoken.take(40)}\" is cut off at ${it.frame.describe()}" }
        val unrecorded = unmerged
            .filter { SemanticsProperties.Text in it.config && SemanticsProperties.EditableText !in it.config && it.clipped == null }
            .map { "the text \"${it.spoken.take(40)}\" is not drawn by the SDK's text composable" }
        val window = mainWindow(unmerged).first().lineage.last().frame
        val lost = lostControls(mainWindow(stage.nodes(merged = true)), window)
            .map { "the control ${it.label()} is off the screen where no scrolling reaches it, at ${it.frame.describe()}" }
        cut + unrecorded + lost
    }

    @Test fun `no text is cut off at twice the font size in English`() = assertNone(nothingCutOff("en"))

    @Test fun `no text is cut off at twice the font size in Spanish`() = assertNone(nothingCutOff("es"))

    @Test fun `no text is cut off at twice the font size in French`() = assertNone(nothingCutOff("fr"))

    @Test fun `no text is cut off at twice the font size in German`() = assertNone(nothingCutOff("de"))

    @Test fun `no text is cut off at twice the font size in Arabic`() = assertNone(nothingCutOff("ar"))

    @Test fun `no text is cut off at twice the font size in the pseudo-locale`() = assertNone(nothingCutOff(SDK_PSEUDO_LANGUAGE))
}
