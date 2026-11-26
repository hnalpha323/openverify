package dev.openverify.sdk.capture.document

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import dev.openverify.sdk.camera.AnalysisFrame
import dev.openverify.sdk.capture.AutoCapture
import dev.openverify.sdk.capture.CaptureGuidance
import dev.openverify.sdk.capture.CaptureGuidanceFactory
import dev.openverify.sdk.capture.document.DocumentCaptureConstants as C
import dev.openverify.sdk.flow.FlowState
import dev.openverify.sdk.generated.resources.Res
import dev.openverify.sdk.generated.resources.openverify_document_guidance_auto
import dev.openverify.sdk.generated.resources.openverify_document_guidance_fit_card
import dev.openverify.sdk.generated.resources.openverify_document_guidance_fit_page
import dev.openverify.sdk.generated.resources.openverify_document_guidance_hold_still
import dev.openverify.sdk.generated.resources.openverify_document_guidance_more_light
import dev.openverify.sdk.generated.resources.openverify_document_guidance_move_closer
import dev.openverify.sdk.generated.resources.openverify_document_guidance_show_mrz
import dev.openverify.sdk.generated.resources.openverify_document_guidance_tilt_away
import dev.openverify.sdk.i18n.sdkString
import dev.openverify.sdk.model.FileKind
import dev.openverify.sdk.model.GovernmentIdStep
import dev.openverify.sdk.ui.text.Text
import kotlin.time.ComparableTimeMark
import kotlin.time.TimeSource
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.collect
import kotlinx.coroutines.flow.transformWhile
import kotlinx.coroutines.launch
import org.jetbrains.compose.resources.StringResource

/**
 * C202.3, C202.4 (decision 19): an ID side's capture guidance, through the capture screen's slots
 * (`capture/CaptureSlots.kt`).
 *
 * Each analysis frame is measured ([DocumentFrameAnalyzer]) inside its callback; the first hint in
 * the fixed order ([DocumentHints]) becomes the shown [hint] once it has held for `hold-ms`, so it
 * is announced once per change and never at the frame rate (C212.2). When every gate has held for
 * `hold-ms`, the still is taken through [AutoCapture] (the `ImageCapture` photo, uploaded with the
 * client-reported trigger `auto`, C206.2) and the guidance ends. The shutter is always on screen
 * and becomes the primary action ([shutterPrimary]) after `manual-shutter-after-ms`, at once when
 * the camera gives no frames (C201.3), and after a failed auto-capture, which is not tried again.
 * Time comes from [timeSource].
 *
 * Guidance only (ADR 0009, C202.5, C202.6): nothing measured here is sent, logged or kept past its
 * frame; the server re-measures every upload, and a photo taken here can still fail there.
 */
internal class DocumentGuidance(
    private val passport: Boolean,
    private val aspect: Double,
    private val timeSource: TimeSource.WithComparableMarks = TimeSource.Monotonic,
    private val measure: (AnalysisFrame, Double, DocumentMeasurement) -> DocumentMeasurement = DocumentFrameAnalyzer()::measure,
) : CaptureGuidance {
    private val shown = MutableStateFlow<DocumentHint?>(null)
    private val primary = MutableStateFlow(false)
    private val measurement = DocumentMeasurement()

    /** The hint shown now, null when none is. */
    val hint: StateFlow<DocumentHint?> = shown.asStateFlow()

    override val shutterPrimary: StateFlow<Boolean> = primary.asStateFlow()

    override suspend fun run(frames: Flow<AnalysisFrame>, autoCapture: AutoCapture) {
        coroutineScope {
            val promotion = launch {
                delay(C.MANUAL_SHUTTER_AFTER)
                primary.value = true
            }
            var autoAllowed = true
            var taken = false
            var holdingSince: ComparableTimeMark? = null
            var candidate: DocumentHint? = null
            var candidateSince: ComparableTimeMark? = null
            frames.transformWhile<AnalysisFrame, Unit> { frame ->
                val raw = DocumentHints.hintOf(measure(frame, aspect, measurement), passport)
                val now = timeSource.markNow()
                if (raw == shown.value) {
                    candidate = raw
                    candidateSince = null
                } else {
                    val since = candidateSince
                    if (raw != candidate || since == null) {
                        candidate = raw
                        candidateSince = now
                    } else if (now - since >= C.HOLD) {
                        shown.value = raw
                    }
                }
                if (raw == null && autoAllowed) {
                    val since = holdingSince ?: now.also { holdingSince = it }
                    if (now - since >= C.HOLD) {
                        taken = autoCapture.takeStill()
                        if (!taken) {
                            autoAllowed = false
                            holdingSince = null
                            primary.value = true
                        }
                    }
                } else {
                    holdingSince = null
                }
                !taken
            }.collect()
            promotion.cancel()
            if (!taken) primary.value = true
        }
    }

    @Composable
    override fun Overlay(modifier: Modifier) {
        val current by hint.collectAsState()
        DocumentGuidanceOverlay(current, passport, modifier)
    }

    override fun close() {
        shown.value = null
    }
}

