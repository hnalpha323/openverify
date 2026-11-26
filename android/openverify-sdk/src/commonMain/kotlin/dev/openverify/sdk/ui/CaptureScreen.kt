package dev.openverify.sdk.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.TextButton
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.ui.layout.Layout
import androidx.compose.ui.unit.Constraints
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.BlendMode
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.CompositingStrategy
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.SemanticsPropertyKey
import androidx.compose.ui.semantics.SemanticsPropertyReceiver
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import dev.openverify.sdk.capture.document.DocumentGuide
import dev.openverify.sdk.camera.AnalysisTarget
import dev.openverify.sdk.camera.CameraFacts
import dev.openverify.sdk.camera.CaptureCamera
import dev.openverify.sdk.camera.CapturedImage
import dev.openverify.sdk.camera.captureTriggerOf
import dev.openverify.sdk.camera.takePictureOrNull
import dev.openverify.sdk.capture.CaptureGuidance
import dev.openverify.sdk.capture.CaptureGuidanceFactory
import dev.openverify.sdk.capture.barcode.BarcodeGuidanceFactory
import dev.openverify.sdk.capture.barcode.isBarcodeBearing
import dev.openverify.sdk.capture.document.DocumentGuidanceFactory
import dev.openverify.sdk.capture.screenAutoCapture
import dev.openverify.sdk.flow.FlowState
import dev.openverify.sdk.flow.SelfieCaptureProtocol
import dev.openverify.sdk.generated.resources.*
import dev.openverify.sdk.i18n.sdkPluralText
import dev.openverify.sdk.i18n.sdkString
import dev.openverify.sdk.i18n.sdkText
import dev.openverify.sdk.model.CaptureTrigger
import dev.openverify.sdk.model.FileKind
import dev.openverify.sdk.model.RetryHint
import dev.openverify.sdk.ui.screen.submitProtection
import dev.openverify.sdk.ui.text.Text
import kotlin.math.min
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/** ID-1 card proportions (85.60 mm x 53.98 mm), the shape of most ID cards and licences. */
private const val ID_CARD_ASPECT = 85.60f / 53.98f

/** A portrait A4 page (210 mm x 297 mm), the shape of most bills and statements. */
private const val PAGE_ASPECT = 210f / 297f

/** Width-to-height ratio of the selfie oval. */
private const val FACE_OVAL_ASPECT = 0.78f

/**
 * Document and selfie capture. With no photo yet it shows the live preview under a guide (a
 * card frame for documents, an oval for selfies) and a shutter button; with a photo it shows
 * the photo for review with Retake and Use this photo. When the capture allows it (a sandbox,
 * C19) and a [photoPicker] is given, the user can also pick a photo instead.
 *
 * Camera photos go to [onCaptured] with what the camera reported about itself (C40.4) and their
 * client-reported trigger (C206.2), picked ones to [onPicked]. Each title is a live region, so a screen reader announces each selfie
 * prompt. A selfie keeps one camera session for all its prompts (C40.11), under the photo being
 * reviewed or sent; while a pose is sent (C40.3) nothing can be pressed. Each selfie prompt says
 * how many minutes the capture lasts and that the photos start again after that (4B H015).
 *
 * A failed capture, whatever the camera threw (1B F025), says so and lets the user try again.
 */
