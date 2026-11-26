package dev.openverify.sdk.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.listSaver
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import dev.openverify.sdk.consent.CONSENT_AGREEMENT_KEY
import dev.openverify.sdk.consent.ConsentText
import dev.openverify.sdk.consent.ConsentValues
import dev.openverify.sdk.consent.consentText
import dev.openverify.sdk.flow.FlowState
import dev.openverify.sdk.generated.resources.*
import dev.openverify.sdk.i18n.LocalSdkLanguage
import dev.openverify.sdk.i18n.OperatorCopy
import dev.openverify.sdk.i18n.ResolvedText
import dev.openverify.sdk.i18n.SDK_DEFAULT_LANGUAGE
import dev.openverify.sdk.i18n.sdkString
import dev.openverify.sdk.ui.text.Text
import dev.openverify.sdk.ui.theme.LocalSessionLook
import dev.openverify.sdk.ui.screen.submitProtection
import org.jetbrains.compose.resources.StringResource

/**
 * The consent step: every text the step lists, an explicit agreement checkbox, and Continue,
 * which stays disabled until the user agrees. Below the agreement, each optional text (C42.3)
 * comes with its own checkbox, unticked: declining it still lets the user continue, and Continue
 * sends only the ones the user ticked.
 *
 * Continue also sends the BCP 47 tag of the language the texts are shown in (C37), read in the same
 * composition as the texts, so consent is recorded in the language the user read.
 *
 * C200.2, C199.6: each text, the agreement's label (`consent.checkbox`) among them, is resolved by
 * `consentText` exactly as the consent hook resolves it for the digests: the session's operator copy
 * in the chosen language, else the SDK's own, filled with the session's retention and the
 * organisation's display name, each filled value isolated for display only (C199.5). A required text
 * or the label that cannot be shown as written (a legal text naming the organisation without its
 * name) shows the unsupported screen, never the SDK's own words in place of the operator's and never
 * a consent; an optional one is not offered.
 *
 * C213.1: on API 26 to 30 the agreement, each optional consent and Continue drop a touch delivered
 * through another app's overlay; from API 31 the platform blocks it and the window hides overlays.
 */
