package dev.openverify.sdk.ui.steps

import android.content.ClipboardManager
import android.content.Context
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.assertTextContains
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performTextInput
import androidx.test.core.app.ApplicationProvider
import dev.openverify.sdk.flow.CryptoChallenge
import dev.openverify.sdk.flow.CryptoError
import dev.openverify.sdk.flow.FlowState
import dev.openverify.sdk.generated.resources.*
import dev.openverify.sdk.i18n.isolated
import dev.openverify.sdk.model.CryptoSigningMethod
import dev.openverify.sdk.model.CryptoWalletStep
import dev.openverify.sdk.model.RetryHint
import dev.openverify.sdk.ui.InputDrafts
import dev.openverify.sdk.ui.RecordingActions
import dev.openverify.sdk.ui.TestTags
import kotlinx.coroutines.runBlocking
import org.jetbrains.compose.resources.PluralStringResource
import org.jetbrains.compose.resources.StringResource
import org.jetbrains.compose.resources.getPluralString
import org.jetbrains.compose.resources.getString
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import kotlin.time.Clock
import kotlin.time.Duration.Companion.minutes
import kotlin.time.Instant

/**
 * C57, C64.1, C64.2: the wallet screen by its paste path: the network by name, the address, then
 * the server's message with a copy button, the pasted signature and, on Solana, the signed message.
 */
@RunWith(RobolectricTestRunner::class)
class CryptoWalletStepScreenTest {

    @get:Rule
    val rule = createComposeRule()

    private val actions = RecordingActions()
    private val drafts = InputDrafts()
    private val now = Instant.parse("2026-10-20T12:00:30Z")
    private val clock = object : Clock {
        override fun now(): Instant = now
    }

    private val step = CryptoWalletStep("wallet", listOf(EVM, SOLANA, BASE), listOf(CryptoSigningMethod.PASTE))
    private val entry = FlowState.CryptoWallet(step, listOf(EVM, SOLANA, BASE))
    private val message = "openverify.test wants you to sign in with your account:\n$ADDRESS"
    private val challenge = CryptoChallenge("cwc_01M5CK16P0D13FXHZSS4TCFB01", EVM, message, now + 10.minutes)

    /** [res] as a screen shows it: each value isolated (C199.5, K10A-2). */
    private fun text(res: StringResource, vararg args: Any) = runBlocking { getString(res, *args.map { isolated(it.toString()) }.toTypedArray()) }

    private fun plural(res: PluralStringResource, n: Int) = runBlocking { getPluralString(res, n, isolated(n.toString())) }

    private fun show(state: FlowState.CryptoWallet) {
        rule.setContent { CryptoWalletStepScreen(state, drafts, actions, clock) }
    }

    // The network and address -----------------------------------------------------------------

    @Test
    fun `the entry offers the networks by name and asks for the message for the address typed`() {
        show(entry)

        rule.onNodeWithText(text(Res.string.openverify_crypto_title)).assertExists()
        rule.onNodeWithTag(TestTags.CRYPTO_CHAIN).assertTextContains("Ethereum")
        rule.onNodeWithTag(TestTags.CRYPTO_ADDRESS).performTextInput(ADDRESS)
        rule.onNodeWithText(text(Res.string.openverify_crypto_get_message)).performScrollTo().performClick()

        assertEquals(listOf<Any?>(EVM to ADDRESS), actions.sent)
    }

    @Test
    fun `another network is chosen by its name, an EVM chain by its number`() {
        show(entry)

        rule.onNodeWithTag(TestTags.CRYPTO_CHAIN).performClick()
        rule.onNodeWithTag(TestTags.option(BASE)).assertTextContains(text(Res.string.openverify_crypto_evm_chain, "8453"))
        rule.onNodeWithTag(TestTags.option(SOLANA)).performClick()
        rule.onNodeWithTag(TestTags.CRYPTO_ADDRESS).performTextInput(SOLANA_ADDRESS)
        rule.onNodeWithText(text(Res.string.openverify_crypto_get_message)).performScrollTo().performClick()

        rule.onNodeWithTag(TestTags.CRYPTO_CHAIN).assertTextContains("Solana")
        assertEquals(listOf<Any?>(SOLANA to SOLANA_ADDRESS), actions.sent)
    }

    @Test
    fun `asking for the message stays off until an address is typed, and while it is on its way`() {
        var state by mutableStateOf(entry)
        rule.setContent { CryptoWalletStepScreen(state, drafts, actions, clock) }

        rule.onNodeWithText(text(Res.string.openverify_crypto_get_message)).assertIsNotEnabled()
        rule.onNodeWithTag(TestTags.CRYPTO_ADDRESS).performTextInput(ADDRESS)
        rule.onNodeWithText(text(Res.string.openverify_crypto_get_message)).assertIsEnabled()
        state = entry.copy(busy = true)
        rule.onNodeWithText(text(Res.string.openverify_crypto_getting_message)).assertExists()
        rule.onNodeWithText(text(Res.string.openverify_crypto_get_message)).assertIsNotEnabled()
    }

