package dev.openverify.sdk.i18n

import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.security.MessageDigest
import java.text.Normalizer

/**
 * C199.1 and C161.5 (review H14): an SDK locale's review status in the form of Phase 9's
 * `LOCALE_REVIEW_STATUS` (`packages/flow-spec/src/locale-review-status.ts`), as
 * `i18n/review-status.json` records it, and the per-key digests that downgrade a `reviewed` locale
 * when one of its texts changes, so no text is called reviewed without a record. A review record
 * keeps `keySha256`, the digest of each text as reviewed (Workflow 10A Stage 1a amendment 12), where
 * the web keeps a snapshot of the reviewed catalog.
 */
internal sealed interface ReviewStatus {
    data object Source : ReviewStatus

    data object MachineDrafted : ReviewStatus

    data class PartiallyReviewed(
        val unreviewedKeys: List<String>,
        val by: String? = null,
        val date: String? = null,
        val catalogSha256: String? = null,
        val keySha256: Map<String, String>? = null,
    ) : ReviewStatus

    data class Reviewed(val by: String, val date: String, val catalogSha256: String, val keySha256: Map<String, String>) : ReviewStatus
}

internal object LocaleReviewStatus {

    /** SHA-256 of [text]'s UTF-8 bytes as 64 lower-case hex digits. */
    fun sha256(text: String): String =
        MessageDigest.getInstance("SHA-256").digest(text.toByteArray(Charsets.UTF_8)).joinToString("") { "%02x".format(it) }

    /**
     * The digest of each resource by name: SHA-256 of its NFC text, or of a plural's items as the
     * lines `<quantity>\t<NFC text>\n` sorted by quantity, so a reviewer signs each text by its key.
     */
    fun keyDigests(resources: Collection<SdkResourceTexts.Resource>): Map<String, String> =
        resources.associate { resource ->
            val text = resource.text
                ?: resource.items.toSortedMap().entries.joinToString("") { (quantity, item) -> "$quantity\t${Normalizer.normalize(item, Normalizer.Form.NFC)}\n" }
            resource.name to sha256(Normalizer.normalize(text, Normalizer.Form.NFC))
        }.toSortedMap()

    /** A review record's `catalogSha256`: SHA-256 of the sorted lines `<key>\t<digest>\n`, as the web's. */
    fun catalogSha256(digests: Map<String, String>): String =
        sha256(digests.toSortedMap().entries.joinToString("") { (key, digest) -> "$key\t$digest\n" })

    /**
     * The status a locale really has, given the digests of its texts now ([current]). A `reviewed`
     * locale with a key added or changed since its review is `partially-reviewed`, listing those keys
     * and keeping its record; a `partially-reviewed` one keeps its keys that still exist and adds those
     * changed since. Fail closed: a record without `keySha256` leaves every key unreviewed. A removed
     * key changes nothing; `source` and `machine-drafted` stay as declared.
     */
    fun effective(declared: ReviewStatus, current: Map<String, String>): ReviewStatus {
        val (reviewed, kept) = when (declared) {
            ReviewStatus.Source, ReviewStatus.MachineDrafted -> return declared
            is ReviewStatus.Reviewed -> declared.keySha256 to emptyList()
            is ReviewStatus.PartiallyReviewed -> declared.keySha256 to declared.unreviewedKeys.filter { it in current }
        }
        val changed = current.filter { (key, digest) -> reviewed == null || reviewed[key] != digest }.keys
        val unreviewedKeys = (kept + changed).distinct().sorted()
        return when (declared) {
            is ReviewStatus.Reviewed ->
                if (unreviewedKeys.isEmpty()) {
                    declared
                } else {
                    ReviewStatus.PartiallyReviewed(unreviewedKeys, declared.by, declared.date, declared.catalogSha256, declared.keySha256)
                }
            is ReviewStatus.PartiallyReviewed ->
                if (unreviewedKeys == declared.unreviewedKeys.sorted()) declared else declared.copy(unreviewedKeys = unreviewedKeys)
            else -> declared
        }
    }

    /** One locale's record of `review-status.json`. */
    fun parse(record: JsonObject): ReviewStatus {
        fun text(key: String): String? = (record[key] as? JsonPrimitive)?.content
        fun digests(): Map<String, String>? = (record["keySha256"] as? JsonObject)?.mapValues { it.value.jsonPrimitive.content }
        return when (val status = text("status")) {
            "source" -> ReviewStatus.Source
            "machine-drafted" -> ReviewStatus.MachineDrafted
            "partially-reviewed" -> ReviewStatus.PartiallyReviewed(
                record.getValue("unreviewedKeys").jsonArray.map { it.jsonPrimitive.content },
                text("by"),
                text("date"),
                text("catalogSha256"),
                digests(),
            )
            "reviewed" -> ReviewStatus.Reviewed(text("by")!!, text("date")!!, text("catalogSha256")!!, digests()!!)
            else -> error("review-status.json: unknown status $status")
        }
    }

    /** The locales' records of a parsed `review-status.json`. */
    fun locales(file: JsonObject): Map<String, ReviewStatus> = file.getValue("locales").jsonObject.mapValues { parse(it.value.jsonObject) }
}