@Composable
internal fun CaptureScreen(
    state: FlowState.Capture,
    camera: CaptureCamera,
    onCaptured: (CapturedImage, CameraFacts?, CaptureTrigger?) -> Unit,
    onPicked: (CapturedImage) -> Unit,
    onRetake: () -> Unit,
    onConfirm: () -> Unit,
    onCancel: () -> Unit,
    modifier: Modifier = Modifier,
    photoPicker: PhotoPicker? = null,
    /** A document's camera (C64.2) goes back to the document step's screen with it. */
    onBack: (() -> Unit)? = null,
    /** The capture guidance of each state (Workflow 10B's slots); null keeps today's manual shutter. */
    guidance: CaptureGuidanceFactory? = LocalCaptureGuidance.current,
) {
    // The coordinator captures only the ID sides and the selfie poses, which all have copy.
    val copy = captureCopy(state.kind) ?: return
    val scope = rememberCoroutineScope()
    var capturing by remember(state.step.id, state.kind) { mutableStateOf(false) }
    var captureFailed by remember(state.step.id, state.kind) { mutableStateOf(false) }
    var uploadFailed by remember(state.step.id, state.kind) { mutableStateOf(false) }
    val pickPhoto = if (state.uploadAllowed && photoPicker != null) {
        photoPicker.rememberLauncher { picked ->
            uploadFailed = picked == null
            if (picked != null) {
                captureFailed = false
                onPicked(picked)
            }
        }
    } else {
        null
    }
    val image = state.image
    // C206.2, C202.4, C204.3 (Workflow 10B, foundation-10b's hook): the shutter and the auto-capture take
    // the still through this one action, each with the trigger `camera/CaptureTrigger.kt` decides; false
    // when the camera could not take it.
    val still: suspend (CaptureTrigger?) -> Boolean = still@{ trigger ->
        // One still at a time: an auto-capture while the shutter's photo is being taken takes none.
        if (capturing) return@still false
        capturing = true
        captureFailed = false
        uploadFailed = false
        val taken = takeStill(camera, trigger, onCaptured)
        capturing = false
        if (!taken) captureFailed = true
        taken
    }

    // C202.4, C204.3: the auto-capture action (`capture/AutoCapture.kt`) the guidance takes the still
    // through, always the screen's current one.
    val currentStill by rememberUpdatedState(still)
    val autoCapture = remember { screenAutoCapture { trigger -> currentStill(trigger) } }

    // Workflow 10B's slots: the state's guidance reads the camera's analysis frames while the preview is
    // shown (C201), never over the review; it is closed when the state leaves. Its callbacks run on this
    // composition's dispatcher, each inside its frame's callback (C201.1).
    val active: CaptureGuidance? = remember(guidance, state.step.id, state.kind, state.index, image == null) {
        if (image == null) guidance?.create(state) else null
    }
    DisposableEffect(active) { onDispose { active?.close() } }
    LaunchedEffect(active) { active?.run(camera.frames(), autoCapture) }
    // C202.4: the shutter is always on screen; without a guidance it is the primary action, as today.
    val shutterPrimary = active?.shutterPrimary?.collectAsState()?.value ?: true

    // C201.5 (review H20): a screen timeout cannot lock the phone during a capture or its review.
    KeepScreenOn()

    // C212.2 (Workflow 10D): the heading is read first, then the photo's place in the step; and the
    // screen scrolls when its words need more room than the window has (a large font, a long
    // language), so no text is cut off and every control stays reachable. With room to spare the
    // preview takes it all, as before.
    CaptureFrame(
        modifier = modifier,
        above = {
            Text(
                text = sdkString(copy.title),
                style = MaterialTheme.typography.headlineSmall,
                modifier = Modifier.semantics {
                    heading()
                    liveRegion = LiveRegionMode.Polite
                },
            )
            Text(
                text = sdkText(Res.string.openverify_capture_progress, state.index + 1, state.count),
                style = MaterialTheme.typography.labelLarge,
            )
            if (image == null && state.restarted) {
                Text(
                    text = sdkString(Res.string.openverify_selfie_capture_restarted),
                    style = MaterialTheme.typography.bodyMedium,
                    modifier = Modifier.testTag(TestTags.CAPTURE_RESTARTED).semantics { liveRegion = LiveRegionMode.Polite },
                )
            }
            if (image == null && state.isSelfie) {
                // 4B H015: the capture's lifetime (C40.2) is a time limit, so the user is told of it.
                val minutes = SelfieCaptureProtocol.CAPTURE_TTL.inWholeMinutes.toInt()
                Text(
                    text = sdkPluralText(Res.plurals.openverify_selfie_time_limit, minutes, minutes),
                    style = MaterialTheme.typography.bodyMedium,
                )
            }
            if (image == null && state.retryHints.isNotEmpty()) {
                RetryHints(state.retryHints)
            }
        },
        preview = {
            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .clip(RoundedCornerShape(16.dp))
                    .background(Color.Black),
            ) {
                // C40.11 `camera-stays-open`: a selfie's camera stays bound under the photo being reviewed
                // or sent, so the next prompt does not reopen it; a document's closes for the review.
                if (image == null || (state.isSelfie && SelfieCaptureProtocol.CAMERA_STAYS_OPEN)) {
                    val previewDescription = sdkString(Res.string.openverify_capture_preview)
                    camera.Preview(
                        lens = state.lens,
                        // C201.2: the analysis size of the photo this screen takes (the barcode width only on
                        // the side the server marks barcode-bearing, KP10-21).
                        analysis = AnalysisTarget.of(state.kind, isBarcodeBearing(state)),
                        modifier = Modifier
                            .fillMaxSize()
                            .then(
                                if (image == null) {
                                    Modifier.testTag(TestTags.PREVIEW).semantics { contentDescription = previewDescription }
                                } else {
                                    // Hidden under the photo, and from screen readers.
                                    Modifier.clearAndSetSemantics { }
                                },
                            ),
                    )
                }
                if (image == null) {
                    CaptureGuide(
                        shape = when {
                            state.isSelfie -> GuideShape.OVAL
                            state.kind == FileKind.DOCUMENT -> GuideShape.PAGE
                            else -> GuideShape.CARD
                        },
                        aspect = captureGuideAspect(state),
                        modifier = Modifier.fillMaxSize(),
                    )
                } else {
                    ReviewPhoto(image, sdkString(copy.photo), Modifier.fillMaxSize().background(Color.Black))
                }
            }
        },
        overlay = {
            // The guidance's hint and overlay, over the guide (C202.3, C203.3, C204.3).
            if (image == null) active?.Overlay(Modifier.fillMaxSize())
        },
        below = {
            Text(
                text = sdkString(if (image == null) copy.instruction else Res.string.openverify_capture_check),
                style = MaterialTheme.typography.bodyLarge,
            )
            if (image == null && (captureFailed || uploadFailed)) {
                Text(
                    text = sdkString(
                        if (uploadFailed) Res.string.openverify_capture_upload_failed else Res.string.openverify_capture_failed,
                    ),
                    color = MaterialTheme.colorScheme.error,
                    style = MaterialTheme.typography.bodyMedium,
                    modifier = Modifier.testTag(TestTags.CAPTURE_PROBLEM).semantics { liveRegion = LiveRegionMode.Polite },
                )
            }
            if (image == null) {
                // C202.4: secondary while the guidance may still take the photo, primary once it says so;
                // C213.1: on API 26 to 30 it drops touches delivered through another app's overlay.
                val shutter = Modifier
                    .fillMaxWidth()
                    .testTag(TestTags.CAPTURE_SHUTTER)
                    .semantics { captureShutterPrimary = shutterPrimary }
                    .submitProtection()
                val takePhoto: () -> Unit = { scope.launch { still(captureTriggerOf(auto = false)) } }
                if (shutterPrimary) {
                    Button(onClick = takePhoto, enabled = !capturing, modifier = shutter) {
                        Text(sdkString(Res.string.openverify_capture_take))
                    }
                } else {
                    OutlinedButton(onClick = takePhoto, enabled = !capturing, modifier = shutter) {
                        Text(sdkString(Res.string.openverify_capture_take))
                    }
                }
                if (pickPhoto != null) {
                    OutlinedButton(onClick = pickPhoto, enabled = !capturing, modifier = Modifier.fillMaxWidth().submitProtection()) {
                        Text(sdkString(Res.string.openverify_capture_upload))
                    }
                }
                if (onBack != null) {
                    TextButton(onClick = onBack, enabled = !capturing, modifier = Modifier.fillMaxWidth()) {
                        Text(sdkString(Res.string.openverify_document_capture_back))
                    }
                }
                TextButton(onClick = onCancel, modifier = Modifier.fillMaxWidth()) {
                    Text(sdkString(Res.string.openverify_cancel))
                }
            } else {
                if (state.sending) {
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                        modifier = Modifier.testTag(TestTags.CAPTURE_SENDING).semantics(mergeDescendants = true) { liveRegion = LiveRegionMode.Polite },
                    ) {
                        CircularProgressIndicator(modifier = Modifier.size(20.dp), strokeWidth = 2.dp)
                        Text(text = sdkString(Res.string.openverify_capture_sending), style = MaterialTheme.typography.bodyMedium)
                    }
                }
                Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    OutlinedButton(onClick = onRetake, enabled = !state.sending, modifier = Modifier.weight(1f)) {
                        Text(sdkString(Res.string.openverify_capture_retake))
                    }
                    Button(onClick = onConfirm, enabled = !state.sending, modifier = Modifier.weight(1f).submitProtection()) {
                        Text(sdkString(Res.string.openverify_capture_use))
                    }
                }
            }
        },
    )
}

