package dev.openverify.sdk.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import dev.openverify.sdk.flow.FlowState
import dev.openverify.sdk.flow.ServerPosition
import dev.openverify.sdk.flow.SessionEndReason
import dev.openverify.sdk.generated.resources.*
import dev.openverify.sdk.i18n.sdkString
import dev.openverify.sdk.ui.text.Text

@Composable
internal fun LoadingScreen(modifier: Modifier = Modifier) {
    StatusLayout(title = null, message = sdkString(Res.string.openverify_loading), modifier, showProgress = true)
}

/** The server checks the step's submission; [photos] is false for a step without photos (C64.2). */
@Composable
internal fun ProcessingScreen(modifier: Modifier = Modifier, photos: Boolean = true) {
    StatusLayout(
        title = sdkString(if (photos) Res.string.openverify_processing_title else Res.string.openverify_processing_verification_title),
        message = sdkString(Res.string.openverify_processing_message),
        modifier = modifier,
        showProgress = true,
    )
}

@Composable
internal fun CompletionScreen(state: FlowState.Completed, onDone: () -> Unit, modifier: Modifier = Modifier) {
    StatusLayout(
        title = sdkString(Res.string.openverify_completion_title),
        message = sdkString(completionMessage(state.step?.messageKey)),
        modifier = modifier,
    ) {
        Button(onClick = onDone, modifier = Modifier.fillMaxWidth()) { Text(sdkString(Res.string.openverify_done)) }
    }
}

@Composable
internal fun ExpiredScreen(onClose: () -> Unit, modifier: Modifier = Modifier) {
    StatusLayout(
        title = sdkString(Res.string.openverify_expired_title),
        message = sdkString(Res.string.openverify_expired_message),
        modifier = modifier,
    ) {
        Button(onClick = onClose, modifier = Modifier.fillMaxWidth()) { Text(sdkString(Res.string.openverify_close)) }
    }
}

/** The session can no longer be used (C19). Nothing can be retried, so it only closes. */
@Composable
internal fun SessionEndedScreen(state: FlowState.SessionEnded, onClose: () -> Unit, modifier: Modifier = Modifier) {
    val (title, message) = when (state.reason) {
        SessionEndReason.EXPIRED -> Res.string.openverify_session_expired_title to Res.string.openverify_session_expired_message
        SessionEndReason.CANCELED -> Res.string.openverify_session_canceled_title to Res.string.openverify_session_canceled_message
    }
    StatusLayout(title = sdkString(title), message = sdkString(message), modifier = modifier) {
        Button(onClick = onClose, modifier = Modifier.fillMaxWidth()) { Text(sdkString(Res.string.openverify_close)) }
    }
}

/** The inquiry was redacted (410): its data is gone, so the flow cannot continue. */
@Composable
internal fun RedactedScreen(onClose: () -> Unit, modifier: Modifier = Modifier) {
    StatusLayout(
        title = sdkString(Res.string.openverify_redacted_title),
        message = sdkString(Res.string.openverify_redacted_message),
        modifier = modifier,
    ) {
        Button(onClick = onClose, modifier = Modifier.fillMaxWidth()) { Text(sdkString(Res.string.openverify_close)) }
    }
}

/** The one-time link was refused: already used, expired, revoked or unknown. */
@Composable
internal fun LinkRefusedScreen(onClose: () -> Unit, modifier: Modifier = Modifier) {
    StatusLayout(
        title = sdkString(Res.string.openverify_link_refused_title),
        message = sdkString(Res.string.openverify_link_refused_message),
        modifier = modifier,
    ) {
        Button(onClick = onClose, modifier = Modifier.fillMaxWidth()) { Text(sdkString(Res.string.openverify_close)) }
    }
}

/**
 * Shown above every screen of a sandbox session (C19), so testers never mistake it for a real
 * verification. It is read once with the screen, not announced as an alert.
 */
@Composable
internal fun SandboxBanner(modifier: Modifier = Modifier) {
    val label = sdkString(Res.string.openverify_sandbox_label)
    val message = sdkString(Res.string.openverify_sandbox_message)
    Surface(
        color = SANDBOX_BACKGROUND,
        contentColor = SANDBOX_TEXT,
        modifier = modifier
            .fillMaxWidth()
            .testTag(TestTags.SANDBOX_BANNER)
            .semantics(mergeDescendants = true) {},
    ) {
        Text(
            text = "$label. $message",
            style = MaterialTheme.typography.bodyMedium,
            modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp),
        )
    }
}

/** Amber, as in the web flow's banner, with text that keeps a 4.5:1 contrast in both themes. */
private val SANDBOX_BACKGROUND = Color(0xFFFFF7D6)
private val SANDBOX_TEXT = Color(0xFF6B4100)

