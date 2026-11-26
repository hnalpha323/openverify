package dev.openverify.sdk.ui.text

import androidx.compose.material3.LocalTextStyle
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.SemanticsPropertyKey
import androidx.compose.ui.semantics.SemanticsPropertyReceiver
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.TextLayoutResult
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign

/**
 * The SDK's one text composable (C212.2, review H19): every text the SDK draws outside a text field
 * goes through here, never through Material's `Text` directly (`SdkTextSourceTest`), so one place
 * records whether a text was cut off.
 *
 * It draws Material's `Text` unchanged and writes into the test-only semantics property
 * [TextClipped] what the layout reported: true when the text did not fit its box
 * (`TextLayoutResult.hasVisualOverflow` or `didOverflowHeight`). No accessibility service reads the
 * property; the host tests assert it is false on every screen at font scale 2.0, in the five
 * languages and under the pseudo-locale.
 */
@Composable
internal fun Text(
    text: String,
    modifier: Modifier = Modifier,
    color: Color = Color.Unspecified,
    fontWeight: FontWeight? = null,
    fontFamily: FontFamily? = null,
    textAlign: TextAlign? = null,
    style: TextStyle = LocalTextStyle.current,
) {
    var clipped by remember { mutableStateOf(false) }
    androidx.compose.material3.Text(
        text = text,
        modifier = modifier.semantics { textClipped = clipped },
        color = color,
        fontWeight = fontWeight,
        fontFamily = fontFamily,
        textAlign = textAlign,
        onTextLayout = { clipped = it.isClipped() },
        style = style,
    )
}

/** [Text] for a text with spans (a language name marked as its language, an isolated value). */
@Composable
internal fun Text(
    text: AnnotatedString,
    modifier: Modifier = Modifier,
    color: Color = Color.Unspecified,
    fontWeight: FontWeight? = null,
    textAlign: TextAlign? = null,
    style: TextStyle = LocalTextStyle.current,
) {
    var clipped by remember { mutableStateOf(false) }
    androidx.compose.material3.Text(
        text = text,
        modifier = modifier.semantics { textClipped = clipped },
        color = color,
        fontWeight = fontWeight,
        textAlign = textAlign,
        onTextLayout = { clipped = it.isClipped() },
        style = style,
    )
}

/** Test-only semantics: whether this text was cut off by its own box (C212.2). */
internal val TextClipped: SemanticsPropertyKey<Boolean> = SemanticsPropertyKey("OpenVerifyTextClipped")

private var SemanticsPropertyReceiver.textClipped by TextClipped

/** Whether the laid-out text did not fit its box: wider or taller than it, or cut at a line limit. */
private fun TextLayoutResult.isClipped(): Boolean = hasVisualOverflow || didOverflowHeight
