package dev.openverify.sdk.nfc

import dev.openverify.sdk.model.FileKind
import dev.openverify.sdk.model.RetryHint
import dev.openverify.sdk.model.SandboxChipScenario

/** How the chip is opened (C207.2): the MRZ's three key fields, or a card's six-digit CAN. */
internal enum class NfcAccessKind { MRZ, CAN }

/** Why an access entry was not taken: the values are not an MRZ's, or the chip refused them. Never the values. */
internal enum class NfcEntryError {
    /** The document number is empty or holds something an MRZ cannot. */
    DOCUMENT_NUMBER,

    /** The birth date is not six digits of a date. */
    BIRTH_DATE,

    /** The expiry date is not six digits of a date. */
    EXPIRY_DATE,

    /** The CAN is not six digits. */
    CAN,

    /** The chip did not open with these values (`access_denied`); the person checks them against the document. */
    REFUSED_BY_CHIP,
}

/**
 * Where the tap screen is (C207.2, C207.5). Nothing here is a verdict: [READ] means the device has
 * the files and the server will check them.
 */
internal enum class NfcPhase {
    /** The hint and "I'm ready"; no challenge is open on the screen and no reader is on. */
    READY,

    /** "I'm ready" was pressed: the chip challenge is being requested. */
    REQUESTING,

    /** The reader is on and waits for the document. */
    WAITING,

    /** A chip answered: "connecting". */
    CONNECTING,

    /** A file is being read: "reading". */
    READING,

    /** The chip signs the server's nonce: "signing the check code". */
    SIGNING,

    /** Every file is read: "read; we will check it now". */
    READ,
}

/** What the tap screen says beside its phase: why it is back, or what to do. */
internal enum class NfcNotice {
    /** The challenge expired before a document was read; pressing "I'm ready" asks for a new one. */
    CHALLENGE_EXPIRED,

    /** The document was lifted (`tag_lost`): "keep it still", and the read goes on. */
    KEEP_STILL,

    /** The document was lifted too often on this try. */
    LIFTED,

    /** The reader cannot read this document (`unsupported_document`), or what it read is not a chip's files. */
    UNSUPPORTED_DOCUMENT,

    /** No document came into the field in the reader's time (`timeout`). */
    TIMEOUT,

    /** Another read is running (`reader_busy`). */
    READER_BUSY,

    /** The read stopped for a reason the reader did not name. */
    READ_FAILED,

    /** The server no longer takes the challenge the chip signed (a slow upload): one more tap, with a new one. */
    ONE_MORE_TAP,

    /** The person said the data shown was not theirs: the one new read. */
    READING_AGAIN,
}

/** C207.9, C207.2: why this device shows a "cannot read document chips" screen. */
internal enum class NfcUnable {
    /** The host app installed no chip reader. */
    READER_NOT_INSTALLED,

    /** The phone has no NFC hardware. */
    NFC_UNAVAILABLE,

    /** NFC is off. */
    NFC_DISABLED,

    /** The verification's chip challenges are spent (nine asked, under the server's ten). */
    CHALLENGES_SPENT,
}

/**
 * What an NFC screen asks of the step (`FlowActions.nfc`), a closed list. Events that carry typed
 * values redact them in `toString` (rule 11).
 */
internal sealed interface NfcEvent {
    /** The MRZ entry's three values as typed; the controller normalises and checks them. */
    class MrzEntered(val documentNumber: String, val birthDate: String, val expiryDate: String) : NfcEvent {
        override fun toString(): String = "NfcEvent.MrzEntered(<redacted>)"
    }

    /** The CAN as typed. */
    class CanEntered(val can: String) : NfcEvent {
        override fun toString(): String = "NfcEvent.CanEntered(<redacted>)"
    }

    /** Show the entry screen of [kind]: the other way to open the chip, or other values. */
    data class ChooseAccess(val kind: NfcAccessKind) : NfcEvent

    /**
     * "I'm ready" (C207.2): asks for the chip challenge and turns the reader on. With [sandbox], the
     * sandbox test chip of that scenario is read in the installed reader's place (C208.2).
     */
    data class Ready(val sandbox: SandboxChipScenario? = null) : NfcEvent

    /** The tap screen is resumed: the reader may be on (C207.5). */
    data object Resumed : NfcEvent

    /** The tap screen is no longer resumed: the reader is turned off. */
    data object Paused : NfcEvent

    /** The person stopped a read on the tap screen: the troubleshooting tips. */
    data object StopRead : NfcEvent

    /** Back to the tap screen from the tips. */
    data object TryAgain : NfcEvent

    /** The DG1 review: "this is my data"; the files are uploaded and submitted. */
    data object ReviewConfirmed : NfcEvent

    /** The DG1 review: "this is not my data"; nothing is uploaded (C207.5). */
    data object ReviewRefused : NfcEvent

    /** "Use another way" (C207.9): the client-unable report. */
    data object UseAnotherWay : NfcEvent

    /** Opens the system's NFC settings. */
    data object OpenNfcSettings : NfcEvent

    /** Reads again what the phone offers (after the person came back from the settings). */
    data object Recheck : NfcEvent

    /** The checking screen is shown: wait for the server's decision and its position (C193.4). */
    data object Check : NfcEvent
}

/**
 * What the NFC step shows inside `FlowState.Nfc`, a closed list. It never holds chip bytes or typed
 * access values (C207.4, C207.6); [Review] holds what DG1's MRZ says, for the person to confirm,
 * and never prints it.
 */
internal sealed interface NfcView {
    /** The MRZ-entry or CAN screen. [hints] are the previous attempt's; [sandbox] offers the test chip. */
    data class Entry(
        val kind: NfcAccessKind,
        val error: NfcEntryError? = null,
        val hints: List<RetryHint> = emptyList(),
        val sandbox: Boolean = false,
    ) : NfcView

    /**
     * The tap screen. [reader] says an installed reader can be used ("I'm ready"), [sandbox] that
     * the test chip is offered, [editable] that the access values were typed and can be changed.
     * [file] and [percent] are the read's progress while [phase] is [NfcPhase.READING].
     */
    data class Tap(
        val phase: NfcPhase,
        val reader: Boolean,
        val sandbox: Boolean = false,
        val editable: Boolean = false,
        val file: FileKind? = null,
        val percent: Int? = null,
        val notice: NfcNotice? = null,
        val hints: List<RetryHint> = emptyList(),
    ) : NfcView

    /** The DG1 review (C207.5), before anything is uploaded. [again] marks the one new read's review. */
    data class Review(val details: Dg1Details, val again: Boolean = false) : NfcView {
        override fun toString(): String = "NfcView.Review(<redacted>, again=$again)"
    }

    /** The troubleshooting tips, after the person stopped a read. */
    data object Tips : NfcView

    /** A "cannot read document chips" screen (C207.9). [fallback] offers "use another way"; [sandbox] the test chip. */
    data class CannotRead(val reason: NfcUnable, val fallback: Boolean, val sandbox: Boolean = false, val busy: Boolean = false) : NfcView

    /** The step's work on this device is done or waits for the server (C193.4). */
    data object Checking : NfcView
}

/**
 * What the phone offers for reading a chip, as the step reads it: [NfcPlatform] behind an interface,
 * so host tests run over a fake phone (the `expect class` cannot be faked; rule 28).
 */
internal interface NfcPhone {
    /** Whether the device has NFC and whether it is on. */
    fun availability(): NfcAvailability

    /** Opens the system's NFC settings. */
    fun openSettings()
}
