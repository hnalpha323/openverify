package dev.openverify.sdk.mrz

import dev.openverify.sdk.model.Fixtures
import dev.openverify.sdk.model.OpenVerifyJson
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.DynamicTest
import org.junit.jupiter.api.DynamicTest.dynamicTest
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.TestFactory
import org.junit.jupiter.api.assertThrows
import org.junit.jupiter.api.fail

/**
 * [Mrz] and [BacKeySeed] against every cross-language vector in `contracts/fixtures/mrz/` (C33,
 * C37), the files the TypeScript parser and the Python generator test against too. The README
 * there gives the format. The files are read from the test classpath, like the other contract
 * fixtures, so a vector `checks-logic` adds is tested here without a change.
 *
 * The SDK reads no MRZ layout today, so the ICAO 9303 layouts below are test code: they let the
 * lines of every vector, including the OCR-corrected ones, exercise [Mrz.checkDigit].
 */
internal class MrzVectorsTest {

    private class Vector(val json: JsonObject) {
        val id: String = json.getValue("id").jsonPrimitive.content
        val format: String? = json.getValue("format").takeUnless { it is JsonNull }?.jsonPrimitive?.content
        val lines: List<String> = strings("lines")
        val valid: Boolean = json.getValue("valid").jsonPrimitive.boolean

        fun strings(key: String): List<String> = json.getValue(key).jsonArray.map { it.jsonPrimitive.content }
    }

    /** A check digit: the characters it covers, and the character printed for it. */
    private data class Digit(val input: String, val printed: Char) {
        val holds: Boolean get() = printed.isDigit() && printed.digitToInt() == Mrz.checkDigit(input)
    }

    private val vectors: List<Vector> = Fixtures.list("mrz").flatMap { path ->
        val file = OpenVerifyJson.parseToJsonElement(Fixtures.read(path)).jsonObject
        check(file.getValue("schema_version").jsonPrimitive.int == 1) { "$path has an unknown schema_version" }
        file.getValue("vectors").jsonArray.map { Vector(it.jsonObject) }
    }

    private val withCheckDigits = vectors.filter { "check_digits" in it.json }
    private val ocrCorrections = vectors.filter { "corrected_lines" in it.json }
    private val structuralErrors = vectors.filter { "error" in it.json }

    @Test
    fun `every vector is read, once, and is of a kind a test below checks`() {
        assertEquals(vectors.size, vectors.map { it.id }.toSet().size, "vector ids repeat")
        assertTrue(withCheckDigits.isNotEmpty() && ocrCorrections.isNotEmpty() && structuralErrors.isNotEmpty())
        assertEquals(vectors.map { it.id }, vectors.filter { it in withCheckDigits + ocrCorrections + structuralErrors }.map { it.id })
    }

    @TestFactory
    fun `Mrz computes every check digit the vectors give, and whether the printed one holds`(): List<DynamicTest> =
        withCheckDigits.map { vector ->
            dynamicTest(vector.id) {
                val holds = vector.json.getValue("check_digits").jsonObject.mapNotNull { (field, value) ->
                    if (value is JsonNull) return@mapNotNull null
                    val digit = value.jsonObject
                    val computed = Mrz.checkDigit(digit.getValue("input").jsonPrimitive.content)
                    assertEquals(digit.getValue("computed").jsonPrimitive.int, computed, "$field: computed")
                    val printedHolds = digit.getValue("printed").jsonPrimitive.content == computed.toString()
                    assertEquals(digit.getValue("valid").jsonPrimitive.boolean, printedHolds, "$field: valid")
                    printedHolds
                }
                assertTrue(holds.isNotEmpty())
                assertEquals(vector.valid, holds.all { it }, "valid")
            }
        }

    @TestFactory
    fun `each MRZ layout puts its check digits where the vectors say`(): List<DynamicTest> =
        withCheckDigits.map { vector ->
            dynamicTest(vector.id) {
                val expected = vector.json.getValue("check_digits").jsonObject.mapValues { (_, value) ->
                    if (value is JsonNull) {
                        null
                    } else {
                        val digit = value.jsonObject
                        Digit(digit.getValue("input").jsonPrimitive.content, digit.getValue("printed").jsonPrimitive.content.single())
                    }
                }
                assertEquals(expected, checkDigitsOf(checkNotNull(vector.format), vector.lines))
            }
        }

