package dev.openverify.sdk.ui.steps

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.Checkbox
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextDirection
import androidx.compose.ui.unit.dp
import dev.openverify.sdk.flow.FlowState
import dev.openverify.sdk.flow.ShareConsentView
import dev.openverify.sdk.flow.ShareConsentWithdrawals
import dev.openverify.sdk.generated.resources.*
import dev.openverify.sdk.i18n.isolated
import dev.openverify.sdk.i18n.sdkString
import dev.openverify.sdk.ui.FlowActions
import dev.openverify.sdk.ui.filledByName
import dev.openverify.sdk.ui.screen.submitProtection
import dev.openverify.sdk.ui.text.Text
import org.jetbrains.compose.resources.StringResource

/**
 * C238.7, C237.6 (Phase 11, Workflow 11A; `clients-connect`): the share-consent screen and the
 * withdrawal affordance, in `commonMain` (iOS-ready, C256.1).
 *
 * The screen shows the text the server composed exactly as it was served (the driver has already
 * checked its digest, `flow/ShareConsent.kt`), the source and the recipient by name, the categories
 * in words (the web's words, through the key map, C199.1) and, when served, the biometric text as
 * the label of its own box, unticked. "I agree" reports the tick; the driver asks for it first when
 * the share carries biometric data, which this screen says in a polite live region. While the
 * choice is sent, nothing can be pressed and the wait is said. Every text is drawn through the SDK's
 * one text composable; a name inside a sentence is isolated (C199.5). Nothing is composed here.
 */
@Composable
internal fun ShareConsentStepScreen(view: ShareConsentView, actions: FlowActions, modifier: Modifier = Modifier) {
    val step = view.step
    // The tick lives in memory only, never in saved state: after a rotation it is asked for again, unticked.
    var ticked by remember(step.id) { mutableStateOf(false) }
    StepLayout(title = filledByName(sdkString(Res.string.openverify_share_consent_title), "recipient", isolated(step.recipientName)), modifier = modifier) {
        Named(sdkString(Res.string.openverify_share_shared_by), step.sourceName)
        Named(sdkString(Res.string.openverify_share_shared_with), step.recipientName)
        Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text(text = sdkString(Res.string.openverify_share_what_is_shared), style = MaterialTheme.typography.titleSmall)
            step.categories.forEach { category ->
                CATEGORY_WORDS[category]?.let { words -> Text(text = sdkString(words), style = MaterialTheme.typography.bodyMedium) }
            }
        }
        // The server's text, as served: its paragraphs are its own (a blank line between two).
        // Its direction is its own (TextDirection.Content): an English text keeps its order on an Arabic screen.
        Text(text = step.text.body, style = MaterialTheme.typography.bodyLarge.copy(textDirection = TextDirection.Content), modifier = Modifier.testTag(ShareConsentTags.TEXT))
        step.biometric?.let { biometric ->
            Row(
                modifier = Modifier
                    .testTag(ShareConsentTags.BIOMETRIC)
                    .submitProtection()
                    .fillMaxWidth()
                    .toggleable(value = ticked, enabled = !view.submitting, role = Role.Checkbox, onValueChange = { ticked = it }),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Checkbox(checked = ticked, onCheckedChange = null, enabled = !view.submitting)
                Text(text = biometric.body, style = MaterialTheme.typography.bodyMedium.copy(textDirection = TextDirection.Content))
            }
            if (view.tickMissing && !ticked) {
                Text(
                    text = sdkString(Res.string.openverify_share_biometric_required),
                    color = MaterialTheme.colorScheme.error,
                    style = MaterialTheme.typography.bodyMedium,
                    modifier = Modifier.testTag(ShareConsentTags.TICK_MISSING).semantics { liveRegion = LiveRegionMode.Polite },
                )
            }
        }
        if (view.submitting) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                modifier = Modifier.testTag(ShareConsentTags.SAVING).semantics(mergeDescendants = true) { liveRegion = LiveRegionMode.Polite },
            ) {
                Text(text = sdkString(Res.string.openverify_share_saving), style = MaterialTheme.typography.bodyMedium)
            }
        }
        Button(
            onClick = { actions.acceptShareConsent(ticked) },
            enabled = !view.submitting,
            modifier = Modifier.fillMaxWidth().testTag(ShareConsentTags.ACCEPT).submitProtection(),
        ) {
            Text(sdkString(Res.string.openverify_share_consent_accept))
        }
        OutlinedButton(
            onClick = actions::declineShareConsent,
            enabled = !view.submitting,
            modifier = Modifier.fillMaxWidth().testTag(ShareConsentTags.DECLINE).submitProtection(),
        ) {
            Text(sdkString(Res.string.openverify_share_consent_decline))
        }
    }
}

/** A label and an organisation's name, read as one. */
@Composable
private fun Named(label: String, name: String) {
    Column(Modifier.semantics(mergeDescendants = true) {}) {
        Text(text = label, style = MaterialTheme.typography.titleSmall)
        Text(text = name, style = MaterialTheme.typography.bodyLarge)
    }
}

/** The words of each share category (C230.4), from the web catalogs through the key map. */
private val CATEGORY_WORDS: Map<String, StringResource> = mapOf(
    "identity-fields" to Res.string.openverify_share_category_identity_fields,
    "contact-fields" to Res.string.openverify_share_category_contact_fields,
    "other-fields" to Res.string.openverify_share_category_other_fields,
    "document-images" to Res.string.openverify_share_category_document_images,
    "biometric" to Res.string.openverify_share_category_biometric,
    "check-results" to Res.string.openverify_share_category_check_results,
)

