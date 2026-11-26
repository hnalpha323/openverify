package dev.openverify.sdk.flow

import dev.openverify.sdk.api.FlowApiException
import dev.openverify.sdk.flow.FakeFlowApi.Companion.CHALLENGE_EXPIRES_AT
import dev.openverify.sdk.flow.FakeFlowApi.Companion.INQUIRY_ID
import dev.openverify.sdk.flow.FakeFlowApi.Companion.NOW
import dev.openverify.sdk.flow.FakeFlowApi.Companion.verification
import dev.openverify.sdk.model.CompletionStep
import dev.openverify.sdk.model.ContractFixturesTest
import dev.openverify.sdk.model.CryptoSigningMethod
import dev.openverify.sdk.model.CryptoWalletStep
import dev.openverify.sdk.model.FailureStep
import dev.openverify.sdk.model.Flow
import dev.openverify.sdk.model.FlowConsent
import dev.openverify.sdk.model.FlowCryptoSubmit
import dev.openverify.sdk.model.FlowMetadata
import dev.openverify.sdk.model.FlowStep
import dev.openverify.sdk.model.FlowTransition
import dev.openverify.sdk.model.FlowVerification
import dev.openverify.sdk.model.InquiryStatus
import dev.openverify.sdk.model.Problem
import dev.openverify.sdk.model.RetryHint
import dev.openverify.sdk.model.VerificationStatus
import dev.openverify.sdk.model.VerificationType
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.runTest
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.junit.jupiter.params.ParameterizedTest
import org.junit.jupiter.params.provider.CsvSource
import kotlin.time.Duration.Companion.seconds
import kotlin.time.Instant

/**
 * C57, C64.2: the crypto wallet step in the flow engine, by the paste path (the SDK has no wallet of
 * its own): the chain and address, the server's message to sign, then the pasted signature. Every
 * refusal leads somewhere: a message that can no longer be used gets a new one, and the eleventh
 * message, which cancels the attempt, starts the step again (C57.2, H07).
 */
@OptIn(ExperimentalCoroutinesApi::class)
internal class FlowCoordinatorCryptoTest {

    private val walletStep = CryptoWalletStep("wallet", listOf(EVM, SOLANA, BITCOIN), listOf(CryptoSigningMethod.WALLET, CryptoSigningMethod.PASTE))
    private val completion = CompletionStep("completion", "flow.completion")
    private val failure = FailureStep("failure", "flow.failure")
    private val settings = FlowCoordinator.Settings(pollInterval = 1.seconds, pollAttempts = 3)
    private val entry = FlowState.CryptoWallet(walletStep, listOf(EVM, SOLANA, BITCOIN))
    private val mismatch = RetryHint("crypto_wallet_address_comparison", listOf("signature_address_mismatch"))

    private fun flowOf(vararg steps: FlowStep): Flow = Flow(
        FlowMetadata(specVersion = 1, id = "wallet", version = 1, name = "Wallet"),
        steps.toList() + completion + failure,
        steps.map { FlowTransition(it.id, failure.id, ContractFixturesTest.FAILED_CONDITION) },
    )

    private fun api(step: FlowStep = walletStep, verifications: List<FlowVerification> = emptyList()) = FakeFlowServer(
        flow = flowOf(step),
        inquiryStatus = InquiryStatus.PENDING,
        consent = FlowConsent(NOW),
        verifications = verifications,
    )

    private fun coordinator(api: FakeFlowApi) = FlowCoordinator(api, INQUIRY_ID, settings)

    private fun TestScope.recordStates(coordinator: FlowCoordinator): List<FlowState> {
        val states = mutableListOf<FlowState>()
        backgroundScope.launch(UnconfinedTestDispatcher(testScheduler)) { coordinator.state.collect { states += it } }
        return states
    }

    /** The message the fake server builds for [address], as its `n`th challenge. */
    private fun challenge(n: Int, chain: String = EVM, address: String = ADDRESS) = CryptoChallenge(
        String.format("cwc_01M5CK16P0D13FXHZSS4TCFB%02d", n),
        chain,
        "openverify.test wants you to sign in with your account:\n$address\n\nNonce: ${"n".repeat(16)}",
        Instant.parse(CHALLENGE_EXPIRES_AT),
    )