/** The least height of the preview at font scale 1.0, when its overlay asks for less (ours, provisional: a third of a 360 dp phone's width, enough to frame a card). */
private val PREVIEW_MIN_HEIGHT = 120.dp

/**
 * The capture screen's frame (C212.2): what is read [above] the preview, the [preview] with the
 * guidance's [overlay] drawn over it, and what comes [below], in one scrolling column. The preview
 * takes the height the window has left; it is never lower than [PREVIEW_MIN_HEIGHT] or than what the
 * overlay's words (the hint and the note) need at the current font size, and the column scrolls by
 * whatever that adds. Only the overlay is asked what it needs: the camera's own view is never
 * measured for a preferred size.
 */
@Composable
private fun CaptureFrame(
    modifier: Modifier,
    above: @Composable ColumnScope.() -> Unit,
    preview: @Composable () -> Unit,
    overlay: @Composable () -> Unit,
    below: @Composable ColumnScope.() -> Unit,
) {
    BoxWithConstraints(modifier.fillMaxSize()) {
        val window = if (constraints.hasBoundedHeight) constraints.maxHeight else 0
        Layout(
            content = {
                Column(verticalArrangement = Arrangement.spacedBy(12.dp), content = above)
                Box { preview() }
                Box(Modifier.clip(RoundedCornerShape(16.dp))) { overlay() }
                Column(verticalArrangement = Arrangement.spacedBy(12.dp), content = below)
            },
            modifier = Modifier.verticalScroll(rememberScrollState()).padding(16.dp),
        ) { measurables, constraints ->
            val width = constraints.maxWidth
            val wrap = Constraints(minWidth = width, maxWidth = width)
            val top = measurables[0].measure(wrap)
            val bottom = measurables[3].measure(wrap)
            val gap = 12.dp.roundToPx()
            val left = window - 2 * 16.dp.roundToPx() - top.height - bottom.height - 2 * gap
            val least = maxOf(PREVIEW_MIN_HEIGHT.roundToPx(), measurables[2].minIntrinsicHeight(width))
            val box = Constraints.fixed(width, maxOf(left, least))
            val middle = measurables[1].measure(box)
            val over = measurables[2].measure(box)
            layout(width, top.height + gap + middle.height + gap + bottom.height) {
                top.placeRelative(0, 0)
                middle.placeRelative(0, top.height + gap)
                over.placeRelative(0, top.height + gap)
                bottom.placeRelative(0, top.height + gap + middle.height + gap)
            }
        }
    }
}

