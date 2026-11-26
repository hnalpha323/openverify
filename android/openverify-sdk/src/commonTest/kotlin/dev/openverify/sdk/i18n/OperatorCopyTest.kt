package dev.openverify.sdk.i18n

import dev.openverify.sdk.model.FlowCopy
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * C199.6 (Phase 9 C162.3, C162.5, C162.6) and C199.7 (decision 13): the session's operator copy
 * replaces the SDK's own text for each key the key map places, with `{name}` placeholders filled
 * from each key's closed list and nothing else interpreted; component texts are always operator
 * copy, through C162.5's fallbacks, never a raw key; an override the SDK cannot place keeps the
 * built-in text when it has no legal weight and renders the step unsupported when it has.
 */
internal class OperatorCopyTest {

    private val isolate = '⁨'
    private val pop = '⁩'

    private val copy = FlowCopy(
        messages = mapOf(
            "en" to mapOf(
                "consent.title" to "Verify with {organization}",
                "consent.processing" to "{organization} processes your data.",
                "consent.biometric" to "We keep your face template for {days} days.",
                "consent.continue" to "I agree",
                "failure.title" to "We could not verify you",
                "id_screen.full_name.label" to "Your full name at {organization}",
                "id_screen.country.option.us" to "United States",
            ),
            "fr" to mapOf(
                "consent.title" to "Vérifier avec {organization}",
                "id_screen.full_name.hint" to "Comme sur votre pièce",
            ),
        ),
    )

    private val values = mapOf("organization" to "Synthetic Bank", "days" to "30")

    @Test
    fun theRulesMirrorPhase9sCopyKeys() {
        // Workflow 10B (decision 66): notice.play-integrity is the 21st; Workflow 11A adds the eight
        // share.consent.* keys (C238.3).
        assertEquals(29, COPY_KEY_RULES.size)
        assertEquals(CopyKeyRule(listOf("organization"), LegalKind.NOTICE), COPY_KEY_RULES["notice.play-integrity"])
        assertEquals(CopyKeyRule(listOf("days", "organization"), LegalKind.CONSENT), COPY_KEY_RULES["consent.biometric-matching"])
        assertEquals(CopyKeyRule(listOf("organization"), LegalKind.NOTICE), COPY_KEY_RULES["notice.session-integrity"])
        assertEquals(CopyKeyRule(emptyList(), null), COPY_KEY_RULES["screen.continue"])
        assertEquals(CopyKeyRule(listOf("organization"), null), COPY_KEY_RULES["screen.waiting.message"])
    }

    @Test
    fun theKeyMapPlacesABuiltInKeyOnItsSdkStrings() {
        assertEquals("consent.title", SDK_COPY_KEYS["openverify_consent_title"])
        assertEquals("notice.session-integrity", SDK_COPY_KEYS["openverify_notice_session_integrity"])
        assertNull(SDK_COPY_KEYS["openverify_consent_biometric_matching_checkbox"], "a checkbox label no operator copy can target")
        assertEquals(CopyKeyPlacement.Placed(listOf("openverify_consent_processing")), placeCopyKey("consent.processing"))
    }

    @Test
    fun aServerComposedKeyIsNeitherPlacedNorRefused() {
        // C238.3, C238.7 (Workflow 11A): the server composes the share-consent texts, overrides
        // included, into the step's view, so an override is not a legal text the SDK failed to place.
        assertEquals(CopyKeyPlacement.ServerComposed, placeCopyKey("share.consent.source"))
        assertEquals(CopyKeyRule(listOf("source", "recipient", "categories", "expires", "withdraw", "retention"), LegalKind.CONSENT), COPY_KEY_RULES["share.consent.destination"])
        val review = reviewCopy(FlowCopy(messages = mapOf("en" to mapOf("share.consent.source" to "Synthetic override for {recipient}"))))
        assertEquals(CopyReview(unsupported = emptyList(), ignored = emptyList()), review)
        assertEquals(false, review.rendersUnsupported)
    }

    @Test
    fun aKeyTheSdkCannotPlaceIsIgnoredUnlessItIsLegal() {
        assertEquals(CopyKeyPlacement.Ignored, placeCopyKey("failure.title"))
        assertEquals(CopyKeyPlacement.Ignored, placeCopyKey("screen.help"))
        // KP10-10: the waiting words are key-mapped, so an operator's text for them is placed.
        assertEquals(CopyKeyPlacement.Placed(listOf("openverify_waiting_message")), placeCopyKey("screen.waiting.message"))
        assertEquals(CopyKeyPlacement.Ignored, placeCopyKey("no.such.key"), "an unknown key (the server refuses one on save) has no legal weight")
        assertEquals(CopyKeyPlacement.Component, placeCopyKey("id_screen.full_name.label"))
        assertEquals(CopyKeyPlacement.Component, placeCopyKey("id_screen.country.option.us"))
        assertEquals(CopyKeyPlacement.Ignored, placeCopyKey("id_screen.full_name.colour"), "not a component attribute")
        assertEquals(CopyKeyPlacement.Ignored, placeCopyKey("id_screen.option.us"))
    }