    // The chain and address (C57.1, C57.2) ---------------------------------------------------

    @Test
    fun `a wallet step opens on the chain and address entry with the chains it offers, creating nothing yet`() = runTest {
        val api = api()
        val coordinator = coordinator(api)

        coordinator.start()

        assertEquals(entry, coordinator.state.value)
        assertEquals(listOf("getSession"), api.calls)
    }

    @Test
    fun `a chain this SDK does not know is left out, and a step with none it knows is unsupported`() = runTest {
        val some = walletStep.copy(chains = listOf("cosmos:cosmoshub-4", EVM))
        val none = walletStep.copy(chains = listOf("cosmos:cosmoshub-4"))
        val withSome = coordinator(api(some))
        val withNone = coordinator(api(none))

        withSome.start()
        withNone.start()

        assertEquals(FlowState.CryptoWallet(some, listOf(EVM)), withSome.state.value)
        assertEquals(FlowState.Unsupported("crypto_wallet without a chain this SDK knows"), withNone.state.value)
    }

    @Test
    fun `a step that signs only with an injected wallet is unsupported, as this SDK signs by pasting (C64_2)`() = runTest {
        val api = api(walletStep.copy(signing = listOf(CryptoSigningMethod.WALLET)))
        val coordinator = coordinator(api)

        coordinator.start()

        assertEquals(FlowState.Unsupported("crypto_wallet without paste signing"), coordinator.state.value)
    }

    @Test
    fun `asking for the message creates the verification, sends the chain and the trimmed address, and shows the message`() = runTest {
        val api = api()
        val coordinator = coordinator(api)
        val states = recordStates(coordinator)
        coordinator.start()

        coordinator.createCryptoChallenge(EVM, "  $ADDRESS ")

        assertEquals(entry.copy(challenge = challenge(1)), coordinator.state.value)
        assertTrue(entry.copy(busy = true) in states, states.toString())
        assertEquals(listOf("getSession", "createVerification:crypto-wallet", "createCryptoChallenge"), api.calls)
        assertEquals(listOf(Triple(api.verifications.single().id, EVM, ADDRESS)), api.challengeRequests)
    }

    @Test
    fun `a chain the step does not offer, or a blank address, is never sent`() = runTest {
        val api = api()
        val coordinator = coordinator(api)
        coordinator.start()

        coordinator.createCryptoChallenge("eip155:8453", ADDRESS)
        coordinator.createCryptoChallenge(EVM, "   ")

        assertEquals(entry, coordinator.state.value)
        assertEquals(listOf("getSession"), api.calls)
    }

    @Test
    fun `an address over the 128 characters C57_1 allows is never sent, and the entry says it is not an address (Workflow 5C review P028)`() = runTest {
        val api = api()
        val coordinator = coordinator(api)
        coordinator.start()

        coordinator.createCryptoChallenge(EVM, "a".repeat(129))

        assertEquals(entry.copy(error = CryptoError.ADDRESS_INVALID), coordinator.state.value)
        assertEquals(listOf("getSession"), api.calls)
    }

    @ParameterizedTest(name = "{0}")
    @CsvSource(
        "crypto_chain_not_offered, CHAIN_NOT_OFFERED",
        "crypto_address_invalid, ADDRESS_INVALID",
        "crypto_expected_address_mismatch, EXPECTED_ADDRESS_MISMATCH",
    )
    fun `an address or chain the server refuses stays on the entry, saying why (C57_2)`(code: String, error: CryptoError) = runTest {
        val api = api()
        val coordinator = coordinator(api)
        coordinator.start()
        api.failNext("createCryptoChallenge", FlowApiException.Rejected(422, Problem(status = 422, code = code), null))

        coordinator.createCryptoChallenge(EVM, ADDRESS)

        assertEquals(entry.copy(error = error), coordinator.state.value)
    }

