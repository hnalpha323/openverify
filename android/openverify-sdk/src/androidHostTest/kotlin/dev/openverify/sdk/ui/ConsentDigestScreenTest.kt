package dev.openverify.sdk.ui

import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.semantics.getOrNull
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import dev.openverify.sdk.InquiryViewModel
import dev.openverify.sdk.api.FlowApi
import dev.openverify.sdk.consent.ConsentEvidence
import dev.openverify.sdk.consent.consentCatalogVersion
import dev.openverify.sdk.fixtures.readContractFixture
import dev.openverify.sdk.flow.FakeFlowApi
import dev.openverify.sdk.flow.FakeFlowServer
import dev.openverify.sdk.flow.FlowCoordinator
import dev.openverify.sdk.flow.FlowState
import dev.openverify.sdk.generated.resources.Res
import dev.openverify.sdk.generated.resources.openverify_unsupported_title
import dev.openverify.sdk.i18n.sdkStringTable
import dev.openverify.sdk.model.ConsentStep
import dev.openverify.sdk.model.FlowCopy
import dev.openverify.sdk.model.FlowLocales
import dev.openverify.sdk.model.FlowSession
import dev.openverify.sdk.ui.theme.SessionLook
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.jetbrains.compose.resources.getString
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.security.MessageDigest
import java.text.Normalizer

/**
 * C200.4 (decision 14; reviews H07, F06, V13): each Android row of `consent-texts.json`, rendered
 * through the real consent screen inside `OpenVerifyTheme` in its language with the session's
 * retention and organisation name, shows the text whose SHA-256 (UTF-8, NFC, the display's isolates
 * removed) is the digest the server's own fill and hash expect (`android-consent-digests.json`,
 * api-android-10a's); and what the coordinator then sends is that digest.
 */
@RunWith(RobolectricTestRunner::class)
@Config(qualifiers = "w360dp-h4000dp")
internal class ConsentDigestScreenTest {

    @get:Rule
    val rule = createComposeRule()

    /** A case of the file: a built-in text ([text] null), or (KP10-9) an operator's [text] in the session's copy. */
    private class Case(val key: String, val locale: String, val days: Int, val organization: String?, val digest: String, val text: String?)

    private val all: List<Case> =
        Json.parseToJsonElement(readContractFixture("i18n/android-consent-digests.json")).jsonObject.getValue("cases").jsonArray.map {
            val case = it.jsonObject
            val values = case.getValue("values") as JsonObject
            Case(
                case.getValue("key").jsonPrimitive.content,
                case.getValue("locale").jsonPrimitive.content,
                values.getValue("days").jsonPrimitive.content.toInt(),
                values["organization"]?.jsonPrimitive?.content,
                case.getValue("text-sha256").jsonPrimitive.content,
                case["text"]?.jsonPrimitive?.content?.also { check(case["copy-source"]?.jsonPrimitive?.content == "custom") },
            )
        }

    private val cases: List<Case> = all.filter { it.text == null }

    /** KP10-9: the custom-copy cases, the three organisation names among them. */
    private val customCases: List<Case> = all.filter { it.text != null }

    /** Every Android consent text: five required (Workflow 10B: `notice.play-integrity`), three optional, and the agreement's label (`consent.checkbox`). */
    private val step = ConsentStep(
        "consent",
        listOf("consent.biometric", "consent.processing", "notice.session-integrity", "notice.device-recognition", "notice.play-integrity"),
        required = true,
        optionalTextKeys = listOf("consent.biometric-matching", "consent.device-recognition", "consent.automated-decision"),
    )

    private val locales = FlowLocales(listOf("en", "es", "fr", "de", "ar"), "en")

    private fun sha256(text: String): String {
        assertTrue(text, Normalizer.isNormalized(text, Normalizer.Form.NFC))
        return MessageDigest.getInstance("SHA-256").digest(text.toByteArray(Charsets.UTF_8)).joinToString("") { "%02x".format(it) }
    }

    /** The text the screen shows for [key], as a person reads it, without the display-only isolates. */
    private fun shown(key: String): String {
        val node = rule.onNodeWithTag(ConsentTags.text(key), useUnmergedTree = true).fetchSemanticsNode()
        val text = node.config.getOrNull(SemanticsProperties.Text).orEmpty().joinToString("") { it.text }
        return text.replace("⁨", "").replace("⁩", "")
    }

    @Test
    fun `every Android row shows the text whose digest the server expects`() {
        assertTrue("${cases.size} cases", cases.size >= 80)
        var group by mutableStateOf(cases.first())
        rule.setContent {
            val look = SessionLook(locales = locales, organizationDisplayName = group.organization)
            OpenVerifyTheme(look = look, requestedLocale = group.locale) {
                ConsentScreen(FlowState.Consent(step, retentionDays = group.days), onAccept = { _, _ -> }, onCancel = {})
            }
        }

        cases.forEach { case ->
            group = case
            rule.waitForIdle()
            assertEquals("${case.locale} ${case.key} days=${case.days} organization=${case.organization}", case.digest, sha256(shown(case.key)))
        }
    }

