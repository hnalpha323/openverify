package dev.openverify.sdk.consent

import dev.openverify.sdk.OPENVERIFY_SDK_VERSION
import dev.openverify.sdk.fixtures.readContractFixture
import dev.openverify.sdk.flow.logic.Sha256
import dev.openverify.sdk.i18n.sdkStringIn
import dev.openverify.sdk.model.ConsentStep
import dev.openverify.sdk.model.FlowCopy
import dev.openverify.sdk.model.FlowSessionInquiry
import dev.openverify.sdk.model.FlowLocales
import dev.openverify.sdk.model.FlowSession
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertIs
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * C200.1, C200.2 (decision 14; reviews H07, F06): what the consent screen shows and what the consent
 * body reports it showed. A text is the operator's when the session's copy holds it in the chosen
 * language, else the SDK's own; `{{days}}` (built in) or `{days}` (operator) from the session's
 * `face-template-retention-days`, written in ASCII, and `{organization}` from its
 * `organization-display-name`. The digest is SHA-256 over the logical text (UTF-8, NFC, no isolate);
 * only the displayed text isolates each filled value (C199.5).
 */
internal class ConsentTextTest {

    private val values = ConsentValues(retentionDays = 365, organization = null)

    private fun builtIn(language: String, resource: String): String = checkNotNull(sdkStringIn(language, resource, emptyList()))

    private fun shown(text: ConsentText): ConsentText.Shown = assertIs<ConsentText.Shown>(text)

    @Test
    fun aBuiltInTextIsTheSdksOwnInTheChosenLanguage() {
        listOf("en", "es", "fr", "de", "ar").forEach { language ->
            val text = shown(consentText("consent.processing", language, null, "en", values))

            assertEquals(builtIn(language, "openverify_consent_processing"), text.logical)
            assertFalse(text.custom)
        }
    }

    @Test
    fun theDaysAreFilledInAsciiAndIsolatedOnlyWhenDisplayed() {
        val text = shown(consentText("consent.biometric-matching", "ar", null, "en", values))

        assertEquals(builtIn("ar", "openverify_consent_biometric_matching").replace("{{days}}", "365"), text.logical)
        assertEquals(builtIn("ar", "openverify_consent_biometric_matching").replace("{{days}}", "⁨365⁩"), text.display)
        assertFalse('⁨' in text.logical || '⁩' in text.logical)
    }

    @Test
    fun aTextNamingTheDaysIsUnavailableWithoutThem() {
        assertIs<ConsentText.Unavailable>(consentText("consent.biometric-matching", "en", null, "en", ConsentValues(null, null)))
    }

    @Test
    fun theAgreementsLabelIsAConsentTextToo() {
        assertEquals(builtIn("de", "openverify_consent_checkbox"), shown(consentText("consent.checkbox", "de", null, "en", values)).logical)
    }

    @Test
    fun aKeyTheSdkHasNoTextForIsUnavailable() {
        assertIs<ConsentText.Unavailable>(consentText("consent.unheard-of", "en", null, "en", values))
        assertIs<ConsentText.Unavailable>(consentText("consent.title", "en", null, "en", values))
    }

    private val custom = FlowCopy(
        mapOf(
            "en" to mapOf("consent.biometric" to "{organization} compares your selfie with your ID and keeps the template {days} days."),
            "fr" to mapOf("consent.processing" to "Texte de l'organisation."),
        ),
    )

    @Test
    fun theOperatorsTextReplacesTheSdksWithItsPlaceholdersFilled() {
        val text = shown(consentText("consent.biometric", "en", custom, "en", ConsentValues(30, "Example Verification Ltd")))

        assertEquals("Example Verification Ltd compares your selfie with your ID and keeps the template 30 days.", text.logical)
        assertEquals("⁨Example Verification Ltd⁩ compares your selfie with your ID and keeps the template ⁨30⁩ days.", text.display)
        assertTrue(text.custom)
    }

    @Test
    fun anOperatorsTextNamingTheOrganizationWithoutItsNameIsUnavailable() {
        assertIs<ConsentText.Unavailable>(consentText("consent.biometric", "en", custom, "en", ConsentValues(30, null)))
    }

    @Test
    fun anOperatorsTextInAnotherLanguageLeavesTheSdksOwn() {
        val text = shown(consentText("consent.processing", "en", custom, "fr", values))

        assertEquals(builtIn("en", "openverify_consent_processing"), text.logical)
        assertFalse(text.custom)
    }

    private val step = ConsentStep(
        "consent",
        listOf("consent.biometric", "consent.processing", "notice.session-integrity"),
        required = true,
        optionalTextKeys = listOf("consent.biometric-matching", "consent.device-recognition"),
    )

    private fun session(copy: FlowCopy? = null, organization: String? = null, days: Int? = 365) = FlowSession(
        inquiry = FlowSessionInquiry("inq_01M5CJXHG07XPHF3HRM6NREDH7", dev.openverify.sdk.model.InquiryStatus.PENDING),
        flow = dev.openverify.sdk.model.Flow(dev.openverify.sdk.model.FlowMetadata(specVersion = 1, id = "consent", version = 1, name = "Consent"), listOf(step)),
        verifications = emptyList(),
        consent = null,
        faceTemplateRetentionDays = days,
        copy = copy,
        locales = FlowLocales(listOf("en", "es", "fr", "de", "ar"), "en"),
        organizationDisplayName = organization,
    )

