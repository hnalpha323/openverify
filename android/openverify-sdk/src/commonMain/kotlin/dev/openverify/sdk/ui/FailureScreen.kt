package dev.openverify.sdk.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import dev.openverify.sdk.flow.FlowState
import dev.openverify.sdk.generated.resources.*
import dev.openverify.sdk.i18n.isolated
import dev.openverify.sdk.i18n.sdkString
import dev.openverify.sdk.log.SdkLog
import dev.openverify.sdk.model.FlowContestRoute
import dev.openverify.sdk.ui.screen.LocalScreenEnvironment
import dev.openverify.sdk.ui.screen.ScreenTags
import dev.openverify.sdk.ui.screen.isHttpsLink
import dev.openverify.sdk.ui.text.Text

/**
 * C197.3: the failed inquiry. A `failure` step shows its message ([FlowState.Failed.step]'s key); an
 * inquiry failed without one shows the general failure message, as before Phase 10. When the server
 * sends the decision's contest route (C128.7, C150.7; [LocalScreenEnvironment]'s `contestRoute`), the
 * screen also says how to ask for a review: the operator's `https:` link, opened in the system
 * browser and introduced by its host, and the contact. The words around the route are the web
 * catalogs' (`contest.*`, decision texts the key map carries, never drafted here); the host and the
 * contact are isolated so they keep their own order inside Arabic text (C199.5). Nothing on this
 * screen implies an outcome other than the one the server recorded (C197.5).
 */
@Composable
internal fun FailureScreen(state: FlowState.Failed, onDone: () -> Unit, modifier: Modifier = Modifier) {
    val route = LocalScreenEnvironment.current.contestRoute
    StatusLayout(
        title = sdkString(Res.string.openverify_failure_title),
        message = sdkString(failureMessage(state.step?.messageKey)),
        modifier = modifier,
    ) {
        if (route != null) ContestRoute(route)
        Button(onClick = onDone, modifier = Modifier.fillMaxWidth()) { Text(sdkString(Res.string.openverify_close)) }
    }
}

/** C128.7: the contest route; a link that is not `https:` is not offered (and logged as a PII-free code). */
@Composable
internal fun ContestRoute(route: FlowContestRoute, modifier: Modifier = Modifier) {
    val link = route.url?.takeIf(::isHttpsLink)
    if (route.url != null && link == null) LaunchedEffect(route.url) { SdkLog.log("failure.contest_link_refused") }
    if (link == null && route.contact == null) return
    val uriHandler = LocalUriHandler.current
    Column(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(
            text = sdkString(Res.string.openverify_contest_heading),
            style = MaterialTheme.typography.titleMedium,
            modifier = Modifier.semantics { heading() },
        )
        Text(sdkString(Res.string.openverify_contest_intro), style = MaterialTheme.typography.bodyLarge)
        if (link != null) {
            route.host?.let { host ->
                Text(filledByName(sdkString(Res.string.openverify_contest_host), "host", isolated(host)), style = MaterialTheme.typography.bodyMedium)
            }
            OutlinedButton(onClick = { uriHandler.openUri(link) }, modifier = Modifier.fillMaxWidth().testTag(ScreenTags.CONTEST_LINK)) {
                Text(sdkString(Res.string.openverify_contest_link))
            }
        }
        route.contact?.let { contact ->
            Text(
                text = filledByName(sdkString(Res.string.openverify_contest_contact), "contact", isolated(contact)),
                style = MaterialTheme.typography.bodyMedium,
                modifier = Modifier.testTag(ScreenTags.CONTEST_CONTACT),
            )
        }
    }
}

/** The web catalogs' `{{name}}` placeholder of [text] filled with [value] in one pass; nothing else is read as syntax. */
internal fun filledByName(text: String, name: String, value: String): String = text.replace("{{$name}}", value)
