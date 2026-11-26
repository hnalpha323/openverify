@file:OptIn(ExperimentalOpenVerifyApi::class, ExperimentalCoroutinesApi::class)

package dev.openverify.sdk.nfc

import dev.openverify.sdk.ExperimentalOpenVerifyApi
import dev.openverify.sdk.api.FlowApiException
import dev.openverify.sdk.chip.ChipAccess
import dev.openverify.sdk.chip.ChipDeviceReport
import dev.openverify.sdk.chip.ChipReadException
import dev.openverify.sdk.chip.ChipReadFailure
import dev.openverify.sdk.flow.FakeFlowApi
import dev.openverify.sdk.flow.FakeFlowApi.Companion.DEFAULT_FLOW
import dev.openverify.sdk.flow.FakeFlowApi.Companion.INQUIRY_ID
import dev.openverify.sdk.flow.FakeFlowApi.Companion.NOW
import dev.openverify.sdk.flow.FakeFlowServer
import dev.openverify.sdk.flow.FlowCoordinator
import dev.openverify.sdk.flow.FlowError
import dev.openverify.sdk.flow.FlowProblemCodes
import dev.openverify.sdk.flow.FlowState
import dev.openverify.sdk.model.ClientUnableReason
import dev.openverify.sdk.model.CompletionStep
import dev.openverify.sdk.model.ConsentStep
import dev.openverify.sdk.model.EnvironmentKind
import dev.openverify.sdk.model.FileKind
import dev.openverify.sdk.model.FlowChipDeviceReport
import dev.openverify.sdk.model.FlowConsent
import dev.openverify.sdk.model.FlowEnvironment
import dev.openverify.sdk.model.FlowSandboxChip
import dev.openverify.sdk.model.FlowVerification
import dev.openverify.sdk.model.InquiryStatus
import dev.openverify.sdk.model.NfcPrefillMrz
import dev.openverify.sdk.model.NfcStep
import dev.openverify.sdk.model.RetryHint
import dev.openverify.sdk.model.SandboxChipScenario
import dev.openverify.sdk.model.VerificationStatus
import dev.openverify.sdk.model.VerificationType
import kotlin.io.encoding.Base64
import kotlin.time.Duration.Companion.minutes
import kotlin.time.Duration.Companion.seconds
import kotlin.time.TestTimeSource
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import okio.IOException
import org.junit.jupiter.api.Assertions.assertArrayEquals
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.junit.jupiter.params.ParameterizedTest
import org.junit.jupiter.params.provider.EnumSource

/**
 * C207 on the device and C208.2 (Workflow 10C nfc-sdk): the NFC step's controller, driven through
 * the real [FlowCoordinator] over [FakeFlowServer], a scripted [FakeChipReader], a [FakeNfcPhone]
 * and a frozen [TestTimeSource]. The device reads and the server verifies: nothing here is a verdict.
 */
internal class NfcStepControllerTest {

    private val time = TestTimeSource()
    private val settings = FlowCoordinator.Settings(pollInterval = 1.seconds, pollAttempts = 3, timeSource = time)
    private val consent = DEFAULT_FLOW.steps[0] as ConsentStep
    private val done = CompletionStep("done")
    private val prefill = NfcPrefillMrz("L898902C3", "740812", "120415")
    private val reader = FakeChipReader()
    private val phone = FakeNfcPhone()
    private val states = mutableListOf<FlowState>()
    private lateinit var server: FakeFlowServer

    private fun TestScope.flow(
        step: NfcStep = NfcStep("chip", prefillMrz = prefill),
        chipReader: FakeChipReader? = reader,
        nfcPhone: NfcPhone? = phone,
        verifications: List<FlowVerification> = emptyList(),
        sandbox: Boolean = false,
    ): FlowCoordinator {
        server = FakeFlowServer(
            steps = listOf(consent, step, done),
            consent = FlowConsent(NOW),
            verifications = verifications,
            environment = if (sandbox) FlowEnvironment(EnvironmentKind.SANDBOX) else null,
        )
        return coordinator(chipReader, nfcPhone)
    }

    private fun TestScope.coordinator(chipReader: FakeChipReader? = reader, nfcPhone: NfcPhone? = phone): FlowCoordinator {
        val coordinator = FlowCoordinator(server, INQUIRY_ID, settings, nfcEnvironment = NfcEnvironment(chipReader, phone = nfcPhone))
        states.clear()
        backgroundScope.launch(UnconfinedTestDispatcher(testScheduler)) { coordinator.state.collect { states += it } }
        return coordinator
    }

    private fun FlowCoordinator.view(): NfcView = (state.value as FlowState.Nfc).view

    private fun views(): List<NfcView> = states.filterIsInstance<FlowState.Nfc>().map { it.view }

    /** Sends [event] beside the test, as the view model does, and runs what is ready. */
    private fun TestScope.send(coordinator: FlowCoordinator, event: NfcEvent) {
        backgroundScope.launch { coordinator.nfc(event) }
        runCurrent()
    }

    /** The server's position leaves the step for the completion, scripted where a test decides no attempt. */
    private fun movesOn() {
        server.scripted = FakeFlowServer.Position("done", FakeFlowServer.State.ENDED, "chip")
    }

