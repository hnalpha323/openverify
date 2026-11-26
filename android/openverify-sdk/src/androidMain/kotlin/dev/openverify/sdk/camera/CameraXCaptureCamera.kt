package dev.openverify.sdk.camera

import android.content.Context
import android.hardware.camera2.CameraCaptureSession
import android.hardware.camera2.CaptureRequest
import android.hardware.camera2.CaptureResult
import android.hardware.camera2.TotalCaptureResult
import android.util.Size
import androidx.annotation.OptIn
import androidx.camera.camera2.interop.Camera2Interop
import androidx.camera.camera2.interop.ExperimentalCamera2Interop
import androidx.camera.compose.CameraXViewfinder
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.ImageCapture
import androidx.camera.core.ImageCaptureException
import androidx.camera.core.ImageProxy
import androidx.camera.core.Preview
import androidx.camera.core.SurfaceRequest
import androidx.camera.core.resolutionselector.AspectRatioStrategy
import androidx.camera.core.resolutionselector.ResolutionSelector
import androidx.camera.core.resolutionselector.ResolutionStrategy
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.lifecycle.awaitInstance
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.LocalLifecycleOwner
import dev.openverify.sdk.generated.resources.Res
import dev.openverify.sdk.generated.resources.openverify_camera_unavailable
import dev.openverify.sdk.i18n.sdkString
import dev.openverify.sdk.log.SdkLog
import dev.openverify.sdk.ui.text.Text
import java.util.concurrent.Executor
import kotlin.coroutines.resumeWithException
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.asExecutor
import kotlinx.coroutines.awaitCancellation
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext

/**
 * [CaptureCamera] on CameraX: a Compose viewfinder bound to the screen's lifecycle, in-memory
 * captures, and the analysis frames the capture guidance reads (C201). Photos never touch the file
 * system. It also keeps what the bound camera reports about itself ([deviceFacts], C40.4): its ids,
 * lens facing and supported frame rates from `CameraInfo`, the frame rate it runs at from each preview
 * frame's capture result, and the size of the last photo.
 *
 * C201.2: each preview binds `Preview`, `ImageCapture` and `ImageAnalysis` in one call, the analysis
 * asked at its [AnalysisTarget]'s size, RGBA, keeping only the latest frame, sampled at `guidance-hz`
 * by [FrameAnalyzer] into one reused buffer per frame size. KP10-21: what is asked is not always
 * given (beside a full-size still CameraX holds the analysis to the preview class, [AnalysisSizes]),
 * so a barcode side's first frame says what a read on it can carry ([barcodeRead]). C201.3: when the three cannot be bound
 * together, it binds preview and capture alone, [frames] completes empty, and the step keeps the
 * manual shutter; [forceTwoUseCases] forces that path for the device test. KP10-14: when not even the
 * two can be bound, the preview says the camera is unavailable and tells [reportUnavailableTo]'s
 * listener. The photo uploaded is always the `ImageCapture` still (C201.6).
 *
 * This class only connects CameraX to [CaptureCamera]. It needs camera hardware for a real bind, so
 * the device test runs it on the CI emulator, and the host tests reach it through a fake
 * [CameraBinder]; it is left out of the coverage gate. The parts it calls ([bindUseCases],
 * [FrameAnalyzer], [FrameSampler], [FrameBuffers], [FrameRelay], [ImageEncoding]) are covered.
 */
