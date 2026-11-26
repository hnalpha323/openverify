@file:OptIn(ExperimentalOpenVerifyApi::class)

package dev.openverify.sdk.nfc

import dev.openverify.sdk.ExperimentalOpenVerifyApi
import dev.openverify.sdk.api.FlowApi
import dev.openverify.sdk.chip.ChipAccess
import dev.openverify.sdk.chip.ChipDeviceReport
import dev.openverify.sdk.chip.ChipProgress
import dev.openverify.sdk.chip.ChipRead
import dev.openverify.sdk.chip.ChipReadException
import dev.openverify.sdk.chip.ChipReadFailure
import dev.openverify.sdk.chip.ChipReader
import dev.openverify.sdk.model.FileKind
import dev.openverify.sdk.model.SandboxChipScenario
import kotlin.io.encoding.Base64

/**
 * C208.2: the sandbox test chip as a [ChipReader], over `POST .../sandbox-chip`. It is offered only
 * when the `nfc` client view's `sandboxChipAvailable` is true and is labelled "Test chip (sandbox)";
 * the review, upload, submit and poll after it are the real ones. It proves the flow and the
 * server's checks, never a reader (C208.4): it claims no protocol and no timing in its device
 * report, and the access key it is given opens nothing.
 *
 * The route's own failures stay the flow API's exceptions, for the driver's rules (C193.5). What the
 * reader itself refuses is a [ChipReadException] with its code and fixed message, never the server's
 * words or a decoding excerpt (C213.3).
 */
internal class SandboxChipReader(
    private val api: FlowApi,
    private val verificationId: String,
    private val challengeId: String,
    private val scenario: SandboxChipScenario = SandboxChipScenario.MATCH,
) : ChipReader {
    /** Whether the server attached DG2 itself (C208.1), so the client never uploads it. */
    var dg2Attached: Boolean = false
        private set

    override suspend fun read(access: ChipAccess, challenge: ByteArray, progress: (ChipProgress) -> Unit): ChipRead {
        val answer = api.requestSandboxChip(verificationId, challengeId, scenario)
        progress(ChipProgress.Connected)
        val files = linkedMapOf<FileKind, ByteArray>()
        for (file in answer.files) {
            if (file.kind !in NfcFlowRequests.CHIP_KINDS) throw ChipReadException(ChipReadFailure.UNSUPPORTED_DOCUMENT)
            files[file.kind] = decoded(file.content)
            progress(ChipProgress.Reading(file.kind, 100))
        }
        val response = answer.activeAuthenticationResponse?.let(::decoded)
        dg2Attached = answer.dg2Attached
        progress(ChipProgress.Done)
        return ChipRead(files, response, ChipDeviceReport())
    }

    private fun decoded(content: String): ByteArray = try {
        Base64.decode(content)
    } catch (_: IllegalArgumentException) {
        throw ChipReadException(ChipReadFailure.UNSUPPORTED_DOCUMENT)
    }
}