    private fun attempt(number: Int, status: VerificationStatus, vararg hints: RetryHint) =
        FakeFlowApi.verification("ver_01M5CK16P0D13FXHZSS4TCFC0$number", VerificationType.GOVERNMENT_ID_NFC, status, *hints)

    private val ready = NfcView.Tap(NfcPhase.READY, reader = true)

    // What the device can do (C207.9, C207.12) ------------------------------------------------

    @Test
    fun `without an installed reader the step says this app cannot read document chips, and calls nothing`() = runTest {
        val coordinator = flow(NfcStep("chip", fallbackAvailable = true), chipReader = null)

        coordinator.start()

        assertEquals(NfcView.CannotRead(NfcUnable.READER_NOT_INSTALLED, fallback = true), coordinator.view())
        assertEquals(listOf("getSession"), server.calls)
    }

    @Test
    fun `a phone without NFC, or a launch with no phone seam, says this phone cannot read document chips`() = runTest {
        phone.state = NfcAvailability.NO_HARDWARE
        val first = flow()
        first.start()
        assertEquals(NfcView.CannotRead(NfcUnable.NFC_UNAVAILABLE, fallback = false), first.view())

        val second = flow(nfcPhone = null)
        second.start()
        assertEquals(NfcView.CannotRead(NfcUnable.NFC_UNAVAILABLE, fallback = false), second.view())
    }

    @Test
    fun `with NFC off the step offers the settings, and reads the phone again when asked`() = runTest {
        phone.state = NfcAvailability.DISABLED
        val coordinator = flow()
        coordinator.start()
        assertEquals(NfcView.CannotRead(NfcUnable.NFC_DISABLED, fallback = false), coordinator.view())

        send(coordinator, NfcEvent.OpenNfcSettings)
        assertEquals(1, phone.settingsOpened)

        phone.state = NfcAvailability.READY
        send(coordinator, NfcEvent.Recheck)
        assertEquals(ready, coordinator.view())
        assertEquals(listOf("getSession"), server.calls)
    }

    // The access key (C207.2) ------------------------------------------------------------------

    @Test
    fun `a prefilled MRZ goes straight to the tap screen and opens the chip with its three fields`() = runTest {
        reader.succeeds()
        val coordinator = flow()
        coordinator.start()
        assertEquals(ready, coordinator.view())

        send(coordinator, NfcEvent.Ready())

        assertEquals(SPECIMEN_MRZ_INFORMATION, (reader.accesses.single() as ChipAccess.Mrz).seed.mrzInformation)
    }

    @Test
    fun `without a prefill the person types the MRZ's three values, normalised to ASCII before the chip sees them`() = runTest {
        reader.succeeds()
        val coordinator = flow(NfcStep("chip"))
        coordinator.start()
        assertEquals(NfcView.Entry(NfcAccessKind.MRZ), coordinator.view())

        // Lower case, a space, and Arabic-Indic digits typed under a non-Latin device locale (C196.3).
        send(coordinator, NfcEvent.MrzEntered(" l898902c3 ", "٧٤٠٨١٢", "۱۲۰۴۱۵"))

        assertEquals(ready.copy(editable = true), coordinator.view())
        assertEquals(listOf("getSession"), server.calls)
        send(coordinator, NfcEvent.Ready())
        assertEquals(SPECIMEN_MRZ_INFORMATION, (reader.accesses.single() as ChipAccess.Mrz).seed.mrzInformation)
    }

    @Test
    fun `values an MRZ cannot hold are refused on the entry screen, field by field`() = runTest {
        val coordinator = flow(NfcStep("chip"))
        coordinator.start()

        send(coordinator, NfcEvent.MrzEntered("", "740812", "120415"))
        assertEquals(NfcView.Entry(NfcAccessKind.MRZ, NfcEntryError.DOCUMENT_NUMBER), coordinator.view())
        send(coordinator, NfcEvent.MrzEntered("L8989#2C3", "740812", "120415"))
        assertEquals(NfcView.Entry(NfcAccessKind.MRZ, NfcEntryError.DOCUMENT_NUMBER), coordinator.view())
        send(coordinator, NfcEvent.MrzEntered("L898902C3", "741312", "120415"))
        assertEquals(NfcView.Entry(NfcAccessKind.MRZ, NfcEntryError.BIRTH_DATE), coordinator.view())
        send(coordinator, NfcEvent.MrzEntered("L898902C3", "740812", "1204"))
        assertEquals(NfcView.Entry(NfcAccessKind.MRZ, NfcEntryError.EXPIRY_DATE), coordinator.view())
        send(coordinator, NfcEvent.MrzEntered("L898902C3", "740812", "120432"))
        assertEquals(NfcView.Entry(NfcAccessKind.MRZ, NfcEntryError.EXPIRY_DATE), coordinator.view())
        assertEquals(listOf("getSession"), server.calls)
    }

