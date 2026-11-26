package dev.openverify.sdk.model

import kotlinx.serialization.KSerializer
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.SerializationException
import kotlinx.serialization.descriptors.SerialDescriptor
import kotlinx.serialization.descriptors.buildClassSerialDescriptor
import kotlinx.serialization.descriptors.element
import kotlinx.serialization.encoding.Decoder
import kotlinx.serialization.encoding.Encoder
import kotlinx.serialization.json.JsonDecoder
import kotlinx.serialization.json.JsonEncoder
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject

/**
 * C148, C151.5: a `screen` step's client view, its components with copy keys, validation and
 * same-screen rules (`screenClientViewSchema`). `android-screens` renders it (C195); a screen
 * holding an [UnsupportedComponent] renders unsupported as a whole, never in part (C194.3).
 */
@Serializable
internal data class ScreenStep(
    override val id: String,
    val components: List<FlowComponent>,
) : FlowStep {
    override val type: String get() = TYPE

    internal companion object {
        const val TYPE = "screen"
    }
}

/**
 * One component of C148's catalogue v1 (`COMPONENT_KINDS`). [visibleWhen] and [enabledWhen] are
 * strict visibility rules over the same screen's fields (C148.4), evaluated by `android-logic`'s
 * evaluator and again by the server.
 */
@Serializable(with = FlowComponentSerializer::class)
internal sealed interface FlowComponent {
    val id: String
    val kind: String
    val visibleWhen: JsonObject?
    val enabledWhen: JsonObject?
}

/** A form component binds a field of the version (C148.7). */
internal sealed interface FormComponent : FlowComponent {
    val labelKey: String
    val hintKey: String?
    val required: Boolean?
}

/** A form component of one field. */
internal sealed interface FieldComponent : FormComponent {
    val field: String
}

/** A text input's limits; [pattern] is the restricted grammar of C148.3, matched by `android-logic`. */
internal sealed interface TextFieldComponent : FieldComponent {
    val minLength: Int?
    val maxLength: Int?
    val pattern: String?
}

/** A component with options (C148.2). */
internal sealed interface OptionsComponent : FieldComponent {
    val options: List<ComponentOption>
}

@Serializable
internal data class ComponentOption(val key: String, val value: String, val labelKey: String)

@Serializable
internal data class TextComponent(
    override val id: String,
    /** `title`, `body` or `caption`. */
    val variant: String,
    val copyKey: String,
    override val visibleWhen: JsonObject? = null,
    override val enabledWhen: JsonObject? = null,
) : FlowComponent {
    override val kind: String get() = "text"
}

@Serializable
internal data class ImageComponent(
    override val id: String,
    val assetId: String,
    val altKey: String? = null,
    val decorative: Boolean,
    override val visibleWhen: JsonObject? = null,
    override val enabledWhen: JsonObject? = null,
) : FlowComponent {
    override val kind: String get() = "image"
}

@Serializable
internal data class SpacerComponent(
    override val id: String,
    /** `s`, `m` or `l`. */
    val size: String,
    override val visibleWhen: JsonObject? = null,
    override val enabledWhen: JsonObject? = null,
) : FlowComponent {
    override val kind: String get() = "spacer"
}

@Serializable
internal data class ContainerComponent(
    override val id: String,
    /** `vertical` or `horizontal`. */
    val direction: String,
    val children: List<FlowComponent>,
    override val visibleWhen: JsonObject? = null,
    override val enabledWhen: JsonObject? = null,
) : FlowComponent {
    override val kind: String get() = "container"
}

@Serializable
internal data class FooterComponent(
    override val id: String,
    val children: List<FlowComponent>,
    override val visibleWhen: JsonObject? = null,
    override val enabledWhen: JsonObject? = null,
) : FlowComponent {
    override val kind: String get() = "footer"
}

@Serializable
internal data class StepperComponent(
    override val id: String,
    val labelKeys: List<String>,
    val current: Int,
    override val visibleWhen: JsonObject? = null,
    override val enabledWhen: JsonObject? = null,
) : FlowComponent {
    override val kind: String get() = "stepper"
}

@Serializable
internal data class TextInputComponent(
    override val id: String,
    override val field: String,
    override val labelKey: String,
    override val hintKey: String? = null,
    override val required: Boolean? = null,
    override val minLength: Int? = null,
    override val maxLength: Int? = null,
    override val pattern: String? = null,
    override val visibleWhen: JsonObject? = null,
    override val enabledWhen: JsonObject? = null,
) : TextFieldComponent {
    override val kind: String get() = "text_input"
}

@Serializable
internal data class TextAreaComponent(
    override val id: String,
    override val field: String,
    override val labelKey: String,
    override val hintKey: String? = null,
    override val required: Boolean? = null,
    override val minLength: Int? = null,
    override val maxLength: Int? = null,
    override val pattern: String? = null,
    override val visibleWhen: JsonObject? = null,
    override val enabledWhen: JsonObject? = null,
) : TextFieldComponent {
    override val kind: String get() = "text_area"
}

