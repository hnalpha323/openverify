package dev.openverify.sdk.i18n

import dev.openverify.sdk.model.OpenVerifyJson
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test
import java.io.File

/**
 * C199.6 (the key map's reverse): the SDK's run-time table `SDK_COPY_KEYS` is exactly the entries of
 * `android/openverify-sdk/i18n/key-map.json` (android-i18n's) that carry a flow key, so operator
 * copy reaches every string the key map places and no other. An entry android-i18n adds with a flow
 * key fails here until the table names it.
 */
internal class SdkCopyKeysTest {

    @Test
    fun `the run-time table is the key map's entries with a flow key (C199_6)`() {
        val entries = OpenVerifyJson.parseToJsonElement(File("i18n/key-map.json").readText()).jsonObject.getValue("entries").jsonArray.map { it.jsonObject }
        val withFlowKey = entries.mapNotNull { entry ->
            val flowKey = entry.getValue("flowKey").takeUnless { it is JsonNull }?.jsonPrimitive?.content ?: return@mapNotNull null
            entry.getValue("resource").jsonPrimitive.content to flowKey
        }.toMap()
        assertEquals(withFlowKey.toSortedMap(), SDK_COPY_KEYS.toSortedMap())
    }
}