    @Test
    fun `a card's CAN is six digits, typed on its own screen`() = runTest {
        reader.succeeds()
        val coordinator = flow(NfcStep("chip"))
        coordinator.start()

        send(coordinator, NfcEvent.ChooseAccess(NfcAccessKind.CAN))
        assertEquals(NfcView.Entry(NfcAccessKind.CAN), coordinator.view())
        send(coordinator, NfcEvent.CanEntered("12345"))
        assertEquals(NfcView.Entry(NfcAccessKind.CAN, NfcEntryError.CAN), coordinator.view())
        send(coordinator, NfcEvent.CanEntered("١٢٣٤٥٦"))
        assertEquals(ready.copy(editable = true), coordinator.view())

        send(coordinator, NfcEvent.Ready())
        assertEquals("123456", (reader.accesses.single() as ChipAccess.Can).can)

        send(coordinator, NfcEvent.ChooseAccess(NfcAccessKind.MRZ))
        assertEquals(NfcView.Entry(NfcAccessKind.MRZ), coordinator.view())
    }

    // The challenge, the tap and the review (C207.2, C207.5) --------------------------------------

    @Test
    fun `the challenge is requested only on I'm ready, then one tap reads and signs, and the review shows DG1 before any upload`() = runTest {
        reader.succeeds()
        val coordinator = flow()
        coordinator.start()
        assertEquals(listOf("getSession"), server.calls)

        send(coordinator, NfcEvent.Ready())

        assertEquals(listOf("getSession", "createVerification:government-id-nfc", "createChipChallenge"), server.calls)
        // The chip signs the nonce's eight bytes (C62.5).
        assertArrayEquals(byteArrayOf(0x01, 0x23, 0x45, 0x67, 0x89.toByte(), 0xAB.toByte(), 0xCD.toByte(), 0xE0.toByte()), reader.challenges.single())
        assertEquals(
            listOf(
                ready,
                ready.copy(phase = NfcPhase.REQUESTING),
                ready.copy(phase = NfcPhase.WAITING),
                ready.copy(phase = NfcPhase.CONNECTING),
                ready.copy(phase = NfcPhase.READING, file = FileKind.CHIP_SOD, percent = 100),
                ready.copy(phase = NfcPhase.READING, file = FileKind.CHIP_DG1, percent = 50),
                ready.copy(phase = NfcPhase.READING, file = FileKind.CHIP_DG1, percent = 100),
                ready.copy(phase = NfcPhase.SIGNING),
                ready.copy(phase = NfcPhase.READ),
                NfcView.Review(Dg1Details("ERIKSSON, ANNA MARIA", "L898902C3", "UTO", "740812", "120415")),
            ),
            views(),
        )
        assertTrue(server.chipFiles.isEmpty())
    }

    @Test
    fun `an initiated verification of the session is reused`() = runTest {
        reader.succeeds()
        val coordinator = flow(verifications = listOf(attempt(1, VerificationStatus.INITIATED)))
        coordinator.start()

        send(coordinator, NfcEvent.Ready())

        assertEquals(listOf("getSession", "createChipChallenge"), server.calls)
    }

    @Test
    fun `confirming uploads each file with its kind, submits within the challenge, drops the bytes and follows the server`() = runTest {
        val report = ChipDeviceReport(
            listOf(
                ChipDeviceReport.Attempt(ChipDeviceReport.Protocol.PACE, ChipDeviceReport.Outcome.FAILED),
                ChipDeviceReport.Attempt(ChipDeviceReport.Protocol.BAC, ChipDeviceReport.Outcome.SUCCEEDED),
                ChipDeviceReport.Attempt(ChipDeviceReport.Protocol.CHIP_AUTHENTICATION, ChipDeviceReport.Outcome.NOT_ATTEMPTED),
            ),
            readMillis = 4_200,
        )
        // A file kind the server does not take from a chip is never uploaded (C207.4).
        reader.succeeds(FakeChipReader.chipFiles() + (FileKind.FRONT to ByteArray(4)), report = report)
        val coordinator = flow()
        coordinator.start()
        send(coordinator, NfcEvent.Ready())
        server.decide(VerificationStatus.PASSED, InquiryStatus.COMPLETED)
        movesOn()

        send(coordinator, NfcEvent.ReviewConfirmed)
        advanceTimeBy(5.seconds)

        assertEquals(
            listOf(FileKind.CHIP_SOD to 7, FileKind.CHIP_DG1 to 93, FileKind.CHIP_DG2 to 9, FileKind.CHIP_DG15 to 5, FileKind.CHIP_COM to 3),
            server.chipFiles,
        )
        val submit = server.chipSubmits.single()
        assertEquals(server.chipChallenges.single().id to server.chipChallenges.single().nonce, submit.challengeId to submit.nonce)
        assertEquals(Base64.encode(byteArrayOf(1, 2, 3, 4)), submit.activeAuthenticationResponse)
        assertEquals(
            FlowChipDeviceReport(
                listOf(
                    FlowChipDeviceReport.Attempt("pace", "failed"),
                    FlowChipDeviceReport.Attempt("bac", "succeeded"),
                    FlowChipDeviceReport.Attempt("chip-authentication", "not-attempted"),
                ),
                readMs = 4_200,
            ),
            submit.deviceReport,
        )
        // C207.4, C207.6: the chip bytes are wiped once submitted.
        assertTrue(reader.handedOut.all { bytes -> bytes.all { it == 0.toByte() } })
        assertTrue(states.none { it is FlowState.Error }, states.toString())
        assertEquals(InquiryStatus.COMPLETED, (coordinator.state.value as FlowState.Completed).inquiryStatus)
        assertEquals(listOf("submitChip", "submit", "getVerification", "getSession"), server.calls.takeLast(4))
    }

