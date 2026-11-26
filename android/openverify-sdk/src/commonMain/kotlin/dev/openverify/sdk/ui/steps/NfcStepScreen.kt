package dev.openverify.sdk.ui.steps

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import dev.openverify.sdk.flow.FlowState
import dev.openverify.sdk.generated.resources.*
import dev.openverify.sdk.i18n.sdkString
import dev.openverify.sdk.model.FileKind
import dev.openverify.sdk.model.SandboxChipScenario
import dev.openverify.sdk.nfc.NfcAccessKind
import dev.openverify.sdk.nfc.NfcEntryError
import dev.openverify.sdk.nfc.NfcEvent
import dev.openverify.sdk.nfc.NfcNotice
import dev.openverify.sdk.nfc.NfcPhase
import dev.openverify.sdk.nfc.NfcUnable
import dev.openverify.sdk.nfc.NfcView
import dev.openverify.sdk.nfc.WhileResumed
import dev.openverify.sdk.ui.FlowActions
import dev.openverify.sdk.ui.KeepScreenOn
import dev.openverify.sdk.ui.ProcessingScreen
import dev.openverify.sdk.ui.screen.SECRET_NUMBER
import dev.openverify.sdk.ui.screen.SECRET_TEXT
import dev.openverify.sdk.ui.screen.submitProtection
import dev.openverify.sdk.ui.screen.typedValueProtection
import dev.openverify.sdk.ui.text.Text
import org.jetbrains.compose.resources.StringResource

/**
 * C207.5 (Workflow 10C): the NFC step's screens; `InquiryFlowScreen.kt` (shared) dispatches
 * [FlowState.Nfc] here, and every control sends an [NfcEvent] through `FlowActions.nfc`. No string,
 * icon or mark here says the document is verified: the device reads and the server decides (C207.5,
 * C207.11). Typed values live in composition only, never in saved state (C213.2).
 */
@Composable
internal fun NfcStepScreen(state: FlowState.Nfc, actions: FlowActions, modifier: Modifier = Modifier) {
    when (val view = state.view) {
        is NfcView.Entry -> when (view.kind) {
            NfcAccessKind.MRZ -> MrzEntry(view, actions, modifier)
            NfcAccessKind.CAN -> CanEntry(view, actions, modifier)
        }
        is NfcView.Tap -> TapScreen(view, actions, modifier)
        is NfcView.Review -> ReviewScreen(view, actions, modifier)
        NfcView.Tips -> TipsScreen(actions, modifier)
        is NfcView.CannotRead -> CannotReadScreen(view, actions, modifier)
        NfcView.Checking -> {
            // C193.4: the server decides; the step waits for it and for its position.
            LaunchedEffect(Unit) { actions.nfc(NfcEvent.Check) }
            ProcessingScreen(modifier, photos = false)
        }
    }
}

// The access entry (C207.2) ------------------------------------------------------------------------

@Composable
private fun MrzEntry(view: NfcView.Entry, actions: FlowActions, modifier: Modifier) {
    var number by remember { mutableStateOf("") }
    var birth by remember { mutableStateOf("") }
    var expiry by remember { mutableStateOf("") }
    StepLayout(title = sdkString(Res.string.openverify_nfc_mrz_title), modifier = modifier) {
        Paragraph(sdkString(Res.string.openverify_nfc_mrz_intro))
        AttemptHints(view.hints)
        SecretField(number, { number = it }, Res.string.openverify_nfc_document_number, NfcStepTags.DOCUMENT_NUMBER, SECRET_TEXT)
        SecretField(birth, { birth = it }, Res.string.openverify_nfc_birth_date, NfcStepTags.BIRTH_DATE, SECRET_NUMBER, Res.string.openverify_nfc_date_hint)
        SecretField(expiry, { expiry = it }, Res.string.openverify_nfc_expiry_date, NfcStepTags.EXPIRY_DATE, SECRET_NUMBER, Res.string.openverify_nfc_date_hint)
        view.error?.let { ErrorMessage(sdkString(entryErrorWords(it))) }
        Button(
            onClick = { actions.nfc(NfcEvent.MrzEntered(number, birth, expiry)) },
            enabled = number.isNotBlank() && birth.isNotBlank() && expiry.isNotBlank(),
            modifier = Modifier.fillMaxWidth().testTag(NfcStepTags.CONTINUE).submitProtection(),
        ) {
            Text(sdkString(Res.string.openverify_nfc_continue))
        }
        EntryFooter(view, NfcAccessKind.CAN, Res.string.openverify_nfc_use_can, actions)
    }
}

