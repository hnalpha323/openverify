package dev.openverify.nfc

import dev.openverify.sdk.chip.ChipAccess
import dev.openverify.sdk.mrz.BacKeySeed
import java.util.logging.Logger
import kotlin.time.Duration
import kotlin.time.Duration.Companion.milliseconds
import kotlin.time.TestTimeSource

/**
 * A scripted chip for the orchestrator's host tests (C209.3): it holds [files], records every call
 * in [calls], throws what [fail] queued for a call, and logs through the libraries' loggers at every
 * call, as JMRTD and SCUBA do. Synthetic bytes only.
 */
internal class ScriptedChipSession(
    private val files: Map<ChipFile, ByteArray>,
    override val largeBlocks: Boolean = false,
    /** `null`: EF.CardAccess, if there is one, offers no PACE; otherwise whether PACE uses the chip authentication mapping. */
    private val paceWithChipAuthenticationMapping: Boolean? = null,
    private val chipAuthentication: Boolean = false,
    private val activeAuthenticationResponse: ByteArray = ByteArray(64) { 0x5a },
    private val clock: TestTimeSource? = null,
    private val perCall: Duration = 10.milliseconds,
    /** How many bytes of a file arrive at a time. */
    private val chunk: Int = 40,
) : ChipSession {
    val calls = mutableListOf<String>()
    private val failures = mutableMapOf<String, ArrayDeque<Exception>>()
    private val lost = mutableSetOf<Exception>()
    private var selected: ChipFile? = null
    private var readLengths = mutableMapOf<ChipFile, Int>()

    /** The next call named [call] throws [error]; [isLost] makes [connectionLost] answer true for it. */
    fun fail(call: String, error: Exception, isLost: Boolean = false): ScriptedChipSession {
        failures.getOrPut(call) { ArrayDeque() }.add(error)
        if (isLost) lost += error
        return this
    }

    /** [file] says it is [length] bytes long, whatever it holds. */
    fun declare(file: ChipFile, length: Int): ScriptedChipSession {
        readLengths[file] = length
        return this
    }

    private fun called(call: String) {
        calls += call
        clock?.let { it += perCall }
        // What the libraries would write: a command, a file, a status word. None may reach a handler.
        LIBRARY_LOGGERS.forEach { Logger.getLogger(it).severe("$call 00A4020C02011E X12345678") }
        failures[call]?.removeFirstOrNull()?.let { throw it }
    }

    override fun open() = called("open")

    override fun select(file: ChipFile, largeBlocks: Boolean): Int {
        called("select ${file.name} ${if (largeBlocks) "large" else "small"}")
        val content = files[file] ?: throw ScriptedRefusal(0x6A82)
        selected = file
        return readLengths[file] ?: content.size
    }

    override fun readSelected(read: (bytes: Int) -> Unit): ByteArray {
        val file = checkNotNull(selected)
        called("read ${file.name}")
        val content = files.getValue(file)
        var done = 0
        while (done < content.size) {
            done = minOf(content.size, done + chunk)
            read(done)
        }
        return content.copyOf()
    }

    override fun offersPace(cardAccess: ByteArray): Boolean {
        called("offersPace")
        return paceWithChipAuthenticationMapping != null
    }

    override fun pace(access: ChipAccess, cardAccess: ByteArray): Boolean {
        called("pace ${if (access is ChipAccess.Can) "can" else "mrz"}")
        return checkNotNull(paceWithChipAuthenticationMapping)
    }

    override fun selectApplication(afterPace: Boolean) = called("selectApplication ${if (afterPace) "secured" else "plain"}")

    override fun bac(seed: BacKeySeed) = called("bac")

    override fun offersChipAuthentication(dg14: ByteArray): Boolean {
        called("offersChipAuthentication")
        return chipAuthentication
    }

    override fun chipAuthentication(dg14: ByteArray) = called("chipAuthentication")

    override fun activeAuthentication(dg15: ByteArray, dg14: ByteArray?, challenge: ByteArray): ByteArray {
        called("activeAuthentication ${challenge.joinToString("") { "%02x".format(it) }}${if (dg14 == null) " without dg14" else ""}")
        return activeAuthenticationResponse.copyOf()
    }

    override fun connectionLost(error: Exception): Boolean = error in lost

    override fun close() = called("close")

    internal companion object {
        val LIBRARY_LOGGERS = listOf("org.jmrtd.protocol", "org.jmrtd", "net.sf.scuba.smartcards", "net.sf.scuba", "org.ejbca.cvc", "org.ejbca")

        /** Synthetic contents: each file starts with its template's tag, as a chip's does. */
        fun content(file: ChipFile, size: Int): ByteArray = ByteArray(size) { index -> (file.ordinal * 16 + index % 13).toByte() }

        /** A chip with every file the reader takes but EF.CardAccess: opened with Basic Access Control. */
        val BAC_FILES: Map<ChipFile, ByteArray> = mapOf(
            ChipFile.COM to content(ChipFile.COM, 24),
            ChipFile.SOD to content(ChipFile.SOD, 120),
            ChipFile.DG1 to content(ChipFile.DG1, 93),
            ChipFile.DG2 to content(ChipFile.DG2, 200),
            ChipFile.DG14 to content(ChipFile.DG14, 29),
            ChipFile.DG15 to content(ChipFile.DG15, 93),
        )

        /** The same chip with EF.CardAccess. */
        val PACE_FILES: Map<ChipFile, ByteArray> = BAC_FILES + (ChipFile.CARD_ACCESS to content(ChipFile.CARD_ACCESS, 20))
    }
}

/** What a library throws for a status word other than success: SCUBA's exception, with the word. */
internal class ScriptedRefusal(statusWord: Int) : net.sf.scuba.smartcards.CardServiceException("File not found, canary X12345678", statusWord)