    @Test
    fun `a chip without Active Authentication submits no response`() = runTest {
        reader.succeeds(response = null)
        val coordinator = flow()
        coordinator.start()
        send(coordinator, NfcEvent.Ready())
        server.decide(VerificationStatus.PASSED, InquiryStatus.COMPLETED)
        movesOn()

        send(coordinator, NfcEvent.ReviewConfirmed)
        advanceTimeBy(5.seconds)

        assertEquals(null, server.chipSubmits.single().activeAuthenticationResponse)
        assertEquals(null, server.chipSubmits.single().deviceReport)
    }

    @Test
    fun `this is not my data gives one new read on the same challenge, then nothing more, and uploads nothing`() = runTest {
        reader.succeeds()
        reader.succeeds()
        val coordinator = flow()
        coordinator.start()
        send(coordinator, NfcEvent.Ready())

        send(coordinator, NfcEvent.ReviewRefused)

        assertTrue(ready.copy(phase = NfcPhase.WAITING, notice = NfcNotice.READING_AGAIN) in views())
        assertEquals(true, (coordinator.view() as NfcView.Review).again)
        assertEquals(1, server.chipChallenges.size)
        assertEquals(2, reader.accesses.size)

        send(coordinator, NfcEvent.ReviewRefused)

        assertEquals(ready, coordinator.view())
        assertTrue(reader.handedOut.all { bytes -> bytes.all { it == 0.toByte() } })
        assertTrue(server.chipFiles.isEmpty() && server.chipSubmits.isEmpty())
        assertEquals(2, reader.accesses.size)
    }

    @Test
    fun `an unused challenge that expires returns to I'm ready, and the next press asks for a new one`() = runTest {
        val coordinator = flow()
        coordinator.start()
        send(coordinator, NfcEvent.Ready())
        assertEquals(ready.copy(phase = NfcPhase.WAITING), coordinator.view())

        time += 300.seconds
        advanceTimeBy(300.seconds)
        runCurrent()

        assertEquals(ready.copy(notice = NfcNotice.CHALLENGE_EXPIRED), coordinator.view())
        assertEquals(1, reader.canceled)
        assertFalse(reader.reading)

        reader.succeeds()
        send(coordinator, NfcEvent.Ready())
        assertEquals(2, server.chipChallenges.size)
        assertTrue(coordinator.view() is NfcView.Review)
    }

    @Test
    fun `twenty minutes on the tap screen cost nothing, and the read still works (C212_3)`() = runTest {
        reader.succeeds()
        val coordinator = flow()
        coordinator.start()

        time += 20.minutes
        advanceTimeBy(20.minutes)
        runCurrent()

        assertEquals(ready, coordinator.view())
        assertEquals(listOf("getSession"), server.calls)
        send(coordinator, NfcEvent.Ready())
        assertTrue(coordinator.view() is NfcView.Review)
        assertEquals(1, server.chipChallenges.size)
    }

    @Test
    fun `at most nine challenges are asked for a verification, and then the screen says why and offers another way`() = runTest {
        val coordinator = flow(NfcStep("chip", fallbackAvailable = true, prefillMrz = prefill))
        coordinator.start()

        repeat(9) {
            send(coordinator, NfcEvent.Ready())
            time += 300.seconds
            advanceTimeBy(300.seconds)
            runCurrent()
        }

        assertEquals(9, server.chipChallenges.size)
        assertEquals(NfcView.CannotRead(NfcUnable.CHALLENGES_SPENT, fallback = true), coordinator.view())

        send(coordinator, NfcEvent.Ready())
        assertEquals(9, server.chipChallenges.size)
        assertEquals(NfcView.CannotRead(NfcUnable.CHALLENGES_SPENT, fallback = true), coordinator.view())
    }

    @Test
    fun `a read that failed keeps its challenge for the next press`() = runTest {
        reader.fails(ChipReadFailure.TIMEOUT)
        reader.succeeds()
        val coordinator = flow()
        coordinator.start()

        send(coordinator, NfcEvent.Ready())
        assertEquals(ready.copy(notice = NfcNotice.TIMEOUT), coordinator.view())
        send(coordinator, NfcEvent.Ready())

        assertTrue(coordinator.view() is NfcView.Review)
        assertEquals(1, server.chipChallenges.size)
    }

    // Every way a read fails (C207.3, C207.5) -----------------------------------------------------

    @Test
    fun `a lifted document says keep it still and the read goes on with the same challenge`() = runTest {
        reader.fails(ChipReadFailure.TAG_LOST)
        reader.succeeds()
        val coordinator = flow()
        coordinator.start()

        send(coordinator, NfcEvent.Ready())

        assertTrue(ready.copy(phase = NfcPhase.WAITING, notice = NfcNotice.KEEP_STILL) in views())
        assertTrue(coordinator.view() is NfcView.Review)
        assertEquals(1, server.chipChallenges.size)
    }

    @Test
    fun `a document lifted as often as the step has attempts returns to I'm ready`() = runTest {
        repeat(3) { reader.fails(ChipReadFailure.TAG_LOST) }
        val coordinator = flow()
        coordinator.start()

        send(coordinator, NfcEvent.Ready())

        assertEquals(ready.copy(notice = NfcNotice.LIFTED), coordinator.view())
        assertEquals(3, reader.accesses.size)
    }