@Composable
private fun CanEntry(view: NfcView.Entry, actions: FlowActions, modifier: Modifier) {
    var can by remember { mutableStateOf("") }
    StepLayout(title = sdkString(Res.string.openverify_nfc_can_title), modifier = modifier) {
        Paragraph(sdkString(Res.string.openverify_nfc_can_intro))
        AttemptHints(view.hints)
        SecretField(can, { can = it }, Res.string.openverify_nfc_can, NfcStepTags.CAN, SECRET_NUMBER)
        view.error?.let { ErrorMessage(sdkString(entryErrorWords(it))) }
        Button(
            onClick = { actions.nfc(NfcEvent.CanEntered(can)) },
            enabled = can.isNotBlank(),
            modifier = Modifier.fillMaxWidth().testTag(NfcStepTags.CONTINUE).submitProtection(),
        ) {
            Text(sdkString(Res.string.openverify_nfc_continue))
        }
        EntryFooter(view, NfcAccessKind.MRZ, Res.string.openverify_nfc_use_mrz, actions)
    }
}

/** The other way to open the chip, the sandbox test chip when the server offers it, and cancel. */
@Composable
private fun EntryFooter(view: NfcView.Entry, other: NfcAccessKind, otherWords: StringResource, actions: FlowActions) {
    OutlinedButton(
        onClick = { actions.nfc(NfcEvent.ChooseAccess(other)) },
        modifier = Modifier.fillMaxWidth().testTag(NfcStepTags.SWITCH_ACCESS).submitProtection(),
    ) {
        Text(sdkString(otherWords))
    }
    if (view.sandbox) SandboxChip(actions)
    TextButton(onClick = actions::cancel, modifier = Modifier.fillMaxWidth()) {
        Text(sdkString(Res.string.openverify_cancel))
    }
}

/**
 * A field of the access key (C195.2, review P07): a secret on a plain text or number keyboard with
 * autocorrect off, with no autofill content type, so no autofill service is told what it holds; and
 * accessibility-data-sensitive on API 34+ (C213.1). Compose 1.11 cannot set
 * `IME_FLAG_NO_PERSONALIZED_LEARNING` or mark one node not important for autofill.
 */
@Composable
private fun SecretField(
    value: String,
    onChange: (String) -> Unit,
    label: StringResource,
    tag: String,
    keyboard: KeyboardOptions,
    hint: StringResource? = null,
) {
    OutlinedTextField(
        value = value,
        onValueChange = onChange,
        label = { Text(sdkString(label)) },
        supportingText = hint?.let { words -> { Text(sdkString(words)) } },
        singleLine = true,
        keyboardOptions = keyboard,
        modifier = Modifier.fillMaxWidth().testTag(tag).typedValueProtection(),
    )
}

private fun entryErrorWords(error: NfcEntryError): StringResource = when (error) {
    NfcEntryError.DOCUMENT_NUMBER -> Res.string.openverify_nfc_error_document_number
    NfcEntryError.BIRTH_DATE -> Res.string.openverify_nfc_error_birth_date
    NfcEntryError.EXPIRY_DATE -> Res.string.openverify_nfc_error_expiry_date
    NfcEntryError.CAN -> Res.string.openverify_nfc_error_can
    NfcEntryError.REFUSED_BY_CHIP -> Res.string.openverify_nfc_error_refused
}

// The tap screen (C207.2, C207.5) --------------------------------------------------------------------

@Composable
private fun TapScreen(view: NfcView.Tap, actions: FlowActions, modifier: Modifier) {
    // C201.5: a screen timeout must not lock the phone while it is held to the document.
    KeepScreenOn()
    // C207.5: the reader is on only while this screen is the resumed one.
    WhileResumed(onResumed = { actions.nfc(NfcEvent.Resumed) }, onPaused = { actions.nfc(NfcEvent.Paused) })
    StepLayout(title = sdkString(Res.string.openverify_nfc_tap_title), modifier = modifier) {
        AttemptHints(view.hints)
        view.notice?.let { notice ->
            Text(
                text = sdkString(noticeWords(notice)),
                style = MaterialTheme.typography.bodyLarge,
                modifier = Modifier.testTag(NfcStepTags.NOTICE).semantics { liveRegion = LiveRegionMode.Polite },
            )
        }
        if (view.phase == NfcPhase.READY || view.phase == NfcPhase.WAITING) {
            Paragraph(sdkString(Res.string.openverify_nfc_tap_hint_passport))
            Paragraph(sdkString(Res.string.openverify_nfc_tap_hint_card))
        }
        if (view.phase == NfcPhase.READY) {
            ReadyActions(view, actions)
        } else {
            ReadProgress(view, actions)
        }
    }
}

