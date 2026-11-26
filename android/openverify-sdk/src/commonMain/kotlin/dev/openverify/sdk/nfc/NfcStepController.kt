@file:OptIn(ExperimentalOpenVerifyApi::class)

package dev.openverify.sdk.nfc

import dev.openverify.sdk.ExperimentalOpenVerifyApi
import dev.openverify.sdk.api.FlowApi
import dev.openverify.sdk.api.FlowApiException
import dev.openverify.sdk.chip.ChipAccess
import dev.openverify.sdk.chip.ChipDeviceReport
import dev.openverify.sdk.chip.ChipProgress
import dev.openverify.sdk.chip.ChipRead
import dev.openverify.sdk.chip.ChipReadException
import dev.openverify.sdk.chip.ChipReadFailure
import dev.openverify.sdk.chip.ChipReader
import dev.openverify.sdk.flow.FlowProblemCodes
import dev.openverify.sdk.flow.FlowState
import dev.openverify.sdk.flow.logic.normalizeDigits
import dev.openverify.sdk.flow.stepMaxAttempts
import dev.openverify.sdk.log.SdkLog
import dev.openverify.sdk.model.ClientUnableReason
import dev.openverify.sdk.model.FileKind
import dev.openverify.sdk.model.FlowChipChallenge
import dev.openverify.sdk.model.FlowChipDeviceReport
import dev.openverify.sdk.model.FlowChipSubmit
import dev.openverify.sdk.model.FlowPositionState
import dev.openverify.sdk.model.FlowSession
import dev.openverify.sdk.model.NfcStep
import dev.openverify.sdk.model.RetryHint
import dev.openverify.sdk.model.SandboxChipScenario
import dev.openverify.sdk.model.VerificationStatus
import dev.openverify.sdk.model.VerificationType
import dev.openverify.sdk.mrz.BacKeySeed
import kotlin.concurrent.Volatile
import kotlin.coroutines.cancellation.CancellationException
import kotlin.io.encoding.Base64
import kotlin.time.ComparableTimeMark
import kotlin.time.Duration
import kotlin.time.Duration.Companion.seconds
import kotlin.time.TimeSource
import kotlinx.coroutines.Job
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/**
 * C207 (Workflow 10C): the NFC step's work on the device. `FlowCoordinator` (shared) routes an
 * `nfc` position here through three hooks:
 * - `resolve(session, step)`, called for an [NfcStep] on every render: the state to show;
 * - `handle(event)`, called for every [NfcEvent] the NFC screens send through `FlowActions.nfc`,
 *   each in a coroutine of its own (so a read in one event can be stopped by another);
 * - [NfcStepHost], the coordinator's side.
 *
 * The sequence (C207.2): the access key (the prefilled MRZ, or the MRZ or CAN entry); the tap
 * screen, where the chip challenge is requested only when the person presses "I'm ready" and the
 * reader is turned on then; the read; the DG1 review; upload and submit; the server's decision and
 * position. The device reads and the server verifies (C207.11): nothing here decides, and the step
 * never advances on its own (C193.3).
 *
 * Everything is in memory (C207.4, C207.6): the access key, the challenge and the files live in this
 * object only, the files are wiped after the submit or when they are dropped, and a new launch
 * starts from the tap with nothing restored.
 */
internal class NfcStepController(private val host: NfcStepHost, private val environment: NfcEnvironment) {
    private var step: NfcStep? = null
    private var shown: NfcView? = null

    /** The verification this step works on, once the session showed it or this object created it. */
    private var verificationId: String? = null

    /** A create got no readable answer: the session says whether it happened (as the other steps do). */
    private var createUnconfirmed = false
    private var hints: List<RetryHint> = emptyList()

    /** The access key: the prefilled MRZ, or what the person typed ([typed]). Never printed, never saved. */
    private var access: ChipAccess? = null
    private var typed = false
    private var entryKind = NfcAccessKind.MRZ

    /** The person chose to type, or the chip refused the prefilled key: the prefill is not used again. */
    private var manual = false

    /** The challenges asked for [verificationId] by this object (C207.2: at most [MAX_CHALLENGES]). */
    private var challengesAsked = 0
    private var challenge: OpenChallenge? = null

    /** The scenario of the sandbox test chip being read, or `null` for the installed reader. */
    private var scenario: SandboxChipScenario? = null
    private var pending: PendingRead? = null
    private var refusals = 0
    private val uploaded = mutableSetOf<FileKind>()

