package dev.openverify.sdk.capture.selfie

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import dev.openverify.sdk.api.FlowApi
import dev.openverify.sdk.api.FlowApiException
import dev.openverify.sdk.flow.FlowProblemCodes
import dev.openverify.sdk.flow.SelfieCaptureProtocol
import dev.openverify.sdk.generated.resources.Res
import dev.openverify.sdk.generated.resources.openverify_selfie_extend_already_sent
import dev.openverify.sdk.generated.resources.openverify_selfie_extend_extended
import dev.openverify.sdk.generated.resources.openverify_selfie_extend_failed
import dev.openverify.sdk.generated.resources.openverify_selfie_extend_more_time
import dev.openverify.sdk.generated.resources.openverify_selfie_extend_warning
import dev.openverify.sdk.i18n.sdkPlural
import dev.openverify.sdk.i18n.sdkPluralText
import dev.openverify.sdk.i18n.sdkString
import dev.openverify.sdk.log.SdkLog
import dev.openverify.sdk.model.SelfieCaptureGuidance
import dev.openverify.sdk.model.VerificationStatus
import dev.openverify.sdk.model.VerificationType
import dev.openverify.sdk.ui.text.Text
import kotlin.coroutines.cancellation.CancellationException
import kotlinx.coroutines.delay
import kotlin.time.ComparableTimeMark
import kotlin.time.Duration
import kotlin.time.Duration.Companion.seconds

/*
 * C204.5 (Phase 9 C171.4, WCAG 2.2.1): more time on a selfie capture. The coordinator exposes the open
 * capture's id and expiry ([SelfieCaptureWindow], `FlowCoordinator.selfieCapture`) and, when asked,
 * calls [extendCapture] with its API and adopts the window it answers, outcome included; the capture screen's dispatch
 * shows [SelfieCaptureExtension] over a selfie's capture screen (foundation-10b's hooks). This file is
 * `selfie-guidance`'s, which builds the warning and the call.
 */

/**
 * The open selfie capture as the coordinator exposes it: its id (`self_` plus a ULID) and the moment it
 * expires on this device's monotonic clock (its creation plus `CAPTURE_TTL`, moved by each extension),
 * the server's pose thresholds for the guidance (C40.2 `guidance`), `null` while the coordinator does
 * not pass them (the guidance then leaves the selfie to the shutter, C204.6), and what became of the
 * person's last request for more time on it ([extension]; `null` when none was asked).
 */
internal data class SelfieCaptureWindow(
    val id: String,
    val expiresAt: ComparableTimeMark,
    val guidance: SelfieCaptureGuidance? = null,
    val extension: SelfieExtensionOutcome? = null,
)

/** WCAG 2.2.1's "at least 20 seconds": how long before the capture's limit the person is warned (C204.5). */
internal val CAPTURE_WARNING: Duration = 20.seconds

/** What became of the person's last request for more time, for the warning to say. */
internal enum class SelfieExtensionOutcome {
    /** Asked; no answer yet. */
    EXTENDING,

    /** The server moved the capture's expiry. */
    EXTENDED,

    /** Refused while the capture is still open (its limit, or its end), or the call failed. */
    FAILED,

    /** Refused because the photos were already submitted (C193.5: read from the session). */
    ALREADY_SENT,
}

/** Test tags of the time-limit warning. */
internal object SelfieExtensionTags {
    const val WARNING: String = "openverify_selfie_extend_warning"
    const val MORE_TIME: String = "openverify_selfie_extend_more_time"
    const val STATUS: String = "openverify_selfie_extend_status"
}

/**
 * Asks the server for more time on [window]'s capture (`FlowApi.extendSelfieCapture`) and answers the
 * window the capture now has, with the outcome in its [SelfieCaptureWindow.extension]: moved and
 * [SelfieExtensionOutcome.EXTENDED], or as it was and [SelfieExtensionOutcome.FAILED] or
 * [SelfieExtensionOutcome.ALREADY_SENT]. The outcome travels with the window alone (KP10-25): nothing
 * outside the launch's coordinator keeps it.
 *
 * The server moves the capture's `expires-at` by its lifetime on each extension (C171.4), so the window
 * moves by [SelfieCaptureProtocol.CAPTURE_TTL] on this device's clock, and the two clocks never need to
 * agree. The call is a single-use POST (C193.5): the SDK never sends it again by itself. A 409
 * `selfie_capture_not_extendable` is answered by reading the session: when the selfie was already
 * submitted, the photos were already sent; otherwise (the capture's last extension, or its end) more time
 * could not be added, and the capture keeps its expiry, after which the next pose starts a new capture.
 * Nothing about the call is logged but a constant code.
 */
