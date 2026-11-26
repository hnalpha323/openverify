package dev.openverify.sdk.privacy

import android.app.Activity
import android.app.Application
import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.view.WindowManager
import androidx.test.core.app.ApplicationProvider
import dev.openverify.sdk.OpenVerifyInquiry
import dev.openverify.sdk.api.LoopbackHttp
import dev.openverify.sdk.log.HostDebuggable
import dev.openverify.sdk.model.Fixtures
import dev.openverify.sdk.model.OpenVerifyJson
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonObject
import mockwebserver3.Dispatcher
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import mockwebserver3.RecordedRequest
import java.util.Collections

/**
 * The flow API the privacy tests launch the real activity against: a loopback `MockWebServer` that
 * answers the session read with one fixed session and refuses every other call with 404, recording
 * its path. Nothing here reaches a network (rule 9).
 */
internal class PrivacyFlowServer : AutoCloseable {
    private val server = MockWebServer()

    /** Every path asked other than the session, in order. */
    val otherPaths: MutableList<String> = Collections.synchronizedList(mutableListOf())

    @Volatile
    var session: String = "{}"

    init {
        LoopbackHttp.testOverride = true
        HostDebuggable.forget()
        server.dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest): MockResponse = when (request.url.encodedPath) {
                "/api/v1/flow/session" -> MockResponse.Builder().code(200).addHeader("Content-Type", "application/json").body(session).build()
                else -> {
                    otherPaths += request.url.encodedPath
                    MockResponse.Builder().code(404).build()
                }
            }
        }
        server.start()
    }

    /** The intent a host's contract makes for this server. */
    fun launchIntent(): Intent = OpenVerifyInquiry.Contract().createIntent(
        ApplicationProvider.getApplicationContext<Context>(),
        OpenVerifyInquiry.Request(INQUIRY_ID, TOKEN, server.url("/").toString()),
    )

    override fun close() {
        LoopbackHttp.testOverride = null
        HostDebuggable.forget()
        server.close()
    }

    internal companion object {
        const val INQUIRY_ID = "inq_01M5CJXHG07XPHF3HRM6NREDH7"

        /** Synthetic: a prefix plus 43 base64url characters. */
        val TOKEN = "ovs_" + "s".repeat(43)
    }
}

/** Sessions for the privacy tests, each the golden spec-2 session positioned on one step. Synthetic words only. */
internal object PrivacySessions {
    private val golden: JsonObject by lazy { OpenVerifyJson.parseToJsonElement(Fixtures.read("api/flow-session-v2.json")).jsonObject }

    /**
     * The golden session positioned on [step] (a client view as JSON), with [verifications] and the
     * English operator [copy] of the step's components.
     */
    fun at(step: String, verifications: String = "[]", copy: Map<String, String> = emptyMap()): String {
        val view = OpenVerifyJson.parseToJsonElement(step).jsonObject
        val id = view.getValue("id").jsonPrimitive.content
        val members: Map<String, JsonElement> = mapOf(
            "step" to view,
            "position" to OpenVerifyJson.parseToJsonElement("""{"step-id":"$id","state":"active","previous-step-id":null}"""),
            "verifications" to OpenVerifyJson.parseToJsonElement(verifications),
            "values" to JsonObject(emptyMap()),
            "copy" to buildJsonObject { putJsonObject("messages") { putJsonObject("en") { copy.forEach { (key, words) -> put(key, words) } } } },
            "signals" to OpenVerifyJson.parseToJsonElement("""{"integrity":false,"recognition":false}"""),
        )
        return JsonObject(golden + members).toString()
    }

    /** A verification of [type] as the session lists it, `initiated`, with [guidance]. */
    fun initiated(type: String, guidance: String = "{}"): String =
        """[{"type":"verification/$type","id":"ver_01M5CK16P0D13FXHZSS4TCFBVH","attributes":{"status":"initiated","retry-hints":[],""" +
            """"created-at":"2026-10-20T12:02:00.000Z","updated-at":"2026-10-20T12:02:00.000Z","guidance":$guidance}}]"""
}

/**
 * Every window this process has added, by its layout parameters: the activity's, and each dialog,
 * popup or sheet over it. Read from `WindowManagerGlobal`, as the platform's own test tooling does,
 * so a window is seen whoever made it.
 */
internal object ProcessWindows {
    fun params(): List<WindowManager.LayoutParams> {
        val global = Class.forName("android.view.WindowManagerGlobal")
        val instance = global.getMethod("getInstance").invoke(null)
        val field = global.getDeclaredField("mParams").apply { isAccessible = true }
        @Suppress("UNCHECKED_CAST")
        return (field.get(instance) as List<WindowManager.LayoutParams>).toList()
    }

    /** Whether the window of [params] keeps its content out of screenshots, recordings and recents. */
    fun secure(params: WindowManager.LayoutParams): Boolean = params.flags and WindowManager.LayoutParams.FLAG_SECURE != 0
}