    /** The verification whose decision the checking screen waits for. */
    private var awaiting: String? = null
    private var requesting = false
    private var reading: Job? = null
    private var stopped: Stop? = null

    /** The tap screen is not resumed: the reader stays off (C207.5). */
    private var paused = false

    /** A read was stopped, or not started, because the tap screen was not resumed: it starts on resume. */
    private var interrupted = false

    /** A chip answered in the running read; an expiring challenge does not stop such a read. */
    @Volatile
    private var connected = false

    /** What the `nfc` position shows on this device for [session]. Reads the phone, calls no route. */
    fun resolve(session: FlowSession, step: NfcStep): FlowState {
        this.step = step
        stop(Stop.SUPERSEDED)
        dropPending()
        val attempts = session.verifications.filter { it.verificationType == VerificationType.GOVERNMENT_ID_NFC }
        val latest = attempts.lastOrNull()
        return when (val stage = stageOf(session, step)) {
            Stage.Unknown -> FlowState.Unsupported(STATUS_UNKNOWN_REASON)
            Stage.Await -> {
                awaiting = latest?.id?.takeIf { latest.attributes.status in UNDECIDED }
                state(step, NfcView.Checking)
            }
            is Stage.Work -> {
                if (stage.reusable != verificationId) {
                    // Another attempt (or none yet): its challenges and files are its own.
                    verificationId = stage.reusable
                    challengesAsked = 0
                    challenge = null
                    refusals = 0
                    uploaded.clear()
                }
                awaiting = null
                hints = stage.hints
                state(step, deviceView())
            }
        }
    }

    /** One event of the NFC screens (`FlowActions.nfc`). */
    suspend fun handle(event: NfcEvent) {
        val step = step ?: return
        when (event) {
            is NfcEvent.MrzEntered -> mrzEntered(step, event)
            is NfcEvent.CanEntered -> canEntered(step, event)
            is NfcEvent.ChooseAccess -> {
                stop(Stop.SUPERSEDED)
                dropPending()
                access = null
                manual = true
                entryKind = event.kind
                show(NfcView.Entry(event.kind, hints = hints, sandbox = step.sandboxChipAvailable))
            }
            is NfcEvent.Ready -> ready(step, event.sandbox)
            NfcEvent.Resumed -> {
                paused = false
                resumed(step)
            }
            NfcEvent.Paused -> {
                paused = true
                stop(Stop.PAUSED)
            }
            NfcEvent.StopRead -> if (reading?.isActive == true) stop(Stop.BY_PERSON) else show(NfcView.Tips)
            NfcEvent.TryAgain -> show(deviceView())
            NfcEvent.ReviewConfirmed -> if (pending != null) upload(step)
            NfcEvent.ReviewRefused -> reviewRefused(step)
            NfcEvent.UseAnotherWay -> useAnotherWay(step)
            NfcEvent.OpenNfcSettings -> environment.phone?.openSettings()
            NfcEvent.Recheck -> show(deviceView())
            NfcEvent.Check -> check(step)
        }
    }

    // What the device can do -------------------------------------------------------------------

    /**
     * The screen for what this device offers now (C207.9, C207.12): a "cannot read document chips"
     * screen, the access entry, or the tap screen at "I'm ready" with [notice].
     */
    private fun deviceView(notice: NfcNotice? = null): NfcView {
        val step = checkNotNull(step)
        val sandbox = step.sandboxChipAvailable
        if (challengesAsked >= MAX_CHALLENGES && !alive(challenge)) {
            return NfcView.CannotRead(NfcUnable.CHALLENGES_SPENT, step.fallbackAvailable)
        }
        val unable = when {
            environment.chipReader == null -> NfcUnable.READER_NOT_INSTALLED
            else -> when (environment.phone?.availability() ?: NfcAvailability.NO_HARDWARE) {
                NfcAvailability.NO_HARDWARE -> NfcUnable.NFC_UNAVAILABLE
                NfcAvailability.DISABLED -> NfcUnable.NFC_DISABLED
                NfcAvailability.READY -> null
            }
        }
        return when {
            // No reader, and the server offers its test chip: the tap screen with that alone (C208.2).
            unable == NfcUnable.READER_NOT_INSTALLED && sandbox ->
                NfcView.Tap(NfcPhase.READY, reader = false, sandbox = true, notice = notice, hints = hints)
            unable != null -> NfcView.CannotRead(unable, step.fallbackAvailable, sandbox)
            else -> {
                if (access == null && !manual) access = prefilled(step)
                if (access == null) {
                    NfcView.Entry(entryKind, hints = hints, sandbox = sandbox)
                } else {
                    NfcView.Tap(NfcPhase.READY, reader = true, sandbox = sandbox, editable = typed, notice = notice, hints = hints)
                }
            }
        }
    }