@Composable
private fun ReadyActions(view: NfcView.Tap, actions: FlowActions) {
    if (view.reader) {
        Paragraph(sdkString(Res.string.openverify_nfc_tap_ready_note))
        Button(
            onClick = { actions.nfc(NfcEvent.Ready()) },
            modifier = Modifier.fillMaxWidth().testTag(NfcStepTags.READY).submitProtection(),
        ) {
            Text(sdkString(Res.string.openverify_nfc_ready))
        }
    }
    if (view.editable) {
        OutlinedButton(
            onClick = { actions.nfc(NfcEvent.ChooseAccess(NfcAccessKind.MRZ)) },
            modifier = Modifier.fillMaxWidth().testTag(NfcStepTags.CHANGE_DETAILS),
        ) {
            Text(sdkString(Res.string.openverify_nfc_change_details))
        }
    }
    if (view.sandbox) SandboxChip(actions)
    TextButton(onClick = actions::cancel, modifier = Modifier.fillMaxWidth()) {
        Text(sdkString(Res.string.openverify_cancel))
    }
}

/**
 * The read's phase in a polite live region, so each phase is announced once when it changes
 * (C212.2); the file and its progress are beside it, outside the region, so nothing is announced at
 * the rate the percent moves. No success mark: "read" only says the device has the files.
 */
@Composable
private fun ReadProgress(view: NfcView.Tap, actions: FlowActions) {
    Text(
        text = sdkString(phaseWords(view.phase)),
        style = MaterialTheme.typography.titleMedium,
        modifier = Modifier.testTag(NfcStepTags.PHASE).semantics { liveRegion = LiveRegionMode.Polite },
    )
    if (view.phase == NfcPhase.READING) {
        view.file?.let { Text(text = sdkString(fileWords(it)), style = MaterialTheme.typography.bodyMedium, modifier = Modifier.testTag(NfcStepTags.FILE)) }
        val percent = view.percent ?: 0
        LinearProgressIndicator(progress = { percent / 100f }, modifier = Modifier.fillMaxWidth().testTag(NfcStepTags.PROGRESS))
    }
    if (view.phase != NfcPhase.READ) {
        OutlinedButton(onClick = { actions.nfc(NfcEvent.StopRead) }, modifier = Modifier.fillMaxWidth().testTag(NfcStepTags.STOP)) {
            Text(sdkString(Res.string.openverify_nfc_stop))
        }
    }
}

private fun phaseWords(phase: NfcPhase): StringResource = when (phase) {
    NfcPhase.READY, NfcPhase.REQUESTING -> Res.string.openverify_nfc_phase_requesting
    NfcPhase.WAITING -> Res.string.openverify_nfc_phase_waiting
    NfcPhase.CONNECTING -> Res.string.openverify_nfc_phase_connecting
    NfcPhase.READING -> Res.string.openverify_nfc_phase_reading
    NfcPhase.SIGNING -> Res.string.openverify_nfc_phase_signing
    NfcPhase.READ -> Res.string.openverify_nfc_phase_read
}

private fun noticeWords(notice: NfcNotice): StringResource = when (notice) {
    NfcNotice.CHALLENGE_EXPIRED -> Res.string.openverify_nfc_notice_expired
    NfcNotice.KEEP_STILL -> Res.string.openverify_nfc_notice_keep_still
    NfcNotice.LIFTED -> Res.string.openverify_nfc_notice_lifted
    NfcNotice.UNSUPPORTED_DOCUMENT -> Res.string.openverify_nfc_notice_unsupported
    NfcNotice.TIMEOUT -> Res.string.openverify_nfc_notice_timeout
    NfcNotice.READER_BUSY -> Res.string.openverify_nfc_notice_busy
    NfcNotice.READ_FAILED -> Res.string.openverify_nfc_notice_failed
    NfcNotice.ONE_MORE_TAP -> Res.string.openverify_nfc_notice_one_more_tap
    NfcNotice.READING_AGAIN -> Res.string.openverify_nfc_notice_again
}