    @Test
    fun `every custom-copy case, rendered as the session's operator copy, shows the text whose digest the server expects (KP10-9)`() {
        assertTrue("${customCases.size} custom-copy cases", customCases.size >= 3)
        assertTrue("the organisation cases", customCases.count { it.organization != null } >= 3)
        var group by mutableStateOf(customCases.first())
        rule.setContent {
            val copy = FlowCopy(mapOf(group.locale to mapOf(group.key to checkNotNull(group.text))))
            val look = SessionLook(locales = locales, organizationDisplayName = group.organization, copy = copy)
            OpenVerifyTheme(look = look, requestedLocale = group.locale) {
                ConsentScreen(FlowState.Consent(step, retentionDays = group.days), onAccept = { _, _ -> }, onCancel = {})
            }
        }

        customCases.forEach { case ->
            group = case
            rule.waitForIdle()
            assertEquals("${case.locale} ${case.key} organization=${case.organization}", case.digest, sha256(shown(case.key)))
        }
    }

    /** A Phase 9 session answer for [server]'s position, with the version's locales, [copy] and the organisation's name. */
    private class Served(private val server: FakeFlowServer, private val copy: FlowCopy?, private val organization: String?) : FlowApi by server {
        override suspend fun getSession(): FlowSession =
            server.getSession().copy(copy = copy, organizationDisplayName = organization, locales = FlowLocales(listOf("en", "es", "fr", "de", "ar"), "en"))
    }

    private fun agreeAndContinue(language: String) {
        rule.onNodeWithTag(TestTags.CONSENT_CHECKBOX).performScrollTo().performClick()
        rule.onNodeWithText(checkNotNull(sdkStringTable(language)).strings.getValue("openverify_consent_continue")).performScrollTo().performClick()
        rule.waitForIdle()
    }

    private fun showFlow(server: FakeFlowServer, served: FlowApi, language: String, look: SessionLook) {
        val viewModel = InquiryViewModel(FlowCoordinator(served, FakeFlowApi.INQUIRY_ID, FlowCoordinator.Settings(consentTextKeys = ConsentTexts.keys)), FakeFlowApi.INQUIRY_ID)
        rule.setContent {
            val state by viewModel.state.collectAsState()
            OpenVerifyTheme(look = look, requestedLocale = language) { InquiryFlowScreen(state, FakeCaptureCamera(), viewModel) }
        }
        rule.waitUntil(10_000) { rule.onAllNodesWithTag(TestTags.CONSENT_CHECKBOX).fetchSemanticsNodes().isNotEmpty() }
        check(server.consentEvidence == null)
    }

    @Test
    @Config(qualifiers = "en")
    fun `the coordinator sends the digests of the texts the screen showed, in Arabic, built in`() {
        val server = FakeFlowServer()
        val look = SessionLook(locales = locales)
        showFlow(server, Served(server, null, null), "ar", look)
        val keys = (server.flow.steps.first() as ConsentStep).textKeys
        val digests = keys.map { sha256(shown(it)) }

        agreeAndContinue("ar")

        assertEquals(ConsentEvidence(digests, "built-in", consentCatalogVersion()), server.consentEvidence)
        assertEquals("ar", server.consentRequest?.second)
    }

    @Test
    fun `operator copy is shown, named custom, with the organisation's name`() {
        val server = FakeFlowServer()
        val keys = (server.flow.steps.first() as ConsentStep).textKeys
        val copy = FlowCopy(mapOf("en" to keys.associateWith { "{organization} asks you to agree to $it." }))
        val look = SessionLook(locales = locales, organizationDisplayName = "Example Verification Ltd", copy = copy)
        showFlow(server, Served(server, copy, "Example Verification Ltd"), "en", look)

        keys.forEach { assertEquals("Example Verification Ltd asks you to agree to $it.", shown(it)) }
        agreeAndContinue("en")

        assertEquals(keys.map { sha256("Example Verification Ltd asks you to agree to $it.") }, server.consentEvidence?.textSha256)
        assertEquals("custom", server.consentEvidence?.copySource)
    }

    @Test
    fun `an operator's legal text naming the organisation without its name renders the step unsupported, never the SDK's words`() {
        val copy = FlowCopy(mapOf("en" to mapOf("consent.processing" to "{organization} processes your photos.")))
        rule.setContent {
            OpenVerifyTheme(look = SessionLook(locales = locales, copy = copy), requestedLocale = "en") {
                ConsentScreen(FlowState.Consent(step, retentionDays = 365), onAccept = { _, _ -> }, onCancel = {})
            }
        }

        rule.onNodeWithText(runBlocking { getString(Res.string.openverify_unsupported_title) }).assertExists()
        rule.onNodeWithTag(TestTags.CONSENT_CHECKBOX).assertDoesNotExist()
    }
}