    /** C207.2: the access key the server prefilled from the inquiry's government ID, when an MRZ can hold it. */
    private fun prefilled(step: NfcStep): ChipAccess? {
        val mrz = step.prefillMrz ?: return null
        return try {
            ChipAccess.Mrz(BacKeySeed(mrz.documentNumber, mrz.birthDate, mrz.expiryDate)).also { typed = false }
        } catch (_: IllegalArgumentException) {
            null
        }
    }

    // The access entry (C207.2) --------------------------------------------------------------------

    private fun mrzEntered(step: NfcStep, event: NfcEvent.MrzEntered) {
        // ASCII only: Kotlin's `uppercase` is locale-free, and Arabic-Indic digits become 0 to 9 (C196.3).
        val number = normalizeDigits(event.documentNumber).filterNot { it.isWhitespace() }.uppercase()
        val birth = normalizeDigits(event.birthDate).trim()
        val expiry = normalizeDigits(event.expiryDate).trim()
        val error = when {
            !DOCUMENT_NUMBER.matches(number) -> NfcEntryError.DOCUMENT_NUMBER
            !isDate(birth) -> NfcEntryError.BIRTH_DATE
            !isDate(expiry) -> NfcEntryError.EXPIRY_DATE
            else -> null
        }
        val seed = if (error != null) {
            null
        } else {
            try {
                BacKeySeed(number, birth, expiry)
            } catch (_: IllegalArgumentException) {
                null
            }
        }
        if (seed == null) {
            show(NfcView.Entry(NfcAccessKind.MRZ, error ?: NfcEntryError.DOCUMENT_NUMBER, hints, step.sandboxChipAvailable))
            return
        }
        entered(NfcAccessKind.MRZ, ChipAccess.Mrz(seed))
    }

    private fun canEntered(step: NfcStep, event: NfcEvent.CanEntered) {
        val can = normalizeDigits(event.can).trim()
        if (!CAN.matches(can)) {
            show(NfcView.Entry(NfcAccessKind.CAN, NfcEntryError.CAN, hints, step.sandboxChipAvailable))
            return
        }
        entered(NfcAccessKind.CAN, ChipAccess.Can(can))
    }

    private fun entered(kind: NfcAccessKind, key: ChipAccess) {
        entryKind = kind
        access = key
        typed = true
        manual = true
        show(deviceView())
    }

    // "I'm ready", the challenge and the read (C207.2, C207.5) ---------------------------------------

    private suspend fun ready(step: NfcStep, sandbox: SandboxChipScenario?) {
        if (requesting || reading?.isActive == true || pending != null) return
        if (sandbox != null) {
            if (!step.sandboxChipAvailable) return
        } else {
            if (environment.chipReader == null) return
            // The phone may have changed since the screen was drawn; the access key may be gone.
            val view = deviceView()
            if (view !is NfcView.Tap) {
                show(view)
                return
            }
        }
        scenario = sandbox
        startRead(step, notice = null)
    }

    /** Reads with the open challenge while it lives, else asks for a new one first. */
    private suspend fun startRead(step: NfcStep, notice: NfcNotice?) {
        val open = challenge?.takeIf(::alive) ?: requestChallenge(step) ?: return
        read(step, open, notice)
    }

    /**
     * C207.2: a new chip challenge for the verification, at most [MAX_CHALLENGES] of them. A 409
     * (the verification was canceled at the server's limit, or the position moved) reads the session
     * and renders its position (C193.5); `null` when no challenge was made.
     */
    private suspend fun requestChallenge(step: NfcStep): OpenChallenge? {
        challenge = null
        if (challengesAsked >= MAX_CHALLENGES) {
            show(deviceView())
            return null
        }
        show(tap(step, NfcPhase.REQUESTING))
        requesting = true
        return try {
            val wire = host.api.createChipChallenge(verification())
            challengesAsked += 1
            OpenChallenge(wire, host.timeSource.markNow()).also { challenge = it }
        } catch (error: FlowApiException) {
            if (error is FlowApiException.Conflict) host.readAndRender() else host.failed(error) { startRead(step, notice = null) }
            null
        } finally {
            requesting = false
        }
    }