/** What a chip file is, in the person's words; the data groups' numbers mean nothing to them. */
private fun fileWords(kind: FileKind): StringResource = when (kind) {
    FileKind.CHIP_DG1 -> Res.string.openverify_nfc_file_details
    FileKind.CHIP_DG2 -> Res.string.openverify_nfc_file_photo
    FileKind.CHIP_COM -> Res.string.openverify_nfc_file_contents
    else -> Res.string.openverify_nfc_file_security
}

/**
 * C208.2, C208.4: the sandbox test chip, offered only when the server says so and always labelled
 * "Test chip (sandbox)". The scenarios are the route's own names, for the developer who tests with them.
 */
@Composable
private fun SandboxChip(actions: FlowActions) {
    var scenario by remember { mutableStateOf(SandboxChipScenario.MATCH) }
    Card(modifier = Modifier.fillMaxWidth()) {
        Column(modifier = Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(
                text = sdkString(Res.string.openverify_nfc_sandbox_label),
                style = MaterialTheme.typography.titleSmall,
                modifier = Modifier.testTag(NfcStepTags.SANDBOX_LABEL),
            )
            Selector(
                label = sdkString(Res.string.openverify_nfc_sandbox_scenario),
                selected = scenario.wireValue,
                options = SandboxChipScenario.entries.map { it.wireValue to it.wireValue },
                onSelect = { chosen -> scenario = SandboxChipScenario.entries.first { it.wireValue == chosen } },
                enabled = true,
                tag = NfcStepTags.SANDBOX_SCENARIO,
            )
            OutlinedButton(
                onClick = { actions.nfc(NfcEvent.Ready(scenario)) },
                modifier = Modifier.fillMaxWidth().testTag(NfcStepTags.SANDBOX).submitProtection(),
            ) {
                Text(sdkString(Res.string.openverify_nfc_sandbox_use))
            }
        }
    }
}

// The DG1 review (C207.5) ------------------------------------------------------------------------------

/**
 * What DG1's MRZ says, for the person to confirm before anything is uploaded. No portrait: DG2 is
 * never decoded. Accessibility-data-sensitive on API 34+, its controls dropping obscured touches on
 * API 26 to 30 (C213.1). "This is not my data" gives one new read; after that it also cancels, and
 * the inquiry stays resumable.
 */
@Composable
private fun ReviewScreen(view: NfcView.Review, actions: FlowActions, modifier: Modifier) {
    val details = view.details
    StepLayout(title = sdkString(Res.string.openverify_nfc_review_title), modifier = modifier) {
        Paragraph(sdkString(if (view.again) Res.string.openverify_nfc_review_again else Res.string.openverify_nfc_review_intro))
        Card(modifier = Modifier.fillMaxWidth().testTag(NfcStepTags.REVIEW).typedValueProtection()) {
            Column(modifier = Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                ReviewLine(Res.string.openverify_nfc_review_name, details.name)
                ReviewLine(Res.string.openverify_nfc_document_number, details.documentNumber)
                ReviewLine(Res.string.openverify_nfc_review_nationality, details.nationality)
                ReviewLine(Res.string.openverify_nfc_birth_date, chipDate(details.birthDate))
                ReviewLine(Res.string.openverify_nfc_expiry_date, chipDate(details.expiryDate))
            }
        }
        Text(text = sdkString(Res.string.openverify_nfc_review_date_note), style = MaterialTheme.typography.bodySmall)
        Button(
            onClick = { actions.nfc(NfcEvent.ReviewConfirmed) },
            modifier = Modifier.fillMaxWidth().testTag(NfcStepTags.CONFIRM).submitProtection(),
        ) {
            Text(sdkString(Res.string.openverify_nfc_review_confirm))
        }
        OutlinedButton(
            onClick = {
                actions.nfc(NfcEvent.ReviewRefused)
                if (view.again) actions.cancel()
            },
            modifier = Modifier.fillMaxWidth().testTag(NfcStepTags.REFUSE).submitProtection(),
        ) {
            Text(sdkString(Res.string.openverify_nfc_review_refuse))
        }
    }
}

@Composable
private fun ReviewLine(label: StringResource, value: String) {
    Column(modifier = Modifier.semantics(mergeDescendants = true) {}) {
        Text(text = sdkString(label), style = MaterialTheme.typography.labelMedium)
        Text(text = value, style = MaterialTheme.typography.bodyLarge)
    }
}