    @Test
    fun `each refusal is said on the entry`() {
        var state by mutableStateOf(entry)
        rule.setContent { CryptoWalletStepScreen(state, drafts, actions, clock) }
        val said = mapOf(
            CryptoError.CHAIN_NOT_OFFERED to Res.string.openverify_crypto_error_chain_not_offered,
            CryptoError.ADDRESS_INVALID to Res.string.openverify_crypto_error_address_invalid,
            CryptoError.EXPECTED_ADDRESS_MISMATCH to Res.string.openverify_crypto_error_expected_address,
            CryptoError.CHALLENGE_INVALID to Res.string.openverify_crypto_error_challenge_invalid,
        )

        for ((error, words) in said) {
            state = entry.copy(error = error)
            rule.onNodeWithText(text(words)).assertExists()
        }
    }

    @Test
    fun `a restarted attempt says why, and a failed one shows its hints`() {
        var state by mutableStateOf(entry.copy(restarted = true))
        rule.setContent { CryptoWalletStepScreen(state, drafts, actions, clock) }

        rule.onNodeWithText(text(Res.string.openverify_crypto_restarted)).assertExists()
        state = entry.copy(retryHints = listOf(RetryHint("crypto_wallet_address_comparison", listOf("signature_address_mismatch"))))
        rule.onNodeWithText(text(Res.string.openverify_retry_title_attempt)).assertExists()
        rule.onNodeWithText(text(Res.string.openverify_retry_signature_address_mismatch)).assertExists()
    }

    // The message and the signature ---------------------------------------------------------

    @Test
    fun `the message is shown as the server built it, copied with one press, and its expiry counted in minutes`() {
        show(entry.copy(challenge = challenge))

        rule.onNodeWithText(text(Res.string.openverify_crypto_message_title)).assertExists()
        rule.onNodeWithTag(TestTags.CRYPTO_MESSAGE).assertTextContains(message)
        rule.onNodeWithText(plural(Res.plurals.openverify_crypto_expires_in, 10)).assertExists()
        rule.onNodeWithText(text(Res.string.openverify_crypto_copy)).performScrollTo().performClick()

        val clipboard = ApplicationProvider.getApplicationContext<Context>().getSystemService(ClipboardManager::class.java)
        assertEquals(message, clipboard.primaryClip?.getItemAt(0)?.text?.toString())
        rule.onNodeWithText(text(Res.string.openverify_crypto_copied)).assertExists()
    }

    @Test
    fun `the pasted signature is submitted, without a signed message off Solana`() {
        show(entry.copy(challenge = challenge))

        rule.onNodeWithTag(TestTags.CRYPTO_SIGNED_MESSAGE).assertDoesNotExist()
        rule.onNodeWithText(text(Res.string.openverify_crypto_submit)).assertIsNotEnabled()
        rule.onNodeWithTag(TestTags.CRYPTO_SIGNATURE).performScrollTo().performTextInput("0xsignature")
        rule.onNodeWithText(text(Res.string.openverify_crypto_submit)).performScrollTo().performClick()

        assertEquals(listOf<Any?>("0xsignature" to null), actions.sent)
    }

    @Test
    fun `on Solana the wallet's signed message can be pasted too`() {
        show(entry.copy(challenge = challenge.copy(chainId = SOLANA)))

        rule.onNodeWithTag(TestTags.CRYPTO_SIGNATURE).performScrollTo().performTextInput("c2lnbmF0dXJl")
        rule.onNodeWithTag(TestTags.CRYPTO_SIGNED_MESSAGE).performScrollTo().performTextInput("wrapped")
        rule.onNodeWithText(text(Res.string.openverify_crypto_submit)).performScrollTo().performClick()

        assertEquals(listOf<Any?>("c2lnbmF0dXJl" to "wrapped"), actions.sent)
    }

    @Test
    fun `another wallet can be used instead, and while the signature is on its way nothing can be sent`() {
        var state by mutableStateOf(entry.copy(challenge = challenge))
        rule.setContent { CryptoWalletStepScreen(state, drafts, actions, clock) }

        rule.onNodeWithText(text(Res.string.openverify_crypto_change)).performScrollTo().performClick()
        drafts["wallet:${challenge.id}:signature"] = "0xsignature"
        state = entry.copy(challenge = challenge, busy = true)

        rule.onNodeWithText(text(Res.string.openverify_crypto_submitting)).assertExists()
        rule.onNodeWithText(text(Res.string.openverify_crypto_submit)).assertIsNotEnabled()
        assertEquals(listOf("changeCryptoWallet"), actions.calls)
    }