    @Test
    fun anUnplacedLegalKeyRendersTheStepUnsupported() {
        val legal = mapOf(
            "consent.title" to CopyKeyRule(listOf("organization"), null),
            "consent.retention" to CopyKeyRule(listOf("days"), LegalKind.RETENTION),
        )
        assertEquals(CopyKeyPlacement.Unsupported(LegalKind.RETENTION), placeCopyKey("consent.retention", legal, SDK_COPY_KEYS))
        val review = reviewCopy(FlowCopy(mapOf("en" to mapOf("consent.retention" to "x", "failure.title" to "y", "consent.title" to "z"))), legal, SDK_COPY_KEYS)
        assertEquals(CopyReview(unsupported = listOf("consent.retention"), ignored = listOf("failure.title")), review)
        assertTrue(review.rendersUnsupported)
        assertFalse(reviewCopy(copy).rendersUnsupported, "every legal key of today's COPY_KEYS is placed")
        assertEquals(listOf("failure.title"), reviewCopy(copy).ignored)
        assertEquals(CopyReview(emptyList(), emptyList()), reviewCopy(null))
    }

    @Test
    fun placeholdersAreFilledFromTheClosedListAndNothingElseIsInterpreted() {
        assertEquals(
            FilledText("Hello Synthetic Bank, 30 days", "Hello ${isolate}Synthetic Bank$pop, ${isolate}30$pop days"),
            fillCopyPlaceholders("Hello {organization}, {days} days", listOf("organization", "days"), values),
        )
        assertEquals(FilledText("No placeholder", "No placeholder"), fillCopyPlaceholders("No placeholder", emptyList(), values))
        assertEquals(FilledText("%1\$s stays as written", "%1\$s stays as written"), fillCopyPlaceholders("%1\$s stays as written", emptyList(), values), "no other syntax is interpreted")
        assertNull(fillCopyPlaceholders("Hello {days}", listOf("organization"), values), "a placeholder outside the key's list")
        assertNull(fillCopyPlaceholders("Hello {organization}", listOf("organization"), emptyMap()), "a placeholder with no value")
        assertNull(fillCopyPlaceholders("Hello {Organization}", listOf("organization"), values), "braces only around a placeholder name")
        assertNull(fillCopyPlaceholders("Hello {{organization}}", listOf("organization"), values))
        assertNull(fillCopyPlaceholders("A stray } brace", listOf("organization"), values))
        assertEquals(
            FilledText("Org {days} Ltd", "${isolate}Org {days} Ltd$pop"),
            fillCopyPlaceholders("{organization}", listOf("organization", "days"), mapOf("organization" to "Org {days} Ltd", "days" to "30")),
            "a filled value is never read again",
        )
    }

    @Test
    fun anSdkStringShowsTheOperatorsTextInTheChosenLanguageElseItsOwn() {
        val english = OperatorCopy(copy, language = "en", defaultLanguage = "en")
        assertEquals(
            ResolvedText.Custom(FilledText("Verify with Synthetic Bank", "Verify with ${isolate}Synthetic Bank$pop"), "en"),
            english.forResource("openverify_consent_title", values),
        )
        assertEquals(ResolvedText.BuiltIn, english.forResource("openverify_consent_saving", values), "a string the key map gives no flow key")
        assertEquals(ResolvedText.BuiltIn, english.forResource("openverify_retry_title", values), "a string outside the key map")
        assertEquals(ResolvedText.BuiltIn, english.forResource("openverify_notice_device_recognition", values), "no override")
        val french = OperatorCopy(copy, language = "fr", defaultLanguage = "en")
        assertEquals(ResolvedText.Custom(FilledText("Vérifier avec Synthetic Bank", "Vérifier avec ${isolate}Synthetic Bank$pop"), "fr"), french.forResource("openverify_consent_title", values))
        assertEquals(ResolvedText.BuiltIn, french.forResource("openverify_consent_continue", values), "C162.5: the chosen language's built-in text before the default's custom one")
        assertEquals(ResolvedText.BuiltIn, OperatorCopy(null, "en", "en").forResource("openverify_consent_title", values))
    }

    @Test
    fun anOverrideThatCannotBeShownAsWrittenFailsClosedOnlyForALegalText() {
        val noOrganization = mapOf("days" to "30")
        val english = OperatorCopy(copy, language = "en", defaultLanguage = "en")
        assertEquals(ResolvedText.Unsupported, english.forResource("openverify_consent_processing", noOrganization), "a consent text never falls back to the SDK's words")
        assertEquals(ResolvedText.BuiltIn, english.forResource("openverify_consent_title", noOrganization), "a title keeps the built-in text")
        assertEquals(
            ResolvedText.Custom(FilledText("We keep your face template for 30 days.", "We keep your face template for ${isolate}30$pop days."), "en"),
            english.forResource("openverify_consent_biometric", values),
        )
    }

    @Test
    fun componentTextsFollowC162_5sFallbacksNeverARawKey() {
        val french = OperatorCopy(copy, language = "fr", defaultLanguage = "en")
        assertEquals(ComponentText(FilledText("Comme sur votre pièce", "Comme sur votre pièce"), "fr"), french.component("id_screen.full_name.hint", values))
        assertEquals(
            ComponentText(FilledText("Your full name at Synthetic Bank", "Your full name at ${isolate}Synthetic Bank$pop"), "en"),
            french.component("id_screen.full_name.label", values),
            "the default language's text, which names its language (WCAG 3.1.2)",
        )
        assertNull(french.component("id_screen.missing.label", values))
        assertNull(OperatorCopy(copy, language = "en", defaultLanguage = "en").component("id_screen.full_name.hint", values), "no English hint and English is the default")
        assertNull(french.component("id_screen.full_name.label", emptyMap()), "a component's {organization} with no value")
    }

    @Test
    fun theCopySourceIsCustomExactlyWhenTheChosenLanguageHasTheOperatorsText() {
        assertTrue(OperatorCopy(copy, "en", "en").isCustom("consent.processing"))
        assertFalse(OperatorCopy(copy, "fr", "en").isCustom("consent.processing"))
        assertFalse(OperatorCopy(null, "en", "en").isCustom("consent.processing"))
    }
}