    @Test
    fun `changing the wallet goes back to the entry, and a new message keeps the verification`() = runTest {
        val api = api()
        val coordinator = coordinator(api)
        coordinator.start()
        coordinator.createCryptoChallenge(EVM, ADDRESS)

        coordinator.changeCryptoWallet()
        val changed = coordinator.state.value
        coordinator.createCryptoChallenge(BITCOIN, BITCOIN_ADDRESS)

        assertEquals(entry, changed)
        assertEquals(entry.copy(challenge = challenge(2, BITCOIN, BITCOIN_ADDRESS)), coordinator.state.value)
        assertEquals(1, api.calls.count { it == "createVerification:crypto-wallet" })
    }

    @Test
    fun `a new message is asked for the open message's chain and the same address, on the same verification (audit gap K9)`() = runTest {
        val api = api()
        val coordinator = coordinator(api)
        val states = recordStates(coordinator)
        coordinator.start()
        coordinator.createCryptoChallenge(BITCOIN, BITCOIN_ADDRESS)

        coordinator.renewCryptoChallenge(" $BITCOIN_ADDRESS ")

        assertEquals(entry.copy(challenge = challenge(2, BITCOIN, BITCOIN_ADDRESS)), coordinator.state.value)
        assertEquals(2, api.calls.count { it == "createCryptoChallenge" })
        assertEquals(1, api.calls.count { it == "createVerification:crypto-wallet" })
        // While the new message is on its way the entry says so; the old message is not shown.
        assertTrue(entry.copy(busy = true) in states, states.toString())
    }

    @Test
    fun `a new message without the address this process typed goes back to the entry, and nothing is asked with no message open`() = runTest {
        val api = api()
        val coordinator = coordinator(api)
        coordinator.start()

        coordinator.renewCryptoChallenge(ADDRESS)
        val withoutMessage = coordinator.state.value
        coordinator.createCryptoChallenge(EVM, ADDRESS)
        coordinator.renewCryptoChallenge("  ")

        assertEquals(entry, withoutMessage)
        assertEquals(entry, coordinator.state.value)
        assertEquals(1, api.calls.count { it == "createCryptoChallenge" })
    }

    // The signature (C57.3) -------------------------------------------------------------------

    @Test
    fun `the pasted signature is submitted over the open message, and the step waits for the decision`() = runTest {
        val api = api()
        api.decide(VerificationStatus.PASSED, InquiryStatus.COMPLETED)
        val coordinator = coordinator(api)
        val states = recordStates(coordinator)
        coordinator.start()
        coordinator.createCryptoChallenge(EVM, ADDRESS)

        coordinator.submitCryptoSignature(" 0xsignature\n", signedMessage = null)

        assertEquals(FlowState.Completed(completion, InquiryStatus.COMPLETED), coordinator.state.value)
        assertEquals(listOf(FlowCryptoSubmit(challenge(1).id, "0xsignature")), api.cryptoSubmits)
        assertEquals(listOf("submitCryptoSignature", "getVerification", "getSession"), api.calls.takeLast(3))
        assertTrue(FlowState.Processing(walletStep) in states, states.toString())
    }

    @Test
    fun `a Solana signature carries the message the wallet signed, and another chain's never does`() = runTest {
        val solana = api()
        val evm = api()
        solana.decide(VerificationStatus.PASSED, InquiryStatus.COMPLETED)
        evm.decide(VerificationStatus.PASSED, InquiryStatus.COMPLETED)
        val onSolana = coordinator(solana)
        val onEvm = coordinator(evm)
        onSolana.start()
        onEvm.start()
        onSolana.createCryptoChallenge(SOLANA, SOLANA_ADDRESS)
        onEvm.createCryptoChallenge(EVM, ADDRESS)

        onSolana.submitCryptoSignature("c2lnbmF0dXJl", signedMessage = " wrapped message ")
        onEvm.submitCryptoSignature("0xsignature", signedMessage = "wrapped message")

        assertEquals(listOf(FlowCryptoSubmit(challenge(1, SOLANA, SOLANA_ADDRESS).id, "c2lnbmF0dXJl", "wrapped message")), solana.cryptoSubmits)
        assertEquals(listOf(FlowCryptoSubmit(challenge(1).id, "0xsignature")), evm.cryptoSubmits)
    }

