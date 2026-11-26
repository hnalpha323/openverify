package dev.openverify.sdk.ui.text

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.width
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.getOrNull
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.unit.dp
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/**
 * C212.2 (review H19): the SDK's one text composable records, in the test-only semantics property
 * [TextClipped], whether its text was cut off by its own box.
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(qualifiers = "w360dp-h800dp-mdpi")
internal class SdkTextTest {

    @get:Rule
    val rule = createComposeRule()

    private fun clipped(tag: String): Boolean? = rule.onNodeWithTag(tag).fetchSemanticsNode().config.getOrNull(TextClipped)

    @Test
    fun `a text that fits its box is recorded as not cut off`() {
        rule.setContent { Text("Synthetic words", Modifier.testTag("fits")) }

        assertEquals(false, clipped("fits"))
    }

    @Test
    fun `a text taller than its box is recorded as cut off`() {
        rule.setContent {
            Box(Modifier.width(60.dp).height(12.dp)) { Text("Synthetic words that need several lines here", Modifier.testTag("cut")) }
        }

        assertEquals(true, clipped("cut"))
    }

    @Test
    fun `a text with spans is recorded the same way`() {
        rule.setContent {
            Box(Modifier.width(60.dp).height(12.dp)) { Text(AnnotatedString("Synthetic words that need several lines here"), Modifier.testTag("cut")) }
        }

        assertEquals(true, clipped("cut"))
    }
}
