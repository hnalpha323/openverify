package dev.openverify.sdk

import dev.openverify.sdk.chip.ChipReader
import dev.openverify.sdk.face.FaceDetectorFactory
import dev.openverify.sdk.integrity.IntegrityTokenProvider

/**
 * The optional parts a host app installs once, from `Application.onCreate`, with
 * `OpenVerifyAndroid.install` (C191.1, decision 6). Each is `null` by default, and each absence has
 * a stated behaviour (C191.3): no [chipReader] shows "this app cannot read document chips" at an NFC
 * step; no [faceDetectorFactory] keeps the selfie's manual shutter with the server's prompts; no
 * [integrityTokenProvider] sends no integrity token; no [eventListener] builds no event; no
 * [transport] uses the SDK's own HTTP client.
 *
 * ```
 * class App : Application() {
 *     override fun onCreate() {
 *         super.onCreate()
 *         OpenVerifyAndroid.install(OpenVerifyComponents(eventListener = { event -> log(event) }))
 *     }
 * }
 * ```
 *
 * An installed component changes what the device can guide or read, never what the server
 * decides (C191.5). The chip reader is an experimental seam: implementing or calling
 * `ChipReader.read` needs `@OptIn(ExperimentalOpenVerifyApi::class)` (ADR 0009).
 */
public class OpenVerifyComponents(
    /** Reads a document's chip at an NFC step (C207.3); `openverify-nfc` implements it. */
    public val chipReader: ChipReader? = null,
    /** Detects faces for the selfie's on-device guidance (C204.2); `openverify-face` implements it. */
    public val faceDetectorFactory: FaceDetectorFactory? = null,
    /** Gives an integrity token for the server to decode (C211.2). */
    public val integrityTokenProvider: IntegrityTokenProvider? = null,
    /** Receives the flow's events, for UI coordination only (C192). */
    public val eventListener: OpenVerifyEventListener? = null,
    /** The HTTP client the flow uses (C191.1, C213.4). */
    public val transport: FlowTransport? = null,
    /** The bot-detection outcome a **sandbox** session asks for; ignored in production (Phase 7 C90.9). */
    public val sandboxSignalOutcome: SandboxSignalOutcome? = null,
)