    @Test
    fun `a blank Solana signed message is left out`() = runTest {
        val api = api()
        api.decide(VerificationStatus.PASSED, InquiryStatus.COMPLETED)
        val coordinator = coordinator(api)
        coordinator.start()
        coordinator.createCryptoChallenge(SOLANA, SOLANA_ADDRESS)

        coordinator.submitCryptoSignature("c2lnbmF0dXJl", signedMessage = "  ")

        assertEquals(listOf(FlowCryptoSubmit(challenge(1, SOLANA, SOLANA_ADDRESS).id, "c2lnbmF0dXJl")), api.cryptoSubmits)
    }

    @Test
    fun `a blank signature, or one without a message, is never sent`() = runTest {
        val api = api()
        val coordinator = coordinator(api)
        coordinator.start()

        coordinator.submitCryptoSignature("0xsignature", null)
        coordinator.createCryptoChallenge(EVM, ADDRESS)
        val calls = api.calls.size
        coordinator.submitCryptoSignature("   ", null)

        assertEquals(calls, api.calls.size)
        assertEquals(listOf("getSession", "createVerification:crypto-wallet", "createCryptoChallenge"), api.calls)
        assertEquals(entry.copy(challenge = challenge(1)), coordinator.state.value)
    }

    @Test
    fun `a signature or signed message over its C57_1 limit is never sent, and the message screen says which (Workflow 5C review P028)`() = runTest {
        val api = api()
        val coordinator = coordinator(api)
        coordinator.start()
        coordinator.createCryptoChallenge(SOLANA, SOLANA_ADDRESS)
        val open = entry.copy(challenge = challenge(1, SOLANA, SOLANA_ADDRESS))
        val calls = api.calls.size

        coordinator.submitCryptoSignature("a".repeat(1025), null)
        val signatureRefused = coordinator.state.value
        // 2,049 two-byte characters: 4,098 bytes, over the 4,096 a signed message may have.
        coordinator.submitCryptoSignature("c2lnbmF0dXJl", "é".repeat(2049))

        assertEquals(open.copy(error = CryptoError.SIGNATURE_TOO_LONG), signatureRefused)
        assertEquals(open.copy(error = CryptoError.SIGNED_MESSAGE_TOO_LONG), coordinator.state.value)
        assertEquals(calls, api.calls.size)
        assertEquals(emptyList<FlowCryptoSubmit>(), api.cryptoSubmits)
    }

    @Test
    fun `a message the server no longer takes goes back to the entry for a new one, on the same verification`() = runTest {
        val api = api()
        api.decide(VerificationStatus.PASSED, InquiryStatus.COMPLETED)
        val coordinator = coordinator(api)
        coordinator.start()
        coordinator.createCryptoChallenge(EVM, ADDRESS)
        api.openChallenges.clear()

        coordinator.submitCryptoSignature("0xsignature", null)
        val refused = coordinator.state.value
        coordinator.createCryptoChallenge(EVM, ADDRESS)
        coordinator.submitCryptoSignature("0xsignature", null)

        assertEquals(entry.copy(error = CryptoError.CHALLENGE_INVALID), refused)
        assertEquals(FlowState.Completed(completion, InquiryStatus.COMPLETED), coordinator.state.value)
        assertEquals(1, api.calls.count { it == "createVerification:crypto-wallet" })
    }

    // Starting again (C57.2, C64.1) -----------------------------------------------------------

    @Test
    fun `the message that cancels the attempt starts the step again, saying why, on a new verification`() = runTest {
        val api = api()
        api.challengeLimit = 1
        val coordinator = coordinator(api)
        coordinator.start()
        coordinator.createCryptoChallenge(EVM, ADDRESS)
        coordinator.changeCryptoWallet()

        coordinator.createCryptoChallenge(EVM, ADDRESS)
        val restarted = coordinator.state.value
        coordinator.createCryptoChallenge(EVM, ADDRESS)

        assertEquals(entry.copy(restarted = true), restarted)
        assertEquals(2, api.calls.count { it == "createVerification:crypto-wallet" })
        assertEquals(VerificationStatus.CANCELED, api.verifications.first().attributes.status)
    }