    @ParameterizedTest
    @EnumSource(ChipReadFailure::class, names = ["TAG_LOST"], mode = EnumSource.Mode.EXCLUDE)
    fun `each other failure has its own screen, and nothing is uploaded`(failure: ChipReadFailure) = runTest {
        reader.script += { throw ChipReadException(failure) }
        val coordinator = flow(NfcStep("chip"))
        coordinator.start()
        send(coordinator, NfcEvent.MrzEntered("L898902C3", "740812", "120415"))

        send(coordinator, NfcEvent.Ready())

        val typed = ready.copy(editable = true)
        val expected = when (failure) {
            ChipReadFailure.ACCESS_DENIED -> NfcView.Entry(NfcAccessKind.MRZ, NfcEntryError.REFUSED_BY_CHIP)
            ChipReadFailure.UNSUPPORTED_DOCUMENT -> typed.copy(notice = NfcNotice.UNSUPPORTED_DOCUMENT)
            ChipReadFailure.TIMEOUT -> typed.copy(notice = NfcNotice.TIMEOUT)
            ChipReadFailure.NFC_DISABLED -> NfcView.CannotRead(NfcUnable.NFC_DISABLED, fallback = false)
            ChipReadFailure.READER_BUSY -> typed.copy(notice = NfcNotice.READER_BUSY)
            ChipReadFailure.TAG_LOST -> error("excluded")
        }
        assertEquals(expected, coordinator.view())
        assertTrue(server.chipFiles.isEmpty() && server.chipSubmits.isEmpty())
    }

    @Test
    fun `a reader that throws anything else stops the read without an error screen`() = runTest {
        reader.script += { error("synthetic reader fault") }
        val coordinator = flow()
        coordinator.start()

        send(coordinator, NfcEvent.Ready())

        assertEquals(ready.copy(notice = NfcNotice.READ_FAILED), coordinator.view())
    }

    @Test
    fun `a read without a security object or a readable DG1, or with a file over its size, is not a chip's files`() = runTest {
        val files = FakeChipReader.chipFiles()
        reader.succeeds(files - FileKind.CHIP_SOD)
        reader.succeeds(files + (FileKind.CHIP_DG1 to "synthetic".encodeToByteArray()))
        reader.succeeds(files + (FileKind.CHIP_DG2 to ByteArray(1024 * 1024 + 1)))
        reader.succeeds(files + (FileKind.CHIP_DG15 to ByteArray(64 * 1024 + 1)))
        reader.succeeds(files, response = ByteArray(1025))
        val coordinator = flow()
        coordinator.start()

        repeat(5) {
            send(coordinator, NfcEvent.Ready())
            assertEquals(ready.copy(notice = NfcNotice.UNSUPPORTED_DOCUMENT), coordinator.view())
        }
        assertTrue(server.chipFiles.isEmpty())
    }

    // The reader is on only while the tap screen is resumed (C207.5) --------------------------------

    @Test
    fun `leaving the tap screen turns the reader off, and coming back turns it on while the challenge lives`() = runTest {
        val coordinator = flow()
        coordinator.start()
        send(coordinator, NfcEvent.Resumed)
        assertEquals(listOf("getSession"), server.calls)
        send(coordinator, NfcEvent.Ready())
        assertTrue(reader.reading)

        send(coordinator, NfcEvent.Paused)
        assertFalse(reader.reading)
        assertEquals(ready, coordinator.view())

        time += 100.seconds
        send(coordinator, NfcEvent.Resumed)
        assertTrue(reader.reading)
        assertEquals(ready.copy(phase = NfcPhase.WAITING), coordinator.view())
        assertEquals(1, server.chipChallenges.size)

        send(coordinator, NfcEvent.Paused)
        time += 200.seconds
        send(coordinator, NfcEvent.Resumed)
        assertFalse(reader.reading)
        assertEquals(ready.copy(notice = NfcNotice.CHALLENGE_EXPIRED), coordinator.view())
    }

    @Test
    fun `stopping a read shows the troubleshooting tips, and trying again returns to I'm ready`() = runTest {
        val coordinator = flow()
        coordinator.start()
        send(coordinator, NfcEvent.Ready())

        send(coordinator, NfcEvent.StopRead)
        assertEquals(NfcView.Tips, coordinator.view())
        assertFalse(reader.reading)

        send(coordinator, NfcEvent.TryAgain)
        assertEquals(ready, coordinator.view())
    }

    // Upload, submit and the single-use rule (C207.2, C193.5) ---------------------------------------

