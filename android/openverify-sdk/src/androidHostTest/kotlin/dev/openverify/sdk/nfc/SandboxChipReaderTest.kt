@file:OptIn(ExperimentalOpenVerifyApi::class)

package dev.openverify.sdk.nfc

import dev.openverify.sdk.ExperimentalOpenVerifyApi
import dev.openverify.sdk.api.FlowApiException
import dev.openverify.sdk.chip.ChipAccess
import dev.openverify.sdk.chip.ChipProgress
import dev.openverify.sdk.chip.ChipReadException
import dev.openverify.sdk.chip.ChipReadFailure
import dev.openverify.sdk.flow.FakeFlowApi
import dev.openverify.sdk.flow.FakeFlowServer
import dev.openverify.sdk.flow.FlowProblemCodes
import dev.openverify.sdk.model.FileKind
import dev.openverify.sdk.model.FlowSandboxChip
import dev.openverify.sdk.model.SandboxChipScenario
import kotlin.io.encoding.Base64
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.test.runTest
import okio.IOException
import org.junit.jupiter.api.Assertions.assertArrayEquals
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

/**
 * C208.2: the sandbox test chip as a `ChipReader` over the sandbox-chip route. Every exception it
 * throws is a `ChipReadException` with a code and a fixed message, never a server detail (C213.3).
 */
internal class SandboxChipReaderTest {
    private val server = FakeFlowServer()
    private val challenge = "chc_01M5CK3190XEVBM5ZXA76E1JS0"
    private val verification = "ver_01M5CK16P0D13FXHZSS4TCFB00"
    private val access = ChipAccess.Can("000000")

    private fun reader(scenario: SandboxChipScenario = SandboxChipScenario.MATCH) = SandboxChipReader(server, verification, challenge, scenario)

    @Test
    fun `it asks the route once for the challenge and scenario and returns the decoded files, DG2 left to the server`() = runTest {
        server.sandboxChip = FlowSandboxChip(
            listOf(FlowSandboxChip.File(FileKind.CHIP_SOD, Base64.encode(byteArrayOf(0x77, 1))), FlowSandboxChip.File(FileKind.CHIP_DG1, Base64.encode(dg1Of()))),
            dg2Attached = true,
            activeAuthenticationResponse = Base64.encode(byteArrayOf(5, 6)),
        )
        val progress = mutableListOf<ChipProgress>()
        val reader = reader(SandboxChipScenario.TAMPERED_DG1)

        val read = reader.read(access, ByteArray(8), progress::add)

        assertEquals(listOf(challenge to SandboxChipScenario.TAMPERED_DG1), server.sandboxChipRequests)
        assertEquals(listOf(FileKind.CHIP_SOD, FileKind.CHIP_DG1), read.files.keys.toList())
        assertArrayEquals(byteArrayOf(0x77, 1), read.files[FileKind.CHIP_SOD])
        assertArrayEquals(dg1Of(), read.files[FileKind.CHIP_DG1])
        assertArrayEquals(byteArrayOf(5, 6), read.activeAuthenticationResponse)
        assertTrue(reader.dg2Attached)
        // Nothing the device did is claimed: no protocol, no timing.
        assertTrue(read.deviceReport.protocols.isEmpty())
        assertNull(read.deviceReport.readMillis)
        assertEquals(
            listOf(ChipProgress.Connected, ChipProgress.Reading(FileKind.CHIP_SOD, 100), ChipProgress.Reading(FileKind.CHIP_DG1, 100), ChipProgress.Done),
            progress,
        )
    }

    @Test
    fun `a scenario without Active Authentication returns no response`() = runTest {
        val read = reader(SandboxChipScenario.NO_ACTIVE_AUTHENTICATION).read(access, ByteArray(8)) {}

        assertNull(read.activeAuthenticationResponse)
    }

    @Test
    fun `a file that is not base64, or of a kind a chip does not hold, is an unsupported document with a fixed message`() {
        server.sandboxChip = FlowSandboxChip(listOf(FlowSandboxChip.File(FileKind.CHIP_SOD, "not base64 at all: canary-4711")), dg2Attached = true)
        val malformed = assertThrows(ChipReadException::class.java) { runBlocking { reader().read(access, ByteArray(8)) {} } }
        assertEquals(ChipReadFailure.UNSUPPORTED_DOCUMENT, malformed.failure)
        assertEquals("Chip read failed: unsupported_document", malformed.message)
        assertNull(malformed.cause)

        server.sandboxChip = FlowSandboxChip(listOf(FlowSandboxChip.File(FileKind.FRONT, "c3ludGhldGlj")), dg2Attached = true)
        val foreign = assertThrows(ChipReadException::class.java) { runBlocking { reader().read(access, ByteArray(8)) {} } }
        assertEquals(ChipReadFailure.UNSUPPORTED_DOCUMENT, foreign.failure)
    }

    @Test
    fun `the route's own failures stay the flow API's, for the driver to answer (C193_5)`() {
        server.failNext("requestSandboxChip", FakeFlowApi.conflict(FlowProblemCodes.SANDBOX_CHIP_ANCHOR_MISSING))
        assertThrows(FlowApiException.Conflict::class.java) { runBlocking { reader().read(access, ByteArray(8)) {} } }

        server.failNext("requestSandboxChip", FlowApiException.Network(IOException("synthetic")))
        assertThrows(FlowApiException.Network::class.java) { runBlocking { reader().read(access, ByteArray(8)) {} } }
    }
}