    /** Creates the step's verification, at most once: a create whose answer was lost is looked up in the session first. */
    private suspend fun verification(): String {
        verificationId?.let { return it }
        if (createUnconfirmed) {
            createUnconfirmed = false
            val created = host.api.getSession().verifications
                .lastOrNull { it.verificationType == VerificationType.GOVERNMENT_ID_NFC }
                ?.takeIf { it.attributes.status == VerificationStatus.INITIATED }
                ?.id
            if (created != null) return created.also { verificationId = it }
        }
        return try {
            host.api.createVerification(VerificationType.GOVERNMENT_ID_NFC).id.also { verificationId = it }
        } catch (unread: FlowApiException) {
            if (unread is FlowApiException.Network || unread is FlowApiException.InvalidResponse) createUnconfirmed = true
            throw unread
        }
    }

    /**
     * One tap (C207.2): the reader is on from here until it returns, fails or is stopped. A lifted
     * document says "keep it still" and the read goes on with the same challenge, as often as the
     * step has attempts. A challenge that expires before a chip answered stops the read and returns
     * to "I'm ready".
     */
    private suspend fun read(step: NfcStep, open: OpenChallenge, firstNotice: NfcNotice?) {
        val sandbox = scenario
        val reader: ChipReader = if (sandbox != null) {
            SandboxChipReader(host.api, checkNotNull(verificationId), open.wire.id, sandbox)
        } else {
            environment.chipReader ?: return
        }
        // The sandbox test chip opens with no key: it reads nothing from a document.
        val key = if (sandbox != null) SANDBOX_ACCESS else access ?: return
        if (paused) {
            // The challenge arrived after the screen was left: the reader waits for the resume.
            interrupted = true
            show(deviceView())
            return
        }
        val nonce = nonceBytes(open.wire.nonce)
        val lifts = stepMaxAttempts(step) ?: DEFAULT_LIFTS
        var outcome: ReadOutcome = ReadOutcome.Stopped
        stopped = null
        interrupted = false
        connected = false
        coroutineScope {
            val job = launch {
                var notice = firstNotice
                var lifted = 0
                while (true) {
                    show(tap(step, NfcPhase.WAITING, notice = notice))
                    try {
                        val result = reader.read(key, nonce) { progress -> progressed(step, progress, notice) }
                        outcome = ReadOutcome.Read(result, (reader as? SandboxChipReader)?.dg2Attached == true)
                        break
                    } catch (canceled: CancellationException) {
                        throw canceled
                    } catch (failed: ChipReadException) {
                        connected = false
                        if (failed.failure != ChipReadFailure.TAG_LOST) {
                            outcome = ReadOutcome.Failed(failed.failure)
                            break
                        }
                        lifted += 1
                        if (lifted >= lifts) {
                            outcome = ReadOutcome.Lifted
                            break
                        }
                        notice = NfcNotice.KEEP_STILL
                    } catch (error: FlowApiException) {
                        outcome = ReadOutcome.Refused(error)
                        break
                    } catch (_: Exception) {
                        // A reader's own fault: a constant code, never its message (C213.3).
                        SdkLog.log("nfc.read_failed")
                        outcome = ReadOutcome.Faulted
                        break
                    }
                }
            }
            reading = job
            val expiry = launch {
                delay(CHALLENGE_LIFETIME - open.takenAt.elapsedNow())
                if (!connected && job.isActive) {
                    stopped = Stop.EXPIRED
                    job.cancel()
                }
            }
            job.join()
            expiry.cancel()
        }
        reading = null
        finish(step, open, outcome)
    }

    private fun progressed(step: NfcStep, progress: ChipProgress, notice: NfcNotice?) {
        when (progress) {
            ChipProgress.WaitingForDocument -> show(tap(step, NfcPhase.WAITING, notice = notice))
            ChipProgress.Connected -> {
                connected = true
                show(tap(step, NfcPhase.CONNECTING))
            }
            is ChipProgress.Reading -> {
                connected = true
                show(tap(step, NfcPhase.READING, progress.fileKind, progress.percent.coerceIn(0, 100)))
            }
            ChipProgress.Authenticating -> show(tap(step, NfcPhase.SIGNING))
            ChipProgress.Done -> show(tap(step, NfcPhase.READ))
        }
    }