/** Every `Bundle` an activity of this process saved while [record] ran, in order. */
internal fun savedBundles(record: () -> Unit): List<Bundle> {
    val saved = mutableListOf<Bundle>()
    val application = ApplicationProvider.getApplicationContext<Application>()
    val callbacks = object : Application.ActivityLifecycleCallbacks {
        override fun onActivityPostSaveInstanceState(activity: Activity, outState: Bundle) {
            saved += outState
        }

        override fun onActivityCreated(activity: Activity, savedInstanceState: Bundle?) = Unit
        override fun onActivityStarted(activity: Activity) = Unit
        override fun onActivityResumed(activity: Activity) = Unit
        override fun onActivityPaused(activity: Activity) = Unit
        override fun onActivityStopped(activity: Activity) = Unit
        override fun onActivitySaveInstanceState(activity: Activity, outState: Bundle) = Unit
        override fun onActivityDestroyed(activity: Activity) = Unit
    }
    application.registerActivityLifecycleCallbacks(callbacks)
    try {
        record()
    } finally {
        application.unregisterActivityLifecycleCallbacks(callbacks)
    }
    return saved
}

/**
 * Everything a saved `Bundle` holds, as text: every key and every value at any depth, through nested
 * bundles, lists, maps, arrays, sparse arrays and the fields of saved objects (Compose's saved
 * states, view states), with numbers and characters written out and byte arrays read as UTF-8 and
 * UTF-16. The canary test looks for a typed value in these.
 */
internal object SavedText {
    private const val MAX_DEPTH = 24

    fun of(root: Any?): List<String> {
        val found = mutableListOf<String>()
        val seen = java.util.IdentityHashMap<Any, Unit>()
        val pending = ArrayDeque<Pair<Any?, Int>>()
        pending += root to 0
        while (pending.isNotEmpty()) {
            val (value, depth) = pending.removeFirst()
            if (value == null || depth > MAX_DEPTH) continue
            fun push(next: Any?) {
                pending += next to depth + 1
            }
            when (value) {
                is CharSequence -> found += value.toString()
                is Number, is Boolean, is Char -> found += value.toString()
                is CharArray -> found += String(value)
                is ByteArray -> {
                    found += value.toString(Charsets.UTF_8)
                    found += value.toString(Charsets.UTF_16LE)
                    found += value.toString(Charsets.UTF_16BE)
                }
                is IntArray -> found += value.joinToString(",")
                is LongArray -> found += value.joinToString(",")
                is ShortArray, is FloatArray, is DoubleArray, is BooleanArray -> Unit
                else -> {
                    if (seen.put(value, Unit) != null) continue
                    when (value) {
                        is android.os.BaseBundle -> value.keySet().forEach { key ->
                            found += key
                            @Suppress("DEPRECATION")
                            push(value.get(key))
                        }
                        is Map<*, *> -> value.forEach { (key, item) ->
                            push(key)
                            push(item)
                        }
                        is Iterable<*> -> value.forEach(::push)
                        is Array<*> -> value.forEach(::push)
                        is android.util.SparseArray<*> -> for (index in 0 until value.size()) push(value.valueAt(index))
                        is Enum<*> -> found += value.name
                        is Class<*> -> Unit
                        else -> fields(value).forEach(::push)
                    }
                }
            }
        }
        return found
    }

    /** The instance fields of [value], its superclasses' included; a JDK or Kotlin runtime object is not opened. */
    private fun fields(value: Any): List<Any?> {
        val name = value.javaClass.name
        if (name.startsWith("java.") || name.startsWith("javax.") || name.startsWith("jdk.") || name.startsWith("sun.") || name.startsWith("kotlin.")) {
            return listOf(value.toString())
        }
        val values = mutableListOf<Any?>()
        var type: Class<*>? = value.javaClass
        while (type != null && type != Any::class.java) {
            type.declaredFields.filterNot { java.lang.reflect.Modifier.isStatic(it.modifiers) }.forEach { field ->
                try {
                    field.isAccessible = true
                    values += field.get(value)
                } catch (_: RuntimeException) {
                    // A field the runtime does not open: its owner's text stands in for it.
                    values += value.toString()
                }
            }
            type = type.superclass
        }
        return values
    }
}

/**
 * C213.3: the canary is in no message, no `toString` and no trace of [error], its causes or its
 * suppressed exceptions; [what] names the case in the failure.
 */
internal fun assertNoCanary(error: Throwable, canary: String, what: String) {
    val seen = mutableSetOf<Throwable>()
    val pending = ArrayDeque(listOf(error))
    while (pending.isNotEmpty()) {
        val next = pending.removeFirst()
        if (!seen.add(next)) continue
        listOf("message" to next.message.orEmpty(), "toString" to next.toString(), "trace" to next.stackTraceToString()).forEach { (part, text) ->
            if (canary in text) throw AssertionError("$what: ${next::class.simpleName}'s $part carries the canary")
        }
        next.cause?.let(pending::addLast)
        pending.addAll(next.suppressed)
    }
}
