package dev.openverify.sdk.ui.help

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.intl.LocaleList
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.unit.dp
import dev.openverify.sdk.generated.resources.Res
import dev.openverify.sdk.generated.resources.openverify_language
import dev.openverify.sdk.generated.resources.openverify_language_change
import dev.openverify.sdk.i18n.sdkString
import dev.openverify.sdk.ui.text.Text
import dev.openverify.sdk.ui.theme.LanguageSelection

/**
 * Each SDK language named in its own language (C199.3), as the web flow's selector names it
 * (`apps/flow/src/components/language-select.tsx`), so a person finds theirs whatever is showing.
 * Names, not translations: they are the same in every locale.
 */
internal val SDK_LANGUAGE_NAMES: Map<String, String> = linkedMapOf(
    "en" to "English",
    "es" to "Español",
    "fr" to "Français",
    "de" to "Deutsch",
    "ar" to "العربية",
)

/** [language]'s own name, marked as that language so a screen reader speaks it in its own voice (WCAG 3.1.2). */
private fun languageName(language: String): AnnotatedString = buildAnnotatedString {
    withStyle(SpanStyle(localeList = LocaleList(language))) { append(SDK_LANGUAGE_NAMES[language] ?: language) }
}

/**
 * C199.3: the language selector, one control that reads its label and the language shown ("Language,
 * English") and opens a menu of [languages], each named in itself; choosing one sets [selection],
 * which changes every SDK string at once (C199.4). The choice is the person's and comes first
 * (C199.2); the consent the person then gives records the language its texts were shown in
 * (`openverify_locale`, C37, 10A decision 5), and a choice after consent is not reported.
 */
@Composable
internal fun LanguageSelector(languages: List<String>, current: String, selection: LanguageSelection, modifier: Modifier = Modifier) {
    var open by remember { mutableStateOf(false) }
    Box(modifier) {
        Row(
            modifier = Modifier
                .heightIn(min = 48.dp)
                .clip(MaterialTheme.shapes.small)
                .clickable(onClickLabel = sdkString(Res.string.openverify_language_change), role = Role.DropdownList) { open = true }
                .padding(horizontal = 12.dp)
                .testTag(ChromeTags.LANGUAGE_SELECTOR),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Text(sdkString(Res.string.openverify_language), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            Text(languageName(current), style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.primary, fontWeight = FontWeight.Medium)
        }
        DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
            for (language in languages) {
                DropdownMenuItem(
                    text = { Text(languageName(language)) },
                    onClick = {
                        selection.selected = language
                        open = false
                    },
                    modifier = Modifier.testTag(ChromeTags.languageItem(language)).semantics { selected = language == current },
                )
            }
        }
    }
}
