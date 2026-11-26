package dev.openverify.sdk.chip

import dev.openverify.sdk.ExperimentalOpenVerifyApi
import dev.openverify.sdk.model.FileKind
import dev.openverify.sdk.mrz.BacKeySeed

/**
 * Reads an identity document's chip at an NFC step (C207.3; ADR 0009). `openverify-nfc`
 * implements it on Android; a host installs it with `OpenVerifyAndroid.install`. The device reads
 * and the server verifies: Passive and Active Authentication and the bindings to the photographed
 * MRZ and the selfie are the server's, so nothing [read] returns is a verdict.
 *
 * Experimental: its fit with the iOS reader is unverified for CAN access (ADR 0009), so [read] and
 * every type it names need `@OptIn(ExperimentalOpenVerifyApi::class)`. The interface itself does
 * not, so a host can name it in `OpenVerifyComponents` without opting in to anything else.
 *
 * ```
 * @OptIn(ExperimentalOpenVerifyApi::class)
 * OpenVerifyAndroid.install(OpenVerifyComponents(chipReader = OpenVerifyNfc.chipReader(context)))
 * ```
 */
public interface ChipReader {
    /**
     * Opens the chip with [access], reads the files the server takes (never DG11 or DG12), signs
     * [challenge] (the server's 8-byte nonce) with Active Authentication when the chip offers it,
     * and reports [progress] on the way. Bytes are held in memory only.
     *
     * @throws ChipReadException with a [ChipReadFailure] when the read cannot finish.
     */
    @ExperimentalOpenVerifyApi
    public suspend fun read(access: ChipAccess, challenge: ByteArray, progress: (ChipProgress) -> Unit): ChipRead
}

/** How the chip is opened (C207.2): the MRZ's key fields, or a card's six-digit CAN. */
@ExperimentalOpenVerifyApi
public sealed interface ChipAccess {
    /** The MRZ's document number, birth date and expiry ([BacKeySeed]). */
    public class Mrz(public val seed: BacKeySeed) : ChipAccess {
        override fun toString(): String = "ChipAccess.Mrz(<redacted>)"
    }

    /** The card access number printed on a card that offers PACE with a CAN. Never shown. */
    public class Can(public val can: String) : ChipAccess {
        override fun toString(): String = "ChipAccess.Can(<redacted>)"
    }
}

/**
 * What a read returns (C207.3): each file's bytes by kind, the Active Authentication response
 * over the challenge (`null` when the chip has none), and what the device did. Never logged.
 */
@ExperimentalOpenVerifyApi
public class ChipRead(
    public val files: Map<FileKind, ByteArray>,
    public val activeAuthenticationResponse: ByteArray?,
    public val deviceReport: ChipDeviceReport,
) {
    override fun toString(): String =
        "ChipRead(files=${files.keys.joinToString("|") { it.wireValue }}, activeAuthenticationResponse=" +
            "${if (activeAuthenticationResponse == null) "null" else "<redacted>"})"
}

/**
 * What the device says it did (C62.5's `device-report`): the protocols it tried with their
 * outcomes, and how long the read took. Shown to operators only, never evidence.
 */
@ExperimentalOpenVerifyApi
public class ChipDeviceReport(
    public val protocols: List<Attempt> = emptyList(),
    public val readMillis: Long? = null,
) {
    /** One protocol the device tried. */
    public class Attempt(public val protocol: Protocol, public val outcome: Outcome)

    /** The chip protocols of C62.5 (`CHIP_PROTOCOLS`). */
    public enum class Protocol { BAC, PACE, PACE_CAM, CHIP_AUTHENTICATION, ACTIVE_AUTHENTICATION }

    /** How an attempt ended on the device. */
    public enum class Outcome { SUCCEEDED, FAILED, NOT_ATTEMPTED }
}

/** Where a read is (C207.3, C207.5), for the tap screen's live region. */
@ExperimentalOpenVerifyApi
public sealed interface ChipProgress {
    /** The reader waits for a document in the field. */
    public data object WaitingForDocument : ChipProgress

    /** A chip answered. */
    public data object Connected : ChipProgress

    /** Reading [fileKind], [percent] of it so far (0 to 100). */
    public data class Reading(val fileKind: FileKind, val percent: Int) : ChipProgress

    /** Signing the server's challenge. */
    public data object Authenticating : ChipProgress

    /** Every file is read. */
    public data object Done : ChipProgress
}

/** Why a read could not finish (C207.3), a closed list. */
@ExperimentalOpenVerifyApi
public enum class ChipReadFailure { TAG_LOST, ACCESS_DENIED, UNSUPPORTED_DOCUMENT, TIMEOUT, NFC_DISABLED, READER_BUSY }

/** A read that could not finish, with its [failure] and a fixed message (C213.3). */
@ExperimentalOpenVerifyApi
public class ChipReadException(public val failure: ChipReadFailure) :
    Exception("Chip read failed: ${failure.name.lowercase()}")
