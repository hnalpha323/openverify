package dev.openverify.sdk.ui.screen

import androidx.compose.foundation.clickable
import androidx.compose.foundation.focusable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import dev.openverify.sdk.flow.FlowState
import dev.openverify.sdk.flow.logic.VisibilityRuleRefused
import dev.openverify.sdk.generated.resources.*
import dev.openverify.sdk.i18n.sdkString
import dev.openverify.sdk.model.AddressComponent
import dev.openverify.sdk.model.FlowValue
import dev.openverify.sdk.model.TextComponent
import dev.openverify.sdk.ui.FlowActions
import dev.openverify.sdk.ui.UnsupportedScreen
import dev.openverify.sdk.ui.steps.BusyRow
import dev.openverify.sdk.ui.steps.ErrorMessage
import dev.openverify.sdk.ui.text.Text

/**
 * C195 (Workflow 10A, android-screens): the `screen` step. It renders the server's client view of the
 * current screen (C151.5) with C148's catalogue, components in order; fills each field with the value
 * the session holds (3.3.7); shows and enables components through the strict visibility evaluator on
 * arrival and on every change (C196.1); checks values only to help the person (C195.10), with the
 * server's 422 pointers shown on their fields; and submits the visible values with the pressed
 * button's port through the driver (C195.7). The server decides where the flow goes: the screen never
 * chooses a path.
 *
 * A screen it cannot render as a whole (a later component kind, C148.6's limits, a rule outside the
 * strict subset, a component text no catalog holds) is the unsupported screen, never a partial one
 * (C194.3, C195.9, C199.6).
 */
@Composable
internal fun ScreenStepScreen(state: FlowState.Screen, actions: FlowActions, modifier: Modifier = Modifier) {
    val environment = LocalScreenEnvironment.current
    val renderable = remember(state.step, environment) {
        screenUnsupportedReason(state.step) == null && screenTextsComplete(state.step, environment.text)
    }
    if (!renderable) {
        UnsupportedScreen(actions::finish, modifier)
        return
    }
    ScreenForm(
        state = state,
        environment = environment,
        onSubmit = actions::submitScreen,
        onCancel = actions::cancel,
        onClose = actions::finish,
        modifier = modifier,
    )
}

/**
 * The form of a renderable screen: [onSubmit] takes the visible values and the pressed button's port
 * key (null for the primary button, port `next`); [onCancel] ends the session for now, after a
 * confirmation (the inquiry stays resumable, C195.3).
 */
