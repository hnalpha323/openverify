package dev.openverify.sdk.ui.a11y

import android.Manifest
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.semantics.SemanticsNode
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.semantics.getOrNull
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.junit4.ComposeContentTestRule
import androidx.compose.ui.unit.Density
import androidx.test.core.app.ApplicationProvider
import dev.openverify.sdk.Appearance
import dev.openverify.sdk.i18n.LocalSdkLanguage
import dev.openverify.sdk.i18n.SDK_PSEUDO_LANGUAGE
import dev.openverify.sdk.model.FlowLinks
import dev.openverify.sdk.model.FlowLocales
import dev.openverify.sdk.model.FlowTheme
import dev.openverify.sdk.ui.OpenVerifyTheme
import dev.openverify.sdk.ui.ReviewPhotoDecoded
import dev.openverify.sdk.ui.TestTags
import dev.openverify.sdk.ui.help.ChromeTags
import dev.openverify.sdk.ui.screen.LocalScreenEnvironment
import dev.openverify.sdk.ui.screen.RecordingUriHandler
import dev.openverify.sdk.ui.screen.ScreenGoldens
import dev.openverify.sdk.ui.text.TextClipped
import dev.openverify.sdk.ui.theme.LanguageSelection
import dev.openverify.sdk.ui.theme.SessionLook
import org.robolectric.Shadows.shadowOf

/** How a state is drawn: the language (one of the five, or the pseudo-locale), the font scale and the palette. */
internal data class A11yLook(
    val language: String = "en",
    val fontScale: Float = 1f,
    val dark: Boolean = false,
    val theme: FlowTheme? = null,
) {
    /** The bundled language the theme lays out in: the pseudo-locale is English made longer. */
    val base: String get() = if (language == SDK_PSEUDO_LANGUAGE) "en" else language

    override fun toString(): String = "$language at $fontScale${if (dark) ", dark" else ""}"
}

/** The five languages the SDK bundles and the pseudo-locale (C212.2). */
internal val A11Y_LANGUAGES: List<String> = listOf("en", "es", "fr", "de", "ar", SDK_PSEUDO_LANGUAGE)

/** The session's look of every stage: the five languages offered and both links, so the whole chrome shows. */
private fun sessionLook(theme: FlowTheme?) = SessionLook(
    theme = theme,
    locales = FlowLocales(listOf("en", "es", "fr", "de", "ar"), "en"),
    links = FlowLinks("https://help.example.com/flow", "https://example.com/privacy"),
)

/**
 * [state] as the activity draws it: inside `OpenVerifyTheme` with the session's look, in [look]'s
 * language, direction, font scale and palette, with the screens' environment in that language.
 */
@Composable
internal fun A11yStage(state: A11yState, look: A11yLook, fixture: A11yFixture) {
    OpenVerifyTheme(
        look = sessionLook(look.theme),
        appearance = if (look.dark) Appearance.DARK else Appearance.LIGHT,
        requestedLocale = look.base,
        language = remember { LanguageSelection() },
        systemDark = look.dark,
    ) {
        val density = LocalDensity.current
        CompositionLocalProvider(
            LocalSdkLanguage provides look.language,
            LocalDensity provides Density(density.density, look.fontScale),
            LocalScreenEnvironment provides ScreenGoldens.environment(look.base, state.contestRoute),
            LocalUriHandler provides RecordingUriHandler(),
        ) {
            Surface { Box(Modifier.fillMaxSize()) { state.content(fixture) } }
        }
    }
}

/**
 * One composition that shows the catalog's states one after another: [show] replaces what is drawn,
 * lets it settle on the test clock (which the tests move themselves: a selfie's time warning reads
 * its clock every second for ever) and runs the state's [A11yState.act].
 */
internal class A11yStageDriver(private val rule: ComposeContentTestRule) {
    private var shown by mutableStateOf<Triple<A11yState, A11yLook, A11yFixture>?>(null)
    private var generation by mutableStateOf(0)
    private var started = false
    private var manual = false

    var fixture: A11yFixture = A11yFixture()
        private set

