package dev.openverify.sdk.ui.scaffold

import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.painter.BitmapPainter
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.unit.dp
import dev.openverify.sdk.ui.help.ChromeTags
import dev.openverify.sdk.ui.text.Text
import dev.openverify.sdk.ui.theme.ThemeBrand

/**
 * C198.3, C198.10: the theme's brand above the content, as the web flow's header (`placement`
 * `header`, the only placement Phase 9 defines; any other value takes the header too). The logo is
 * drawn as it is in every language, never mirrored (C199.5): only its place follows the layout's
 * start. A decorative logo has no description and the organisation's name beside it; with no logo
 * to show, the name alone.
 */
@Composable
internal fun BrandHeader(brand: ThemeBrand, modifier: Modifier = Modifier) {
    Column(modifier.fillMaxWidth().testTag(ChromeTags.BRAND)) {
        Row(
            modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp).padding(horizontal = 16.dp, vertical = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            brand.logo?.let { logo ->
                // C199.5: the image keeps its own left and right whatever the language's direction.
                CompositionLocalProvider(LocalLayoutDirection provides LayoutDirection.Ltr) {
                    Image(
                        painter = BitmapPainter(logo),
                        contentDescription = brand.description,
                        contentScale = ContentScale.Fit,
                        modifier = Modifier.height(32.dp).aspectRatio(logo.width.toFloat() / logo.height).testTag(ChromeTags.BRAND_LOGO),
                    )
                }
            }
            brand.name?.let { name ->
                Text(name, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold, color = MaterialTheme.colorScheme.onSurface)
            }
        }
        HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
    }
}