@Composable
internal fun ScreenForm(
    state: FlowState.Screen,
    environment: ScreenEnvironment,
    onSubmit: (values: Map<String, FlowValue>, button: String?) -> Unit,
    onCancel: () -> Unit,
    onClose: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val step = state.step
    val drafts = environment.drafts
    var form by remember(step.id) { mutableStateOf(drafts?.get(step.id) ?: initialScreenState(step, state.values)) }
    var shown by remember(step.id) { mutableStateOf<Map<String, FieldError>?>(null) }
    // Fields changed since the server refused them: their refusal is no longer shown.
    var edited by remember(step.id, state.refusedFields) { mutableStateOf(emptySet<String>()) }
    var confirming by remember(step.id) { mutableStateOf(false) }
    var refusals by remember(step.id) { mutableIntStateOf(0) }
    val fields = remember(step) { boundFields(step) }
    val requesters = remember(step.id) { fields.map { it.key }.distinct().associateWith { FocusRequester() } }
    val heading = remember(step.id) { FocusRequester() }
    val summary = remember(step.id) { FocusRequester() }

    val visibility = try {
        visibilityOf(step, form.values)
    } catch (_: VisibilityRuleRefused) {
        null
    }
    if (visibility == null) {
        UnsupportedScreen(onClose, modifier)
        return
    }

    if (confirming) {
        CancelConfirmation(onConfirm = onCancel, onKeep = { confirming = false }, modifier = modifier)
        return
    }

    val errors = buildMap {
        state.refusedFields.filter { it !in edited }.forEach { put(it, FieldError(FieldErrorCode.REFUSED)) }
        shown?.let { putAll(it) }
    }
    val scope = ScreenScope(
        form = form,
        errors = errors,
        visibility = visibility,
        busy = state.submitting,
        environment = environment,
        titleId = allComponents(step.components).firstOrNull { it is TextComponent && it.variant == TITLE }?.id,
        heading = heading,
        requesters = requesters,
        change = { field, value ->
            val next = form.with(field, value)
            form = next
            drafts?.set(step.id, next)
            shown = shown?.minus(field.key)
            edited = edited + field.key
        },
        submit = { port ->
            val found = screenErrors(step, form, visibility)
            shown = found
            edited = emptySet()
            if (found.isEmpty()) onSubmit(submissionValues(step, form, visibility), port) else refusals++
        },
        cancel = { confirming = true },
    )

    LaunchedEffect(step.id) { heading.requestFocus() }
    LaunchedEffect(refusals) { if (refusals > 0) summary.requestFocus() }

    Column(
        modifier = modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 24.dp, vertical = 24.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        // The heading first (C195.8), then the error summary and the required note (C195.4), then the rest.
        val headingAt = step.components.indexOfFirst { it.id == scope.titleId }
        if (scope.titleId == null) {
            Text(
                text = sdkString(Res.string.openverify_screen_heading),
                style = MaterialTheme.typography.headlineSmall,
                modifier = Modifier.headingFocus(heading),
            )
        } else if (headingAt >= 0) {
            RenderComponents(step.components.take(headingAt + 1), scope)
        }
        val summarised = fields.filter { it.key in errors }.distinctBy { it.key }
        if (summarised.isNotEmpty()) ErrorSummary(summarised, scope, summary)
        if (fields.any(::isRequired)) {
            Text(sdkString(Res.string.openverify_screen_required), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        RenderComponents(step.components.drop(headingAt + 1), scope)
        if (state.submitting) {
            Column(Modifier.testTag(ScreenTags.SAVING)) { BusyRow(sdkString(Res.string.openverify_screen_saving)) }
        }
        if (state.refused) {
            Column(Modifier.testTag(ScreenTags.REFUSED)) { ErrorMessage(sdkString(Res.string.openverify_screen_error_refused)) }
        }
    }
}

/** The heading's focus on arrival (C195.8): it can be focused, and is a heading for TalkBack. */
internal fun Modifier.headingFocus(requester: FocusRequester): Modifier =
    this.semantics { heading() }.focusRequester(requester).focusable().testTag(ScreenTags.HEADING)

/**
 * C195.4: the errors at the top, after a submission the device refused, announced at once and
 * focused; each names its field and moves focus to it.
 */
@Composable
private fun ErrorSummary(fields: List<BoundField>, scope: ScreenScope, requester: FocusRequester) {
    Card(
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.errorContainer, contentColor = MaterialTheme.colorScheme.onErrorContainer),
        modifier = Modifier
            .fillMaxWidth()
            .testTag(ScreenTags.SUMMARY)
            .semantics { liveRegion = LiveRegionMode.Assertive }
            .focusRequester(requester)
            .focusable(),
    ) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text(sdkString(Res.string.openverify_screen_summary), style = MaterialTheme.typography.titleSmall)
            fields.forEach { field ->
                Text(
                    text = scope.labelOf(field),
                    style = MaterialTheme.typography.bodyMedium,
                    modifier = Modifier
                        .fillMaxWidth()
                        .heightIn(min = 48.dp)
                        .clickable { scope.requesters[field.key]?.requestFocus() }
                        .padding(vertical = 12.dp)
                        .testTag(ScreenTags.summaryLink(field.key)),
                )
            }
        }
    }
}

/** C195.3: a `cancel` button asks first; stopping keeps the inquiry resumable. */
@Composable
private fun CancelConfirmation(onConfirm: () -> Unit, onKeep: () -> Unit, modifier: Modifier) {
    val heading = remember { FocusRequester() }
    LaunchedEffect(Unit) { heading.requestFocus() }
    Column(
        modifier = modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(24.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        Text(sdkString(Res.string.openverify_screen_cancel_title), style = MaterialTheme.typography.headlineSmall, modifier = Modifier.headingFocus(heading))
        Text(sdkString(Res.string.openverify_screen_cancel_message), style = MaterialTheme.typography.bodyLarge)
        Button(
            onClick = onConfirm,
            colors = ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.error, contentColor = MaterialTheme.colorScheme.onError),
            modifier = Modifier.fillMaxWidth().submitProtection().testTag(ScreenTags.CANCEL_CONFIRM),
        ) {
            Text(sdkString(Res.string.openverify_screen_cancel_confirm))
        }
        OutlinedButton(onClick = onKeep, modifier = Modifier.fillMaxWidth().testTag(ScreenTags.CANCEL_KEEP)) {
            Text(sdkString(Res.string.openverify_screen_cancel_keep))
        }
    }
}

internal const val TITLE: String = "title"

/** An address part's own label, which the summary and the part's field use. */
internal fun addressPartLabel(part: AddressPart) = when (part) {
    AddressPart.STREET1 -> Res.string.openverify_screen_address_street1
    AddressPart.STREET2 -> Res.string.openverify_screen_address_street2
    AddressPart.CITY -> Res.string.openverify_screen_address_city
    AddressPart.SUBDIVISION -> Res.string.openverify_screen_address_subdivision
    AddressPart.POSTAL_CODE -> Res.string.openverify_screen_address_postal_code
    AddressPart.COUNTRY -> Res.string.openverify_screen_address_country
}

/** Whether [field] is an address part, so its label is the SDK's own. */
internal val BoundField.isAddressPart: Boolean get() = component is AddressComponent && part != null