/**
 * C237.6 (V02): the withdrawal affordance: one withdrawal per accepted share, naming its recipient;
 * a withdrawal on its way, done or refused is said in a polite live region. Nothing is drawn while
 * the session lists none and nothing was withdrawn here.
 */
@Composable
internal fun ShareConsentWithdrawalsCard(withdrawals: ShareConsentWithdrawals, onWithdraw: (String) -> Unit, modifier: Modifier = Modifier) {
    if (withdrawals.entries.isEmpty() && withdrawals.withdrawnRecipient == null) return
    Card(modifier = modifier.fillMaxWidth().padding(horizontal = 24.dp, vertical = 8.dp).testTag(ShareConsentTags.WITHDRAWALS)) {
        // It sits between the screen and the help slot, so it scrolls within a bounded height: at a large
        // font size it never pushes the help slot or the screen's own controls off the window.
        Column(
            modifier = Modifier.heightIn(max = WITHDRAWALS_MAX_HEIGHT).verticalScroll(rememberScrollState()).padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Text(
                text = sdkString(Res.string.openverify_share_withdraw_heading),
                style = MaterialTheme.typography.titleMedium,
                modifier = Modifier.semantics { heading() },
            )
            withdrawals.withdrawnRecipient?.let { recipient ->
                Text(
                    text = filledByName(sdkString(Res.string.openverify_share_withdrawn), "recipient", isolated(recipient)),
                    style = MaterialTheme.typography.bodyMedium,
                    modifier = Modifier.testTag(ShareConsentTags.WITHDRAWN).semantics { liveRegion = LiveRegionMode.Polite },
                )
            }
            withdrawals.entries.forEach { entry ->
                Text(
                    text = filledByName(sdkString(Res.string.openverify_share_withdraw_intro), "recipient", isolated(entry.recipientName)),
                    style = MaterialTheme.typography.bodyMedium,
                )
                OutlinedButton(
                    onClick = { onWithdraw(entry.stepId) },
                    enabled = withdrawals.busyStepId == null,
                    modifier = Modifier.fillMaxWidth().testTag(ShareConsentTags.withdraw(entry.stepId)).submitProtection(),
                ) {
                    Text(filledByName(sdkString(Res.string.openverify_share_consent_withdraw), "recipient", isolated(entry.recipientName)))
                }
            }
            if (withdrawals.busyStepId != null) {
                Text(
                    text = sdkString(Res.string.openverify_share_withdrawing),
                    style = MaterialTheme.typography.bodyMedium,
                    modifier = Modifier.testTag(ShareConsentTags.WITHDRAWING).semantics { liveRegion = LiveRegionMode.Polite },
                )
            }
            if (withdrawals.failed) {
                Text(
                    text = sdkString(Res.string.openverify_error_network),
                    color = MaterialTheme.colorScheme.error,
                    style = MaterialTheme.typography.bodyMedium,
                    modifier = Modifier.testTag(ShareConsentTags.WITHDRAW_FAILED).semantics { liveRegion = LiveRegionMode.Polite },
                )
            }
        }
    }
}

/** The withdrawal affordance's greatest height under a screen (ours: about a quarter of a 800 dp phone window). */
private val WITHDRAWALS_MAX_HEIGHT = 200.dp

/** What the scaffold's hook reads: the withdrawals and the action that withdraws one; `null` outside the flow screen. */
internal class ShareConsentWithdrawalsHandle(val withdrawals: ShareConsentWithdrawals, val onWithdraw: (String) -> Unit)

internal val LocalShareConsentWithdrawals = staticCompositionLocalOf<ShareConsentWithdrawalsHandle?> { null }

/** Provides [actions]' withdrawals to the scaffold's hook ([ShareConsentWithdrawalsSlot]) below it. */
@Composable
internal fun ProvideShareConsentWithdrawals(actions: FlowActions, content: @Composable () -> Unit) {
    val withdrawals by actions.shareConsentWithdrawals.collectAsState()
    CompositionLocalProvider(LocalShareConsentWithdrawals provides ShareConsentWithdrawalsHandle(withdrawals, actions::withdrawShareConsent), content = content)
}

/**
 * C237.6 (V02): `StepScaffold`'s hook, under every screen. Not while the session can no longer be
 * used, nor on an error or while loading: a withdrawal is then offered again once the flow is back.
 */
@Composable
internal fun ShareConsentWithdrawalsSlot(state: FlowState) {
    val handle = LocalShareConsentWithdrawals.current ?: return
    when (state) {
        FlowState.Loading, FlowState.Expired, FlowState.Redacted, FlowState.LinkRefused, is FlowState.SessionEnded, is FlowState.Error -> return
        else -> ShareConsentWithdrawalsCard(handle.withdrawals, handle.onWithdraw)
    }
}

/** The share-consent screen's and the withdrawal affordance's test tags (C238.7, C237.6). */
internal object ShareConsentTags {
    const val TEXT: String = "openverify.share_consent.text"
    const val BIOMETRIC: String = "openverify.share_consent.biometric"
    const val TICK_MISSING: String = "openverify.share_consent.tick_missing"
    const val SAVING: String = "openverify.share_consent.saving"
    const val ACCEPT: String = "openverify.share_consent.accept"
    const val DECLINE: String = "openverify.share_consent.decline"
    const val WITHDRAWALS: String = "openverify.share_consent.withdrawals"
    const val WITHDRAWING: String = "openverify.share_consent.withdrawing"
    const val WITHDRAWN: String = "openverify.share_consent.withdrawn"
    const val WITHDRAW_FAILED: String = "openverify.share_consent.withdraw_failed"

    /** The withdrawal button of the share consent of [stepId]. */
    fun withdraw(stepId: String): String = "openverify.share_consent.withdraw.$stepId"
}
