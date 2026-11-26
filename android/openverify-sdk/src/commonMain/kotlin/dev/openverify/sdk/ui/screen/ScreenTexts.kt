package dev.openverify.sdk.ui.screen

import dev.openverify.sdk.i18n.ComponentText
import dev.openverify.sdk.i18n.SDK_DEFAULT_LANGUAGE
import dev.openverify.sdk.i18n.availableLanguages
import dev.openverify.sdk.model.ButtonComponent
import dev.openverify.sdk.model.FlowSession
import dev.openverify.sdk.model.FormComponent
import dev.openverify.sdk.model.ImageComponent
import dev.openverify.sdk.model.ScreenStep
import dev.openverify.sdk.model.StepperComponent
import dev.openverify.sdk.model.TextComponent

/**
 * C162.5, C199.6: the copy keys a screen cannot be shown without: each text's words, each form
 * component's label, each button's label, each stepper label, and the text alternative of an image
 * that is not decorative. A hint is optional (left out when no catalog holds it) and an option's label
 * falls back to the option's own value, as the web flow shows them.
 */
internal fun requiredTextKeys(step: ScreenStep): List<String> = allComponents(step.components).flatMap { component ->
    when (component) {
        is TextComponent -> listOf(component.copyKey)
        is FormComponent -> listOf(component.labelKey)
        is ButtonComponent -> listOf(component.labelKey)
        is StepperComponent -> component.labelKeys
        is ImageComponent -> if (component.decorative) emptyList() else listOfNotNull(component.altKey)
        else -> emptyList()
    }
}.distinct()

/**
 * Whether [text] holds every key [step] cannot be shown without: a screen whose words are missing
 * renders unsupported, never with a raw key or an empty label (C199.6; the server requires every
 * component text in the default locale on publish, so a gap here is a defect, never a guess).
 */
internal fun screenTextsComplete(step: ScreenStep, text: (key: String) -> ComponentText?): Boolean =
    requiredTextKeys(step).all { text(it) != null }

/**
 * KP10-8 (C194.1, C195): whether [session] can show every text [step] needs in every language the
 * person could be shown (the chooser's candidates, `availableLanguages`, else the default), through the
 * same environment the screen renders with. The coordinator does not hold the person's choice, so a gap
 * in any of them makes the whole screen unsupported from the driver, never partway inside the screen.
 */
internal fun screenCopyComplete(step: ScreenStep, session: FlowSession): Boolean =
    availableLanguages(session.locales).ifEmpty { listOf(SDK_DEFAULT_LANGUAGE) }
        .all { language -> screenTextsComplete(step, screenEnvironmentOf(session, language).text) }

/**
 * C195.3: whether [url] is an `https:` address with a host, the only kind a `link` button opens in
 * the system browser; anything else is refused (and logged as a PII-free code, never the URL).
 */
internal fun isHttpsLink(url: String?): Boolean {
    if (url == null || url.length > URL_LONGEST || !url.startsWith("https://")) return false
    if (url.any { it.isWhitespace() || it.isISOControl() }) return false
    val authority = url.substring(8).takeWhile { it != '/' && it != '?' && it != '#' }
    val host = authority.substringAfterLast('@').substringBefore(':')
    return host.isNotEmpty() && '\\' !in authority
}