    fun show(state: A11yState, look: A11yLook = A11yLook()): A11yFixture {
        grantCamera()
        fixture = A11yFixture()
        state.arrange(fixture)
        // With the clock advancing by itself, Compose's tests pause endless animations and reach idle
        // whatever a background read changes later. Only a state that reads a clock for ever (the
        // selfie's time warning) is moved by hand.
        manual = state.manualClock
        rule.mainClock.autoAdvance = !manual
        if (!started) {
            started = true
            rule.setContent {
                val current = shown
                if (current != null) key(generation) { A11yStage(current.first, current.second, current.third) }
            }
        }
        shown = Triple(state, look, fixture)
        generation++
        settle()
        awaitReviewPhoto()
        state.act?.let { act ->
            act(rule)
            settle()
            awaitReviewPhoto()
        }
        return fixture
    }

    /**
     * A photo under review is decoded off the main thread, which Compose's idle does not wait for:
     * on a loaded machine a golden was compared before the photo was drawn (Workflow 10E, the
     * clean-build pass). So a screen that shows one is settled only once the screen says the photo
     * is decoded ([ReviewPhotoDecoded]); a photo that never is fails here, by name.
     */
    private fun awaitReviewPhoto() {
        val shows = SemanticsMatcher.keyIsDefined(ReviewPhotoDecoded)
        if (rule.onAllNodes(shows, useUnmergedTree = true).fetchSemanticsNodes().isEmpty()) return
        val decoded = SemanticsMatcher.expectValue(ReviewPhotoDecoded, true)
        try {
            rule.waitUntil(REVIEW_PHOTO_WAIT_MS) { rule.onAllNodes(decoded, useUnmergedTree = true).fetchSemanticsNodes().isNotEmpty() }
        } catch (_: androidx.compose.ui.test.ComposeTimeoutException) {
            throw AssertionError("the photo under review was not decoded and drawn within $REVIEW_PHOTO_WAIT_MS ms")
        }
        settle()
    }

    /** Lets what is drawn settle: a few frames of the test clock, then the main thread's work. */
    fun settle() {
        if (!manual) {
            rule.waitForIdle()
            return
        }
        repeat(3) {
            rule.mainClock.advanceTimeBy(100)
            rule.waitForIdle()
        }
    }

    /** Moves the test clock by [milliseconds] (a state drawn with its clock moved by hand), then lets the screen settle. */
    fun advance(milliseconds: Long) {
        rule.mainClock.advanceTimeBy(milliseconds)
        rule.waitForIdle()
    }

    /** What each live region holds now, by node: what a screen reader is told when it changes. */
    fun live(): Map<Int, String> = nodes(merged = true).filter { it.live }.associate { it.id to it.spokenWithin }

    /** Every semantics node of every window (a menu is a window of its own), merged or not. */
    fun nodes(merged: Boolean): List<SemanticsNode> = rule.onAllNodes(ANY, useUnmergedTree = !merged).fetchSemanticsNodes()

    val density: Density get() = rule.density

    private companion object {
        val ANY = SemanticsMatcher("any node") { true }

        /** How long a review photo's decoding may take before the state fails: a bound on waiting for a condition, never a pause. */
        const val REVIEW_PHOTO_WAIT_MS = 20_000L

        fun grantCamera() {
            shadowOf(ApplicationProvider.getApplicationContext<android.app.Application>()).grantPermissions(Manifest.permission.CAMERA)
        }
    }
}

// Reading the semantics -----------------------------------------------------------------------------

internal val SemanticsNode.tag: String? get() = config.getOrNull(SemanticsProperties.TestTag)

/** What a screen reader says for this node: its content description, else its text. */
internal val SemanticsNode.spoken: String
    get() {
        val description = config.getOrNull(SemanticsProperties.ContentDescription).orEmpty().joinToString(" ")
        if (description.isNotBlank()) return description
        val editable = config.getOrNull(SemanticsProperties.EditableText)?.text.orEmpty()
        return (config.getOrNull(SemanticsProperties.Text).orEmpty().map { it.text } + editable).joinToString(" ").trim()
    }

/** A node a person can press, toggle or type into. */
internal val SemanticsNode.actionable: Boolean
    get() = SemanticsActions.OnClick in config || SemanticsActions.SetText in config || SemanticsProperties.ToggleableState in config

internal val SemanticsNode.enabled: Boolean get() = SemanticsProperties.Disabled !in config

internal val SemanticsNode.heading: Boolean get() = SemanticsProperties.Heading in config

internal val SemanticsNode.live: Boolean get() = SemanticsProperties.LiveRegion in config

/** This node and its ancestors, nearest first. */
internal val SemanticsNode.lineage: Sequence<SemanticsNode> get() = generateSequence(this) { it.parent }

