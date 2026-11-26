package dev.openverify.sdk.privacy

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNotNull
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Test

/**
 * KP10-42: the reading of an optional artifact's sources that `ExceptionCanaryTest` holds each
 * artifact's exception table to ([ModuleExceptions]), on a source written for this test.
 */
internal class ModuleExceptionsTest {

    private val source = SourceScan.code(
        """
        class Refusal : IllegalStateException("A fixed refusal")
        suspend fun read(value: String, failure: Exception) {
            require(value.isNotEmpty()) { "A value is needed" }
            check(value.length < 9)
            try {
                work()
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (failed: Exception) {
                // A comment that says throw failed is not a line of code.
                throw ChipReadException(ChipReadFailure.TAG_LOST)
            }
            if (value == "x") error("Not ${'$'}value")
            throw IllegalArgumentException(
                "Two lines",
                failure,
            )
        }
        fun other(reader: Reader) = reader.error("a method of something else is not a call of error")
        fun wrapped(caught: Exception): Nothing = throw mapped(caught)
        """.trimIndent(),
    )

    private val rows = ModuleExceptions.rowsIn("src/main/kotlin/Sample.kt", source)

    @Test
    fun `every exception made, every check and every rethrow is a row, in source order`() {
        assertEquals(
            listOf(
                """src/main/kotlin/Sample.kt | IllegalStateException | "A fixed refusal"""",
                """src/main/kotlin/Sample.kt | require | "A value is needed"""",
                "src/main/kotlin/Sample.kt | check | -",
                "src/main/kotlin/Sample.kt | rethrow | cancelled",
                "src/main/kotlin/Sample.kt | ChipReadException | ChipReadFailure.TAG_LOST",
                "src/main/kotlin/Sample.kt | error | \"Not \$value\"",
                """src/main/kotlin/Sample.kt | IllegalArgumentException | "Two lines", failure,""",
                "src/main/kotlin/Sample.kt | rethrow | mapped(caught)",
            ),
            rows.map { it.toString() },
        )
    }

    @Test
    fun `a fixed literal, no message, a failure constant and a cancellation thrown on keep the rule`() {
        assertEquals(listOf(null, null, null, null, null), rows.take(5).map { ModuleExceptions.problem(it, source) })
    }

    @Test
    fun `a value in a message, a cause, another exception thrown on and a failure that is no constant break it`() {
        assertNotNull(ModuleExceptions.problem(rows[5], source))
        assertNotNull(ModuleExceptions.problem(rows[6], source))
        assertNotNull(ModuleExceptions.problem(rows[7], source))
        assertNotNull(ModuleExceptions.problem(ModuleExceptions.Row("a.kt", "rethrow", "failed"), source))
        assertNotNull(ModuleExceptions.problem(ModuleExceptions.Row("a.kt", "ChipReadException", "failureOf(error)"), source))
        assertNotNull(ModuleExceptions.problem(ModuleExceptions.Row("a.kt", "IllegalStateException", "\"a\" + value"), source))
        assertNull(ModuleExceptions.problem(ModuleExceptions.Row("a.kt", "rethrow", "cancelled"), source))
    }

    @Test
    fun `a table is its rows, comments and blank lines left out, and a line that is no row is refused`() {
        val table = "# why\n\nsrc/a.kt | error | \"fixed | with a bar\"\n  src/b.kt | check | -  \n"

        assertEquals(
            listOf(ModuleExceptions.Row("src/a.kt", "error", "\"fixed | with a bar\""), ModuleExceptions.Row("src/b.kt", "check", "-")),
            ModuleExceptions.parse(table),
        )
        assertThrows(IllegalArgumentException::class.java) { ModuleExceptions.parse("src/a.kt: error") }
    }
}
