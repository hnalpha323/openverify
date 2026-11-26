package dev.openverify.sdk.flow

import dev.openverify.sdk.flow.FakeFlowApi.Companion.DEFAULT_FLOW
import dev.openverify.sdk.flow.FakeFlowApi.Companion.INQUIRY_ID
import dev.openverify.sdk.model.ConsentStep
import kotlin.time.Duration.Companion.seconds
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.testTimeSource
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

/**
 * Workflow 10B Stage 3 (integration-10b; C211.9, decision 66): a consent step that shows
 * `notice.play-integrity` beside the session-integrity notice, as publish requires while a
 * `deviceIntegrity` provider is bound, is shown by the SDK, never refused as an unknown text.
 */
internal class IntegrationConsentNoticeTest {

    @Test
    fun `a consent showing notice play-integrity is shown`() = runTest {
        val consent = DEFAULT_FLOW.steps.first() as ConsentStep
        val step = consent.copy(textKeys = consent.textKeys + "notice.play-integrity")
        val coordinator = FlowCoordinator(
            FakeFlowServer(steps = listOf(step) + DEFAULT_FLOW.steps.drop(1)),
            INQUIRY_ID,
            FlowCoordinator.Settings(pollInterval = 1.seconds, pollAttempts = 3, timeSource = testTimeSource),
        )

        coordinator.start()

        assertTrue(coordinator.state.value is FlowState.Consent, "${coordinator.state.value}")
    }
}
