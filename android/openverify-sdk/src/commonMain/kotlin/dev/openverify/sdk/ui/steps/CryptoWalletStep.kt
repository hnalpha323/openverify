package dev.openverify.sdk.ui.steps

import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.input.KeyboardType
import dev.openverify.sdk.flow.CryptoChallenge
import dev.openverify.sdk.flow.CryptoError
import dev.openverify.sdk.flow.FlowState
import dev.openverify.sdk.generated.resources.*
import dev.openverify.sdk.i18n.sdkPluralText
import dev.openverify.sdk.i18n.sdkString
import dev.openverify.sdk.i18n.sdkText
import dev.openverify.sdk.model.CryptoChains
import dev.openverify.sdk.ui.FlowActions
import dev.openverify.sdk.ui.InputDrafts
import dev.openverify.sdk.ui.TestTags
import dev.openverify.sdk.ui.screen.submitProtection
import dev.openverify.sdk.ui.screen.typedValueProtection
import dev.openverify.sdk.ui.rememberTextCopier
import dev.openverify.sdk.ui.text.Text
import kotlin.time.Clock
import org.jetbrains.compose.resources.StringResource

/**
 * C57, C64.1, C64.2: the crypto wallet step by its paste path. The SDK has no wallet of its own:
 * the user picks the network and enters the address, the server builds the message to sign, and
 * the user signs it in their own wallet app and pastes the signature (and, on Solana, the message
 * the wallet signed when it shows one). The message is shown as the server built it, selectable,
 * with a copy button where the platform has a clipboard.
 */
@Composable
internal fun CryptoWalletStepScreen(
    state: FlowState.CryptoWallet,
    drafts: InputDrafts,
    actions: FlowActions,
    clock: Clock,
    modifier: Modifier = Modifier,
) {
    val challenge = state.challenge
    if (challenge == null) {
        WalletEntry(state, drafts, actions, modifier)
    } else {
        MessageToSign(state, challenge, drafts, actions, clock, modifier)
    }
}

@Composable
private fun WalletEntry(state: FlowState.CryptoWallet, drafts: InputDrafts, actions: FlowActions, modifier: Modifier) {
    val chainKey = "${state.step.id}:chain"
    val addressKey = "${state.step.id}:address"
    val chain = drafts[chainKey].takeIf { it in state.chains } ?: state.chains.firstOrNull()
    val address = drafts[addressKey]

    StepLayout(title = sdkString(Res.string.openverify_crypto_title), modifier = modifier) {
        Paragraph(sdkString(Res.string.openverify_crypto_intro))
        if (state.restarted) ErrorMessage(sdkString(Res.string.openverify_crypto_restarted))
        AttemptHints(state.retryHints)
        Selector(
            label = sdkString(Res.string.openverify_crypto_chain),
            selected = chain,
            options = state.chains.map { it to chainName(it) },
            onSelect = { drafts[chainKey] = it },
            enabled = !state.busy,
            tag = TestTags.CRYPTO_CHAIN,
        )
        OutlinedTextField(
            value = address,
            onValueChange = { drafts[addressKey] = it },
            label = { Text(sdkString(Res.string.openverify_crypto_address)) },
            singleLine = true,
            enabled = !state.busy,
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Ascii, autoCorrectEnabled = false),
            modifier = Modifier.fillMaxWidth().testTag(TestTags.CRYPTO_ADDRESS).typedValueProtection(),
        )
        state.error?.let { ErrorMessage(sdkString(cryptoErrorWords(it))) }
        if (state.busy) BusyRow(sdkString(Res.string.openverify_crypto_getting_message))
        Button(
            onClick = { if (chain != null) actions.createCryptoChallenge(chain, address) },
            enabled = !state.busy && chain != null && address.isNotBlank(),
            modifier = Modifier.fillMaxWidth().submitProtection(),
        ) {
            Text(sdkString(Res.string.openverify_crypto_get_message))
        }
        TextButton(onClick = actions::cancel, modifier = Modifier.fillMaxWidth()) {
            Text(sdkString(Res.string.openverify_cancel))
        }
    }
}