internal suspend fun extendCapture(api: FlowApi, window: SelfieCaptureWindow): SelfieCaptureWindow {
    val outcome = try {
        val extended = api.extendSelfieCapture(window.id)
        if (extended.id == window.id) {
            return window.copy(expiresAt = window.expiresAt + SelfieCaptureProtocol.CAPTURE_TTL, extension = SelfieExtensionOutcome.EXTENDED)
        }
        SelfieExtensionOutcome.FAILED
    } catch (cancelled: CancellationException) {
        throw cancelled
    } catch (conflict: FlowApiException.Conflict) {
        if (conflict.problem?.code == FlowProblemCodes.SELFIE_CAPTURE_NOT_EXTENDABLE && alreadySent(api)) {
            SelfieExtensionOutcome.ALREADY_SENT
        } else {
            SelfieExtensionOutcome.FAILED
        }
    } catch (_: Exception) {
        SdkLog.log("selfie.extension_failed")
        SelfieExtensionOutcome.FAILED
    }
    return window.copy(extension = outcome)
}

/** C193.5: whether the session says the selfie was already submitted (its latest selfie verification has left `initiated`). */
private suspend fun alreadySent(api: FlowApi): Boolean {
    val session = try {
        api.getSession()
    } catch (cancelled: CancellationException) {
        throw cancelled
    } catch (_: Exception) {
        return false
    }
    val selfie = session.verifications.lastOrNull { it.verificationType == VerificationType.SELFIE } ?: return false
    return selfie.attributes.status != VerificationStatus.INITIATED
}

/**
 * Over a selfie's capture screen (C204.5, WCAG 2.2.1): [CAPTURE_WARNING] before [window] ends, a polite
 * live region says how long is left, once (the count does not tick down, so it is not announced every
 * second), and offers more time, which calls [onExtend]; then it says what became of the request: more
 * time given, not given, or not needed because the photos were already sent. `null` while no capture is
 * open. The device's clock is read once a second.
 */
@Composable
internal fun SelfieCaptureExtension(window: SelfieCaptureWindow?, onExtend: () -> Unit, modifier: Modifier = Modifier) {
    if (window == null) return
    var left by remember(window) { mutableStateOf(-window.expiresAt.elapsedNow()) }
    // The seconds said when the warning first shows, kept while it stays (C212.2: said once).
    var said by remember(window.id) { mutableStateOf<Int?>(null) }
    LaunchedEffect(window) {
        while (true) {
            left = -window.expiresAt.elapsedNow()
            said = if (left > Duration.ZERO && left <= CAPTURE_WARNING) said ?: ceilSeconds(left) else null
            delay(CLOCK_READ)
        }
    }
    val outcome = window.extension
    val warning = left > Duration.ZERO && left <= CAPTURE_WARNING
    val status = when (outcome) {
        SelfieExtensionOutcome.EXTENDED -> if (warning) null else Res.string.openverify_selfie_extend_extended
        SelfieExtensionOutcome.FAILED -> Res.string.openverify_selfie_extend_failed
        SelfieExtensionOutcome.ALREADY_SENT -> Res.string.openverify_selfie_extend_already_sent
        SelfieExtensionOutcome.EXTENDING, null -> null
    }
    if (!warning && status == null) return
    if (left <= Duration.ZERO && outcome != SelfieExtensionOutcome.ALREADY_SENT) return
    Box(modifier = modifier.fillMaxSize().padding(16.dp), contentAlignment = Alignment.TopCenter) {
        Surface(
            shape = RoundedCornerShape(12.dp),
            color = MaterialTheme.colorScheme.surface,
            shadowElevation = 4.dp,
            modifier = Modifier.fillMaxWidth(),
        ) {
            Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                val count = said
                if (warning && count != null && outcome != SelfieExtensionOutcome.ALREADY_SENT) {
                    val text = sdkPlural(Res.plurals.openverify_selfie_extend_warning, count, count)
                    Text(
                        // C199.5: the number isolated where it is displayed; the spoken text is the logical one.
                        text = sdkPluralText(Res.plurals.openverify_selfie_extend_warning, count, count),
                        style = MaterialTheme.typography.bodyLarge,
                        modifier = Modifier
                            .testTag(SelfieExtensionTags.WARNING)
                            .semantics {
                                contentDescription = text
                                liveRegion = LiveRegionMode.Polite
                            },
                    )
                }
                if (status != null) {
                    val text = sdkString(status)
                    Text(
                        text = text,
                        style = MaterialTheme.typography.bodyMedium,
                        color = if (outcome == SelfieExtensionOutcome.FAILED) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurface,
                        modifier = Modifier
                            .testTag(SelfieExtensionTags.STATUS)
                            .semantics {
                                contentDescription = text
                                liveRegion = LiveRegionMode.Polite
                            },
                    )
                }
                if (warning && outcome != SelfieExtensionOutcome.ALREADY_SENT) {
                    Button(
                        onClick = onExtend,
                        enabled = outcome != SelfieExtensionOutcome.EXTENDING,
                        modifier = Modifier.fillMaxWidth().testTag(SelfieExtensionTags.MORE_TIME),
                    ) {
                        Text(sdkString(Res.string.openverify_selfie_extend_more_time))
                    }
                }
            }
        }
    }
}

/** How often the warning reads the device's clock. */
private val CLOCK_READ: Duration = 1.seconds

/** [left] in whole seconds, rounded up, as the web's `Math.ceil(left / 1000)`. */
private fun ceilSeconds(left: Duration): Int = ((left.inWholeMilliseconds + 999) / 1_000).toInt()