/** Whether the node is part of the chrome around a step (the brand header, the sandbox banner, the help slot). */
internal val SemanticsNode.inChrome: Boolean
    get() = lineage.any { it.tag == ChromeTags.BRAND || it.tag == ChromeTags.HELP_SLOT || it.tag == TestTags.SANDBOX_BANNER }

/** Whether something a person reads or uses is at this node: words, a description, a progress indicator or a control. */
internal val SemanticsNode.readable: Boolean
    get() = spoken.isNotBlank() || SemanticsProperties.ProgressBarRangeInfo in config || actionable

internal val SemanticsNode.scrolls: Boolean
    get() = lineage.any { SemanticsProperties.VerticalScrollAxisRange in it.config || SemanticsProperties.HorizontalScrollAxisRange in it.config }

internal val SemanticsNode.clipped: Boolean? get() = config.getOrNull(TextClipped)

private val SemanticsNode.scrollsVertically: Boolean get() = SemanticsProperties.VerticalScrollAxisRange in config

private val SemanticsNode.scrollsHorizontally: Boolean get() = SemanticsProperties.HorizontalScrollAxisRange in config

/**
 * Whether a person can bring this node into [window]: on each axis along which it lies past the
 * window, some ancestor scrolls along that axis (a row that scrolls sideways inside a page that
 * scrolls up and down reaches both ways). A node outside any scrolling area must lie inside it.
 */
private fun SemanticsNode.reachableIn(window: Rect): Boolean {
    val inX = frame.left >= window.left - 0.5f && frame.right <= window.right + 0.5f
    val inY = frame.top >= window.top - 0.5f && frame.bottom <= window.bottom + 0.5f
    val areas = parent?.lineage.orEmpty()
    return (inX || areas.any { it.scrollsHorizontally }) && (inY || areas.any { it.scrollsVertically })
}

/**
 * KP10-53 (10D review A012): the controls among [nodes] a person cannot reach in [window]: a control
 * laid out with no height, or one no scrolling can bring into the window ([reachableIn]). A
 * scrolling ancestor no longer exempts a control past the side of a page that scrolls only up and
 * down.
 */
internal fun lostControls(nodes: List<SemanticsNode>, window: Rect): List<SemanticsNode> =
    nodes.filter { it.actionable && (it.size.height == 0 || !it.reachableIn(window)) }

/**
 * The nodes in reading order, as Compose orders them for a screen reader when no node sets a
 * traversal index: by their place on screen, top to bottom, then from the line's start (the right
 * edge in a right-to-left layout).
 */
internal fun List<SemanticsNode>.inReadingOrder(rightToLeft: Boolean = false): List<SemanticsNode> =
    sortedWith(compareBy<SemanticsNode> { it.frame.top }.thenBy { if (rightToLeft) -it.frame.right else it.frame.left })

/**
 * Where the node is laid out in its window, whether or not a scrolling parent shows it now
 * (`boundsInRoot` is cut to what is visible, and is empty for a node scrolled out of view).
 */
internal val SemanticsNode.frame: Rect get() = Rect(positionInRoot, Size(size.width.toFloat(), size.height.toFloat()))

/** What a screen reader says for this node and everything under it. */
internal val SemanticsNode.spokenWithin: String
    get() = (listOf(spoken) + children.map { it.spokenWithin }).filter { it.isNotBlank() }.joinToString(" ")

/** This node and every node under it. */
internal val SemanticsNode.subtree: List<SemanticsNode> get() = listOf(this) + children.flatMap { it.subtree }

internal fun Rect.describe(): String = "[${left.toInt()},${top.toInt()} ${width.toInt()}x${height.toInt()}]"

/** A short name for a node in a failure message: its tag, else its words. */
internal fun SemanticsNode.label(): String = tag ?: spoken.take(40).ifBlank { "(no words) ${frame.describe()}" }

/**
 * Counts announcements as a screen reader's live regions make them (C212.2): one each time a live
 * region appears with words or its words change. [listen] is called after every update of the
 * screen. It counts what the semantics tree offers; it does not hear TalkBack (C212.6).
 */
internal class Announcements(private val stage: A11yStageDriver) {
    private var last: Map<Int, String> = emptyMap()
    val said = mutableListOf<String>()

    fun listen() {
        val now = stage.live()
        now.forEach { (node, words) -> if (words.isNotBlank() && last[node] != words) said += words }
        last = now
    }
}