internal class CameraXCaptureCamera(
    private val context: Context,
    /** C201.3's test hook: binding three use cases fails at once, as on a device that cannot run them together. */
    private val forceTwoUseCases: Boolean = false,
    /** How the use cases are bound: CameraX's process camera provider, or a host test's fake. */
    private val binderOf: suspend (Context) -> CameraBinder = { ProcessCameraBinder(ProcessCameraProvider.awaitInstance(it)) },
) : CaptureCamera {

    /**
     * Phase 12A K1: the still of the preview bound now, with what it is of (which sets its encoding,
     * K2); `null` before the first preview binds. Written on the main thread.
     */
    @Volatile
    private var still: Pair<ImageCapture, StillKind>? = null

    /** C201.1: the frames of the bound session, handed one at a time to the guidance that reads them. */
    private val relay = FrameRelay()

    /** C201.1: one pixel buffer per analysis frame size, kept across sessions. */
    private val buffers = FrameBuffers()

    /** The analysis thread: one at a time, allowed to wait for the guidance's callback. */
    private val analysisExecutor: Executor = Dispatchers.IO.limitedParallelism(1).asExecutor()

    /** What `CameraInfo` said about the camera last bound. Written on the main thread. */
    @Volatile
    private var bound: CameraFacts? = null

    /** The upper bound of the auto-exposure target frame rate of the latest preview frame. */
    @Volatile
    private var frameRate: Int? = null

    /** The last photo's size, upright. */
    @Volatile
    private var photoSize: Pair<Int, Int>? = null

    /** KP10-14: told each time a preview could bind no use case at all. */
    @Volatile
    private var unavailableListener: (() -> Unit)? = null

    /**
     * KP10-21: what a barcode read can carry on the frames of the session now bound, known from its
     * first frame ([BarcodeReadSink]); `null` before that frame, and on a side that asks no barcode
     * width. A camera that gives less than the 1,280 px asked is logged by its code, once a session.
     */
    @Volatile
    internal var barcodeRead: BarcodeRead? = null
        private set

    private fun noteBarcodeRead(read: BarcodeRead) {
        barcodeRead = read
        // Literal codes only (C213.3).
        when (read) {
            BarcodeRead.STREAM -> Unit
            BarcodeRead.NARROW -> SdkLog.log("camera.barcode_analysis_narrow")
            BarcodeRead.NONE -> SdkLog.log("camera.barcode_analysis_unreadable")
        }
    }

    override fun reportUnavailableTo(listener: () -> Unit) {
        unavailableListener = listener
    }

    override fun deviceFacts(): CameraFacts? = bound?.copy(
        width = photoSize?.first,
        height = photoSize?.second,
        frameRate = frameRate,
    )

    override fun frames(): Flow<AnalysisFrame> = relay.frames()

    /**
     * A preview that reads the frame rate the camera runs at from each frame's capture result. It
     * only observes: no capture request is changed.
     */
    @OptIn(markerClass = [ExperimentalCamera2Interop::class])
    private fun previewBuilder(): Preview.Builder = Preview.Builder().also { builder ->
        Camera2Interop.Extender(builder).setSessionCaptureCallback(
            object : CameraCaptureSession.CaptureCallback() {
                override fun onCaptureCompleted(session: CameraCaptureSession, request: CaptureRequest, result: TotalCaptureResult) {
                    result.get(CaptureResult.CONTROL_AE_TARGET_FPS_RANGE)?.let { frameRate = it.upper }
                }
            },
        )
    }

    @Composable
    override fun Preview(lens: CameraLens, modifier: Modifier) = Preview(lens, AnalysisTarget.of(lens), modifier)

    @Composable
    override fun Preview(lens: CameraLens, analysis: AnalysisTarget, modifier: Modifier) {
        val lifecycleOwner = LocalLifecycleOwner.current
        var surfaceRequest by remember { mutableStateOf<SurfaceRequest?>(null) }
        var unavailable by remember(lens, analysis) { mutableStateOf(false) }

        LaunchedEffect(lens, analysis, lifecycleOwner) {
            // CameraX binds and unbinds on the main thread only. Effects usually run there, but not
            // always: the v2 Compose test rule runs them on the test thread (CI run 39418338299).
            withContext(Dispatchers.Main.immediate) {
                val preview = previewBuilder().build().apply { setSurfaceProvider { request -> surfaceRequest = request } }
                val kind = StillKind.of(analysis)
                val imageCapture = stillUseCase(kind)
                still = imageCapture to kind
                barcodeRead = null
                val imageAnalysis = analysisUseCase(analysis).apply {
                    setAnalyzer(analysisExecutor, FrameAnalyzer(FrameSampler(FrameSampler.GUIDANCE_HZ), buffers, BarcodeReadSink(analysis, relay, ::noteBarcodeRead)))
                }
                val selector = if (lens == CameraLens.FRONT) CameraSelector.DEFAULT_FRONT_CAMERA else CameraSelector.DEFAULT_BACK_CAMERA
                var binder: CameraBinder? = null
                val binding = try {
                    val provider = binderOf(context).also { binder = it }
                    // The flow is the only camera user while its activity is in front. Unbinding first
                    // lets the next pose switch lenses before the previous effect has cleaned up.
                    provider.unbindAll()
                    frameRate = null
                    photoSize = null
                    bindUseCases(
                        three = {
                            check(!forceTwoUseCases) { "Three use cases refused by the test hook" }
                            provider.bind(lifecycleOwner, selector, preview, imageCapture, imageAnalysis)
                        },
                        two = { provider.bind(lifecycleOwner, selector, preview, imageCapture) },
                        release = provider::unbindAll,
                    )
                } catch (e: CancellationException) {
                    throw e
                } catch (_: Exception) {
                    // The camera provider itself could not start.
                    Binding.Unavailable
                }
                val session = relay.open(analysing = binding is Binding.Analysing)
                when (binding) {
                    is Binding.Analysing -> bound = binding.value
                    is Binding.WithoutAnalysis -> {
                        bound = binding.value
                        SdkLog.log("camera.analysis_unavailable")
                    }
                    Binding.Unavailable -> {
                        // No camera matches the selector (for example no front camera), or CameraX could
                        // not start. The screen says so instead of crashing the host app, and the host's
                        // listener hears it once (KP10-14).
                        unavailable = true
                        unavailableListener?.invoke()
                    }
                }
                try {
                    awaitCancellation()
                } finally {
                    relay.close(session)
                    imageAnalysis.clearAnalyzer()
                    binder?.unbind(preview, imageCapture, imageAnalysis)
                    // A newer preview may have bound its own still already: keep that one.
                    if (still?.first === imageCapture) still = null
                    surfaceRequest = null
                }
            }
        }

        Box(modifier = modifier) {
            val request = surfaceRequest
            when {
                unavailable -> Text(
                    text = sdkString(Res.string.openverify_camera_unavailable),
                    color = Color.White,
                    style = MaterialTheme.typography.bodyLarge,
                    modifier = Modifier.align(Alignment.Center).padding(24.dp),
                )
                request != null -> CameraXViewfinder(surfaceRequest = request, modifier = Modifier.fillMaxSize())
            }
        }
    }

    override suspend fun takePicture(): CapturedImage {
        val (imageCapture, kind) = still ?: throw CameraCaptureException("No camera preview is bound")
        val frame = suspendCancellableCoroutine { continuation ->
            imageCapture.takePicture(
                Dispatchers.Default.asExecutor(),
                object : ImageCapture.OnImageCapturedCallback() {
                    override fun onCaptureSuccess(image: ImageProxy) {
                        continuation.resume(image) { _, frame, _ -> frame.close() }
                    }

                    override fun onError(exception: ImageCaptureException) {
                        continuation.resumeWithException(CameraCaptureException("The camera could not take a photo", exception))
                    }
                },
            )
        }
        return withContext(Dispatchers.Default) {
            frame.use {
                val quarterTurn = it.imageInfo.rotationDegrees % 180 != 0
                photoSize = if (quarterTurn) it.height to it.width else it.width to it.height
                val bitmap = it.toBitmap()
                try {
                    ImageEncoding.uprightJpeg(bitmap, it.imageInfo.rotationDegrees, kind)
                } finally {
                    bitmap.recycle()
                }
            }
        }
    }

    internal companion object {
        /**
         * Phase 12A K1: a document's still, the sensor's largest 4:3 size up to this bound (the
         * 12-megapixel class; a 50-megapixel still would be a 200 MB bitmap for an upload capped at
         * [ImageEncoding.MAX_DIMENSION]), else the closest above it.
         */
        private val DOCUMENT_STILL = Size(ImageEncoding.MAX_DIMENSION, ImageEncoding.MAX_DIMENSION * 3 / 4)

        /** A selfie's still (C201.2), as before Phase 12A. */
        private val SELFIE_STILL = Size(1920, 1440)

        /**
         * Phase 12A K1: the `ImageCapture` of a [kind] still. A document's is taken in quality mode at
         * [DOCUMENT_STILL] and the still's 4:3 shape; a selfie's keeps latency mode at [SELFIE_STILL].
         */
        fun stillUseCase(kind: StillKind): ImageCapture {
            val selector = ResolutionSelector.Builder()
                .setResolutionStrategy(
                    ResolutionStrategy(
                        if (kind == StillKind.DOCUMENT) DOCUMENT_STILL else SELFIE_STILL,
                        ResolutionStrategy.FALLBACK_RULE_CLOSEST_LOWER_THEN_HIGHER,
                    ),
                )
            if (kind == StillKind.DOCUMENT) {
                selector.setAspectRatioStrategy(AspectRatioStrategy.RATIO_4_3_FALLBACK_AUTO_STRATEGY)
            }
            return ImageCapture.Builder()
                .setCaptureMode(
                    if (kind == StillKind.DOCUMENT) ImageCapture.CAPTURE_MODE_MAXIMIZE_QUALITY else ImageCapture.CAPTURE_MODE_MINIMIZE_LATENCY,
                )
                .setResolutionSelector(selector.build())
                .build()
        }

        /**
         * C201.2: the analysis use case of [target]: RGBA (`OUTPUT_IMAGE_FORMAT_RGBA_8888`), only the latest
         * frame kept (`STRATEGY_KEEP_ONLY_LATEST`), asked at the closest size at or above the target's at
         * the still's 4:3 shape, else the closest below, among the sizes CameraX can run beside the
         * preview and the still ([AnalysisSizes.beside] states that rule); never rotated or mirrored by
         * CameraX (the frame keeps its rotation degrees).
         */
        fun analysisUseCase(target: AnalysisTarget): ImageAnalysis = ImageAnalysis.Builder()
            .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
            .setOutputImageFormat(ImageAnalysis.OUTPUT_IMAGE_FORMAT_RGBA_8888)
            .setResolutionSelector(
                ResolutionSelector.Builder()
                    .setAspectRatioStrategy(AspectRatioStrategy.RATIO_4_3_FALLBACK_AUTO_STRATEGY)
                    .setResolutionStrategy(
                        ResolutionStrategy(
                            Size(target.longSidePx, target.shortSidePx),
                            ResolutionStrategy.FALLBACK_RULE_CLOSEST_HIGHER_THEN_LOWER,
                        ),
                    )
                    .build(),
            )
            .build()
    }
}
