package dev.openverify.sdk.ui.a11y

import androidx.compose.ui.test.junit4.v2.createComposeRule
import dev.openverify.sdk.capture.barcode.BarcodeTags
import dev.openverify.sdk.capture.selfie.SelfieGuidanceTags
import dev.openverify.sdk.i18n.sdkStringIn
import dev.openverify.sdk.privacy.SdkModule
import dev.openverify.sdk.privacy.SourceScan
import dev.openverify.sdk.ui.TestTags
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/**
 * C212.2, C199.5 (Workflow 10D, android-a11y-audit): right to left. In Arabic every screen lays out
 * from the right; what shows the world as it is (the camera preview, the document and face
 * outlines, the barcode guide) sits and is drawn exactly as in English; a selfie prompt's left and
 * right stay the person's own; and the SDK draws no icon, so there is no directional icon to
 * mirror, which a source check holds until one is added. `@Config(qualifiers = "ar")` also puts the
 * device in Arabic, as the plan asks; the SDK's own direction comes from its chosen language.
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(qualifiers = "ar-w360dp-h800dp-mdpi")
internal class A11yRightToLeftTest {

    @get:Rule
    val rule = createComposeRule()

    private val stage by lazy { A11yStageDriver(rule) }
    private val arabic = A11yLook(language = "ar")

    @Test
    fun `in Arabic every heading that starts its column starts at the right edge, and a centred one stays centred`() {
        var startAligned = 0
        val problems = A11yCatalog.STATES.filter { !it.popup }.flatMap { state ->
            fun heading(look: A11yLook) = stage.also { it.show(state, look) }.nodes(merged = true).filter { it.heading && !it.inChrome }.inReadingOrder().first()
            val window = stage.also { it.show(state, arabic) }.nodes(merged = true).first().lineage.last().frame
            val right = heading(arabic).frame
            val left = heading(A11yLook()).frame
            // A heading that starts its column mirrors its margin; a centred one (a status screen's) stays centred.
            val mirrored = kotlin.math.abs((window.right - right.right) - (left.left - window.left)) <= 1f
            val centred = kotlin.math.abs(right.center.x - window.center.x) <= 1f && kotlin.math.abs(left.center.x - window.center.x) <= 1f
            if (!centred) startAligned++
            listOfNotNull(
                "${state.name}: the Arabic heading is ${window.right - right.right} px from the right and the English one ${left.left - window.left} px from the left"
                    .takeIf { !mirrored && !centred },
            )
        }

        assertTrue("no heading starts its column", startAligned > 80)
        assertEquals("", problems.joinToString("\n"))
    }

    @Test
    fun `the camera preview, the outlines and the barcode guide sit the same in Arabic as in English`() {
        val unmirrored = setOf(TestTags.PREVIEW, TestTags.DOCUMENT_GUIDE, TestTags.OVAL_GUIDE, TestTags.PAGE_GUIDE, BarcodeTags.GUIDE, TestTags.REVIEW_PHOTO)
        var compared = 0
        val problems = A11yCatalog.STATES.filter { it.screen in setOf(A11yScreen.CAPTURE, A11yScreen.CAPTURE_REVIEW, A11yScreen.BARCODE_GUIDANCE) }.flatMap { state ->
            fun frames(look: A11yLook) = stage.also { it.show(state, look) }.nodes(merged = false).filter { it.tag in unmirrored }.associate { it.tag to (it.frame.left to it.frame.width) }
            val english = frames(A11yLook())
            val inArabic = frames(arabic)
            compared += english.size
            (english.keys + inArabic.keys).filter { english[it] != inArabic[it] }.map { "${state.name}: $it is at ${english[it]} in English and ${inArabic[it]} in Arabic" }
        }

        assertTrue("nothing was compared", compared >= 20)
        assertEquals("", problems.joinToString("\n"))
    }

    @Test
    fun `a selfie prompt's left and right are the person's own in Arabic too`() {
        val left = checkNotNull(sdkStringIn("ar", "openverify_selfie_guidance_turn_left", emptyList()))
        val right = checkNotNull(sdkStringIn("ar", "openverify_selfie_guidance_turn_right", emptyList()))
        fun hint(state: String) = stage.also { it.show(A11yCatalog.state(state), arabic) }.nodes(merged = true).first { it.tag == SelfieGuidanceTags.HINT }.spoken

        assertNotEquals(left, right)
        assertEquals(left, hint("selfie-guidance-turn-left"))
        assertEquals(right, hint("selfie-guidance-turn-right"))
    }

    @Test
    fun `no shipped source draws an icon or flips what it draws, so nothing directional can be mirrored wrongly`() {
        val sources = SdkModule.SHIPPED.flatMap(SourceScan::sourcesOf)
        val icon = Regex("""\bIcons?\.|\bIcon\(|\bIconButton\(|painterResource\(|vectorResource\(""")
        // The brand's logo is the one thing laid out left to right whatever the language (C199.5).
        val forced = Regex("""LayoutDirection\.Ltr""")
        val flipped = Regex("""scaleX\s*=\s*-|scale\(\s*(scaleX\s*=\s*)?-1|rotationY\s*=""")

        assertTrue("the scan read no source", sources.size > 100)
        assertEquals(emptyList<String>(), sources.filter { icon.containsMatchIn(SourceScan.code(it.second)) }.map { it.first })
        assertEquals(emptyList<String>(), sources.filter { flipped.containsMatchIn(SourceScan.code(it.second)) }.map { it.first })
        assertEquals(
            listOf("src/commonMain/kotlin/dev/openverify/sdk/ui/OpenVerifyTheme.kt", "src/commonMain/kotlin/dev/openverify/sdk/ui/scaffold/BrandHeader.kt"),
            sources.filter { forced.containsMatchIn(SourceScan.code(it.second)) }.map { it.first }.sorted(),
        )
    }
}
