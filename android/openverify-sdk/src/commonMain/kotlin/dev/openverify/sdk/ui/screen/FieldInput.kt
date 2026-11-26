package dev.openverify.sdk.ui.screen

import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.ui.autofill.ContentType
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.KeyboardType
import dev.openverify.sdk.model.AddressComponent
import dev.openverify.sdk.model.CheckboxComponent
import dev.openverify.sdk.model.CheckboxGroupComponent
import dev.openverify.sdk.model.CountrySelectComponent
import dev.openverify.sdk.model.DateComponent
import dev.openverify.sdk.model.EmailComponent
import dev.openverify.sdk.model.MaskedTextComponent
import dev.openverify.sdk.model.MultiSelectComponent
import dev.openverify.sdk.model.NumberComponent
import dev.openverify.sdk.model.PhoneComponent
import dev.openverify.sdk.model.RadioGroupComponent
import dev.openverify.sdk.model.SelectComponent
import dev.openverify.sdk.model.TextAreaComponent
import dev.openverify.sdk.model.TextInputComponent
import dev.openverify.sdk.model.UrlComponent

/**
 * C195.2 (review P07): how a typed field asks the keyboard and the autofill service. [contentType]
 * is the Android autofill hint for the field's purpose (C148.7's `autocomplete` tokens, WCAG 1.3.5),
 * null when the field has none. A [secret] field (`masked_text`, a document number, an OTP code, and
 * in 10C the MRZ and the CAN) carries no autofill content type, so no autofill service is told what
 * it holds and Compose leaves it out of the save request it builds from content types, with
 * autocorrect off ([SECRET_TEXT] says why not a password keyboard). [masked] fields show dots once
 * typed.
 */
internal data class FieldInput(
    internal val keyboard: KeyboardOptions,
    internal val contentType: ContentType?,
    internal val secret: Boolean = false,
    internal val masked: Boolean = false,
    internal val singleLine: Boolean = true,
)

private val PLAIN = KeyboardOptions(autoCorrectEnabled = false)

/** The [FieldInput] of a form component's field (an address's [part]); null for a field that is not typed. */
internal fun fieldInputOf(field: BoundField): FieldInput? = when (val component = field.component) {
    is TextInputComponent -> FieldInput(PLAIN, contentType = null)
    is TextAreaComponent -> FieldInput(KeyboardOptions(capitalization = KeyboardCapitalization.Sentences), contentType = null, singleLine = false)
    // A secret: shown masked once entered (C195.2).
    is MaskedTextComponent -> FieldInput(SECRET_TEXT, contentType = null, secret = true, masked = true)
    // A text keyboard with the decimal digits, so typed Arabic-Indic digits reach the normalisation (C196.3).
    is NumberComponent -> FieldInput(KeyboardOptions(keyboardType = KeyboardType.Decimal, autoCorrectEnabled = false), contentType = null)
    is DateComponent -> FieldInput(
        KeyboardOptions(keyboardType = KeyboardType.Number, autoCorrectEnabled = false),
        contentType = if (BIRTH.containsMatchIn(component.field)) ContentType.BirthDateFull else null,
    )
    is EmailComponent -> FieldInput(KeyboardOptions(keyboardType = KeyboardType.Email, autoCorrectEnabled = false), ContentType.EmailAddress)
    is PhoneComponent -> FieldInput(KeyboardOptions(keyboardType = KeyboardType.Phone, autoCorrectEnabled = false), ContentType.PhoneNumber)
    is UrlComponent -> FieldInput(KeyboardOptions(keyboardType = KeyboardType.Uri, autoCorrectEnabled = false), contentType = null)
    is AddressComponent -> when (field.part) {
        AddressPart.STREET1 -> FieldInput(WORDS, ContentType.AddressStreet)
        AddressPart.STREET2 -> FieldInput(WORDS, ContentType.AddressAuxiliaryDetails)
        AddressPart.CITY -> FieldInput(WORDS, ContentType.AddressLocality)
        AddressPart.SUBDIVISION -> FieldInput(WORDS, ContentType.AddressRegion)
        AddressPart.POSTAL_CODE -> FieldInput(
            KeyboardOptions(capitalization = KeyboardCapitalization.Characters, autoCorrectEnabled = false),
            ContentType.PostalCode,
        )
        AddressPart.COUNTRY, null -> null
    }
    is CheckboxComponent, is CheckboxGroupComponent, is MultiSelectComponent, is RadioGroupComponent, is SelectComponent, is CountrySelectComponent -> null
}

private val WORDS = KeyboardOptions(capitalization = KeyboardCapitalization.Words, autoCorrectEnabled = false)

/**
 * A secret's keyboard: plain text with autocorrect off. Not the password variation, which keyboards
 * do not learn from: Compose 1.11's text field declares `ContentType.Password` for a `Password` or
 * `NumberPassword` keyboard (and `EmailAddress` for `Email`, `PhoneNumber` for `Phone`), which would
 * tell every autofill service the field holds a password and invite it to save the value, the exposure
 * C195.2 rules out first. Compose 1.11 cannot set `IME_FLAG_NO_PERSONALIZED_LEARNING`, so a keyboard may
 * still learn what is typed; the TDD file records it (review P07).
 */
internal val SECRET_TEXT: KeyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Text, autoCorrectEnabled = false)

/** A numeric secret's keyboard (an OTP code): digits, autocorrect off, for the same reason not the number-password variation. */
internal val SECRET_NUMBER: KeyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number, autoCorrectEnabled = false)

/** A field named for a birth date gets the birth-date hint (as the web flow's `bday`). */
private val BIRTH = Regex("birth|dob")