/**
 * The capture action (C201.6): takes the `ImageCapture` still and hands it to [onCaptured] with what the
 * camera reported about itself (C40.4) and [trigger] (C206.2). False when the camera could not take it.
 */
internal suspend fun takeStill(
    camera: CaptureCamera,
    trigger: CaptureTrigger?,
    onCaptured: (CapturedImage, CameraFacts?, CaptureTrigger?) -> Unit,
): Boolean {
    val photo = camera.takePictureOrNull() ?: return false
    onCaptured(photo, camera.deviceFacts(), trigger)
    return true
}

@Composable
private fun RetryHints(hints: List<RetryHint>) {
    Card(
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.errorContainer),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Column(modifier = Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text(text = sdkString(Res.string.openverify_retry_title), style = MaterialTheme.typography.titleSmall)
            retryMessages(hints).forEach { message ->
                Text(text = sdkString(message), style = MaterialTheme.typography.bodyMedium)
            }
        }
    }
}

/**
 * Test-only semantics: whether the photo under review has been decoded and is drawn. The decoding
 * runs off the main thread, so a host test that compares a screenshot waits for this, never for a
 * length of time (Workflow 10E: a golden was once compared before the photo arrived, on a loaded
 * machine). No accessibility service reads the property.
 */
internal val ReviewPhotoDecoded: SemanticsPropertyKey<Boolean> = SemanticsPropertyKey("OpenVerifyReviewPhotoDecoded")

private var SemanticsPropertyReceiver.reviewPhotoDecoded by ReviewPhotoDecoded