    private suspend fun finish(step: NfcStep, open: OpenChallenge, outcome: ReadOutcome) {
        when (outcome) {
            ReadOutcome.Stopped -> when (stopped) {
                Stop.EXPIRED -> {
                    challenge = null
                    show(deviceView(NfcNotice.CHALLENGE_EXPIRED))
                }
                Stop.PAUSED -> {
                    interrupted = true
                    show(deviceView())
                }
                Stop.BY_PERSON -> show(NfcView.Tips)
                // Another render or screen took over: it shows its own state.
                Stop.SUPERSEDED, null -> Unit
            }
            is ReadOutcome.Failed -> when (outcome.failure) {
                ChipReadFailure.ACCESS_DENIED -> {
                    access = null
                    manual = true
                    show(NfcView.Entry(entryKind, NfcEntryError.REFUSED_BY_CHIP, hints, step.sandboxChipAvailable))
                }
                ChipReadFailure.NFC_DISABLED -> show(NfcView.CannotRead(NfcUnable.NFC_DISABLED, step.fallbackAvailable, step.sandboxChipAvailable))
                ChipReadFailure.UNSUPPORTED_DOCUMENT -> show(deviceView(NfcNotice.UNSUPPORTED_DOCUMENT))
                ChipReadFailure.TIMEOUT -> show(deviceView(NfcNotice.TIMEOUT))
                ChipReadFailure.READER_BUSY -> show(deviceView(NfcNotice.READER_BUSY))
                ChipReadFailure.TAG_LOST -> show(deviceView(NfcNotice.LIFTED))
            }
            ReadOutcome.Lifted -> show(deviceView(NfcNotice.LIFTED))
            ReadOutcome.Faulted -> show(deviceView(NfcNotice.READ_FAILED))
            // The sandbox route's own answer (C193.5): a 409 reads the session before any error screen.
            is ReadOutcome.Refused ->
                if (outcome.error is FlowApiException.Conflict) host.readAndRender() else host.failed(outcome.error) { startRead(step, notice = null) }
            is ReadOutcome.Read -> accept(step, open, outcome)
        }
    }

    /**
     * What a read returned becomes the review (C207.5), or nothing: only the kinds the server takes
     * are kept (C207.4), each within its size, with a security object and a DG1 this SDK can show.
     */
    private fun accept(step: NfcStep, open: OpenChallenge, outcome: ReadOutcome.Read) {
        val read = outcome.read
        val files = NfcFlowRequests.CHIP_KINDS.mapNotNull { kind -> read.files[kind]?.let { kind to it } }.toMap()
        val response = read.activeAuthenticationResponse
        val details = files[FileKind.CHIP_DG1]?.let(Dg1::parse)
        val usable = details != null &&
            FileKind.CHIP_SOD in files &&
            files.all { (kind, bytes) -> bytes.isNotEmpty() && bytes.size <= NfcFlowRequests.maxBytes(kind) } &&
            (response == null || response.size in 1..AA_RESPONSE_MAX_BYTES)
        // Whatever the reader handed over and the step does not keep is wiped now.
        read.files.forEach { (kind, bytes) -> if (!usable || kind !in files) bytes.fill(0) }
        if (!usable || details == null) {
            response?.fill(0)
            show(deviceView(NfcNotice.UNSUPPORTED_DOCUMENT))
            return
        }
        pending = PendingRead(files, response, read.deviceReport.takeIf { scenario == null }, outcome.dg2Attached, open)
        show(NfcView.Review(details, again = refusals > 0))
    }

    private suspend fun resumed(step: NfcStep) {
        if (!interrupted) return
        interrupted = false
        val open = challenge
        if (open != null && alive(open)) {
            read(step, open, firstNotice = null)
        } else {
            challenge = null
            show(deviceView(NfcNotice.CHALLENGE_EXPIRED))
        }
    }

    /** Turns the reader off for [reason]; the read's own coroutine then shows what follows. */
    private fun stop(reason: Stop) {
        val job = reading ?: return
        if (!job.isActive) return
        stopped = reason
        job.cancel()
    }

    // The review, upload and submit (C207.2, C207.5) ---------------------------------------------------

    /**
     * "This is not my data": the files are wiped and nothing is uploaded. The first time, one new
     * read within the same attempt; after that the screen cancels (the inquiry stays resumable).
     */
    private suspend fun reviewRefused(step: NfcStep) {
        if (pending == null) return
        dropPending()
        refusals += 1
        if (refusals == 1) startRead(step, NfcNotice.READING_AGAIN) else show(deviceView())
    }

