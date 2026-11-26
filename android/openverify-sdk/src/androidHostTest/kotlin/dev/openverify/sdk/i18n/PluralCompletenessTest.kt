package dev.openverify.sdk.i18n

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test

/**
 * C199.8 (Phase 9 C161.6, as `apps/flow/src/i18n/plurals.test.ts` holds it for the web): every
 * plural of every SDK locale defines each category CLDR names for its language, Arabic six (zero,
 * one, two, few, many, other), French and Spanish one, many and other, German and English one and
 * other. French and Spanish may leave out `many`, which only exact millions select, when the
 * plural's documented range cannot reach it; a plural whose range is not noted here gets 0 to
 * 1,000,000, so it needs every category. What a missing category shows is not something to rely on,
 * so a missing one is a failure.
 */
internal class PluralCompletenessTest {

    /**
     * The CLDR plural rules (`plurals.xml`, as CLDR has had them since its version 38) of the five SDK locales for whole numbers,
     * whose visible fraction digits `v` and exponent `e` are 0, written as code (rule 15).
     */
    internal object CldrIntegerPlurals {
        val CATEGORIES: Map<String, List<String>> = mapOf(
            "en" to listOf("one", "other"),
            "es" to listOf("one", "many", "other"),
            "fr" to listOf("one", "many", "other"),
            "de" to listOf("one", "other"),
            "ar" to listOf("zero", "one", "two", "few", "many", "other"),
        )

        private fun millions(n: Long) = n != 0L && n % 1_000_000L == 0L

        fun select(locale: String, n: Long): String = when (locale) {
            "en", "de" -> if (n == 1L) "one" else "other"
            "es" -> when {
                n == 1L -> "one"
                millions(n) -> "many"
                else -> "other"
            }
            "fr" -> when {
                n == 0L || n == 1L -> "one"
                millions(n) -> "many"
                else -> "other"
            }
            "ar" -> when {
                n == 0L -> "zero"
                n == 1L -> "one"
                n == 2L -> "two"
                n % 100L in 3L..10L -> "few"
                n % 100L in 11L..99L -> "many"
                else -> "other"
            }
            else -> error("no plural rules for $locale")
        }
    }

    @Test
    fun `the plural rules written here select CLDR's own examples`() {
        val examples = mapOf(
            "en" to mapOf(1L to "one", 0L to "other", 2L to "other", 16L to "other"),
            "de" to mapOf(1L to "one", 0L to "other", 2L to "other", 100L to "other"),
            "es" to mapOf(1L to "one", 1_000_000L to "many", 0L to "other", 2L to "other", 16L to "other"),
            "fr" to mapOf(0L to "one", 1L to "one", 1_000_000L to "many", 2L to "other", 17L to "other"),
            "ar" to mapOf(
                0L to "zero", 1L to "one", 2L to "two", 3L to "few", 10L to "few", 103L to "few", 110L to "few",
                11L to "many", 26L to "many", 111L to "many", 100L to "other", 102L to "other",
            ),
        )

        assertEquals(examples, examples.mapValues { (locale, cases) -> cases.mapValues { (n, _) -> CldrIntegerPlurals.select(locale, n) } })
        assertEquals(SdkResourceTexts.LOCALE_FOLDERS.keys, CldrIntegerPlurals.CATEGORIES.keys)
    }

    /** Each locale's categories that [plural] must define: all of them, but for an unreachable omittable one. */
    private fun required(locale: String, plural: String): List<String> {
        val range = PLURAL_RANGES[plural] ?: DEFAULT_RANGE
        val reached = range.mapTo(mutableSetOf()) { CldrIntegerPlurals.select(locale, it) }
        return CldrIntegerPlurals.CATEGORIES.getValue(locale).filter { it in reached || it !in OMITTABLE[locale].orEmpty() }
    }

    @Test
    fun `every plural defines each category its language selects, Arabic six (C199_8)`() {
        val plurals = SdkResourceTexts.resources("values").values.filter { it.isPlural }.map { it.name }.sorted()
        val missing = SdkResourceTexts.LOCALE_FOLDERS.flatMap { (locale, folder) ->
            val resources = SdkResourceTexts.resources(folder)
            plurals.mapNotNull { plural ->
                val defined = resources[plural]?.takeIf { it.isPlural }?.items?.keys.orEmpty()
                val absent = required(locale, plural).filterNot { it in defined }
                if (absent.isEmpty()) null else "$folder/$plural: $absent"
            }
        }

        assertEquals(true, plurals.isNotEmpty(), "the SDK has no plurals")
        assertEquals(emptyList<String>(), missing)
    }

    @Test
    fun `no plural defines a category its language never selects`() {
        val stray = SdkResourceTexts.LOCALE_FOLDERS.flatMap { (locale, folder) ->
            SdkResourceTexts.resources(folder).values.filter { it.isPlural }.flatMap { plural ->
                (plural.items.keys - CldrIntegerPlurals.CATEGORIES.getValue(locale).toSet()).map { "$folder/${plural.name}: $it" }
            }
        }

        assertEquals(emptyList<String>(), stray)
    }

    @Test
    fun `French and Spanish leave out many only where the plural's range cannot reach it`() {
        assertEquals(listOf("one", "other"), required("fr", "openverify_document_pages"))
        assertEquals(listOf("one", "many", "other"), required("es", "openverify_unnoted_plural"))
        assertEquals(listOf("zero", "one", "two", "few", "many", "other"), required("ar", "openverify_selfie_time_limit"))
    }

    private companion object {
        /** A plural without a noted range can be given any count the SDK may show. */
        val DEFAULT_RANGE: LongRange = 0L..1_000_000L

        /** Only `many` of French and Spanish may be left out, and only when the range cannot reach it. */
        val OMITTABLE: Map<String, Set<String>> = mapOf("fr" to setOf("many"), "es" to setOf("many"))

        /**
         * The counts each plural can be given, from the constant or the contract that sets them:
         * - the selfie capture's lifetime, `SelfieCaptureProtocol.CAPTURE_TTL` in whole minutes (C40.2, 180 s);
         * - a wallet message's minutes left, shown while above 0 (`CRYPTO_CHALLENGE_TTL_SECONDS`, 600);
         * - a code's minutes left (`OTP_CODE_TTL_SECONDS`, 600), its tries left (`OTP_MAX_ATTEMPTS_PER_CODE`,
         *   5), the seconds to the next send (`OTP_RESEND_COOLDOWNS_SECONDS`, at most 240) and the sends
         *   left, shown while above 0 (`OTP_MAX_SENDS`, 5), all in `packages/contracts/src/otp.ts`;
         * - the document guidance's `max-age-days` (1 to 3,650) and `max-pages` (1 to 50), as the web's
         *   plural test notes them (`packages/contracts/src/verification-attributes.ts`).
         */
        val PLURAL_RANGES: Map<String, LongRange> = mapOf(
            "openverify_selfie_time_limit" to 3L..3L,
            "openverify_crypto_expires_in" to 1L..10L,
            "openverify_otp_expires_in" to 1L..10L,
            "openverify_otp_attempts_left" to 0L..5L,
            "openverify_otp_resend_in" to 1L..240L,
            "openverify_otp_sends_left" to 1L..5L,
            "openverify_document_type_utility_bill" to 1L..3650L,
            "openverify_document_type_bank_statement" to 1L..3650L,
            "openverify_document_type_pay_stub" to 1L..3650L,
            "openverify_document_pages" to 1L..50L,
        )
    }
}