/** A chip's YYMMDD as year-month-day with separators: the century is not on the chip, so none is shown. */
private fun chipDate(value: String): String =
    if (value.length == 6) "${value.substring(0, 2)}-${value.substring(2, 4)}-${value.substring(4, 6)}" else value

// The tips and the "cannot read document chips" screens (C207.5, C207.9) ------------------------------

@Composable
private fun TipsScreen(actions: FlowActions, modifier: Modifier) {
    StepLayout(title = sdkString(Res.string.openverify_nfc_tips_title), modifier = modifier) {
        Paragraph(sdkString(Res.string.openverify_nfc_tip_cover))
        Paragraph(sdkString(Res.string.openverify_nfc_tip_case))
        Paragraph(sdkString(Res.string.openverify_nfc_tip_move))
        Paragraph(sdkString(Res.string.openverify_nfc_tip_still))
        Button(onClick = { actions.nfc(NfcEvent.TryAgain) }, modifier = Modifier.fillMaxWidth().testTag(NfcStepTags.TRY_AGAIN)) {
            Text(sdkString(Res.string.openverify_nfc_try_again))
        }
        OutlinedButton(onClick = actions::cancel, modifier = Modifier.fillMaxWidth().testTag(NfcStepTags.CONTINUE_LATER)) {
            Text(sdkString(Res.string.openverify_nfc_continue_later))
        }
    }
}

/**
 * C207.9 (review H11, H12): each reason has its own message. "Use another way" is offered only when
 * the server says a fallback exists, and the person is never told where it leads; without one, only
 * "continue later" (cancel; the inquiry stays resumable).
 */
@Composable
private fun CannotReadScreen(view: NfcView.CannotRead, actions: FlowActions, modifier: Modifier) {
    val (title, message) = when (view.reason) {
        NfcUnable.READER_NOT_INSTALLED -> Res.string.openverify_nfc_unable_reader_title to Res.string.openverify_nfc_unable_reader_message
        NfcUnable.NFC_UNAVAILABLE -> Res.string.openverify_nfc_unable_phone_title to Res.string.openverify_nfc_unable_phone_message
        NfcUnable.NFC_DISABLED -> Res.string.openverify_nfc_unable_off_title to Res.string.openverify_nfc_unable_off_message
        NfcUnable.CHALLENGES_SPENT -> Res.string.openverify_nfc_unable_spent_title to Res.string.openverify_nfc_unable_spent_message
    }
    if (view.reason == NfcUnable.NFC_DISABLED && !view.busy) {
        // Back from the system's settings: the phone is read again, so NFC turned on is seen at once.
        WhileResumed(onResumed = { actions.nfc(NfcEvent.Recheck) }, onPaused = {})
    }
    StepLayout(title = sdkString(title), modifier = modifier) {
        Paragraph(sdkString(message))
        if (view.reason == NfcUnable.NFC_DISABLED) {
            Button(onClick = { actions.nfc(NfcEvent.OpenNfcSettings) }, modifier = Modifier.fillMaxWidth().testTag(NfcStepTags.OPEN_SETTINGS)) {
                Text(sdkString(Res.string.openverify_nfc_open_settings))
            }
            OutlinedButton(onClick = { actions.nfc(NfcEvent.Recheck) }, modifier = Modifier.fillMaxWidth().testTag(NfcStepTags.RECHECK)) {
                Text(sdkString(Res.string.openverify_nfc_recheck))
            }
        }
        Paragraph(sdkString(if (view.fallback) Res.string.openverify_nfc_fallback_note else Res.string.openverify_nfc_later_note))
        if (view.busy) BusyRow(sdkString(Res.string.openverify_nfc_sending))
        if (view.fallback) {
            OutlinedButton(
                onClick = { actions.nfc(NfcEvent.UseAnotherWay) },
                enabled = !view.busy,
                modifier = Modifier.fillMaxWidth().testTag(NfcStepTags.ANOTHER_WAY).submitProtection(),
            ) {
                Text(sdkString(Res.string.openverify_nfc_another_way))
            }
        }
        if (view.sandbox) SandboxChip(actions)
        TextButton(onClick = actions::cancel, modifier = Modifier.fillMaxWidth().testTag(NfcStepTags.CONTINUE_LATER)) {
            Text(sdkString(Res.string.openverify_nfc_continue_later))
        }
    }
}
