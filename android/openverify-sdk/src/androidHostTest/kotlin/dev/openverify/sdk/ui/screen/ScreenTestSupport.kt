package dev.openverify.sdk.ui.screen

import androidx.compose.ui.platform.UriHandler
import dev.openverify.sdk.i18n.ComponentText
import dev.openverify.sdk.i18n.FilledText
import dev.openverify.sdk.model.FlowContestRoute
import dev.openverify.sdk.model.FlowLinks
import dev.openverify.sdk.model.FlowValue
import dev.openverify.sdk.ui.FlowActions
import dev.openverify.sdk.ui.RecordingActions

/** A screen's actions as the tests see them: each submission, and every other call by name. */
internal class ScreenActions(private val recording: RecordingActions = RecordingActions()) : FlowActions by recording {
    val submissions = mutableListOf<Pair<Map<String, FlowValue>, String?>>()
    val calls: List<String> get() = recording.calls

    override fun submitScreen(values: Map<String, FlowValue>, button: String?) {
        submissions += values to button
    }
}

/** Opens nothing: records each address a link would open in the system browser. */
internal class RecordingUriHandler : UriHandler {
    val opened = mutableListOf<String>()

    override fun openUri(uri: String) {
        opened += uri
    }
}

/**
 * An environment whose component texts are [copy] in [language] (each key's text as written, with no
 * placeholder), synthetic words only; a key outside [copy] has no text. [fromDefault] keys come from
 * another language, as C162.5's fallback gives them.
 */
internal fun screenEnvironment(
    copy: Map<String, String>,
    language: String = "en",
    links: FlowLinks? = null,
    values: Map<String, FlowValue> = emptyMap(),
    contestRoute: FlowContestRoute? = null,
    fromDefault: Map<String, String> = emptyMap(),
    drafts: ScreenDrafts? = null,
): ScreenEnvironment = ScreenEnvironment(
    text = { key ->
        copy[key]?.let { ComponentText(FilledText(it, it), language) }
            ?: fromDefault[key]?.let { ComponentText(FilledText(it, it), "en") }
    },
    language = language,
    links = links,
    values = values,
    contestRoute = contestRoute,
    drafts = drafts,
)
