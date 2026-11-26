package dev.openverify.sdk.model

import kotlinx.serialization.KSerializer
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.SerializationException
import kotlinx.serialization.descriptors.SerialDescriptor
import kotlinx.serialization.descriptors.buildClassSerialDescriptor
import kotlinx.serialization.encoding.Decoder
import kotlinx.serialization.encoding.Encoder
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonDecoder
import kotlinx.serialization.json.JsonEncoder
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.jsonPrimitive

// Phase 9's session members (C151.5-C151.8, C158.5, C160.7, C162.3, C162.6; `flow-api.ts:149-171`),
// frozen in Workflow 10A Stage 1a. Every member is optional: a server before Phase 9 sends none, and
// the driver requires `spec-version: 2` and a `position` (C193.2).

/** C151.5: where the inquiry is. `previous-step-id` names only a step the person saw. */
@Serializable
internal data class FlowPosition(
    @SerialName("step-id") val stepId: String?,
    val state: FlowPositionState,
    @SerialName("previous-step-id") val previousStepId: String? = null,
    /** With [FlowPositionState.WAITING]: when to read the session again, 0 to 30,000 ms. */
    @SerialName("retry-after-ms") val retryAfterMs: Int? = null,
)

/** `position.state` (`FLOW_POSITION_STATES`). A state added after this SDK version decodes as [UNKNOWN]. */
@Serializable(with = FlowPositionState.Serializer::class)
internal enum class FlowPositionState(override val wireValue: String) : WireValue {
    ACTIVE("active"),
    WAITING("waiting"),
    HALTED("halted"),
    ENDED("ended"),
    UNKNOWN("unknown"),
    ;

    internal object Serializer : WireEnumSerializer<FlowPositionState>("dev.openverify.FlowPositionState", entries, UNKNOWN, { it.wireValue })
}

/**
 * C151.5 (review P16): a value of a field bound on the current screen (or a verification step's
 * `prefillFrom` field). It is personal data, so no [toString] shows it. A masked or write-once
 * value comes back only as [Set], never its text.
 */
@Serializable(with = FlowValueSerializer::class)
internal sealed interface FlowValue {
    data class Text(val value: String) : FlowValue {
        override fun toString(): String = "FlowValue.Text(<redacted>)"
    }

    data class Number(val value: Double) : FlowValue {
        override fun toString(): String = "FlowValue.Number(<redacted>)"
    }

    data class Bool(val value: Boolean) : FlowValue {
        override fun toString(): String = "FlowValue.Bool(<redacted>)"
    }

    data class Texts(val values: List<String>) : FlowValue {
        override fun toString(): String = "FlowValue.Texts(<${values.size} redacted>)"
    }

    /** No value. */
    data object Empty : FlowValue

    /** `{ "set": true }`: the field holds a value the server never sends back. Never submitted. */
    data object Set : FlowValue
}

internal object FlowValueSerializer : KSerializer<FlowValue> {
    override val descriptor: SerialDescriptor = buildClassSerialDescriptor("dev.openverify.FlowValue")

    override fun deserialize(decoder: Decoder): FlowValue {
        val input = decoder as? JsonDecoder ?: throw SerializationException("Flow values can only be read from JSON")
        return when (val element = input.decodeJsonElement()) {
            JsonNull -> FlowValue.Empty
            is JsonPrimitive -> when {
                element.isString -> FlowValue.Text(element.content)
                element.booleanOrNull != null -> FlowValue.Bool(element.booleanOrNull!!)
                element.doubleOrNull != null -> FlowValue.Number(element.doubleOrNull!!)
                else -> throw SerializationException("A flow value must be a string, number, boolean or null")
            }
            is JsonArray -> FlowValue.Texts(
                element.map {
                    val item = it as? JsonPrimitive
                    if (item == null || !item.isString) throw SerializationException("A flow value list holds strings only")
                    item.content
                },
            )
            is JsonObject -> if (element.size == 1 && element["set"]?.jsonPrimitive?.booleanOrNull == true) {
                FlowValue.Set
            } else {
                throw SerializationException("A flow value object must be { \"set\": true }")
            }
        }
    }

    override fun serialize(encoder: Encoder, value: FlowValue) {
        val output = encoder as? JsonEncoder ?: throw SerializationException("Flow values can only be written as JSON")
        output.encodeJsonElement(
            when (value) {
                is FlowValue.Text -> JsonPrimitive(value.value)
                is FlowValue.Number -> JsonPrimitive(value.value)
                is FlowValue.Bool -> JsonPrimitive(value.value)
                is FlowValue.Texts -> JsonArray(value.values.map(::JsonPrimitive))
                FlowValue.Empty -> JsonNull
                FlowValue.Set -> throw SerializationException("A set value is the server's marker and is never sent")
            },
        )
    }
}

/**
 * C160.7: the theme a session renders. The palettes stay maps here so that a palette the SDK
 * cannot use (a token outside C160.3's twelve, a colour not `#rrggbb`) never fails the session:
 * `android-theme` checks them and falls back to the built-in theme for the whole session (C198.1).
 */
@Serializable
internal data class FlowTheme(
    @SerialName("theme-set-id") val themeSetId: String?,
    val revision: Int?,
    /** `light`, `dark` or `auto` (`THEME_MODES`). */
    val mode: String,
    val light: Map<String, String>,
    val dark: Map<String, String>?,
    /** 0 to 24. */
    val radius: Int,
    val font: FlowThemeFont,
    val logo: FlowThemeLogo?,
    /** `header` (`THEME_LOGO_PLACEMENTS`). */
    val placement: String,
)

/** C160.7: `system`, or `uploaded` with its asset; native clients always use the system font (C198.4). */
@Serializable
internal data class FlowThemeFont(
    val kind: String,
    @SerialName("asset-id") val assetId: String? = null,
    val platforms: List<String> = emptyList(),
)

/** C160.6: a raster logo by its asset; a decorative one shows the organisation's name as text. */
@Serializable
internal data class FlowThemeLogo(
    @SerialName("asset-id") val assetId: String,
    @SerialName("alt-key") val altKey: String?,
    val decorative: Boolean,
)

/** C162.6: the built-in overrides and the current step's component texts, by enabled locale. */
@Serializable
internal data class FlowCopy(val messages: Map<String, Map<String, String>> = emptyMap())

/** C161.2: the version's enabled locales and its default. */
@Serializable
internal data class FlowLocales(val enabled: List<String>, val default: String)

/** C158.5: the completion redirect; ignored on Android, where the activity result replaces it (decision 10). */
@Serializable
internal data class FlowCompletion(@SerialName("redirect-url") val redirectUrl: String?)

/** C162.3 (Workflow 9B): the version's help and privacy links, `https:` only. */
@Serializable
internal data class FlowLinks(
    @SerialName("help-url") val helpUrl: String?,
    @SerialName("privacy-url") val privacyUrl: String?,
)

/** C128.7: how the person contests a decline: an `https:` URL with its host, or a contact. */
@Serializable
internal data class FlowContestRoute(val url: String?, val host: String?, val contact: String?)

/** C96.3 (F30): what a redeemed handoff session's context screen shows; an SDK session never gets one. */
@Serializable
internal data class FlowHandoffContext(
    @SerialName("organization-display-name") val organizationDisplayName: String,
    val steps: List<String> = emptyList(),
    @SerialName("started-at") val startedAt: String,
)