@Composable
internal fun ConsentScreen(
    state: FlowState.Consent,
    onAccept: (optionalTextKeys: Set<String>, locale: String) -> Unit,
    onCancel: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val locale = sdkString(Res.string.openverify_locale)
    val look = LocalSessionLook.current
    val language = LocalSdkLanguage.current ?: locale
    val defaultLanguage = look.locales?.default ?: SDK_DEFAULT_LANGUAGE
    val values = ConsentValues(state.retentionDays, look.organizationDisplayName)
    val resolve = { key: String -> consentText(key, language, look.copy, defaultLanguage, values) }
    val required = state.step.textKeys.map(resolve)
    val agreement = resolve(AGREEMENT_KEY)
    if (agreement !is ConsentText.Shown || required.any { it !is ConsentText.Shown }) {
        UnsupportedScreen(onClose = onCancel, modifier = modifier)
        return
    }
    var agreed by rememberSaveable { mutableStateOf(false) }
    var ticked by rememberSaveable(stateSaver = TICKED_SAVER) { mutableStateOf(emptySet<String>()) }
    val optional = state.step.optionalTextKeys.mapNotNull { key ->
        val text = resolve(key) as? ConsentText.Shown ?: return@mapNotNull null
        ConsentTexts.optionalCheckboxes[key]?.let { label -> OptionalText(key, text.display, label) }
    }
    val copy = OperatorCopy(look.copy, language, defaultLanguage)
    val organization = values.byName().filterKeys { it == "organization" }

    Column(
        modifier = modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(24.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        Text(
            text = copy.custom("openverify_consent_title", organization) ?: sdkString(Res.string.openverify_consent_title),
            style = MaterialTheme.typography.headlineSmall,
            modifier = Modifier.semantics { heading() },
        )
        if (state.textChanged) {
            // C200.5 (KP10-6): the server refused the last acceptance because the wording changed;
            // nothing was recorded, and the texts below are the new ones. Announced once, politely.
            Text(
                text = sdkString(Res.string.openverify_consent_text_changed),
                style = MaterialTheme.typography.bodyLarge,
                modifier = Modifier.testTag(CONSENT_TEXT_CHANGED_TAG).semantics { liveRegion = LiveRegionMode.Polite },
            )
        }
        required.filterIsInstance<ConsentText.Shown>().forEach { text ->
            Text(text = text.display, style = MaterialTheme.typography.bodyLarge, modifier = Modifier.testTag(ConsentTags.text(text.key)))
        }
        ConsentCheckbox(
            checked = agreed,
            label = agreement.display,
            onChange = { agreed = it },
            modifier = Modifier.testTag(TestTags.CONSENT_CHECKBOX),
            labelModifier = Modifier.testTag(ConsentTags.text(AGREEMENT_KEY)),
        )
        optional.forEach { (key, text, label) ->
            HorizontalDivider()
            Text(text = text, style = MaterialTheme.typography.bodyLarge, modifier = Modifier.testTag(ConsentTags.text(key)))
            ConsentCheckbox(
                checked = key in ticked,
                label = sdkString(label),
                onChange = { tick -> ticked = if (tick) ticked + key else ticked - key },
                modifier = Modifier.testTag(TestTags.optionalConsent(key)),
            )
        }
        if (state.submitting) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                // C212.2: said once when the acceptance is sent, as every other request on its way.
                modifier = Modifier.testTag(TestTags.CONSENT_SAVING).semantics(mergeDescendants = true) { liveRegion = LiveRegionMode.Polite },
            ) {
                CircularProgressIndicator(modifier = Modifier.size(20.dp), strokeWidth = 2.dp)
                Text(text = sdkString(Res.string.openverify_consent_saving))
            }
        }
        Button(
            onClick = { onAccept(ticked intersect optional.map { it.key }.toSet(), locale) },
            enabled = agreed && !state.submitting,
            modifier = Modifier.fillMaxWidth().submitProtection(),
        ) {
            Text(copy.custom("openverify_consent_continue", organization) ?: sdkString(Res.string.openverify_consent_continue))
        }
        TextButton(onClick = onCancel, modifier = Modifier.fillMaxWidth()) {
            Text(sdkString(Res.string.openverify_cancel))
        }
    }
}

/** The agreement's label is the consent text `consent.checkbox` (C200.3). */
private const val AGREEMENT_KEY = CONSENT_AGREEMENT_KEY

/** The test tag of the changed-wording notice (KP10-6). */
internal const val CONSENT_TEXT_CHANGED_TAG: String = "consent.text_changed"

/** The operator's text for [resource] in the chosen language, as displayed, or `null` for the SDK's own (C199.6). */
private fun OperatorCopy.custom(resource: String, values: Map<String, String>): String? =
    (forResource(resource, values) as? ResolvedText.Custom)?.text?.display

/** Test tags of the consent texts as shown, by text key (`consent.checkbox` is the agreement's label). */
internal object ConsentTags {
    fun text(key: String): String = "openverify-consent-text-$key"
}

/** An optional consent text as shown: its key, its displayed text, its checkbox label. */
private data class OptionalText(val key: String, val text: String, val label: StringResource)

/**
 * A checkbox whose whole row, label included, toggles it. On API 26 to 30 it drops a touch delivered
 * through another app's overlay (C213.1, `submitProtection`).
 */
@Composable
private fun ConsentCheckbox(
    checked: Boolean,
    label: String,
    onChange: (Boolean) -> Unit,
    modifier: Modifier,
    labelModifier: Modifier = Modifier,
) {
    Row(
        modifier = modifier
            .submitProtection()
            .fillMaxWidth()
            .toggleable(value = checked, role = Role.Checkbox, onValueChange = onChange),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Checkbox(checked = checked, onCheckedChange = null)
        Text(text = label, style = MaterialTheme.typography.bodyMedium, modifier = labelModifier)
    }
}

/** The ticked optional keys survive a rotation, as the agreement does. */
private val TICKED_SAVER = listSaver<Set<String>, String>(save = { it.toList() }, restore = { it.toSet() })