    @Test
    fun `a submit the server refuses for its challenge asks for one more tap with a fresh challenge`() = runTest {
        reader.succeeds()
        reader.succeeds()
        val coordinator = flow()
        coordinator.start()
        send(coordinator, NfcEvent.Ready())
        server.failNext("submitChip", FakeFlowApi.conflict(FlowProblemCodes.CHIP_CHALLENGE_INVALID))

        send(coordinator, NfcEvent.ReviewConfirmed)

        assertEquals(ready.copy(notice = NfcNotice.ONE_MORE_TAP), coordinator.view())
        assertTrue(states.none { it is FlowState.Error }, states.toString())
        // The session was read first: an earlier send may have landed (C193.5).
        assertEquals(listOf("submitChip", "getSession"), server.calls.takeLast(2))

        send(coordinator, NfcEvent.Ready())
        assertEquals(2, server.chipChallenges.size)
        server.decide(VerificationStatus.PASSED, InquiryStatus.COMPLETED)
        movesOn()
        send(coordinator, NfcEvent.ReviewConfirmed)
        advanceTimeBy(5.seconds)
        assertEquals(server.chipChallenges[1].id, server.chipSubmits.single().challengeId)
        assertTrue(coordinator.state.value is FlowState.Completed)
    }

    @Test
    fun `a submit that landed and whose resend got a 409 follows the session, with no error screen`() = runTest {
        reader.succeeds()
        val coordinator = flow()
        coordinator.start()
        send(coordinator, NfcEvent.Ready())
        server.loseAnswerOfNext("submit", FakeFlowApi.conflict(FlowProblemCodes.CHIP_CHALLENGE_INVALID))
        server.decide(VerificationStatus.PASSED, InquiryStatus.COMPLETED)

        send(coordinator, NfcEvent.ReviewConfirmed)
        runCurrent()
        // The session shows the attempt submitted: the checking screen asks for the decision.
        assertEquals(NfcView.Checking, coordinator.view())
        movesOn()
        send(coordinator, NfcEvent.Check)
        advanceTimeBy(5.seconds)

        assertTrue(states.none { it is FlowState.Error }, states.toString())
        assertTrue(coordinator.state.value is FlowState.Completed, coordinator.state.value.toString())
    }

    @Test
    fun `a failed upload shows the error and its retry sends only what is missing`() = runTest {
        reader.succeeds()
        val coordinator = flow()
        coordinator.start()
        send(coordinator, NfcEvent.Ready())
        server.failNext("uploadChipFile", FlowApiException.Network(IOException("synthetic")))
        server.decide(VerificationStatus.PASSED, InquiryStatus.COMPLETED)
        movesOn()

        send(coordinator, NfcEvent.ReviewConfirmed)
        assertEquals(FlowState.Error(FlowError.NETWORK, canRetry = true), coordinator.state.value)

        backgroundScope.launch { coordinator.retry() }
        advanceTimeBy(5.seconds)

        assertEquals(listOf(FileKind.CHIP_SOD, FileKind.CHIP_DG1, FileKind.CHIP_DG2, FileKind.CHIP_DG15, FileKind.CHIP_COM), server.chipFiles.map { it.first })
        assertTrue(coordinator.state.value is FlowState.Completed, coordinator.state.value.toString())
    }

    @Test
    fun `a challenge the server will not make reads the session, with no error screen`() = runTest {
        val coordinator = flow()
        coordinator.start()
        server.failNext("createChipChallenge", FakeFlowApi.conflict(FlowProblemCodes.CHIP_CHALLENGE_INVALID))

        send(coordinator, NfcEvent.Ready())

        assertTrue(states.none { it is FlowState.Error }, states.toString())
        assertEquals(listOf("createChipChallenge", "getSession"), server.calls.takeLast(2))
        assertEquals(ready, coordinator.view())
    }

    @Test
    fun `a challenge request that fails on the network shows the error, and its retry goes on`() = runTest {
        reader.succeeds()
        val coordinator = flow()
        coordinator.start()
        server.failNext("createChipChallenge", FlowApiException.Network(IOException("synthetic")))

        send(coordinator, NfcEvent.Ready())
        assertEquals(FlowState.Error(FlowError.NETWORK, canRetry = true), coordinator.state.value)

        backgroundScope.launch { coordinator.retry() }
        runCurrent()
        assertTrue(coordinator.view() is NfcView.Review)
    }

    // Client unable (C207.9) ------------------------------------------------------------------------

    @ParameterizedTest
    @EnumSource(NfcUnable::class, names = ["CHALLENGES_SPENT"], mode = EnumSource.Mode.EXCLUDE)
    fun `use another way reports why this client cannot read, once, and reads the session`(unable: NfcUnable) = runTest {
        phone.state = when (unable) {
            NfcUnable.NFC_UNAVAILABLE -> NfcAvailability.NO_HARDWARE
            NfcUnable.NFC_DISABLED -> NfcAvailability.DISABLED
            else -> NfcAvailability.READY
        }
        val coordinator = flow(NfcStep("chip", fallbackAvailable = true), chipReader = reader.takeIf { unable != NfcUnable.READER_NOT_INSTALLED })
        coordinator.start()
        assertEquals(NfcView.CannotRead(unable, fallback = true), coordinator.view())

        send(coordinator, NfcEvent.UseAnotherWay)

        val reason = when (unable) {
            NfcUnable.READER_NOT_INSTALLED -> ClientUnableReason.READER_NOT_INSTALLED
            NfcUnable.NFC_UNAVAILABLE -> ClientUnableReason.NFC_UNAVAILABLE
            else -> ClientUnableReason.NFC_DISABLED_DECLINED
        }
        assertEquals(listOf(server.verifications.single().id to reason), server.clientUnableReports)
        assertEquals(listOf("getSession", "createVerification:government-id-nfc", "reportClientUnable", "getSession"), server.calls)
        assertTrue(NfcView.CannotRead(unable, fallback = true, busy = true) in views())
    }

