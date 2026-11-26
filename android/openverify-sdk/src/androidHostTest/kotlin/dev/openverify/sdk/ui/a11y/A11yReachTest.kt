package dev.openverify.sdk.ui.a11y

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.Text
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.unit.dp
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/**
 * KP10-53 (10D review A012): the font-scale sweep's "no control lost" rule ([lostControls]) exempted
 * any control with a scrolling ancestor. A scrolling area reaches what lies along its own axis only:
 * a control past the window's side inside a page that scrolls up and down cannot be scrolled to, and
 * neither can one inside a scrolling area that is itself off the window. Test content only; the
 * screens are swept by [A11ySweepTest].
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(qualifiers = "w360dp-h800dp-mdpi")
internal class A11yReachTest {

    @get:Rule
    val rule = createComposeRule()

    private fun lost(): List<String> {
        val root = rule.onRoot().fetchSemanticsNode()
        return lostControls(root.subtree, root.frame).map { it.label() }.sorted()
    }

    @Test
    fun `a control reached by scrolling along its area's axis is not lost, one past the other axis is`() {
        rule.setContent {
            Box(Modifier.fillMaxSize()) {
                Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState())) {
                    Button(onClick = {}, modifier = Modifier.testTag("shown")) { Text("Shown") }
                    Spacer(Modifier.height(2000.dp))
                    Button(onClick = {}, modifier = Modifier.testTag("below the fold")) { Text("Below") }
                    Button(onClick = {}, modifier = Modifier.testTag("past the side").offset(x = 500.dp)) { Text("Aside") }
                    Row(Modifier.horizontalScroll(rememberScrollState())) {
                        Spacer(Modifier.width(600.dp))
                        Button(onClick = {}, modifier = Modifier.testTag("along a row that scrolls")) { Text("Row") }
                    }
                }
                Button(onClick = {}, modifier = Modifier.testTag("outside any scrolling area").offset(y = 900.dp)) { Text("Off") }
            }
        }

        assertEquals(listOf("outside any scrolling area", "past the side"), lost())
    }
}
