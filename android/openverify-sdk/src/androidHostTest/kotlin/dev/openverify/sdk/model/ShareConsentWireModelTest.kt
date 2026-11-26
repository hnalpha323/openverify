package dev.openverify.sdk.model

import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonObject
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test

/**
 * C238.3, C237.6 (Phase 11, Workflow 11A; `clients-connect`): the `share_consent` client view and the
 * session's `withdrawable-share-consents` decode from the goldens `contracts-11a` froze
 * (`flow-spec/share-consent-client-view.json`, `api/flow-session-share-consent.json`), and a view
 * this SDK cannot use (another side, no text) is the unsupported step, never a partial one.
 */
internal class ShareConsentWireModelTest {

    private val view = Fixtures.read("flow-spec/share-consent-client-view.json")

    @Test
    fun `the client view decodes as the share_consent step with every member`() {
        val step = OpenVerifyJson.decodeFromString(FlowStep.serializer(), view)

        assertEquals(
            ShareConsentStep(
                id = "share-consent-1",
                side = ShareConsentSide.SOURCE,
                recipientName = "Example Partner",
                sourceName = "Example Source",
                categories = listOf("identity-fields", "document-images", "biometric", "check-results"),
                text = ShareConsentText(
                    locale = "en",
                    body = "Synthetic composed text: Example Source shares your verified identity with Example Partner.",
                    sha256 = "a".repeat(64),
                    keys = listOf("share.consent.source"),
                ),
                biometric = ShareConsentBiometric("Synthetic biometric text for Example Partner.", "b".repeat(64)),
            ),
            step,
        )
        assertEquals("share_consent", step.type)
    }

    @Test
    fun `the session decodes the share_consent step and its withdrawable share consents`() {
        val session = OpenVerifyJson.decodeFromString(FlowSession.serializer(), Fixtures.read("api/flow-session-share-consent.json"))

        assertEquals("share-consent-1", (session.step as ShareConsentStep).id)
        assertEquals(
            listOf(FlowWithdrawableShareConsent("share-consent-0", ShareConsentSide.SOURCE, "Example Partner")),
            session.withdrawableShareConsents,
        )
    }

    @Test
    fun `a view with another side or without its text is the unsupported step`() {
        val golden = OpenVerifyJson.parseToJsonElement(view).jsonObject
        val otherSide = JsonObject(golden + ("side" to JsonPrimitive("both")))
        val noText = JsonObject(golden - "text")

        for (body in listOf(otherSide, noText)) {
            assertEquals(UnsupportedStep("share-consent-1", "share_consent"), OpenVerifyJson.decodeFromJsonElement(FlowStep.serializer(), body))
        }
    }
}