/** The photo under review. Decoding happens off the main thread. */
@Composable
private fun ReviewPhoto(image: CapturedImage, description: String, modifier: Modifier) {
    val bitmap by produceState<ImageBitmap?>(initialValue = null, image) {
        value = withContext(Dispatchers.Default) { decodePreviewBitmap(image.bytes) }
    }
    Box(
        modifier = modifier
            .testTag(TestTags.REVIEW_PHOTO)
            .semantics {
                contentDescription = description
                role = Role.Image
                reviewPhotoDecoded = bitmap != null
            },
    ) {
        bitmap?.let {
            Image(bitmap = it, contentDescription = null, contentScale = ContentScale.Fit, modifier = Modifier.fillMaxSize())
        }
    }
}

/** The frame a capture's preview shows: an ID card's, a selfie's oval, or a page's (C64.2). */
private enum class GuideShape { CARD, OVAL, PAGE }

/**
 * The width-to-height ratio of the frame a capture's preview draws, `null` for a selfie's oval: a
 * page's, else the one the document guidance measures (Workflow 10B, C202.1): the TD3 passport page
 * on a passport-only step's front, the ID-1 card on every other ID side.
 */
internal fun captureGuideAspect(state: FlowState.Capture): Float? = when {
    state.isSelfie -> null
    state.kind == FileKind.DOCUMENT -> PAGE_ASPECT
    else -> DocumentGuide.aspectOf(state).toFloat()
}

/** Dims the preview outside a card-shaped frame, a face oval or a page-shaped frame. */
@Composable
private fun CaptureGuide(shape: GuideShape, aspect: Float?, modifier: Modifier) {
    Canvas(
        modifier = modifier
            .testTag(
                when (shape) {
                    GuideShape.CARD -> TestTags.DOCUMENT_GUIDE
                    GuideShape.OVAL -> TestTags.OVAL_GUIDE
                    GuideShape.PAGE -> TestTags.PAGE_GUIDE
                },
            )
            .graphicsLayer { compositingStrategy = CompositingStrategy.Offscreen },
    ) {
        drawRect(Color.Black.copy(alpha = 0.55f))
        when (shape) {
            GuideShape.CARD, GuideShape.PAGE -> drawCardFrame(aspect ?: ID_CARD_ASPECT)
            GuideShape.OVAL -> drawFaceOval()
        }
    }
}

private fun DrawScope.drawCardFrame(aspect: Float) {
    val width = min(size.width * 0.9f, size.height * 0.9f * aspect)
    val frame = Size(width, width / aspect)
    val topLeft = Offset((size.width - frame.width) / 2, (size.height - frame.height) / 2)
    val corner = CornerRadius(12.dp.toPx())
    drawRoundRect(Color.Transparent, topLeft, frame, corner, blendMode = BlendMode.Clear)
    drawRoundRect(Color.White, topLeft, frame, corner, style = Stroke(width = 3.dp.toPx()))
}

private fun DrawScope.drawFaceOval() {
    val height = min(size.height * 0.8f, size.width * 0.75f / FACE_OVAL_ASPECT)
    val oval = Size(height * FACE_OVAL_ASPECT, height)
    val topLeft = Offset((size.width - oval.width) / 2, (size.height - oval.height) / 2)
    drawOval(Color.Transparent, topLeft, oval, blendMode = BlendMode.Clear)
    drawOval(Color.White, topLeft, oval, style = Stroke(width = 3.dp.toPx()))
}

/** Test-only semantics: whether the shutter is the primary action now (C202.4). */
internal val CaptureShutterPrimary: SemanticsPropertyKey<Boolean> = SemanticsPropertyKey("OpenVerifyCaptureShutterPrimary")

private var SemanticsPropertyReceiver.captureShutterPrimary by CaptureShutterPrimary

/**
 * The guidance every capture screen gets when its caller names none: the document guidance on an ID's
 * sides with the PDF417 hint beside it on a barcode-bearing side (C202, C203), which need no installed
 * component. The selfie's needs the host's face detector (C204.6): without one, the selfie keeps today's
 * manual shutter, and the flow's activity adds it where `OpenVerifyAndroid.install` holds one.
 */
internal val BuiltInCaptureGuidance: CaptureGuidanceFactory = BarcodeGuidanceFactory(next = DocumentGuidanceFactory())

/** The capture guidance of the screens below; [BuiltInCaptureGuidance] unless a caller provides another. */
internal val LocalCaptureGuidance = staticCompositionLocalOf<CaptureGuidanceFactory?> { BuiltInCaptureGuidance }
