package dev.openverify.sdk.ui.help

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.unit.dp
import dev.openverify.sdk.generated.resources.Res
import dev.openverify.sdk.generated.resources.openverify_help_link
import dev.openverify.sdk.generated.resources.openverify_privacy_link
import dev.openverify.sdk.i18n.COPY_KEY_RULES
import dev.openverify.sdk.i18n.SDK_DEFAULT_LANGUAGE
import dev.openverify.sdk.i18n.availableLanguages
import dev.openverify.sdk.i18n.fillCopyPlaceholders
import dev.openverify.sdk.i18n.sdkString
import dev.openverify.sdk.log.SdkLog
import dev.openverify.sdk.ui.text.Text
import dev.openverify.sdk.ui.theme.LocalLanguageChoice
import dev.openverify.sdk.ui.theme.LocalLanguageSelection
import dev.openverify.sdk.ui.theme.LocalSessionLook
import dev.openverify.sdk.ui.theme.SessionLook
import org.jetbrains.compose.resources.StringResource

/** Test tags of the SDK's chrome (C197.4, C198.3, C199.3). */
internal object ChromeTags {
    const val BRAND: String = "openverify-brand"
    const val BRAND_LOGO: String = "openverify-brand-logo"
    const val HELP_SLOT: String = "openverify-help-slot"
    const val HELP_LINK: String = "openverify-help-link"
    const val PRIVACY_LINK: String = "openverify-privacy-link"
    const val LANGUAGE_SELECTOR: String = "openverify-language-selector"

    /** One language's item in the selector's menu. */
    fun languageItem(language: String): String = "openverify-language-$language"
}

/**
 * Whether [url] may be opened from the help slot (C162.3, C195.3): an absolute `https:` URL with a
 * host and no whitespace or control character. The server refuses anything else on save, so meeting
 * one is a server defect; the slot then leaves the link out.
 */
internal fun isAllowedLink(url: String): Boolean {
    if (!url.startsWith("https://", ignoreCase = true)) return false
    val rest = url.substring("https://".length)
    if (rest.isEmpty() || rest[0] == '/' || rest[0] == '?' || rest[0] == '#') return false
    return url.none { it.isWhitespace() || it.code < 0x20 || it.code == 0x7f }
}

/** A link of the slot: its tag, its copy key (`COPY_KEYS`, which the operator may word) and its built-in words. */
private class SlotLink(val tag: String, val copyKey: String, val builtIn: StringResource, val url: String)

/**
 * The fixed help slot after every step's content (C197.4, C162.3; WCAG 3.2.6): the version's help
 * and privacy links, `https:` only, each opened in the system browser, then the language selector
 * (C199.3). It is the same place on every screen. The links read the operator's words for
 * `screen.helpLink` and `screen.privacyLink` in the chosen language when the session's copy holds
 * them (C162.5: else the SDK's own words, the web flow's), with `{organization}` filled and isolated
 * for display (C199.5). Outside `OpenVerifyTheme` (no selector state) and with nothing to show, it
 * takes no space.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
internal fun HelpSlot(modifier: Modifier = Modifier) {
    val selection = LocalLanguageSelection.current ?: return
    val look = LocalSessionLook.current
    val language = LocalLanguageChoice.current?.language ?: SDK_DEFAULT_LANGUAGE
    val offered = look.links?.let { links ->
        listOfNotNull(
            links.helpUrl?.let { SlotLink(ChromeTags.HELP_LINK, "screen.helpLink", Res.string.openverify_help_link, it) },
            links.privacyUrl?.let { SlotLink(ChromeTags.PRIVACY_LINK, "screen.privacyLink", Res.string.openverify_privacy_link, it) },
        )
    }.orEmpty()
    val shown = offered.filter { isAllowedLink(it.url) }
    if (shown.size != offered.size) {
        LaunchedEffect(look.links) { SdkLog.log("help.link_refused") }
    }
    val languages = availableLanguages(look.locales)
    val selector = languages.size > 1
    if (shown.isEmpty() && !selector) return
    Column(modifier.fillMaxWidth().testTag(ChromeTags.HELP_SLOT)) {
        HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
        FlowRow(
            modifier = Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 4.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.End),
            verticalArrangement = Arrangement.Center,
        ) {
            val uriHandler = LocalUriHandler.current
            for (link in shown) {
                TextButton(
                    onClick = {
                        try {
                            uriHandler.openUri(link.url)
                        } catch (failure: Exception) {
                            SdkLog.log("help.link_unavailable")
                        }
                    },
                    modifier = Modifier.heightIn(min = 48.dp).testTag(link.tag),
                ) {
                    Text(linkWords(look, language, link))
                }
            }
            if (selector) {
                LanguageSelector(languages, language, selection, Modifier.align(Alignment.CenterVertically))
            }
        }
    }
}

/** The operator's words for [link] in [language], filled and isolated for display, else the SDK's own (C162.5, C199.5, C199.6). */
@Composable
private fun linkWords(look: SessionLook, language: String, link: SlotLink): AnnotatedString {
    val custom = look.copy?.messages?.get(language)?.get(link.copyKey)?.let { text ->
        val allowed = COPY_KEY_RULES[link.copyKey]?.placeholders.orEmpty()
        val values = look.organizationDisplayName?.let { mapOf("organization" to it) }.orEmpty()
        fillCopyPlaceholders(text, allowed, values)?.display
    }
    return AnnotatedString(custom ?: sdkString(link.builtIn))
}
