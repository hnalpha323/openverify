package dev.openverify.sdk.flow.logic

import dev.openverify.sdk.model.InputField

/**
 * C196.3 (Phase 9 C161.4; behaviour M34): a person on an Arabic keyboard types Arabic-Indic
 * (U+0660 to U+0669) or Extended Arabic-Indic (U+06F0 to U+06F9) digits into a code, phone, date,
 * number or ID field; the SDK turns them into ASCII before validation and submission, as the web flow
 * and the server do (`packages/flow-spec/src/v2/digits.ts`), so the value means the same everywhere.
 * Nothing else changes: other scripts' digits are not in C161.4. MRZ, BAC and PACE keys, the CAN and
 * dates sent to the chip are built as ASCII in the first place. Pure and locale-free: the device's
 * default locale never enters it.
 */
internal fun normalizeDigits(value: String): String {
    if (value.none { it in ARABIC_INDIC || it in EXTENDED_ARABIC_INDIC }) return value
    return buildString(value.length) {
        for (character in value) {
            append(
                when (character) {
                    in ARABIC_INDIC -> '0' + (character - ARABIC_INDIC.first)
                    in EXTENDED_ARABIC_INDIC -> '0' + (character - EXTENDED_ARABIC_INDIC.first)
                    else -> character
                },
            )
        }
    }
}

private val ARABIC_INDIC: CharRange = '٠'..'٩'
private val EXTENDED_ARABIC_INDIC: CharRange = '۰'..'۹'

/**
 * Whether a database, AAMVA or business form normalises [field]'s typed digits (C196.3): every typed
 * field but the email address and the website, as the web flow's `date`, `tel` and `text` kinds do
 * (`apps/flow/src/steps/forms/entered-values-step.tsx`). A field chosen from a list is never typed.
 */
internal fun normalisesDigits(field: InputField): Boolean = when (field) {
    InputField.EMAIL_ADDRESS, InputField.WEBSITE_URL,
    InputField.ADDRESS_COUNTRY_CODE, InputField.COUNTRY_CODE, InputField.ISSUING_AUTHORITY,
    -> false
    else -> true
}
