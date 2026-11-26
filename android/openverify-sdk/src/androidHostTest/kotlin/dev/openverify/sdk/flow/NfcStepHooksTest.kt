package dev.openverify.sdk.flow

import dev.openverify.sdk.InquiryOutcomes
import dev.openverify.sdk.InquiryResult
import dev.openverify.sdk.events.ObservedFlowApi
import dev.openverify.sdk.events.stepTypeOf
import dev.openverify.sdk.flow.FakeFlowApi.Companion.DEFAULT_FLOW
import dev.openverify.sdk.flow.FakeFlowApi.Companion.INQUIRY_ID
import dev.openverify.sdk.flow.FakeFlowApi.Companion.NOW
import dev.openverify.sdk.model.ClientUnableReason
import dev.openverify.sdk.model.CompletionStep
import dev.openverify.sdk.model.ConsentStep
import dev.openverify.sdk.model.FileKind
import dev.openverify.sdk.model.FlowChipSubmit
import dev.openverify.sdk.model.FlowConsent
import dev.openverify.sdk.model.NfcStep
import dev.openverify.sdk.model.VerificationType
import dev.openverify.sdk.nfc.NfcAvailability
import dev.openverify.sdk.nfc.NfcEnvironment
import dev.openverify.sdk.nfc.NfcEvent
import dev.openverify.sdk.nfc.NfcUnable
import dev.openverify.sdk.nfc.NfcView
import kotlinx.coroutines.test.runTest
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Test
import java.io.File
import kotlin.time.Duration.Companion.seconds

/**
 * C207.1, C207.12 (Workflow 10C, contracts-10c): the hooks Stage 1a placed in the shared SDK files
 * for the NFC step, each a call into a file `nfc-sdk` owns (`nfc/NfcStepController.kt`,
 * `nfc/NfcFlowRequests.kt`, `ui/steps/NfcStepScreen.kt`, `nfc/NfcPlatform*.kt`). This file proves
 * the call sites; the step itself is `nfc-sdk`'s.
 */
internal class NfcStepHooksTest {

    private val settings = FlowCoordinator.Settings(pollInterval = 1.seconds, pollAttempts = 3)
    private val consent = DEFAULT_FLOW.steps[0] as ConsentStep
    private val chip = NfcStep("chip", fallbackAvailable = true)
    private val done = CompletionStep("done")

    @Test
    fun `the registry runs an nfc step in the coordinator, as consent and the verification steps (C194_1)`() = runTest {
        val server = FakeFlowServer(steps = listOf(consent, chip, done), consent = FlowConsent(NOW))
        val session = server.getSession()

        assertEquals(StepRendering.Run, StepRegistry.renderers.getValue("nfc").render(chip, session))
        assertEquals(StepRendering.Run, StepRegistry.render(chip, session))
    }

    @Test
    fun `an nfc position shows what the NFC step's controller resolves, with one session read and no other call`() = runTest {
        val server = FakeFlowServer(steps = listOf(consent, chip, done), consent = FlowConsent(NOW))
        val coordinator = FlowCoordinator(server, INQUIRY_ID, settings, nfcEnvironment = NfcEnvironment.None)

        coordinator.start()

        // No reader is installed in this launch: the controller's "this app cannot read document chips".
        assertEquals(FlowState.Nfc(chip, NfcView.CannotRead(NfcUnable.READER_NOT_INSTALLED, fallback = true)), coordinator.state.value)
        assertEquals(listOf("getSession"), server.calls)
    }

    @Test
    fun `an NFC event reaches the controller through the coordinator`() = runTest {
        val server = FakeFlowServer(steps = listOf(consent, chip, done), consent = FlowConsent(NOW))
        val coordinator = FlowCoordinator(server, INQUIRY_ID, settings)
        coordinator.start()

        coordinator.nfc(NfcEvent.UseAnotherWay)

        assertEquals(listOf(ClientUnableReason.READER_NOT_INSTALLED), server.clientUnableReports.map { it.second })
    }

    @Test
    fun `closing an NFC screen cancels, and the events name the nfc step`() {
        val state = FlowState.Nfc(chip, NfcView.Checking)

        assertEquals(InquiryResult.Canceled(INQUIRY_ID), InquiryOutcomes.forFinish(state, INQUIRY_ID))
        assertEquals("nfc", stepTypeOf(state))
    }

    @Test
    fun `an accepted chip submit is a submission, and a refused one is not (C192_2)`() = runTest {
        val server = FakeFlowServer(steps = listOf(consent, chip, done), consent = FlowConsent(NOW))
        var submitted = 0
        val observed = ObservedFlowApi(server, onSession = {}, onSubmitted = { submitted += 1 })
        val verification = observed.createVerification(VerificationType.GOVERNMENT_ID_NFC)
        val submit = FlowChipSubmit("chc_01M5CK3190XEVBM5ZXA76E1JSM", "0123456789abcdef")

        observed.createChipChallenge(verification.id)
        observed.uploadChipFile(verification.id, FileKind.CHIP_SOD, byteArrayOf(0x77, 0x00))
        assertEquals(0, submitted)
        observed.submitChip(verification.id, submit)
        assertEquals(1, submitted)

        assertThrows(NoSuchElementException::class.java) { kotlinx.coroutines.runBlocking { observed.submitChip("ver_01M5CK3190XEVBM5ZXA76E1JSX", submit) } }
        assertEquals(1, submitted)
        assertEquals(listOf(FileKind.CHIP_SOD to 2), server.chipFiles)
        assertEquals(listOf(submit), server.chipSubmits)
    }

    @Test
    fun `only the NFC step reaches the NFC calls, beside their declarations, delegations and the observer`() {
        val allowed = setOf(
            "api/FlowApi.kt", "api/FlowApiClient.kt", "api/OneTimeLinkFlowApi.kt", "events/FlowEvents.kt", "nfc/NfcFlowRequests.kt",
            // nfc-sdk's callers: the step's controller and the sandbox test chip's reader (C208.2).
            "nfc/NfcStepController.kt", "nfc/SandboxChipReader.kt",
        )
        val calls = listOf("createChipChallenge(", "uploadChipFile(", "submitChip(", "reportClientUnable(", "requestSandboxChip(")
        val callers = File("src").walkTopDown()
            .filter { it.isFile && it.extension == "kt" && ("/commonMain/" in it.path || "/androidMain/" in it.path || "/iosMain/" in it.path) }
            .filter { file -> file.readText().let { text -> calls.any { it in text } } }
            .map { it.path.substringAfter("/dev/openverify/sdk/") }
            .filterNot { it in allowed }
            .toList()

        assertEquals(emptyList<String>(), callers)
    }

    @Test
    fun `a coordinator made without an NFC environment has no reader and no platform seam`() {
        assertNull(NfcEnvironment.None.chipReader)
        assertNull(NfcEnvironment.None.platform)
        assertEquals(listOf("READY", "DISABLED", "NO_HARDWARE"), NfcAvailability.entries.map { it.name })
    }
}