    @TestFactory
    fun `an OCR-corrected MRZ is valid exactly when every check digit Mrz computes on it holds`(): List<DynamicTest> =
        ocrCorrections.map { vector ->
            dynamicTest(vector.id) {
                val lines = vector.lines.map(::StringBuilder)
                vector.json.getValue("corrections").jsonArray.map { it.jsonObject }.forEach { correction ->
                    val line = correction.getValue("line").jsonPrimitive.int
                    val position = correction.getValue("position").jsonPrimitive.int
                    assertEquals(correction.getValue("from").jsonPrimitive.content.single(), lines[line][position])
                    lines[line].setCharAt(position, correction.getValue("to").jsonPrimitive.content.single())
                }
                val corrected = vector.strings("corrected_lines")
                assertEquals(corrected, lines.map { it.toString() })

                val digits = checkDigitsOf(checkNotNull(vector.format), corrected).values.filterNotNull()
                assertEquals(vector.valid, digits.all { it.holds })
            }
        }

    @TestFactory
    fun `Mrz refuses a line with a character outside the MRZ set, without echoing it`(): List<DynamicTest> =
        structuralErrors.map { vector ->
            dynamicTest(vector.id) {
                val refused = vector.lines.filter { line ->
                    try {
                        Mrz.checkDigit(line)
                        false
                    } catch (_: IllegalArgumentException) {
                        true
                    }
                }
                when (val error = vector.json.getValue("error").jsonPrimitive.content) {
                    "mrz_invalid_characters" -> {
                        assertEquals(1, refused.size)
                        val thrown = assertThrows<IllegalArgumentException> { Mrz.checkDigit(refused.single()) }
                        assertFalse(thrown.message.orEmpty().contains(refused.single()), "the message echoed the line")
                    }
                    // Every character is an MRZ character; recognizing a layout is not Mrz's job.
                    "mrz_unrecognized_format" -> assertEquals(emptyList<String>(), refused)
                    else -> fail("unknown error $error")
                }
            }
        }

    @TestFactory
    fun `BacKeySeed builds MRZ_information from each vector's document number and dates`(): List<DynamicTest> =
        withCheckDigits.map { vector ->
            dynamicTest(vector.id) {
                val digits = vector.json.getValue("check_digits").jsonObject
                fun input(field: String) = digits.getValue(field).jsonObject.getValue("input").jsonPrimitive.content
                fun computed(field: String) = digits.getValue(field).jsonObject.getValue("computed").jsonPrimitive.int
                val number = input("document_number")

                assertEquals(
                    number.padEnd(9, Mrz.FILLER) + computed("document_number") +
                        input("birth_date") + computed("birth_date") +
                        input("expiration_date") + computed("expiration_date"),
                    BacKeySeed.mrzInformation(number, input("birth_date"), input("expiration_date")),
                )
            }
        }

    /**
     * The check digits of an MRZ by its ICAO 9303 layout (Parts 4 to 7), named as the vectors name
     * them; `null` where the layout has none (TD1 and TD2 have no optional-data digit, visas no
     * optional-data or composite digit).
     */
    private fun checkDigitsOf(format: String, lines: List<String>): Map<String, Digit?> {
        if (format == "TD1") {
            val (upper, middle) = lines
            return mapOf(
                "document_number" to documentNumber(upper.substring(5, 14), upper[14], upper.substring(15, 30)),
                "birth_date" to Digit(middle.substring(0, 6), middle[6]),
                "expiration_date" to Digit(middle.substring(8, 14), middle[14]),
                "optional_data" to null,
                "composite" to Digit(
                    upper.substring(5, 30) + middle.substring(0, 7) + middle.substring(8, 15) + middle.substring(18, 29),
                    middle[29],
                ),
            )
        }
        val lower = lines[1]
        val dates = mapOf(
            "birth_date" to Digit(lower.substring(13, 19), lower[19]),
            "expiration_date" to Digit(lower.substring(21, 27), lower[27]),
        )
        return dates + when (format) {
            "TD2" -> mapOf(
                "document_number" to documentNumber(lower.substring(0, 9), lower[9], lower.substring(28, 35)),
                "optional_data" to null,
                "composite" to Digit(lower.substring(0, 10) + lower.substring(13, 20) + lower.substring(21, 35), lower[35]),
            )
            "TD3" -> mapOf(
                "document_number" to Digit(lower.substring(0, 9), lower[9]),
                "optional_data" to Digit(lower.substring(28, 42), lower[42]),
                "composite" to Digit(lower.substring(0, 10) + lower.substring(13, 20) + lower.substring(21, 43), lower[43]),
            )
            "MRVA", "MRVB" -> mapOf(
                "document_number" to Digit(lower.substring(0, 9), lower[9]),
                "optional_data" to null,
                "composite" to null,
            )
            else -> fail("unknown MRZ format $format")
        }
    }

    /**
     * A TD1 or TD2 document number. One longer than 9 characters has a filler where its check
     * digit would be, and continues in the optional data up to its check digit (Parts 5 and 6).
     */
    private fun documentNumber(number: String, digit: Char, optionalData: String): Digit {
        if (digit != Mrz.FILLER) return Digit(number, digit)
        val rest = optionalData.substringBefore(Mrz.FILLER)
        return Digit(number + rest.dropLast(1), rest.last())
    }
}
