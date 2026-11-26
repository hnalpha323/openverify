package dev.openverify.sdk.i18n

import dev.openverify.sdk.model.OpenVerifyJson
import kotlinx.serialization.json.jsonObject
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test
import java.io.File

/**
 * C199.1 (C161.5, review H14): the per-key digests of `i18n/review-status.json` downgrade a
 * `reviewed` SDK locale to `partially-reviewed` when one of its texts changes, as Phase 9's
 * `effectiveReviewStatus` does for the web, and the committed file states each locale's effective
 * status, so no translation is called reviewed without a record that still matches its words.
 */
internal class LocaleReviewStatusTest {

    private val spanish = LocaleReviewStatus.keyDigests(SdkResourceTexts.resources("values-es").values)

    /** A review of [digests] as a fluent reviewer would record it. */
    private fun reviewOf(digests: Map<String, String>) =
        ReviewStatus.Reviewed("A fluent reviewer", "2026-11-08", LocaleReviewStatus.catalogSha256(digests), digests)

    @Test
    fun `a digest is SHA-256 over the NFC text, and a plural's over its items`() {
        // FIPS 180-2's one-block example, "abc".
        assertEquals("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad", LocaleReviewStatus.sha256("abc"))
        val composed = SdkResourceTexts.Resource("openverify_a", "strings.xml", "é", emptyMap())
        val decomposed = SdkResourceTexts.Resource("openverify_a", "strings.xml", "é", emptyMap())
        val plural = SdkResourceTexts.Resource("openverify_p", "strings.xml", null, mapOf("other" to "b", "one" to "a"))

        assertEquals(LocaleReviewStatus.keyDigests(listOf(composed)), LocaleReviewStatus.keyDigests(listOf(decomposed)))
        assertEquals(mapOf("openverify_p" to LocaleReviewStatus.sha256("one\ta\nother\tb\n")), LocaleReviewStatus.keyDigests(listOf(plural)))
        assertEquals(
            LocaleReviewStatus.sha256("openverify_a\t1\nopenverify_b\t2\n"),
            LocaleReviewStatus.catalogSha256(mapOf("openverify_b" to "2", "openverify_a" to "1")),
        )
    }

    @Test
    fun `a reviewed locale whose texts are unchanged stays reviewed, and a removed key changes nothing`() {
        val review = reviewOf(spanish)

        assertEquals(review, LocaleReviewStatus.effective(review, spanish))
        assertEquals(review, LocaleReviewStatus.effective(review, spanish - spanish.keys.first()))
    }

    @Test
    fun `a text changed or added since the review downgrades the locale, naming those keys and keeping the record`() {
        val review = reviewOf(spanish)
        val changed = spanish.keys.sorted()[3]
        val current = spanish + (changed to LocaleReviewStatus.sha256("a new text")) + ("openverify_added" to LocaleReviewStatus.sha256("added"))

        assertEquals(
            ReviewStatus.PartiallyReviewed(listOf(changed, "openverify_added").sorted(), review.by, review.date, review.catalogSha256, review.keySha256),
            LocaleReviewStatus.effective(review, current),
        )
    }

    @Test
    fun `a partially reviewed locale keeps its unreviewed keys that still exist and adds the changed ones`() {
        val keys = spanish.keys.sorted()
        val partial = ReviewStatus.PartiallyReviewed(listOf(keys[0], "openverify_gone"), "A fluent reviewer", "2026-11-08", null, spanish)
        val current = spanish + (keys[1] to LocaleReviewStatus.sha256("changed"))

        assertEquals(partial.copy(unreviewedKeys = listOf(keys[0], keys[1])), LocaleReviewStatus.effective(partial, current))
        assertEquals(partial.copy(unreviewedKeys = listOf(keys[0])), LocaleReviewStatus.effective(partial.copy(unreviewedKeys = listOf(keys[0])), spanish))
    }

    @Test
    fun `without its digests a partially reviewed locale has every key unreviewed (fail closed)`() {
        val partial = ReviewStatus.PartiallyReviewed(emptyList(), "A fluent reviewer", "2026-11-08")

        assertEquals(partial.copy(unreviewedKeys = spanish.keys.sorted()), LocaleReviewStatus.effective(partial, spanish))
    }

    @Test
    fun `source and machine-drafted stay as declared`() {
        assertEquals(ReviewStatus.Source, LocaleReviewStatus.effective(ReviewStatus.Source, spanish))
        assertEquals(ReviewStatus.MachineDrafted, LocaleReviewStatus.effective(ReviewStatus.MachineDrafted, emptyMap()))
    }

    @Test
    fun `the committed review status is each locale's effective status, and a review names its digests' catalog (C199_1)`() {
        val declared = LocaleReviewStatus.locales(OpenVerifyJson.parseToJsonElement(File("i18n/review-status.json").readText()).jsonObject)
        val effective = SdkResourceTexts.LOCALE_FOLDERS.mapValues { (locale, folder) ->
            LocaleReviewStatus.effective(declared.getValue(locale), LocaleReviewStatus.keyDigests(SdkResourceTexts.resources(folder).values))
        }
        val unsigned = declared.mapNotNull { (locale, status) ->
            val record = status as? ReviewStatus.Reviewed ?: return@mapNotNull null
            locale.takeIf { record.catalogSha256 != LocaleReviewStatus.catalogSha256(record.keySha256) }
        }

        assertEquals(SdkResourceTexts.LOCALE_FOLDERS.keys, declared.keys)
        assertEquals(declared, effective)
        assertEquals(emptyList<String>(), unsigned)
    }
}