    /**
     * Uploads each file with its kind, never DG2 when the server attached it (C208.1), then submits
     * with the challenge the chip signed, wipes the files and follows the server. A retry after an
     * error sends only what is missing.
     */
    private suspend fun upload(step: NfcStep) {
        val held = pending ?: return
        val id = checkNotNull(verificationId)
        host.show(FlowState.Processing(step))
        shown = null
        try {
            for ((kind, bytes) in held.files) {
                if (kind in uploaded || (kind == FileKind.CHIP_DG2 && held.dg2Attached)) continue
                host.api.uploadChipFile(id, kind, bytes)
                uploaded += kind
            }
            val submit = FlowChipSubmit(
                challengeId = held.challenge.wire.id,
                nonce = held.challenge.wire.nonce,
                activeAuthenticationResponse = held.response?.let { Base64.encode(it) },
                deviceReport = held.report?.let(::wireReport),
            )
            try {
                host.api.submitChip(id, submit)
            } catch (conflict: FlowApiException.Conflict) {
                submitRefused(step, conflict)
                return
            }
        } catch (error: FlowApiException) {
            if (error is FlowApiException.Conflict) {
                dropPending()
                host.readAndRender()
            } else {
                host.failed(error) { upload(step) }
            }
            return
        }
        dropPending()
        challenge = null
        uploaded.clear()
        decided(step, id)
    }

    /**
     * C193.5, C207.2: a 409 on the submit. The session is read first: when it shows the attempt
     * submitted, an earlier send landed and its answer was lost, so the position is rendered. When
     * the attempt is still open and the server named the challenge (it expired during a slow
     * upload), the files are wiped and the tap screen asks for one more tap, with a fresh challenge.
     */
    private suspend fun submitRefused(step: NfcStep, conflict: FlowApiException.Conflict) {
        val id = checkNotNull(verificationId)
        val session = try {
            host.api.getSession()
        } catch (error: FlowApiException) {
            host.failed(error) { submitRefused(step, conflict) }
            return
        }
        val open = session.verifications.lastOrNull { it.id == id }?.attributes?.status == VerificationStatus.INITIATED
        dropPending()
        challenge = null
        uploaded.clear()
        if (open && conflict.problem?.code == FlowProblemCodes.CHIP_CHALLENGE_INVALID) {
            show(deviceView(NfcNotice.ONE_MORE_TAP))
        } else {
            host.readAndRender()
        }
    }

    // The server's decision and position (C193.4) -----------------------------------------------------

    /** Waits for the server to decide [id], then renders the session's position. */
    private suspend fun decided(step: NfcStep, id: String) {
        try {
            host.api.pollVerification(id)
        } catch (error: FlowApiException) {
            host.failed(error) { decided(step, id) }
            return
        }
        host.readAndRender()
    }

    /**
     * The checking screen is shown: the attempt's decision is awaited, or, when the step's work on
     * this device is done or used up, the session is read until its position moves (C193.3: the SDK
     * never advances on its own).
     */
    private suspend fun check(step: NfcStep) {
        if (shown != NfcView.Checking) return
        host.show(FlowState.Processing(step))
        shown = null
        awaiting?.let { id ->
            awaiting = null
            decided(step, id)
            return
        }
        try {
            repeat(POSITION_READS) {
                delay(FlowApi.DEFAULT_POLL_INTERVAL)
                val session = host.api.getSession()
                val position = session.position
                if (position?.stepId != step.id || position.state != FlowPositionState.ACTIVE || stageOf(session, step) != Stage.Await) {
                    host.readAndRender()
                    return
                }
            }
            host.failed(FlowApiException.StillProcessing(verificationId.orEmpty())) { host.readAndRender() }
        } catch (error: FlowApiException) {
            host.failed(error) { host.readAndRender() }
        }
    }

    // Client unable (C207.9) ----------------------------------------------------------------------------

    /**
     * "Use another way": one self-reported client-unable report for the step's verification, then
     * the session's position. Offered only when the client view says a fallback exists. A 409 reads
     * the session before any error screen (C193.5).
     */
    private suspend fun useAnotherWay(step: NfcStep) {
        val view = shown as? NfcView.CannotRead ?: return
        if (!step.fallbackAvailable || view.busy) return
        show(view.copy(busy = true))
        try {
            host.api.reportClientUnable(verification(), reasonOf(view.reason))
        } catch (error: FlowApiException) {
            if (error is FlowApiException.Conflict) {
                host.readAndRender()
            } else {
                host.failed(error) {
                    show(view)
                    useAnotherWay(step)
                }
            }
            return
        }
        host.readAndRender()
    }

    // Helpers ---------------------------------------------------------------------------------------------

    private fun state(step: NfcStep, view: NfcView): FlowState {
        shown = view
        return FlowState.Nfc(step, view)
    }

