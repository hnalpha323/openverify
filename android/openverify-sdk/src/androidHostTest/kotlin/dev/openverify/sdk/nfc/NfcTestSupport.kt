@file:OptIn(ExperimentalOpenVerifyApi::class)

package dev.openverify.sdk.nfc

import dev.openverify.sdk.ExperimentalOpenVerifyApi
import dev.openverify.sdk.chip.ChipAccess
import dev.openverify.sdk.chip.ChipDeviceReport
import dev.openverify.sdk.chip.ChipProgress
import dev.openverify.sdk.chip.ChipRead
import dev.openverify.sdk.chip.ChipReadException
import dev.openverify.sdk.chip.ChipReadFailure
import dev.openverify.sdk.chip.ChipReader
import dev.openverify.sdk.model.FileKind
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.awaitCancellation

// Test doubles of the NFC step (Workflow 10C nfc-sdk). Synthetic data only: the MRZ is ICAO Doc
// 9303's Utopia specimen, and every other chip file is a few placeholder bytes.

/** ICAO Doc 9303 Part 4's TD3 specimen (the state Utopia). */
internal const val SPECIMEN_TD3 = "P<UTOERIKSSON<<ANNA<MARIA<<<<<<<<<<<<<<<<<<<" + "L898902C36UTO7408122F1204159ZE184226B<<<<<10"

/** The specimen's `MRZ_information`: the number, birth date and expiry, each with its check digit. */
internal const val SPECIMEN_MRZ_INFORMATION = "L898902C3674081221204159"

/** A DG1 holding [mrz], as a chip holds it. */
internal fun dg1Of(mrz: String = SPECIMEN_TD3): ByteArray {
    val text = mrz.encodeToByteArray()
    val inner = byteArrayOf(0x5F, 0x1F, text.size.toByte()) + text
    return byteArrayOf(0x61, inner.size.toByte()) + inner
}

/** A phone whose NFC state a test sets. */
internal class FakeNfcPhone(var state: NfcAvailability = NfcAvailability.READY) : NfcPhone {
    var settingsOpened = 0

    override fun availability(): NfcAvailability = state

    override fun openSettings() {
        settingsOpened += 1
    }
}

/**
 * A [ChipReader] a test scripts: each read takes the next step of [script], and a read with nothing
 * scripted waits for a document until it is canceled. It records every access and challenge it got.
 */
internal class FakeChipReader : ChipReader {
    val script = ArrayDeque<suspend ((ChipProgress) -> Unit) -> ChipRead>()
    val accesses = mutableListOf<ChipAccess>()
    val challenges = mutableListOf<ByteArray>()
    var canceled = 0
    var reading = false

    /** Every file the reader handed out, so a test can see they were wiped. */
    val handedOut = mutableListOf<ByteArray>()

    override suspend fun read(access: ChipAccess, challenge: ByteArray, progress: (ChipProgress) -> Unit): ChipRead {
        accesses += access
        challenges += challenge
        reading = true
        try {
            val next = script.removeFirstOrNull()
            if (next == null) {
                progress(ChipProgress.WaitingForDocument)
                awaitCancellation()
            }
            return next(progress)
        } catch (e: CancellationException) {
            canceled += 1
            throw e
        } finally {
            reading = false
        }
    }

    /** The next read reports every [ChipProgress] and returns [files] (by default a whole synthetic chip). */
    fun succeeds(
        files: Map<FileKind, ByteArray> = chipFiles(),
        response: ByteArray? = byteArrayOf(1, 2, 3, 4),
        report: ChipDeviceReport = ChipDeviceReport(),
    ) {
        script += { progress ->
            progress(ChipProgress.WaitingForDocument)
            progress(ChipProgress.Connected)
            progress(ChipProgress.Reading(FileKind.CHIP_SOD, 100))
            progress(ChipProgress.Reading(FileKind.CHIP_DG1, 50))
            progress(ChipProgress.Reading(FileKind.CHIP_DG1, 50))
            progress(ChipProgress.Reading(FileKind.CHIP_DG1, 100))
            progress(ChipProgress.Authenticating)
            progress(ChipProgress.Done)
            handedOut += files.values
            response?.let { handedOut += it }
            ChipRead(files, response, report)
        }
    }

    /** The next read fails with [failure] after a chip answered. */
    fun fails(failure: ChipReadFailure) {
        script += { progress ->
            progress(ChipProgress.WaitingForDocument)
            progress(ChipProgress.Connected)
            throw ChipReadException(failure)
        }
    }

    internal companion object {
        /** A synthetic chip's files: the specimen DG1 and placeholder bytes for the rest. */
        fun chipFiles(): Map<FileKind, ByteArray> = linkedMapOf(
            FileKind.CHIP_COM to ByteArray(3) { 0x60 },
            FileKind.CHIP_DG15 to ByteArray(5) { 0x6F },
            FileKind.CHIP_DG2 to ByteArray(9) { 0x75 },
            FileKind.CHIP_DG1 to dg1Of(),
            FileKind.CHIP_SOD to ByteArray(7) { 0x77 },
        )
    }
}