/** Test tags of the document guidance's overlay. */
internal object DocumentGuidanceTags {
    const val HINT: String = "openverify:document-guidance-hint"
    const val NOTE: String = "openverify:document-guidance-note"
}

/** The words of [hint]: the frame hint names the page on a passport page, else the card. */
internal fun documentHintText(hint: DocumentHint, passport: Boolean): StringResource = when (hint) {
    DocumentHint.MOVE_CLOSER -> Res.string.openverify_document_guidance_move_closer
    DocumentHint.HOLD_STILL -> Res.string.openverify_document_guidance_hold_still
    DocumentHint.TILT_AWAY -> Res.string.openverify_document_guidance_tilt_away
    DocumentHint.MORE_LIGHT -> Res.string.openverify_document_guidance_more_light
    DocumentHint.FIT_CARD -> if (passport) Res.string.openverify_document_guidance_fit_page else Res.string.openverify_document_guidance_fit_card
    DocumentHint.SHOW_MRZ -> Res.string.openverify_document_guidance_show_mrz
}

/**
 * Drawn over the preview (C202.3): the note that the photo is taken by itself and the shutter still
 * works, and the shown hint in a polite live region that stays in place, so a screen reader hears
 * each change once.
 */
@Composable
internal fun DocumentGuidanceOverlay(hint: DocumentHint?, passport: Boolean, modifier: Modifier = Modifier) {
    Box(modifier = modifier.fillMaxSize().padding(12.dp)) {
        Column(
            modifier = Modifier.align(Alignment.BottomCenter),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Surface(
                shape = RoundedCornerShape(12.dp),
                color = MaterialTheme.colorScheme.inverseSurface.copy(alpha = if (hint == null) 0f else 0.92f),
                contentColor = MaterialTheme.colorScheme.inverseOnSurface,
            ) {
                Text(
                    text = if (hint == null) "" else sdkString(documentHintText(hint, passport)),
                    style = MaterialTheme.typography.titleMedium,
                    textAlign = TextAlign.Center,
                    modifier = Modifier
                        .padding(horizontal = 16.dp, vertical = 8.dp)
                        .testTag(DocumentGuidanceTags.HINT)
                        .semantics { liveRegion = LiveRegionMode.Polite },
                )
            }
            Surface(
                shape = RoundedCornerShape(8.dp),
                color = MaterialTheme.colorScheme.inverseSurface.copy(alpha = 0.8f),
                contentColor = MaterialTheme.colorScheme.inverseOnSurface,
            ) {
                Text(
                    text = sdkString(Res.string.openverify_document_guidance_auto),
                    style = MaterialTheme.typography.bodySmall,
                    textAlign = TextAlign.Center,
                    modifier = Modifier.padding(horizontal = 12.dp, vertical = 6.dp).testTag(DocumentGuidanceTags.NOTE),
                )
            }
        }
    }
}

/**
 * C202: the document owner's [CaptureGuidanceFactory]: an ID side's guidance while its preview is
 * shown, null for anything else (a selfie is the selfie owner's; a supporting document's page keeps
 * today's manual shutter, since the calibration covers ID renders only).
 */
internal class DocumentGuidanceFactory(
    private val timeSource: TimeSource.WithComparableMarks = TimeSource.Monotonic,
) : CaptureGuidanceFactory {
    override fun create(state: FlowState.Capture): CaptureGuidance? {
        if (state.step !is GovernmentIdStep || state.image != null) return null
        if (state.kind != FileKind.FRONT && state.kind != FileKind.BACK) return null
        return DocumentGuidance(DocumentGuide.isPassportPage(state), DocumentGuide.aspectOf(state), timeSource)
    }
}
