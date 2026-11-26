package dev.openverify.sdk.ui

import android.graphics.Bitmap
import android.graphics.Color
import androidx.compose.foundation.layout.Box
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.Modifier
import dev.openverify.sdk.camera.CameraFacts
import dev.openverify.sdk.camera.CameraLens
import dev.openverify.sdk.camera.CaptureCamera
import dev.openverify.sdk.camera.CapturedImage
import dev.openverify.sdk.flow.DocumentError
import dev.openverify.sdk.flow.PickedDocument
import dev.openverify.sdk.model.CaptureTrigger
import dev.openverify.sdk.model.InputField
import dev.openverify.sdk.model.OtpDestination
import dev.openverify.sdk.model.PersonField
import java.io.ByteArrayOutputStream

/**
 * A camera without hardware: the preview is an empty box, photos come from [nextPhoto], and it
 * reports [facts] about itself. [previewedLenses] gains an entry each time a preview starts.
 */
internal class FakeCaptureCamera(var nextPhoto: () -> CapturedImage = { testJpeg() }) : CaptureCamera {
    val previewedLenses = mutableListOf<CameraLens>()
    var picturesTaken = 0
    var facts: CameraFacts? = null

    override fun deviceFacts(): CameraFacts? = facts

    @Composable
    override fun Preview(lens: CameraLens, modifier: Modifier) {
        LaunchedEffect(lens) { previewedLenses += lens }
        Box(modifier)
    }

    override suspend fun takePicture(): CapturedImage {
        picturesTaken++
        return nextPhoto()
    }
}

/** A picker without a system UI: each launch hands over [nextPhoto] at once (`null`: unusable). */
internal class FakePhotoPicker(var nextPhoto: () -> CapturedImage? = { testJpeg() }) : PhotoPicker {
    var launches = 0

    @Composable
    override fun rememberLauncher(onPicked: (CapturedImage?) -> Unit): () -> Unit = {
        launches++
        onPicked(nextPhoto())
    }
}

/** Records which [FlowActions] the screens called. */
internal class RecordingActions : FlowActions {
    val calls = mutableListOf<String>()
    val captured = mutableListOf<CapturedImage>()
    val cameras = mutableListOf<CameraFacts?>()

    /** C206.2: the client-reported trigger each capture carried. */
    val triggers = mutableListOf<CaptureTrigger?>()
    val optionalConsents = mutableListOf<Set<String>>()

    override fun acceptConsent(optionalTextKeys: Set<String>, locale: String?) { calls += "acceptConsent"; optionalConsents += optionalTextKeys }
    override fun cameraReady() { calls += "cameraReady" }
    override fun capture(image: CapturedImage, camera: CameraFacts?, trigger: CaptureTrigger?) { calls += "capture"; captured += image; cameras += camera; triggers += trigger }
    override fun pick(image: CapturedImage) { calls += "pick"; captured += image }
    override fun retake() { calls += "retake" }
    override fun confirmCapture() { calls += "confirmCapture" }
    override fun retry() { calls += "retry" }
    override fun finish() { calls += "finish" }
    override fun cancel() { calls += "cancel" }

    /** What the Phase 5 actions carried, in order (C64.2). */
    val sent = mutableListOf<Any?>()

    override fun sendOtp(destination: OtpDestination) { calls += "sendOtp"; sent += destination }
    override fun resendOtp() { calls += "resendOtp" }
    override fun confirmOtp(code: String) { calls += "confirmOtp"; sent += code }
    override fun changeOtpDestination() { calls += "changeOtpDestination" }
    override fun continueAfterLimit() { calls += "continueAfterLimit" }
    override fun submitInputs(values: Map<InputField, String>, persons: List<Map<PersonField, String>>) {
        calls += "submitInputs"
        sent += values
        if (persons.isNotEmpty()) sent.add(persons)
    }
    override fun pickDocument(document: PickedDocument) { calls += "pickDocument"; sent += document }
    override fun refuseDocument(error: DocumentError) { calls += "refuseDocument"; sent += error }
    override fun discardDocument() { calls += "discardDocument" }
    override fun submitDocument() { calls += "submitDocument" }
    override fun takeDocumentPhoto() { calls += "takeDocumentPhoto" }
    override fun backToDocument() { calls += "backToDocument" }
    override fun createCryptoChallenge(chainId: String, walletAddress: String) { calls += "createCryptoChallenge"; sent += chainId to walletAddress }
    override fun submitCryptoSignature(signature: String, signedMessage: String?) { calls += "submitCryptoSignature"; sent += signature to signedMessage }
    override fun renewCryptoChallenge(walletAddress: String) { calls += "renewCryptoChallenge"; sent += walletAddress }
    override fun changeCryptoWallet() { calls += "changeCryptoWallet" }
}

/** A real, tiny JPEG (needs Robolectric's native graphics). */
internal fun testJpeg(width: Int = 32, height: Int = 20): CapturedImage {
    val bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888).apply { eraseColor(Color.GRAY) }
    val out = ByteArrayOutputStream()
    bitmap.compress(Bitmap.CompressFormat.JPEG, 80, out)
    return CapturedImage(out.toByteArray(), "image/jpeg")
}