/** Shown masked once entered; a [FlowValue.Set] from the server shows "set" and offers re-entry (C195.2). */
@Serializable
internal data class MaskedTextComponent(
    override val id: String,
    override val field: String,
    override val labelKey: String,
    override val hintKey: String? = null,
    override val required: Boolean? = null,
    override val minLength: Int? = null,
    override val maxLength: Int? = null,
    override val pattern: String? = null,
    override val visibleWhen: JsonObject? = null,
    override val enabledWhen: JsonObject? = null,
) : TextFieldComponent {
    override val kind: String get() = "masked_text"
}

@Serializable
internal data class NumberComponent(
    override val id: String,
    override val field: String,
    override val labelKey: String,
    override val hintKey: String? = null,
    override val required: Boolean? = null,
    val min: Double? = null,
    val max: Double? = null,
    override val visibleWhen: JsonObject? = null,
    override val enabledWhen: JsonObject? = null,
) : FieldComponent {
    override val kind: String get() = "number"
}

/** Dates are ISO 8601 (`YYYY-MM-DD`), [min] and [max] too. */
@Serializable
internal data class DateComponent(
    override val id: String,
    override val field: String,
    override val labelKey: String,
    override val hintKey: String? = null,
    override val required: Boolean? = null,
    val min: String? = null,
    val max: String? = null,
    override val visibleWhen: JsonObject? = null,
    override val enabledWhen: JsonObject? = null,
) : FieldComponent {
    override val kind: String get() = "date"
}

@Serializable
internal data class EmailComponent(
    override val id: String,
    override val field: String,
    override val labelKey: String,
    override val hintKey: String? = null,
    override val required: Boolean? = null,
    override val visibleWhen: JsonObject? = null,
    override val enabledWhen: JsonObject? = null,
) : FieldComponent {
    override val kind: String get() = "email"
}

@Serializable
internal data class UrlComponent(
    override val id: String,
    override val field: String,
    override val labelKey: String,
    override val hintKey: String? = null,
    override val required: Boolean? = null,
    override val visibleWhen: JsonObject? = null,
    override val enabledWhen: JsonObject? = null,
) : FieldComponent {
    override val kind: String get() = "url"
}

@Serializable
internal data class CheckboxComponent(
    override val id: String,
    override val field: String,
    override val labelKey: String,
    override val hintKey: String? = null,
    override val required: Boolean? = null,
    override val visibleWhen: JsonObject? = null,
    override val enabledWhen: JsonObject? = null,
) : FieldComponent {
    override val kind: String get() = "checkbox"
}

@Serializable
internal data class PhoneComponent(
    override val id: String,
    override val field: String,
    override val labelKey: String,
    override val hintKey: String? = null,
    override val required: Boolean? = null,
    val allowedCountries: List<String>? = null,
    override val visibleWhen: JsonObject? = null,
    override val enabledWhen: JsonObject? = null,
) : FieldComponent {
    override val kind: String get() = "phone"
}

@Serializable
internal data class CountrySelectComponent(
    override val id: String,
    override val field: String,
    override val labelKey: String,
    override val hintKey: String? = null,
    override val required: Boolean? = null,
    val allowedCountries: List<String>? = null,
    override val visibleWhen: JsonObject? = null,
    override val enabledWhen: JsonObject? = null,
) : FieldComponent {
    override val kind: String get() = "country_select"
}

@Serializable
internal data class SelectComponent(
    override val id: String,
    override val field: String,
    override val labelKey: String,
    override val hintKey: String? = null,
    override val required: Boolean? = null,
    override val options: List<ComponentOption>,
    override val visibleWhen: JsonObject? = null,
    override val enabledWhen: JsonObject? = null,
) : OptionsComponent {
    override val kind: String get() = "select"
}

@Serializable
internal data class RadioGroupComponent(
    override val id: String,
    override val field: String,
    override val labelKey: String,
    override val hintKey: String? = null,
    override val required: Boolean? = null,
    override val options: List<ComponentOption>,
    override val visibleWhen: JsonObject? = null,
    override val enabledWhen: JsonObject? = null,
) : OptionsComponent {
    override val kind: String get() = "radio_group"
}

@Serializable
internal data class MultiSelectComponent(
    override val id: String,
    override val field: String,
    override val labelKey: String,
    override val hintKey: String? = null,
    override val required: Boolean? = null,
    override val options: List<ComponentOption>,
    override val visibleWhen: JsonObject? = null,
    override val enabledWhen: JsonObject? = null,
) : OptionsComponent {
    override val kind: String get() = "multi_select"
}

@Serializable
internal data class CheckboxGroupComponent(
    override val id: String,
    override val field: String,
    override val labelKey: String,
    override val hintKey: String? = null,
    override val required: Boolean? = null,
    override val options: List<ComponentOption>,
    override val visibleWhen: JsonObject? = null,
    override val enabledWhen: JsonObject? = null,
) : OptionsComponent {
    override val kind: String get() = "checkbox_group"
}