    private fun show(view: NfcView) {
        val step = step ?: return
        host.show(state(step, view))
    }

    private fun tap(step: NfcStep, phase: NfcPhase, file: FileKind? = null, percent: Int? = null, notice: NfcNotice? = null) = NfcView.Tap(
        phase = phase,
        reader = environment.chipReader != null,
        sandbox = step.sandboxChipAvailable,
        editable = typed && scenario == null,
        file = file,
        percent = percent,
        notice = notice,
    )

    private fun alive(open: OpenChallenge?): Boolean = open != null && open.takenAt.elapsedNow() < CHALLENGE_LIFETIME

    /** Wipes and forgets the files of a read (C207.4, C207.6). */
    private fun dropPending() {
        pending?.let { held ->
            held.files.values.forEach { it.fill(0) }
            held.response?.fill(0)
        }
        pending = null
    }

    private enum class Stop { EXPIRED, PAUSED, BY_PERSON, SUPERSEDED }

    private class OpenChallenge(val wire: FlowChipChallenge, val takenAt: ComparableTimeMark)

    /** A read's files between the review and the submit; in memory only. */
    private class PendingRead(
        val files: Map<FileKind, ByteArray>,
        val response: ByteArray?,
        val report: ChipDeviceReport?,
        val dg2Attached: Boolean,
        val challenge: OpenChallenge,
    )

    private sealed interface ReadOutcome {
        data object Stopped : ReadOutcome
        class Read(val read: ChipRead, val dg2Attached: Boolean) : ReadOutcome
        class Failed(val failure: ChipReadFailure) : ReadOutcome
        data object Lifted : ReadOutcome
        data object Faulted : ReadOutcome
        class Refused(val error: FlowApiException) : ReadOutcome
    }

    private sealed interface Stage {
        /** The step needs this device: a new attempt, or the [reusable] initiated one, after [hints]. */
        data class Work(val reusable: String?, val hints: List<RetryHint>) : Stage

        /** The step's work here is done, submitted or used up: the server decides and moves the position. */
        data object Await : Stage

        /** A status newer than this SDK: a new attempt could use one the person needs. */
        data object Unknown : Stage
    }