@Composable
private fun MessageToSign(
    state: FlowState.CryptoWallet,
    challenge: CryptoChallenge,
    drafts: InputDrafts,
    actions: FlowActions,
    clock: Clock,
    modifier: Modifier,
) {
    // A paste belongs to the message it was made for: a new message starts empty (Workflow 5C
    // review P022), while the same message shown again, after a retry or a rotation, keeps it.
    val signatureKey = "${state.step.id}:${challenge.id}:signature"
    val signedMessageKey = "${state.step.id}:${challenge.id}:signed-message"
    val signature = drafts[signatureKey]
    // The address typed for this message, which the entry drafted (WalletEntry's key).
    val addressKey = "${state.step.id}:address"
    val wraps = CryptoChains.wrapsSignedMessage(challenge.chainId)
    val now = rememberNow(clock, challenge.expiresAt)
    val copy = rememberTextCopier()
    var copied by remember(challenge.id) { mutableStateOf(false) }

    StepLayout(title = sdkString(Res.string.openverify_crypto_message_title), modifier = modifier) {
        Paragraph(sdkString(Res.string.openverify_crypto_message_instructions))
        SelectionContainer {
            Text(
                text = challenge.message,
                fontFamily = FontFamily.Monospace,
                style = MaterialTheme.typography.bodyMedium,
                modifier = Modifier.testTag(TestTags.CRYPTO_MESSAGE),
            )
        }
        if (copy != null) {
            OutlinedButton(
                onClick = {
                    copy(challenge.message)
                    copied = true
                },
                modifier = Modifier.fillMaxWidth(),
            ) {
                Text(sdkString(Res.string.openverify_crypto_copy))
            }
        }
        if (copied) {
            Text(
                text = sdkString(Res.string.openverify_crypto_copied),
                modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite },
            )
        }
        challenge.expiresAt?.let { expiresAt ->
            val minutes = minutesUntil(now, expiresAt).toInt()
            if (minutes > 0) {
                Text(sdkPluralText(Res.plurals.openverify_crypto_expires_in, minutes, minutes))
            } else {
                ErrorMessage(sdkString(Res.string.openverify_crypto_error_challenge_invalid))
                // Audit gap K9: the words say "get a new message", so a control does exactly that,
                // for the chain of this message and the address typed for it.
                OutlinedButton(
                    onClick = { actions.renewCryptoChallenge(drafts[addressKey]) },
                    enabled = !state.busy,
                    modifier = Modifier.fillMaxWidth().submitProtection(),
                ) {
                    Text(sdkString(Res.string.openverify_crypto_new_message))
                }
            }
        }
        OutlinedTextField(
            value = signature,
            onValueChange = { drafts[signatureKey] = it },
            label = { Text(sdkString(Res.string.openverify_crypto_signature)) },
            minLines = 2,
            enabled = !state.busy,
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Ascii, autoCorrectEnabled = false),
            modifier = Modifier.fillMaxWidth().testTag(TestTags.CRYPTO_SIGNATURE).typedValueProtection(),
        )
        if (wraps) {
            OutlinedTextField(
                value = drafts[signedMessageKey],
                onValueChange = { drafts[signedMessageKey] = it },
                label = { Text(sdkString(Res.string.openverify_crypto_signed_message)) },
                supportingText = { Text(sdkString(Res.string.openverify_crypto_signed_message_hint)) },
                minLines = 2,
                enabled = !state.busy,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Ascii, autoCorrectEnabled = false),
                modifier = Modifier.fillMaxWidth().testTag(TestTags.CRYPTO_SIGNED_MESSAGE).typedValueProtection(),
            )
        }
        // A paste over its limit, refused on the device (Workflow 5C review P028).
        state.error?.let { ErrorMessage(sdkString(cryptoErrorWords(it))) }
        if (state.busy) BusyRow(sdkString(Res.string.openverify_crypto_submitting))
        Button(
            onClick = { actions.submitCryptoSignature(signature, drafts[signedMessageKey].takeIf { wraps }) },
            enabled = !state.busy && signature.isNotBlank(),
            modifier = Modifier.fillMaxWidth().submitProtection(),
        ) {
            Text(sdkString(Res.string.openverify_crypto_submit))
        }
        TextButton(onClick = actions::changeCryptoWallet, enabled = !state.busy, modifier = Modifier.fillMaxWidth()) {
            Text(sdkString(Res.string.openverify_crypto_change))
        }
    }
}

/** A chain by its proper name, an EVM chain other than Ethereum by its number, else its id. */
@Composable
private fun chainName(chainId: String): String =
    CryptoChains.name(chainId)
        ?: CryptoChains.evmChainNumber(chainId)?.let { sdkText(Res.string.openverify_crypto_evm_chain, it).text }
        ?: chainId

private fun cryptoErrorWords(error: CryptoError): StringResource = when (error) {
    CryptoError.CHAIN_NOT_OFFERED -> Res.string.openverify_crypto_error_chain_not_offered
    CryptoError.ADDRESS_INVALID -> Res.string.openverify_crypto_error_address_invalid
    CryptoError.EXPECTED_ADDRESS_MISMATCH -> Res.string.openverify_crypto_error_expected_address
    CryptoError.CHALLENGE_INVALID -> Res.string.openverify_crypto_error_challenge_invalid
    CryptoError.SIGNATURE_TOO_LONG -> Res.string.openverify_crypto_error_signature_too_long
    CryptoError.SIGNED_MESSAGE_TOO_LONG -> Res.string.openverify_crypto_error_signed_message_too_long
}
