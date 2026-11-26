package dev.openverify.sdk.consent

import dev.openverify.sdk.flow.logic.Sha256
import dev.openverify.sdk.model.ConsentStep
import dev.openverify.sdk.model.FlowCopy
import kotlinx.coroutines.test.runTest
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.params.ParameterizedTest
import org.junit.jupiter.params.provider.ValueSource
import java.util.Locale

/**
 * C196.3 (review H08) on the consent fill: the SDK leaves the JVM default locale alone, so a device in
 * `ar-EG`, `fa-IR`, `bn-BD`, `mr-IN` or `my-MM` formats numbers in its own digits; the days filled into
 * a consent text, built in or the operator's, stay ASCII whatever the device, so the digest is the
 * server's. Each runs with the SDK's language equal to the device's (`ar` for `ar-EG`) and not.
 */
internal class ConsentDeviceLocaleTest {

    private val original: Locale = Locale.getDefault()

    @AfterEach
    fun restore() = Locale.setDefault(original)

    @ParameterizedTest
    @ValueSource(strings = ["ar-EG", "fa-IR", "bn-BD", "mr-IN", "my-MM"])
    fun `the days filled into a consent text are ASCII under every device locale`(device: String) = runTest {
        Locale.setDefault(Locale.forLanguageTag(device))
        assertTrue(String.format(Locale.getDefault(), "%d", 365) != "365", "the device's own digits are not ASCII (control)")

        listOf("ar", "en").forEach { language ->
            val shown = consentText("consent.biometric-matching", language, null, "en", ConsentValues(365, null)) as ConsentText.Shown
            assertTrue("365" in shown.logical, shown.logical)
            assertTrue(shown.logical.none { it in '٠'..'٩' || it in '۰'..'۹' }, shown.logical)
        }
        val custom = FlowCopy(mapOf("ar" to mapOf("consent.biometric" to "{organization} يحتفظ بالقالب {days} يومًا.")))
        val step = ConsentStep("consent", listOf("consent.biometric"), required = true)
        val evidence = consentEvidence(step, emptyList(), "ar", session(custom))

        assertEquals(listOf(Sha256.hexOfUtf8("Example Verification Ltd يحتفظ بالقالب 30 يومًا.")), evidence.textSha256)
    }

    private fun session(copy: FlowCopy) = dev.openverify.sdk.flow.FakeFlowApi().let { fake ->
        kotlinx.coroutines.runBlocking { fake.getSession() }.copy(copy = copy, faceTemplateRetentionDays = 30, organizationDisplayName = "Example Verification Ltd")
    }
}