    internal companion object {
        /** The unsupported screen's reason for a verification status this SDK does not know. */
        const val STATUS_UNKNOWN_REASON: String = "verification status unknown"

        /**
         * C207.2: the challenges this SDK asks for one verification. The server cancels the
         * verification at its tenth (`CHIP_CHALLENGE_LIMIT`), so the SDK stops one short.
         */
        const val MAX_CHALLENGES: Int = 9

        /**
         * C62.5 `CHIP_CHALLENGE_TTL_SECONDS`: how long the server takes a challenge, measured here on
         * the device's monotonic clock from the answer's arrival (C212.3).
         */
        val CHALLENGE_LIFETIME: Duration = 300.seconds

        /** How often the checking screen reads the session for a position that has not moved (as the driver's 60). */
        const val POSITION_READS: Int = FlowApi.DEFAULT_POLL_ATTEMPTS

        /** The lifts one tap forgives when the step names no attempts (the type's default, C50.1). */
        private const val DEFAULT_LIFTS = 3
        private const val AA_RESPONSE_MAX_BYTES = 1024

        /** An MRZ document number as typed: up to the longest TD1 number, MRZ characters only. */
        private val DOCUMENT_NUMBER = Regex("[A-Z0-9<]{1,22}")
        private val SIX_DIGITS = Regex("[0-9]{6}")
        private val CAN = SIX_DIGITS
        private val UNDECIDED = setOf(VerificationStatus.SUBMITTED, VerificationStatus.CONFIRMED)
        private val DONE = setOf(VerificationStatus.PASSED, VerificationStatus.SKIPPED, VerificationStatus.NEEDS_REVIEW)

        /** What the sandbox test chip is "opened" with: it has no key, and the value opens nothing. */
        private val SANDBOX_ACCESS: ChipAccess = ChipAccess.Can("000000")

        /** YYMMDD with a month and a day a calendar has. */
        private fun isDate(value: String): Boolean =
            SIX_DIGITS.matches(value) && value.substring(2, 4).toInt() in 1..12 && value.substring(4, 6).toInt() in 1..31

        /** The nonce's eight bytes from its 16 hex characters (C62.5). */
        private fun nonceBytes(hex: String): ByteArray = ByteArray(hex.length / 2) { hex.substring(it * 2, it * 2 + 2).toInt(16).toByte() }

        /** C207.9: the report's reason for each "cannot read" screen. Every one is self-asserted. */
        private fun reasonOf(unable: NfcUnable): ClientUnableReason = when (unable) {
            NfcUnable.READER_NOT_INSTALLED -> ClientUnableReason.READER_NOT_INSTALLED
            NfcUnable.NFC_DISABLED -> ClientUnableReason.NFC_DISABLED_DECLINED
            NfcUnable.NFC_UNAVAILABLE -> ClientUnableReason.NFC_UNAVAILABLE
            // The phone and the app can read chips; the reads of this one did not finish.
            NfcUnable.CHALLENGES_SPENT -> ClientUnableReason.READ_FAILED
        }

        /** C62.5: the device report in the wire's words; client-reported, shown to operators only. */
        private fun wireReport(report: ChipDeviceReport): FlowChipDeviceReport? {
            if (report.protocols.isEmpty() && report.readMillis == null) return null
            return FlowChipDeviceReport(
                protocols = report.protocols.take(10).map { attempt ->
                    FlowChipDeviceReport.Attempt(attempt.protocol.name.lowercase().replace('_', '-'), attempt.outcome.name.lowercase().replace('_', '-'))
                }.takeIf { it.isNotEmpty() },
                readMs = report.readMillis?.coerceIn(0, 600_000),
            )
        }

        /**
         * Where the step stands in [session], as the other verification steps judge it
         * (`FlowCoordinator.verificationState`): every `government-id-nfc` verification is an attempt.
         */
        private fun stageOf(session: FlowSession, step: NfcStep): Stage {
            val attempts = session.verifications.filter { it.verificationType == VerificationType.GOVERNMENT_ID_NFC }
            val latest = attempts.lastOrNull()
            val status = latest?.attributes?.status
            return when {
                status in DONE || status in UNDECIDED -> Stage.Await
                status == VerificationStatus.UNKNOWN -> Stage.Unknown
                else -> {
                    val reusable = latest?.id?.takeIf { status == VerificationStatus.INITIATED }
                    val failed = status == VerificationStatus.FAILED || status == VerificationStatus.REQUIRES_RETRY
                    val retryHints = latest?.attributes?.retryHints?.takeIf { failed }.orEmpty()
                    when {
                        // The attempts are used up, or the failure is never retryable (C30.1): the server moves the position.
                        reusable == null && attempts.size >= (stepMaxAttempts(step) ?: DEFAULT_LIFTS) -> Stage.Await
                        failed && retryHints.isEmpty() -> Stage.Await
                        else -> Stage.Work(reusable, retryHints)
                    }
                }
            }
        }
    }
}

/**
 * What the coordinator gives the NFC step (contracts-10c's hook). Every 409 of a single-use NFC
 * route follows [failed] then, for `flow_step_not_current`, [readAndRender] (C193.5), as every
 * other step's does.
 */
internal interface NfcStepHost {
    /** The coordinator's flow API (observed for the events when a listener is installed). */
    val api: FlowApi

    /** The device's monotonic clock (`FlowCoordinator.Settings.timeSource`): a challenge's age, never the wall clock. */
    val timeSource: TimeSource.WithComparableMarks

    /** Shows [state] (usually a [FlowState.Nfc]). */
    fun show(state: FlowState)

    /** Reads the session and renders its position: after a submit, a client-unable report, or a moved position. */
    suspend fun readAndRender()

    /** The driver's failure rule: a 409 `flow_step_not_current` re-reads the session, any other failure shows the error screen with [retry]. */
    suspend fun failed(error: FlowApiException, retry: suspend () -> Unit)
}

/**
 * What the launch offers the NFC step: the reader the host installed (C191; `null`: none) and the
 * phone's NFC seam (C207.12; `null` in tests and wherever no platform code made one). The step reads
 * the phone through [phone]: [platform] behind [NfcPhone], or a test's fake.
 */
internal class NfcEnvironment(val chipReader: ChipReader? = null, val platform: NfcPlatform? = null, phone: NfcPhone? = null) {
    /** What the step asks about the phone; `null` claims nothing (no hardware). */
    val phone: NfcPhone? = phone ?: platform?.let { made ->
        object : NfcPhone {
            override fun availability(): NfcAvailability = made.availability()

            override fun openSettings() = made.openSettings()
        }
    }

    internal companion object {
        /** No reader and no platform seam: what a coordinator made without one gets. */
        val None: NfcEnvironment = NfcEnvironment()
    }
}
