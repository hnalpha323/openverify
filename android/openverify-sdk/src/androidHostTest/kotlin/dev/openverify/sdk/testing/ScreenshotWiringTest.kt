package dev.openverify.sdk.testing

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.unit.dp
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.experimental.categories.Category
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/**
 * The screenshot wiring itself (C219.3, C212.2; Workflow 10A Stage 1b), over synthetic content: a
 * golden is captured and compared in `screenshotTest`, and the accessibility checks that run on every
 * golden fail what they should. Builders' screenshot tests follow this class's annotations.
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Category(ScreenshotTests::class)
@Config(qualifiers = "w320dp-h480dp-xhdpi")
internal class ScreenshotWiringTest {

    @get:Rule
    val rule = createComposeRule()

    @Test
    fun `a synthetic screen matches its golden and passes the accessibility checks`() {
        rule.setContent {
            MaterialTheme {
                Surface {
                    Column(Modifier.padding(16.dp)) {
                        Text("Screenshot wiring", style = MaterialTheme.typography.titleLarge)
                        Text("Synthetic text for the golden of foundation-10a.")
                    }
                }
            }
        }

        rule.onRoot().verifyGolden(GoldenOwner.FOUNDATION, "screenshot-wiring")
    }

    @Test
    fun `the accessibility checks fail an unlabelled target smaller than 48 dp`() {
        rule.setContent { Box(Modifier.size(10.dp).testTag("unlabelled").clickable { }) }

        val failure = runCatching { rule.onRoot().checkAccessibility() }.exceptionOrNull()

        assertNotNull("the accessibility checks passed an unlabelled 10 dp target", failure)
        assertTrue(failure!!.message.orEmpty(), failure.message.orEmpty().contains("SpeakableTextPresentCheck"))
    }
}
