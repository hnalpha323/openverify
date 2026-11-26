package dev.openverify.sdk.ui.steps

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import dev.openverify.sdk.generated.resources.*
import dev.openverify.sdk.i18n.sdkString
import dev.openverify.sdk.model.RetryHint
import dev.openverify.sdk.ui.TestTags
import dev.openverify.sdk.ui.retryMessages
import dev.openverify.sdk.ui.text.Text
import kotlin.time.Clock
import kotlin.time.Duration.Companion.seconds
import kotlin.time.Instant
import kotlinx.coroutines.delay

// The parts the Phase 5 screens share (C64.2): the layout, the previous attempt's hints, a refusal,
// a request on its way, a selector, and a clock that ticks while a countdown runs.

/** A step's screen: a scrolling column under the step's title, its heading. */
@Composable
internal fun StepLayout(title: String, modifier: Modifier = Modifier, content: @Composable ColumnScope.() -> Unit) {
    Column(
        modifier = modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(24.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        Text(
            text = title,
            style = MaterialTheme.typography.headlineSmall,
            modifier = Modifier.semantics { heading() },
        )
        content()
    }
}

@Composable
internal fun Paragraph(text: String) {
    Text(text = text, style = MaterialTheme.typography.bodyLarge)
}

/** Why the previous attempt failed (its retry hints, C29.4), above what the user enters again. */
@Composable
internal fun AttemptHints(hints: List<RetryHint>) {
    if (hints.isEmpty()) return
    Card(
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.errorContainer),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Column(modifier = Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text(text = sdkString(Res.string.openverify_retry_title_attempt), style = MaterialTheme.typography.titleSmall)
            retryMessages(hints).forEach { message ->
                Text(text = sdkString(message), style = MaterialTheme.typography.bodyMedium)
            }
        }
    }
}

/** A refusal or a problem the user can act on, read out as soon as it appears. */
@Composable
internal fun ErrorMessage(text: String) {
    Text(
        text = text,
        color = MaterialTheme.colorScheme.error,
        style = MaterialTheme.typography.bodyMedium,
        modifier = Modifier.testTag(TestTags.ERROR_MESSAGE).semantics { liveRegion = LiveRegionMode.Polite },
    )
}

/** A request on its way. */
@Composable
internal fun BusyRow(text: String) {
    Row(
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        modifier = Modifier.testTag(TestTags.BUSY).semantics(mergeDescendants = true) { liveRegion = LiveRegionMode.Polite },
    ) {
        CircularProgressIndicator(modifier = Modifier.size(20.dp), strokeWidth = 2.dp)
        Text(text = text, style = MaterialTheme.typography.bodyMedium)
    }
}

/**
 * A choice among [options] (each a value and its words): a button showing the [selected] one, or
 * "Choose", that opens a menu. Each option is tagged [TestTags.option] with its value.
 */
@Composable
internal fun Selector(
    label: String,
    selected: String?,
    options: List<Pair<String, String>>,
    onSelect: (String) -> Unit,
    enabled: Boolean,
    tag: String,
    supporting: (@Composable () -> Unit)? = null,
) {
    var open by remember { mutableStateOf(false) }
    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Text(text = label, style = MaterialTheme.typography.labelLarge)
        Box {
            OutlinedButton(onClick = { open = true }, enabled = enabled, modifier = Modifier.fillMaxWidth().testTag(tag)) {
                Text(options.firstOrNull { it.first == selected }?.second ?: sdkString(Res.string.openverify_field_choose))
            }
            DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
                options.forEach { (value, words) ->
                    DropdownMenuItem(
                        text = { Text(words) },
                        onClick = {
                            onSelect(value)
                            open = false
                        },
                        modifier = Modifier.testTag(TestTags.option(value)),
                    )
                }
            }
        }
        supporting?.invoke()
    }
}

/**
 * The time now on [clock], read again each second until the last of [targets] has passed, so a
 * countdown to them moves. It ticks at most as many times as there were seconds left, so a clock
 * that does not move (a test's) never keeps it running.
 */
@Composable
internal fun rememberNow(clock: Clock, vararg targets: Instant?): Instant {
    val start = remember(clock, *targets) { clock.now() }
    val now by produceState(start, clock, *targets) {
        val ticks = targets.maxOfOrNull { secondsUntil(start, it) } ?: 0
        repeat(ticks.toInt()) {
            delay(1.seconds)
            value = clock.now()
        }
    }
    return now
}
