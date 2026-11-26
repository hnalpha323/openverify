package dev.openverify.sdk.i18n

import androidx.compose.foundation.layout.Column
import androidx.compose.material3.Text
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import dev.openverify.sdk.generated.resources.Res
import dev.openverify.sdk.generated.resources.openverify_cancel
import dev.openverify.sdk.generated.resources.openverify_crypto_evm_chain
import dev.openverify.sdk.generated.resources.openverify_otp_attempts_left
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * C199.4: the facade resolves the SDK's chosen language for its own composition only, whatever the
 * process locale says, and never changes that locale; outside a chosen language it reads as Compose
 * does. C199.5: [sdkText], the displayed form, isolates each interpolated value with U+2068 and
 * U+2069; [sdkString], the logical form, never does.
 */
@RunWith(RobolectricTestRunner::class)
internal class SdkStringsFacadeTest {

    @get:Rule
    val rule = createComposeRule()

    @Test
    fun `a chosen language reads its own words in a process whose locale is English`() {
        rule.setContent {
            CompositionLocalProvider(LocalSdkLanguage provides "fr") {
                Column {
                    Text(sdkString(Res.string.openverify_cancel))
                    Text(sdkPlural(Res.plurals.openverify_otp_attempts_left, 2, 2))
                }
            }
        }

        rule.onNodeWithText("Annuler").assertExists()
        rule.onNodeWithText("Il vous reste 2 essais pour ce code.").assertExists()
        assertEquals("en", java.util.Locale.getDefault().language)
    }

    @Test
    @Config(qualifiers = "de")
    fun `Arabic is chosen in a German process, plural categories by Arabic's rules`() {
        rule.setContent {
            CompositionLocalProvider(LocalSdkLanguage provides "ar") {
                Column {
                    Text(sdkString(Res.string.openverify_cancel))
                    Text(sdkPlural(Res.plurals.openverify_otp_attempts_left, 2, 2))
                }
            }
        }

        rule.onNodeWithText("إلغاء").assertExists()
        rule.onNodeWithText("تبقّت محاولتان لهذا الرمز.").assertExists()
        assertEquals("de", java.util.Locale.getDefault().language)
    }

    @Test
    @Config(qualifiers = "es")
    fun `without a chosen language the facade reads as Compose does, by the process locale`() {
        rule.setContent { Text(sdkString(Res.string.openverify_cancel)) }

        rule.onNodeWithText("Cancelar").assertExists()
    }

    @Test
    fun `the displayed text isolates each interpolated value, the logical text never does`() {
        var logical = ""
        var displayed = ""
        rule.setContent {
            CompositionLocalProvider(LocalSdkLanguage provides "en") {
                logical = sdkString(Res.string.openverify_crypto_evm_chain, "8453")
                displayed = sdkText(Res.string.openverify_crypto_evm_chain, "8453").text
            }
        }
        rule.waitForIdle()

        assertEquals("EVM network 8453", logical)
        assertEquals("EVM network ⁨8453⁩", displayed)
    }
}