    @Test
    fun `another way after the challenges are spent reports a read that failed, never a phone without NFC`() = runTest {
        val coordinator = flow(NfcStep("chip", fallbackAvailable = true, prefillMrz = prefill))
        coordinator.start()
        repeat(9) {
            send(coordinator, NfcEvent.Ready())
            time += 300.seconds
            advanceTimeBy(300.seconds)
            runCurrent()
        }
        assertEquals(NfcView.CannotRead(NfcUnable.CHALLENGES_SPENT, fallback = true), coordinator.view())

        send(coordinator, NfcEvent.UseAnotherWay)

        // This phone has NFC and a reader: the report says what happened (C207.9; Workflow 10C Stage 3).
        assertEquals(listOf("read_failed"), server.clientUnableReports.map { it.second.wireValue })
    }

    @Test
    fun `after the report the server's own walk takes the step's fallback, with no position scripted`() = runTest {
        // The fake server walks an nfc step as the engine does: the report cancels the attempt and
        // the step is left through its exhausted edge, whatever attempts remain (C207.9, C150.6).
        server = FakeFlowServer(
            steps = listOf(consent, NfcStep("chip", fallbackAvailable = true), done),
            consent = FlowConsent(NOW),
            fallbacks = mapOf("chip" to "done"),
        )
        val coordinator = coordinator(chipReader = null)
        coordinator.start()
        assertEquals(NfcView.CannotRead(NfcUnable.READER_NOT_INSTALLED, fallback = true), coordinator.view())

        send(coordinator, NfcEvent.UseAnotherWay)

        advanceTimeBy(10.seconds)
        runCurrent()

        assertEquals(VerificationStatus.CANCELED, server.verifications.single().attributes.status)
        assertEquals("done", server.served.last().stepId)
        assertFalse(coordinator.state.value is FlowState.Nfc, "the flow still showed ${coordinator.state.value}")
    }

    @Test
    fun `without a fallback nothing is reported`() = runTest {
        val coordinator = flow(chipReader = null)
        coordinator.start()

        send(coordinator, NfcEvent.UseAnotherWay)

        assertEquals(listOf("getSession"), server.calls)
    }

    @Test
    fun `a client-unable report the server refuses reads the session, with no error screen`() = runTest {
        val coordinator = flow(NfcStep("chip", fallbackAvailable = true), chipReader = null)
        coordinator.start()
        server.failNext("reportClientUnable", FakeFlowApi.conflict(FlowProblemCodes.CLIENT_UNABLE_NOT_ALLOWED))

        send(coordinator, NfcEvent.UseAnotherWay)

        assertTrue(states.none { it is FlowState.Error }, states.toString())
        assertEquals(listOf("reportClientUnable", "getSession"), server.calls.takeLast(2))
    }

    // The sandbox test chip (C208.2) ----------------------------------------------------------------

    @Test
    fun `the sandbox test chip is offered only when the server says so, and its read, review, upload and submit are the real ones`() = runTest {
        val coordinator = flow(NfcStep("chip", sandboxChipAvailable = true), chipReader = null, sandbox = true)
        server.sandboxChip = FlowSandboxChip(
            files = listOf(
                FlowSandboxChip.File(FileKind.CHIP_SOD, Base64.encode(ByteArray(7) { 0x77 })),
                FlowSandboxChip.File(FileKind.CHIP_DG1, Base64.encode(dg1Of())),
                FlowSandboxChip.File(FileKind.CHIP_DG15, Base64.encode(ByteArray(5) { 0x6F })),
            ),
            dg2Attached = true,
            activeAuthenticationResponse = Base64.encode(byteArrayOf(9, 8, 7)),
        )
        coordinator.start()
        assertEquals(NfcView.Tap(NfcPhase.READY, reader = false, sandbox = true), coordinator.view())

        send(coordinator, NfcEvent.Ready(SandboxChipScenario.MRZ_MISMATCH))

        assertEquals(listOf(server.chipChallenges.single().id to SandboxChipScenario.MRZ_MISMATCH), server.sandboxChipRequests)
        assertEquals("L898902C3", (coordinator.view() as NfcView.Review).details.documentNumber)
        server.decide(VerificationStatus.FAILED, InquiryStatus.PENDING, RetryHint("chip"))
        send(coordinator, NfcEvent.ReviewConfirmed)
        advanceTimeBy(5.seconds)

        // DG2 is the server's (dg2-attached): the client never uploads it.
        assertEquals(listOf(FileKind.CHIP_SOD to 7, FileKind.CHIP_DG1 to 93, FileKind.CHIP_DG15 to 5), server.chipFiles)
        assertEquals(Base64.encode(byteArrayOf(9, 8, 7)), server.chipSubmits.single().activeAuthenticationResponse)
        assertEquals(null, server.chipSubmits.single().deviceReport)
        // The server decided: a failed attempt with a hint and attempts left starts again.
        assertEquals(NfcView.Tap(NfcPhase.READY, reader = false, sandbox = true, hints = listOf(RetryHint("chip"))), coordinator.view())
    }