/** C148.2: an address of several fields, with no autocomplete (C195.2). */
@Serializable
internal data class AddressComponent(
    override val id: String,
    override val labelKey: String,
    val fields: AddressFields,
    override val hintKey: String? = null,
    override val required: Boolean? = null,
    val allowedCountries: List<String>? = null,
    override val visibleWhen: JsonObject? = null,
    override val enabledWhen: JsonObject? = null,
) : FormComponent {
    override val kind: String get() = "address"
}

@Serializable
internal data class AddressFields(
    val street1: String,
    val street2: String? = null,
    val city: String,
    val subdivision: String? = null,
    val postalCode: String,
    val country: String,
)

/** C148.5, C195.3: `submit` (with its [port]), `cancel`, or `link` to a version link field. */
@Serializable
internal data class ButtonComponent(
    override val id: String,
    val labelKey: String,
    val action: String,
    val port: String? = null,
    /** `help-url` or `privacy-url` (`LINK_FIELDS`), for a `link` button. */
    val link: String? = null,
    override val visibleWhen: JsonObject? = null,
    override val enabledWhen: JsonObject? = null,
) : FlowComponent {
    override val kind: String get() = "button"
}

/** A component this SDK version cannot render: a later kind, or a known one it cannot decode (C194.3). */
internal data class UnsupportedComponent(
    override val id: String,
    override val kind: String,
) : FlowComponent {
    override val visibleWhen: JsonObject? get() = null
    override val enabledWhen: JsonObject? get() = null
}

/** Picks the component class from `kind`, falling back to [UnsupportedComponent]. JSON only. */
internal object FlowComponentSerializer : KSerializer<FlowComponent> {
    private val known: Map<String, KSerializer<out FlowComponent>> = mapOf(
        "text" to TextComponent.serializer(),
        "image" to ImageComponent.serializer(),
        "spacer" to SpacerComponent.serializer(),
        "container" to ContainerComponent.serializer(),
        "footer" to FooterComponent.serializer(),
        "stepper" to StepperComponent.serializer(),
        "text_input" to TextInputComponent.serializer(),
        "text_area" to TextAreaComponent.serializer(),
        "number" to NumberComponent.serializer(),
        "date" to DateComponent.serializer(),
        "email" to EmailComponent.serializer(),
        "phone" to PhoneComponent.serializer(),
        "select" to SelectComponent.serializer(),
        "radio_group" to RadioGroupComponent.serializer(),
        "checkbox" to CheckboxComponent.serializer(),
        "checkbox_group" to CheckboxGroupComponent.serializer(),
        "multi_select" to MultiSelectComponent.serializer(),
        "country_select" to CountrySelectComponent.serializer(),
        "url" to UrlComponent.serializer(),
        "masked_text" to MaskedTextComponent.serializer(),
        "address" to AddressComponent.serializer(),
        "button" to ButtonComponent.serializer(),
    )

    /** The kinds this SDK version decodes: C148's catalogue v1. */
    val kinds: Set<String> get() = known.keys

    override val descriptor: SerialDescriptor = buildClassSerialDescriptor("dev.openverify.FlowComponent") {
        element<String>("id")
        element<String>("kind")
    }

    override fun deserialize(decoder: Decoder): FlowComponent {
        val input = decoder as? JsonDecoder ?: throw SerializationException("Components can only be read from JSON")
        val body = input.decodeJsonElement() as? JsonObject ?: throw SerializationException("A component must be an object")
        val id = (body["id"] as? JsonPrimitive)?.takeIf { it.isString }?.content
            ?: throw SerializationException("A component needs a string \"id\"")
        val kind = (body["kind"] as? JsonPrimitive)?.takeIf { it.isString }?.content
            ?: throw SerializationException("A component needs a string \"kind\"")
        val serializer = known[kind] ?: return UnsupportedComponent(id, kind)
        return try {
            input.json.decodeFromJsonElement(serializer, JsonObject(body - "kind"))
        } catch (_: IllegalArgumentException) {
            UnsupportedComponent(id, kind)
        }
    }

    override fun serialize(encoder: Encoder, value: FlowComponent) {
        val output = encoder as? JsonEncoder ?: throw SerializationException("Components can only be written as JSON")
        @Suppress("UNCHECKED_CAST")
        val serializer = known[value.kind] as KSerializer<FlowComponent>?
        val body = if (value is UnsupportedComponent || serializer == null) {
            JsonObject(emptyMap())
        } else {
            output.json.encodeToJsonElement(serializer, value).jsonObject
        }
        output.encodeJsonElement(
            buildJsonObject {
                put("id", JsonPrimitive(value.id))
                put("kind", JsonPrimitive(value.kind))
                body.forEach { (key, element) -> if (key != "id") put(key, element) }
            },
        )
    }
}
