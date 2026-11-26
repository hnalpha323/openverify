package dev.openverify.sdk.flow

import dev.openverify.sdk.api.FlowApi
import dev.openverify.sdk.model.CaptureMethod
import dev.openverify.sdk.model.CaptureTrigger
import dev.openverify.sdk.camera.captureMethodOf
import dev.openverify.sdk.camera.captureTriggerOf
import dev.openverify.sdk.capture.screenAutoCapture
import dev.openverify.sdk.consent.consentEvidence
import dev.openverify.sdk.flow.FakeFlowApi.Companion.DEFAULT_FLOW
import dev.openverify.sdk.flow.FakeFlowApi.Companion.INQUIRY_ID
import dev.openverify.sdk.flow.FakeFlowApi.Companion.NOW
import dev.openverify.sdk.flow.FakeFlowApi.Companion.verification
import dev.openverify.sdk.integrity.IntegrityTokenProvider
import dev.openverify.sdk.model.ConsentStep
import dev.openverify.sdk.model.FlowConsent
import dev.openverify.sdk.model.FlowIntegrityChallenge
import dev.openverify.sdk.model.FlowSession
import dev.openverify.sdk.model.FlowSessionIntegrity
import dev.openverify.sdk.model.VerificationStatus
import dev.openverify.sdk.model.VerificationType
import dev.openverify.sdk.signals.integrityVerdictRequest
import dev.openverify.sdk.ui.theme.SessionTheme
import dev.openverify.sdk.ui.theme.ThemeFixtures
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

/**
 * The three state hooks of `FlowCoordinator` (Workflow 10A Stage 1b; review F04) and their stubs'
 * contracts. Each case names the owner who replaces it when filling the stub:
 * - `ServerPosition` (C193.3, `android-driver`): a session with spec 2 and a position is rendered from it;
 * - `consentEvidence` (C200, `android-sdk-api`): the digests of the texts the consent screen shows,
 *   their copy source and the SDK's catalog version, which the coordinator hands to the API;
 * - `SessionTheme` (C198.1, `android-theme`): the session's theme within its contract, else the built-in
 *   theme (null), published as `FlowCoordinator.theme`.
 *
 * And Workflow 10B's hooks (Stage 1b, foundation-10b; review F05), each a stub its owner replaces with
 * its own case:
 * - `captureTriggerOf`, `captureMethodOf` (C206, `camera/CaptureTrigger.kt`) and `screenAutoCapture`
 *   (C202.4, C204.3, `capture/AutoCapture.kt`), `capture-pipeline`'s, replaced by its owner: `auto` or
 *   `manual`, `camera` or `upload` as the photo was really taken, and an auto-capture that takes the still;
 * - `extendCapture` (C204.5, `capture/selfie/Extension.kt`, `selfie-guidance`), replaced by its owner:
 *   it asks the server once, and the coordinator moves the capture's expiry by its lifetime;
 * - `integrityVerdictRequest` (C211.3, `signals/Integrity.kt`, `device-integrity-android`), replaced by its
 *   owner (KP10-29): a consented session that asks for a verdict takes one challenge and sends the host
 *   provider's token for its hash; one that does not ask takes none.
 */
@OptIn(ExperimentalCoroutinesApi::class)
internal class StateHooksTest {

    @Test
    fun `android-driver - a session the server positions is driven by its position, and one without spec 2 and a position names the older server`() = runTest {
        val positioned = FakeFlowServer().getSession()
        val older = FakeFlowApi().getSession()

        assertTrue(ServerPosition.drives(positioned))
        assertEquals(PositionRendering.Run(positioned.step!!), ServerPosition.render(positioned))
        assertFalse(ServerPosition.drives(older))
        assertEquals(PositionRendering.Shown(FlowState.Unsupported(ServerPosition.SERVER_BEFORE_SPEC_2)), ServerPosition.render(older))
    }

    @Test
    fun `android-driver - the coordinator renders the step the server's position names`() = runTest {
        val server = FakeFlowServer(routes = mapOf("consent" to "selfie"), consent = dev.openverify.sdk.model.FlowConsent(FakeFlowApi.NOW))
        val coordinator = FlowCoordinator(server, INQUIRY_ID)

        coordinator.start()

        assertEquals(FlowState.AwaitingCamera(server.flow.steps.single { it.id == "selfie" }), coordinator.state.value)
    }

    @Test
    fun `android-sdk-api - the consent hook reports the digests of the texts shown, and the coordinator hands them to the API`() = runTest {
        val api = FakeFlowServer()
        val coordinator = FlowCoordinator(api, INQUIRY_ID)

        coordinator.start()
        coordinator.acceptConsent()

        val session = api.getSession()
        val step = session.flow.steps.filterIsInstance<ConsentStep>().first()
        val evidence = consentEvidence(step, emptyList(), "en", session)
        assertEquals(step.textKeys.size, evidence.textSha256?.size)
        assertEquals("built-in", evidence.copySource)
        assertEquals(evidence, api.consentEvidence)
    }

