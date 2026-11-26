package dev.openverify.sdk.ui

import androidx.compose.runtime.mutableStateMapOf

/**
 * The text the user types into the Phase 5 screens (C64.2): a phone number, an email address, a
 * code, a form's values, a wallet address and signature. The view model keeps it, so a rotation
 * keeps it without writing it to saved state, as it is personal data, and clears it once the flow
 * leaves the step (C53.8). Keys are `<step id>:<field>`. It is snapshot state, so a screen that
 * reads a draft recomposes when it changes.
 */
internal class InputDrafts {
    private val values = mutableStateMapOf<String, String>()

    operator fun get(key: String): String = values[key].orEmpty()

    operator fun set(key: String, value: String) {
        values[key] = value
    }

    fun clear() = values.clear()
}