    @Test
    fun `an expired message offers a new one for the same address, and a message still good does not (audit gap K9)`() {
        drafts["wallet:address"] = ADDRESS
        var state by mutableStateOf(entry.copy(challenge = challenge))
        rule.setContent { CryptoWalletStepScreen(state, drafts, actions, clock) }
        rule.onNodeWithText(text(Res.string.openverify_crypto_new_message)).assertDoesNotExist()

        state = entry.copy(challenge = challenge.copy(expiresAt = now))
        rule.waitForIdle()
        rule.onNodeWithText(text(Res.string.openverify_crypto_error_challenge_invalid)).assertExists()
        rule.onNodeWithText(text(Res.string.openverify_crypto_new_message)).performScrollTo().assertIsEnabled().performClick()

        assertEquals(listOf("renewCryptoChallenge"), actions.calls)
        assertEquals(listOf<Any?>(ADDRESS), actions.sent)
    }

    // Workflow 5C review P022: a paste belongs to the message it was made for -----------------

    @Test
    fun `a new message starts with an empty signature, never the one pasted for the old message`() {
        val other = CryptoChallenge("cwc_01M5CK16P0D13FXHZSS4TCFB02", SOLANA, "another message", now + 10.minutes)
        var state by mutableStateOf(entry.copy(challenge = challenge.copy(chainId = SOLANA)))
        rule.setContent { CryptoWalletStepScreen(state, drafts, actions, clock) }
        rule.onNodeWithTag(TestTags.CRYPTO_SIGNATURE).performScrollTo().performTextInput("c2lnbmF0dXJl")
        rule.onNodeWithTag(TestTags.CRYPTO_SIGNED_MESSAGE).performScrollTo().performTextInput("wrapped")

        state = entry // "use another wallet", then a new message for it
        rule.waitForIdle()
        state = entry.copy(challenge = other)
        rule.waitForIdle()

        rule.onNodeWithText(text(Res.string.openverify_crypto_submit)).assertIsNotEnabled()
        rule.onNodeWithTag(TestTags.CRYPTO_SIGNATURE).performScrollTo().performTextInput("bmV3")
        rule.onNodeWithTag(TestTags.CRYPTO_SIGNED_MESSAGE).performScrollTo().performTextInput("again")
        rule.onNodeWithText(text(Res.string.openverify_crypto_submit)).performScrollTo().performClick()
        assertEquals(listOf<Any?>("bmV3" to "again"), actions.sent)
    }

    @Test
    fun `the same message shown again keeps what was pasted for it`() {
        var state by mutableStateOf(entry.copy(challenge = challenge))
        rule.setContent { CryptoWalletStepScreen(state, drafts, actions, clock) }
        rule.onNodeWithTag(TestTags.CRYPTO_SIGNATURE).performScrollTo().performTextInput("0xsignature")

        state = entry.copy(challenge = challenge, busy = true) // on its way, then back after a retry
        rule.waitForIdle()
        state = entry.copy(challenge = challenge)
        rule.waitForIdle()

        rule.onNodeWithText(text(Res.string.openverify_crypto_submit)).performScrollTo().performClick()
        assertEquals(listOf<Any?>("0xsignature" to null), actions.sent)
    }

    // Workflow 5C review P028: a paste over its limit is said where it was pasted ------------

    @Test
    fun `a signature or signed message over its limit is said on the message screen`() {
        val onSolana = entry.copy(challenge = challenge.copy(chainId = SOLANA))
        var state by mutableStateOf(onSolana.copy(error = CryptoError.SIGNATURE_TOO_LONG))
        rule.setContent { CryptoWalletStepScreen(state, drafts, actions, clock) }

        rule.onNodeWithText(text(Res.string.openverify_crypto_error_signature_too_long)).performScrollTo().assertExists()
        state = onSolana.copy(error = CryptoError.SIGNED_MESSAGE_TOO_LONG)
        rule.onNodeWithText(text(Res.string.openverify_crypto_error_signed_message_too_long)).performScrollTo().assertExists()
        state = onSolana
        rule.onNodeWithText(text(Res.string.openverify_crypto_error_signed_message_too_long)).assertDoesNotExist()
    }

    private companion object {
        const val EVM = "eip155:1"
        const val BASE = "eip155:8453"
        const val SOLANA = "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp"

        /** Synthetic addresses, not real wallets'. */
        const val ADDRESS = "0x000000000000000000000000000000000000dEaD"
        const val SOLANA_ADDRESS = "11111111111111111111111111111111"
    }
}
