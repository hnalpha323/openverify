package dev.openverify.sdk.capture.barcode

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import dev.openverify.sdk.generated.resources.Res
import dev.openverify.sdk.generated.resources.openverify_pdf417_found
import dev.openverify.sdk.generated.resources.openverify_pdf417_guide
import dev.openverify.sdk.i18n.sdkString
import dev.openverify.sdk.ui.text.Text
import kotlin.math.min

/** The barcode overlay's test tags. */
internal object BarcodeTags {
    const val GUIDE: String = "openverify:barcode-guide"
    const val HINT: String = "openverify:barcode-hint"
}

/**
 * The guide's width to height: the synthetic AAMVA symbol with its quiet zone (950 x 269 px from
 * `synthetic_aamva.py`, 13 data columns as a licence's barcode), about 3.5 to 1.
 */
private const val BARCODE_GUIDE_ASPECT = 3.5f

/**
 * C203.3 (behaviour M26): the barcode guide inside the card guide, and its hint above it in a polite
 * live region, so each change is announced once (C202.3), never per frame. "Barcode found" outlines the
 * guide in the theme's primary colour; the words carry the meaning, the colour only repeats it. The
 * guide is drawn the same in every layout direction (C199.5: outlines never mirror).
 */
@Composable
internal fun BarcodeOverlay(hint: BarcodeHint, modifier: Modifier = Modifier) {
    val found = hint == BarcodeHint.FOUND
    val outline = if (found) MaterialTheme.colorScheme.primary else Color.White
    Box(modifier) {
        Canvas(Modifier.matchParentSize().testTag(BarcodeTags.GUIDE)) {
            val width = min(size.width * 0.85f, size.height * 0.6f * BARCODE_GUIDE_ASPECT)
            val guide = Size(width, width / BARCODE_GUIDE_ASPECT)
            val topLeft = Offset((size.width - guide.width) / 2, (size.height - guide.height) / 2)
            val stroke = (if (found) 4 else 3).dp.toPx()
            drawRoundRect(outline, topLeft, guide, CornerRadius(6.dp.toPx()), style = Stroke(width = stroke))
        }
        Text(
            text = sdkString(if (found) Res.string.openverify_pdf417_found else Res.string.openverify_pdf417_guide),
            color = Color.White,
            style = MaterialTheme.typography.bodyMedium,
            textAlign = TextAlign.Center,
            modifier = Modifier
                .align(Alignment.TopCenter)
                .padding(8.dp)
                .background(Color.Black.copy(alpha = 0.72f), RoundedCornerShape(8.dp))
                .padding(horizontal = 12.dp, vertical = 6.dp)
                .testTag(BarcodeTags.HINT)
                .semantics { liveRegion = LiveRegionMode.Polite },
        )
    }
}