    @Test
    fun `android-theme - the coordinator publishes the session theme the SDK applies, and the built-in theme without one`() = runTest {
        val plain = FakeFlowApi()
        val themed = object : FakeFlowApi() {
            override fun sessionAnswer(): FlowSession = super.sessionAnswer().copy(theme = ThemeFixtures.theme())
        }
        val builtIn = FlowCoordinator(plain, INQUIRY_ID).also { it.start() }
        val operator = FlowCoordinator(themed, INQUIRY_ID).also { it.start() }

        assertNull(SessionTheme.of(plain.getSession()))
        assertNull(builtIn.theme.value)
        assertEquals(ThemeFixtures.theme(), operator.theme.value)
    }

    @Test
    fun `capture-pipeline - the trigger and method are decided, and the auto-capture takes the still as auto`() = runTest {
        val idStep = DEFAULT_FLOW.steps[1]
        val triggers = mutableListOf<CaptureTrigger?>()

        val taken = screenAutoCapture { trigger -> triggers += trigger; true }.takeStill()

        assertEquals(CaptureTrigger.AUTO, captureTriggerOf(auto = true))
        assertEquals(CaptureTrigger.MANUAL, captureTriggerOf(auto = false))
        assertEquals(CaptureMethod.CAMERA, captureMethodOf(idStep, picked = false))
        assertEquals(CaptureMethod.UPLOAD, captureMethodOf(idStep, picked = true))
        assertTrue(taken)
        assertEquals(listOf<CaptureTrigger?>(CaptureTrigger.AUTO), triggers)
    }

    @Test
    fun `selfie-guidance - extendCapture asks the server once and the coordinator moves the open capture's expiry by its lifetime`() = runTest {
        val passedId = verification("ver_01M5CJZC301G4JHXZQ3PZBYH3P", VerificationType.GOVERNMENT_ID, VerificationStatus.PASSED)
        val api = FakeFlowServer(consent = FlowConsent(NOW), verifications = listOf(passedId))
        val coordinator = FlowCoordinator(api, INQUIRY_ID).also { it.cameraReady() }
        coordinator.start()
        val window = checkNotNull(coordinator.selfieCapture.value)

        coordinator.extendSelfieCapture()

        assertEquals(window.expiresAt + SelfieCaptureProtocol.CAPTURE_TTL, coordinator.selfieCapture.value?.expiresAt)
        assertEquals(1, api.calls.count { it == "extendSelfieCapture" })
    }

    /** [server]'s answers; a consented session says whether it [asks] for an integrity verdict (C211.3). */
    private class VerdictServer(val server: FakeFlowServer, private val asks: Boolean) : FlowApi by server {
        override suspend fun getSession(): FlowSession =
            server.getSession().let { session -> if (session.consent != null) session.copy(integrity = FlowSessionIntegrity(asks)) else session }
    }

    private class RecordingProvider : IntegrityTokenProvider {
        val hashes = mutableListOf<String>()

        override suspend fun token(requestHash: String): String = "synthetic-integrity-token".also { hashes += requestHash }
    }

    @Test
    fun `device-integrity-android - a consented session that asks for a verdict takes one challenge and sends the provider's token for its hash`() = runTest {
        val api = VerdictServer(FakeFlowServer(), asks = true)
        val provider = RecordingProvider()
        val coordinator = FlowCoordinator(api, INQUIRY_ID, integrity = integrityVerdictRequest(api, provider))

        coordinator.start()
        advanceUntilIdle()
        assertEquals(emptyList<FlowIntegrityChallenge>(), api.server.integrityChallenges, "nothing before consent")
        coordinator.acceptConsent()
        advanceUntilIdle()

        val challenge = api.server.integrityChallenges.single()
        assertEquals(listOf(challenge.requestHash), provider.hashes)
        assertEquals(listOf(challenge.id to "synthetic-integrity-token"), api.server.integrityTokens)
    }

    @Test
    fun `device-integrity-android - a consented session that does not ask takes no challenge and sends no token`() = runTest {
        val api = VerdictServer(FakeFlowServer(), asks = false)
        val provider = RecordingProvider()
        val coordinator = FlowCoordinator(api, INQUIRY_ID, integrity = integrityVerdictRequest(api, provider))

        coordinator.start()
        coordinator.acceptConsent()
        advanceUntilIdle()

        assertEquals(emptyList<FlowIntegrityChallenge>(), api.server.integrityChallenges)
        assertEquals(emptyList<Pair<String, String>>(), api.server.integrityTokens)
        assertEquals(emptyList<String>(), provider.hashes)
    }
}
