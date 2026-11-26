package dev.openverify.demo

import android.content.Context
import dev.openverify.demo.artifacts.FaceArtifact
import dev.openverify.demo.artifacts.NfcArtifact
import dev.openverify.sdk.OpenVerifyAndroid
import dev.openverify.sdk.OpenVerifyComponents
import dev.openverify.sdk.OpenVerifyEventListener
import dev.openverify.sdk.chip.ChipReader
import dev.openverify.sdk.face.FaceDetectorFactory

/**
 * What the demo installs in `OpenVerifyAndroid` (C191, C218.1): its event log; when one is picked,
 * the sandbox bot-detection outcome (Phase 7 C90.9), which the SDK sends with a sandbox session's
 * signals only; and the component of each optional artifact this build includes (KP10-45): the chip
 * reader of openverify-nfc and the face detector of openverify-face, each through the artifact's
 * hook in `dev.openverify.demo.artifacts`. A build without an artifact compiles that hook's stub,
 * which answers `null`, so this file names no optional artifact. OpenVerify ships no integrity token
 * provider (a host implements `IntegrityTokenProvider` itself), so none is installed.
 */
object DemoComponents {
    /** The optional artifacts' components, made once from the application by [attach]. */
    private class Artifacts(val chipReader: ChipReader? = null, val faceDetectorFactory: FaceDetectorFactory? = null)

    @Volatile
    private var artifacts = Artifacts()

    /** Asks each optional artifact's hook of this build for its component, once, from the application. */
    fun attach(application: Context) {
        val context = application.applicationContext
        artifacts = Artifacts(NfcArtifact.chipReader(context), FaceArtifact.faceDetectorFactory(context))
    }

    /** The components for a launch with [outcome] picked, telling [events]. */
    fun of(outcome: SandboxOutcomeChoice, events: OpenVerifyEventListener): OpenVerifyComponents {
        val attached = artifacts
        return OpenVerifyComponents(
            chipReader = attached.chipReader,
            faceDetectorFactory = attached.faceDetectorFactory,
            eventListener = events,
            sandboxSignalOutcome = outcome.outcome,
        )
    }

    /** Installs [of] for every flow this process starts from now on. */
    fun install(outcome: SandboxOutcomeChoice, events: OpenVerifyEventListener = EventLog.shared) =
        OpenVerifyAndroid.install(of(outcome, events))
}
