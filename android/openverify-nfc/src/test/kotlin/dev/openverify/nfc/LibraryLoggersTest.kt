package dev.openverify.nfc

import dev.openverify.nfc.ScriptedChipSession.Companion.BAC_FILES
import dev.openverify.sdk.chip.ChipAccess
import dev.openverify.sdk.chip.ChipReadException
import dev.openverify.sdk.mrz.BacKeySeed
import net.sf.scuba.smartcards.CardServiceException
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import java.util.logging.Handler
import java.util.logging.Level
import java.util.logging.LogRecord
import java.util.logging.Logger

/**
 * C209.2, C213.3 (review P06): JMRTD, SCUBA and cert-cvc log commands, file identifiers and status
 * words through `java.util.logging`, which Android routes to Logcat. A read turns their loggers off
 * and puts them back as they were, whether it ends well or not.
 */
class LibraryLoggersTest {

    private val records = mutableListOf<LogRecord>()
    private val handler = object : Handler() {
        override fun publish(record: LogRecord) {
            records += record
        }

        override fun flush() = Unit

        override fun close() = Unit
    }
    private val root = Logger.getLogger("")
    private val roots = listOf("org.jmrtd", "net.sf.scuba", "org.ejbca").map(Logger::getLogger)
    private val before = roots.map { it.level }

    @BeforeEach
    fun listen() {
        root.addHandler(handler)
    }

    @AfterEach
    fun restore() {
        root.removeHandler(handler)
        roots.forEachIndexed { index, logger -> logger.level = before[index] }
    }

    private fun logFromEveryLibrary(text: String) = ScriptedChipSession.LIBRARY_LOGGERS.forEach { Logger.getLogger(it).severe(text) }

    @Test
    fun `the scripted chip's logging reaches a handler outside a read`() {
        logFromEveryLibrary("canary")

        assertEquals(ScriptedChipSession.LIBRARY_LOGGERS, records.map { it.loggerName })
    }

    @Test
    fun `a scripted read emits no record of the libraries' loggers`() {
        val session = ScriptedChipSession(BAC_FILES, chipAuthentication = true)

        ChipReadOrchestrator().read({ session }, ChipAccess.Mrz(BacKeySeed("X12345678", "900101", "310101")), ByteArray(8)) {}

        assertEquals(emptyList<String>(), records.map { "${it.loggerName}: ${it.message}" })
        // The chip did log at every call: 20 calls, each to six loggers.
        assertEquals(20, session.calls.size)
    }

    @Test
    fun `a read that fails emits none either, and the loggers are back as they were`() {
        roots[0].level = Level.FINE
        roots[1].level = Level.WARNING
        val session = ScriptedChipSession(BAC_FILES).fail("bac", CardServiceException("Mutual authentication failed, canary X12345678", 0x6300))

        assertThrows(ChipReadException::class.java) {
            ChipReadOrchestrator().read({ session }, ChipAccess.Mrz(BacKeySeed("X12345678", "900101", "310101")), ByteArray(8)) {}
        }

        assertEquals(emptyList<String>(), records.map { "${it.loggerName}: ${it.message}" })
        assertEquals(listOf(Level.FINE, Level.WARNING, null), roots.map { it.level })
        logFromEveryLibrary("after")
        assertEquals(ScriptedChipSession.LIBRARY_LOGGERS, records.map { it.loggerName })
    }

    @Test
    fun `the loggers are off only inside the block, and what the block returns or throws passes through`() {
        roots[2].level = Level.INFO

        val result = LibraryLoggers.silenced {
            logFromEveryLibrary("inside")
            roots.map { it.level }
        }

        assertEquals(listOf(Level.OFF, Level.OFF, Level.OFF), result)
        assertEquals(emptyList<LogRecord>(), records)
        assertEquals(listOf(before[0], before[1], Level.INFO), roots.map { it.level })
        val thrown = assertThrows(IllegalStateException::class.java) { LibraryLoggers.silenced { error("fixed") } }
        assertEquals("fixed", thrown.message)
        assertEquals(listOf(before[0], before[1], Level.INFO), roots.map { it.level })
    }
}