@Composable
internal fun ErrorScreen(state: FlowState.Error, onRetry: () -> Unit, onClose: () -> Unit, modifier: Modifier = Modifier) {
    StatusLayout(
        title = sdkString(Res.string.openverify_error_title),
        message = sdkString(errorMessage(state.error)),
        modifier = modifier,
    ) {
        if (state.canRetry) {
            Button(onClick = onRetry, modifier = Modifier.fillMaxWidth()) { Text(sdkString(Res.string.openverify_try_again)) }
        }
        OutlinedButton(onClick = onClose, modifier = Modifier.fillMaxWidth()) { Text(sdkString(Res.string.openverify_close)) }
    }
}

/**
 * The flow needs something this SDK cannot render (C194.1). [reason] is [FlowState.Unsupported]'s,
 * for diagnostics only and never shown; for a server older than flow-spec 2 (C193.2) the screen
 * says that the service is older than the app.
 */
@Composable
internal fun UnsupportedScreen(onClose: () -> Unit, modifier: Modifier = Modifier, reason: String? = null) {
    val message = if (reason == ServerPosition.SERVER_BEFORE_SPEC_2) {
        Res.string.openverify_unsupported_server_message
    } else {
        Res.string.openverify_unsupported_message
    }
    StatusLayout(
        title = sdkString(Res.string.openverify_unsupported_title),
        message = sdkString(message),
        modifier = modifier,
    ) {
        Button(onClick = onClose, modifier = Modifier.fillMaxWidth()) { Text(sdkString(Res.string.openverify_close)) }
    }
}

/** A centred title, message and buttons; the shared layout of every non-capture screen. */
@Composable
internal fun StatusLayout(
    title: String?,
    message: String?,
    modifier: Modifier = Modifier,
    showProgress: Boolean = false,
    actions: @Composable ColumnScope.() -> Unit = {},
) {
    Column(
        modifier = modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(24.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp, Alignment.CenterVertically),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        if (showProgress) {
            // C212.2: the words beside it say what is happening; the spinner itself is not read, so
            // the heading is the first thing a screen reader meets.
            CircularProgressIndicator(modifier = Modifier.testTag(TestTags.PROGRESS).clearAndSetSemantics { })
        }
        if (title != null) {
            Text(
                text = title,
                style = MaterialTheme.typography.headlineSmall,
                textAlign = TextAlign.Center,
                modifier = Modifier.semantics { heading() },
            )
        }
        if (message != null) {
            // A screen with no title (loading) has its message as its heading.
            Text(
                text = message,
                style = MaterialTheme.typography.bodyLarge,
                textAlign = TextAlign.Center,
                modifier = if (title == null) Modifier.semantics { heading() } else Modifier,
            )
        }
        actions()
    }
}

/**
 * C150.5, C197.1: the server is deciding (a wait on facts, a workflow). A neutral "one moment" with a
 * progress indicator; the message is a polite live region, so it is announced once, and it names no
 * step, reason or count: the wait may be a signal snapshot or a workflow, which the person must not
 * learn (Phase 9 C150.11). Back, or the cancel button, leaves the flow resumable. The screen stays on
 * while it is shown (C201.5).
 */
@Composable
internal fun WaitingScreen(state: FlowState.Waiting, onCancel: () -> Unit, modifier: Modifier = Modifier) {
    // C201.5 (KP10-13): the wait may last as long as the server decides; the device must not sleep under it.
    KeepScreenOn()
    val message = sdkString(Res.string.openverify_waiting_message)
    Column(
        modifier = modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(24.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp, Alignment.CenterVertically),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        CircularProgressIndicator(modifier = Modifier.testTag(TestTags.PROGRESS).clearAndSetSemantics { })
        Text(
            text = sdkString(Res.string.openverify_waiting_title),
            style = MaterialTheme.typography.headlineSmall,
            textAlign = TextAlign.Center,
            modifier = Modifier.semantics { heading() },
        )
        Text(
            text = message,
            style = MaterialTheme.typography.bodyLarge,
            textAlign = TextAlign.Center,
            modifier = Modifier.testTag(TestTags.WAITING_MESSAGE).semantics { liveRegion = LiveRegionMode.Polite },
        )
        OutlinedButton(onClick = onCancel, modifier = Modifier.fillMaxWidth()) { Text(sdkString(Res.string.openverify_cancel)) }
    }
}

/**
 * C151.2, C197.2: the server stopped the flow at its loop limits; it cannot continue on this device,
 * and the organization can resume it. Closing ends `Failed(FLOW_HALTED)`.
 */
@Composable
internal fun HaltedScreen(onClose: () -> Unit, modifier: Modifier = Modifier) {
    StatusLayout(
        title = sdkString(Res.string.openverify_halted_title),
        message = sdkString(Res.string.openverify_halted_message),
        modifier = modifier,
    ) {
        Button(onClick = onClose, modifier = Modifier.fillMaxWidth()) { Text(sdkString(Res.string.openverify_close)) }
    }
}