    @Test
    fun theEvidenceIsEachTextsDigestInTheBodysOrderTheSourceAndTheCatalogVersion() = runTest {
        val evidence = consentEvidence(step, listOf("consent.biometric-matching"), "es", session())

        val texts = listOf("consent.biometric", "consent.processing", "notice.session-integrity", "consent.biometric-matching")
            .map { shown(consentText(it, "es", null, "en", values)).logical }
        assertEquals(texts.map(Sha256::hexOfUtf8), evidence.textSha256)
        assertEquals("built-in", evidence.copySource)
        assertEquals(consentCatalogVersion(), evidence.catalogVersion)
    }

    @Test
    fun theOperatorsWordsForEveryTextAreACustomSource() = runTest {
        val all = FlowCopy(mapOf("en" to listOf("consent.biometric", "consent.processing", "notice.session-integrity").associateWith { "Operator text for $it." }))

        val evidence = consentEvidence(step, emptyList(), "en", session(all))

        assertEquals("custom", evidence.copySource)
        assertEquals(listOf("consent.biometric", "consent.processing", "notice.session-integrity").map { Sha256.hexOfUtf8("Operator text for $it.") }, evidence.textSha256)
    }

    /**
     * The server checks a `custom` body's texts against the operator's copy only and a `built-in` one's
     * against the released texts only (`checkConsentTextsInTx`), so a consent whose texts come from
     * both names no source, and the server tries both for each text.
     */
    @Test
    fun wordsFromBothNameNoSource() = runTest {
        val evidence = consentEvidence(step, emptyList(), "en", session(custom, "Example Verification Ltd"))

        assertNull(evidence.copySource)
        assertEquals(3, evidence.textSha256?.size)
    }

    @Test
    fun aTextTheScreenCouldNotShowGivesNoEvidence() = runTest {
        assertEquals(ConsentEvidence.NONE, consentEvidence(step, listOf("consent.biometric-matching"), "en", session(days = null)))
    }

    /** C200.3: the catalog version is the one the SDK's rows in the server's table carry. */
    @Test
    fun theCatalogVersionIsTheOneTheServersTableHoldsForTheseTexts() {
        val rows = Json.parseToJsonElement(readContractFixture("i18n/consent-texts.json")).jsonObject.getValue("entries").jsonArray
            .map { it.jsonObject }
            .filter { it.getValue("client").jsonPrimitive.content == "android" }
        val version = consentCatalogVersion()

        assertTrue(version.startsWith("android-$OPENVERIFY_SDK_VERSION-"), version)
        assertEquals(16, version.substringAfterLast('-').length)
        val current = rows.filter { it.getValue("catalog-version").jsonPrimitive.content == version }
        // Nine consent and notice keys in five locales since Workflow 10B (notice.play-integrity, decision 66).
        assertEquals(45, current.size)
        current.forEach { row ->
            val key = row.getValue("key").jsonPrimitive.content
            val locale = row.getValue("locale").jsonPrimitive.content
            assertEquals(row.getValue("text").jsonPrimitive.content, builtIn(locale, CONSENT_RESOURCE_OF.getValue(key)), "$locale $key")
        }
    }

    /** C200.4: each Android row's digest the server computes, at two retention values and with three organisation names. */
    @Test
    fun everyExportedDigestIsTheTextTheScreenShows() {
        val cases = Json.parseToJsonElement(readContractFixture("i18n/android-consent-digests.json")).jsonObject.getValue("cases").jsonArray.map { it.jsonObject }
        assertTrue(cases.size >= 80, "${cases.size} cases")

        cases.forEach { case ->
            // KP10-9: a custom-copy case is the operator's text as the session's copy serves it.
            val key = case.getValue("key").jsonPrimitive.content
            val locale = case.getValue("locale").jsonPrimitive.content
            val custom = case["copy-source"]?.jsonPrimitive?.content == "custom"
            if (!custom) assertEquals(consentCatalogVersion(), case.getValue("catalog-version").jsonPrimitive.content)
            val copy = if (custom) FlowCopy(mapOf(locale to mapOf(key to case.getValue("text").jsonPrimitive.content))) else null
            val caseValues = case.getValue("values") as JsonObject
            val text = shown(
                consentText(
                    key,
                    locale,
                    copy,
                    "en",
                    ConsentValues(caseValues.getValue("days").jsonPrimitive.content.toInt(), caseValues["organization"]?.jsonPrimitive?.content),
                ),
            )
            assertEquals(case.getValue("text-sha256").jsonPrimitive.content, Sha256.hexOfUtf8(text.logical), case.toString())
        }
    }

    private companion object {
        /** The consent texts' resources, by flow key: the key map's legal consent and notice entries. */
        val CONSENT_RESOURCE_OF = mapOf(
            "consent.automated-decision" to "openverify_consent_automated_decision",
            "consent.biometric" to "openverify_consent_biometric",
            "consent.biometric-matching" to "openverify_consent_biometric_matching",
            "consent.checkbox" to "openverify_consent_checkbox",
            "consent.device-recognition" to "openverify_consent_device_recognition",
            "consent.processing" to "openverify_consent_processing",
            "notice.device-recognition" to "openverify_notice_device_recognition",
            "notice.play-integrity" to "openverify_notice_play_integrity",
            "notice.session-integrity" to "openverify_notice_session_integrity",
        )
    }
}