    @Test
    fun `a sandbox read is ignored where the server does not offer it, and an installed reader's press where there is none`() = runTest {
        val coordinator = flow()
        coordinator.start()
        send(coordinator, NfcEvent.Ready(SandboxChipScenario.MATCH))
        assertEquals(listOf("getSession"), server.calls)

        val sandboxOnly = flow(NfcStep("chip", sandboxChipAvailable = true), chipReader = null)
        sandboxOnly.start()
        send(sandboxOnly, NfcEvent.Ready())
        assertEquals(listOf("getSession"), server.calls)
    }

    @Test
    fun `beside an installed reader the test chip is offered on the entry and tap screens`() = runTest {
        val coordinator = flow(NfcStep("chip", sandboxChipAvailable = true))
        coordinator.start()
        assertEquals(NfcView.Entry(NfcAccessKind.MRZ, sandbox = true), coordinator.view())

        phone.state = NfcAvailability.NO_HARDWARE
        send(coordinator, NfcEvent.Recheck)
        assertEquals(NfcView.CannotRead(NfcUnable.NFC_UNAVAILABLE, fallback = false, sandbox = true), coordinator.view())
    }

    // Resuming and the server's position (C193.4, C207.6, C207.7) -----------------------------------

    @Test
    fun `after process death the step restarts from the tap, and nothing read is restored or sent`() = runTest {
        reader.succeeds()
        val first = flow()
        first.start()
        send(first, NfcEvent.Ready())
        assertTrue(first.view() is NfcView.Review)

        val relaunched = coordinator()
        relaunched.start()

        assertEquals(ready, relaunched.view())
        send(relaunched, NfcEvent.ReviewConfirmed)
        assertTrue(server.chipFiles.isEmpty() && server.chipSubmits.isEmpty())
        assertEquals(1, server.verifications.size)
    }

    @Test
    fun `a submitted attempt is checked until the server decides, then the position is rendered`() = runTest {
        val coordinator = flow(verifications = listOf(attempt(1, VerificationStatus.SUBMITTED)))
        coordinator.start()
        assertEquals(NfcView.Checking, coordinator.view())
        server.undecidedPolls = 1
        server.decide(VerificationStatus.PASSED, InquiryStatus.COMPLETED)
        movesOn()

        send(coordinator, NfcEvent.Check)
        advanceTimeBy(10.seconds)

        assertTrue(coordinator.state.value is FlowState.Completed, coordinator.state.value.toString())
        assertTrue(FlowState.Processing(NfcStep("chip", prefillMrz = prefill)) in states)
    }

    @Test
    fun `a decision that never comes ends on the still-processing error`() = runTest {
        val coordinator = flow(verifications = listOf(attempt(1, VerificationStatus.SUBMITTED)))
        coordinator.start()
        server.undecidedPolls = 100

        send(coordinator, NfcEvent.Check)
        advanceTimeBy(200.seconds)

        assertEquals(FlowState.Error(FlowError.STILL_PROCESSING, canRetry = true), coordinator.state.value)
    }

    @Test
    fun `a step whose attempts are used up waits for the server's position and makes no attempt`() = runTest {
        val failed = (1..3).map { attempt(it, VerificationStatus.FAILED, RetryHint("chip")) }
        val coordinator = flow(verifications = failed)
        server.scripted = FakeFlowServer.Position("chip", FakeFlowServer.State.ACTIVE, "consent")
        coordinator.start()
        assertEquals(NfcView.Checking, coordinator.view())

        send(coordinator, NfcEvent.Check)
        advanceTimeBy(1.seconds)
        movesOn()
        server.inquiry = server.inquiry.copy(status = InquiryStatus.COMPLETED)
        advanceTimeBy(5.seconds)

        assertTrue(coordinator.state.value is FlowState.Completed, coordinator.state.value.toString())
        assertTrue(server.calls.none { it.startsWith("createVerification") || it == "createChipChallenge" })
    }

    @Test
    fun `a failed attempt with a hint and attempts left starts again with the hint, and one without waits`() = runTest {
        val retry = flow(NfcStep("chip"), verifications = listOf(attempt(1, VerificationStatus.FAILED, RetryHint("chip"))))
        retry.start()
        assertEquals(NfcView.Entry(NfcAccessKind.MRZ, hints = listOf(RetryHint("chip"))), retry.view())

        val never = flow(verifications = listOf(attempt(1, VerificationStatus.FAILED)))
        server.scripted = FakeFlowServer.Position("chip", FakeFlowServer.State.ACTIVE, "consent")
        never.start()
        assertEquals(NfcView.Checking, never.view())

        val unknown = flow(verifications = listOf(attempt(1, VerificationStatus.UNKNOWN)))
        unknown.start()
        assertEquals(FlowState.Unsupported("verification status unknown"), unknown.state.value)
    }

    // Nothing typed or read is printed (rule 11) -----------------------------------------------------

    @Test
    fun `events that carry typed values never print them`() {
        assertEquals("NfcEvent.MrzEntered(<redacted>)", NfcEvent.MrzEntered("L898902C3", "740812", "120415").toString())
        assertEquals("NfcEvent.CanEntered(<redacted>)", NfcEvent.CanEntered("123456").toString())
    }
}
