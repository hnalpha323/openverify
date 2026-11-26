package dev.openverify.nfc

import dev.openverify.sdk.chip.ChipAccess
import dev.openverify.sdk.model.FileKind
import dev.openverify.sdk.mrz.BacKeySeed

/**
 * A file the reader takes from a chip (C207.4): one of the kinds the server takes, with its file
 * identifier (ICAO Doc 9303 Part 10) and the most bytes the server accepts for it. DG11 and DG12
 * (the holder's additional details) have no entry, so nothing here can read them. EF.CardSecurity
 * has none either: JMRTD 0.8.9 gives no secured route to a master-file file after PACE, and the
 * server takes that file only when a chip has it.
 */
internal enum class ChipFile(val kind: FileKind, val identifier: Int, val maximumBytes: Int, val required: Boolean) {
    /** EF.CardAccess, in the master file: read before any access, to learn whether the chip offers PACE. */
    CARD_ACCESS(FileKind.CHIP_CARD_ACCESS, 0x011C, SMALL_FILE_BYTES, required = false),
    COM(FileKind.CHIP_COM, 0x011E, SMALL_FILE_BYTES, required = false),
    SOD(FileKind.CHIP_SOD, 0x011D, SMALL_FILE_BYTES, required = true),
    DG1(FileKind.CHIP_DG1, 0x0101, SMALL_FILE_BYTES, required = true),
    DG2(FileKind.CHIP_DG2, 0x0102, PORTRAIT_FILE_BYTES, required = true),
    DG14(FileKind.CHIP_DG14, 0x010E, SMALL_FILE_BYTES, required = false),
    DG15(FileKind.CHIP_DG15, 0x010F, SMALL_FILE_BYTES, required = false),
}

/** C207.1: the server takes 64 KiB for every chip file but the portrait. */
internal const val SMALL_FILE_BYTES: Int = 64 * 1024

/** C207.1: the server takes 1 MiB for DG2, the portrait. */
internal const val PORTRAIT_FILE_BYTES: Int = 1024 * 1024

/**
 * One connection to a chip, as [ChipReadOrchestrator] drives it (C209.3; reviews H09, F15). The
 * orchestrator holds the protocol order, the fallbacks, the progress and the error mapping, and is
 * tested on the host over a scripted session; [JmrtdChipSession] is the thin adapter that answers
 * these calls with JMRTD.
 *
 * Every call blocks, and may throw whatever the libraries beneath it throw: the orchestrator maps
 * each failure to a `ChipReadFailure` and lets no library exception, message or byte through
 * (C213.3). A session is used by one thread at a time; [close] may be called from another to end a
 * call that is waiting for the chip.
 */
internal interface ChipSession {
    /** Whether the chip and the phone take extended-length commands, so that files can be read in large blocks. */
    val largeBlocks: Boolean

    /** Connects to the chip. */
    fun open()

    /** Selects [file], to be read in large blocks or not, and answers its length in bytes. */
    fun select(file: ChipFile, largeBlocks: Boolean): Int

    /** Reads the selected file whole, telling [read] how many bytes have arrived so far. */
    fun readSelected(read: (bytes: Int) -> Unit): ByteArray

    /** Whether [cardAccess] (EF.CardAccess) offers PACE in a form this session can run. */
    fun offersPace(cardAccess: ByteArray): Boolean

    /**
     * Runs PACE with [access] as [cardAccess] describes it, and starts secure messaging. Answers
     * whether the chip authentication mapping was used (PACE-CAM).
     */
    fun pace(access: ChipAccess, cardAccess: ByteArray): Boolean

    /** Selects the travel document application, under secure messaging when PACE has run ([afterPace]). */
    fun selectApplication(afterPace: Boolean)

    /** Runs Basic Access Control with the key the MRZ fields of [seed] give, and starts secure messaging. */
    fun bac(seed: BacKeySeed)

    /** Whether [dg14] offers Chip Authentication. */
    fun offersChipAuthentication(dg14: ByteArray): Boolean

    /** Runs Chip Authentication as [dg14] describes it, and restarts secure messaging with its keys. */
    fun chipAuthentication(dg14: ByteArray)

    /**
     * Asks the chip to sign [challenge] (Active Authentication) and answers its response as the chip
     * gave it, unverified: the server verifies it with the key in [dg15] (C62). [dg14] names the
     * signature algorithm of an elliptic-curve key.
     */
    fun activeAuthentication(dg15: ByteArray, dg14: ByteArray?, challenge: ByteArray): ByteArray

    /** Whether [error] means that the chip left the field. */
    fun connectionLost(error: Exception): Boolean

    /** Ends the connection. Safe to call more than once and from another thread. */
    fun close()
}
