package dev.openverify.sdk.api

import okhttp3.MediaType.Companion.toMediaTypeOrNull
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.params.ParameterizedTest
import org.junit.jupiter.params.provider.NullSource
import org.junit.jupiter.params.provider.ValueSource

/**
 * The common [isJsonMediaType] against OkHttp's `MediaType`, which decided before K4 whether an
 * error body was a problem to read: a JSON or `+json` subtype, in a well-formed media type.
 */
class JsonMediaTypeParityTest {

    @ParameterizedTest(name = "[{index}] \"{0}\"")
    @NullSource
    @ValueSource(
        strings = [
            "application/json", "application/json; charset=utf-8", "application/json;charset=UTF-8", "APPLICATION/JSON",
            "application/problem+json", "application/problem+json; charset=utf-8", "Application/Problem+JSON", "application/vnd.api+json",
            "application/json-patch+json", "text/json", "application/json; charset=\"utf-8\"", "application/json; charset='utf-8'",
            "application/json; charset=utf-8; profile=x", "application/json;  charset=utf-8", "application/json;", "application/json;;",
            "text/html", "text/plain; charset=utf-8", "application/jsonp", "application/json-seq", "application/xml", "application/+json",
            "application/json; charset", "application/json; charset=", "application/json; a=b c", "application/json ", " application/json",
            "json", "", "/json", "application/", "application/json/x", "application/json\tx", "application/js on",
        ],
    )
    fun `a content type is JSON exactly when OkHttp's MediaType said so`(contentType: String?) {
        val okHttp = contentType?.toMediaTypeOrNull()?.subtype?.let { it == "json" || it.endsWith("+json") } == true

        assertEquals(okHttp, isJsonMediaType(contentType))
    }
}