    @Test
    fun `a canceled attempt with attempts left starts again when the step is resumed (C64_1)`() = runTest {
        val api = api(verifications = listOf(verification("ver_01M5CK16P0D13FXHZSS4TCFBVA", VerificationType.CRYPTO_WALLET, VerificationStatus.CANCELED)))
        val coordinator = coordinator(api)

        coordinator.start()

        assertEquals(entry.copy(restarted = true), coordinator.state.value)
    }

    @Test
    fun `a failed attempt with attempts left starts again with its hints`() = runTest {
        val api = api(verifications = listOf(verification("ver_01M5CK16P0D13FXHZSS4TCFBVA", VerificationType.CRYPTO_WALLET, VerificationStatus.FAILED, mismatch)))
        val coordinator = coordinator(api)

        coordinator.start()

        assertEquals(entry.copy(retryHints = listOf(mismatch)), coordinator.state.value)
    }

    @Test
    fun `with every attempt used, the flow ends where the server's position ends it`() = runTest {
        val once = walletStep.copy(maxAttempts = 1)
        val api = api(once, listOf(verification("ver_01M5CK16P0D13FXHZSS4TCFBVA", VerificationType.CRYPTO_WALLET, VerificationStatus.CANCELED)))
        val coordinator = coordinator(api)
        val states = recordStates(coordinator)

        coordinator.start()

        // C193.4 (V02): the engine ends the flow on the used-up step; the SDK waits for no failure.
        assertTrue(states.none { it is FlowState.CryptoWallet }, states.toString())
        assertEquals(FlowState.Failed(null, InquiryStatus.FAILED), coordinator.state.value)
    }

    @Test
    fun `resuming an initiated attempt asks for the wallet again, as its message was returned once, and keeps the verification`() = runTest {
        val api = api(verifications = listOf(verification("ver_01M5CK16P0D13FXHZSS4TCFBVA", VerificationType.CRYPTO_WALLET, VerificationStatus.INITIATED)))
        val coordinator = coordinator(api)

        coordinator.start()
        val resumed = coordinator.state.value
        coordinator.createCryptoChallenge(EVM, ADDRESS)

        assertEquals(entry, resumed)
        assertEquals(listOf("getSession", "createCryptoChallenge"), api.calls)
    }

    // Paths the tests above leave out (pinned after the code) -----------------------------------

    @Test
    fun `a wallet step whose attempt passed is done, whatever signing it offers`() = runTest {
        val walletOnly = walletStep.copy(signing = listOf(CryptoSigningMethod.WALLET))
        val api = api(walletOnly, listOf(verification("ver_01M5CK16P0D13FXHZSS4TCFBVA", VerificationType.CRYPTO_WALLET, VerificationStatus.PASSED)))
        val coordinator = coordinator(api)

        coordinator.start()

        assertEquals(FlowState.Completed(completion, InquiryStatus.PENDING), coordinator.state.value)
    }

    @Test
    fun `an unexpected refusal of a challenge shows the error screen`() = runTest {
        val api = api()
        val coordinator = coordinator(api)
        coordinator.start()
        api.failNext("createCryptoChallenge", FlowApiException.ServerError(500, Problem(status = 500), null))

        coordinator.createCryptoChallenge(EVM, ADDRESS)

        assertEquals(FlowState.Error(FlowError.SERVER, canRetry = true), coordinator.state.value)
    }

    @Test
    fun `a challenge answer the client cannot use is an invalid response`() = runTest {
        val api = api()
        val coordinator = coordinator(api)
        coordinator.start()
        api.failNext("createCryptoChallenge", IllegalArgumentException("Not a wallet challenge ID"))

        coordinator.createCryptoChallenge(EVM, ADDRESS)

        assertEquals(FlowState.Error(FlowError.INVALID_RESPONSE, canRetry = false), coordinator.state.value)
    }

    private companion object {
        const val EVM = "eip155:1"
        const val SOLANA = "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp"
        const val BITCOIN = "bip122:000000000019d6689c085ae165831e93"

        /** Synthetic addresses, not real wallets'. */
        const val ADDRESS = "0x000000000000000000000000000000000000dEaD"
        const val SOLANA_ADDRESS = "11111111111111111111111111111111"
        const val BITCOIN_ADDRESS = "bc1qsyntheticaddress000000000000000000000"
    }
}
