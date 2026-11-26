package dev.openverify.sdk.ui.screen

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.LayoutDirection
import dev.openverify.sdk.Appearance
import dev.openverify.sdk.flow.FlowState
import dev.openverify.sdk.i18n.LocalSdkLanguage
import dev.openverify.sdk.model.AddressComponent
import dev.openverify.sdk.model.AddressFields
import dev.openverify.sdk.model.ButtonComponent
import dev.openverify.sdk.model.CheckboxComponent
import dev.openverify.sdk.model.CheckboxGroupComponent
import dev.openverify.sdk.model.ComponentOption
import dev.openverify.sdk.model.ContainerComponent
import dev.openverify.sdk.model.CountrySelectComponent
import dev.openverify.sdk.model.DateComponent
import dev.openverify.sdk.model.EmailComponent
import dev.openverify.sdk.model.FlowComponent
import dev.openverify.sdk.model.FlowContestRoute
import dev.openverify.sdk.model.FlowLinks
import dev.openverify.sdk.model.FlowTheme
import dev.openverify.sdk.model.FlowThemeFont
import dev.openverify.sdk.model.FlowValue
import dev.openverify.sdk.model.FooterComponent
import dev.openverify.sdk.model.ImageComponent
import dev.openverify.sdk.model.MaskedTextComponent
import dev.openverify.sdk.model.MultiSelectComponent
import dev.openverify.sdk.model.NumberComponent
import dev.openverify.sdk.model.PhoneComponent
import dev.openverify.sdk.model.RadioGroupComponent
import dev.openverify.sdk.model.ScreenStep
import dev.openverify.sdk.model.SelectComponent
import dev.openverify.sdk.model.SpacerComponent
import dev.openverify.sdk.model.StepperComponent
import dev.openverify.sdk.model.TextAreaComponent
import dev.openverify.sdk.model.TextComponent
import dev.openverify.sdk.model.TextInputComponent
import dev.openverify.sdk.model.UrlComponent
import dev.openverify.sdk.ui.theme.mappedThemeOf

/**
 * The synthetic content of android-screens' goldens (C219.3; rule 3: no faces, no real person): the
 * screens, their words in the five languages (each locale's words written here, as an operator would,
 * so the operator's copy is shown in the screen's language) and the themes they are drawn in.
 */
internal object ScreenGoldens {

    /** The look a golden is drawn in. */
    internal enum class Look { BUILT_IN_LIGHT, BUILT_IN_DARK, OPERATOR_LIGHT, OPERATOR_DARK }

    /**
     * A non-default operator palette that passes Phase 9's contrast gate (C160.4) with room to spare
     * (each text pair at least 5.2:1, each control pair at least 4.1:1, measured when written), so
     * every golden of it is drawn with a palette an operator could publish (C198.8).
     */
    private val OPERATOR_THEME = FlowTheme(
        themeSetId = null,
        revision = 1,
        mode = "auto",
        light = mapOf(
            "primary" to "#0f766e", "primary-hover" to "#115e59", "on-primary" to "#ffffff", "danger" to "#b91c1c",
            "danger-hover" to "#991b1b", "surface" to "#ffffff", "canvas" to "#f0fdfa", "ink" to "#134e4a",
            "ink-muted" to "#3d5a58", "line" to "#99c5bf", "control" to "#5f7f7b", "focus" to "#000000",
        ),
        dark = mapOf(
            "primary" to "#5eead4", "primary-hover" to "#99f6e4", "on-primary" to "#042f2e", "danger" to "#fca5a5",
            "danger-hover" to "#fecaca", "surface" to "#0f2a28", "canvas" to "#041b19", "ink" to "#ecfdf5",
            "ink-muted" to "#a7c4bf", "line" to "#2f5550", "control" to "#7fa39d", "focus" to "#ffffff",
        ),
        radius = 12,
        font = FlowThemeFont("system"),
        logo = null,
        placement = "header",
    )

    /** [content] in [language] (right to left for Arabic), at [fontScale], in [look]. */
    @Composable
    internal fun Golden(language: String, fontScale: Float, look: Look, environment: ScreenEnvironment, content: @Composable () -> Unit) {
        val mapped = when (look) {
            Look.BUILT_IN_LIGHT -> mappedThemeOf(null, Appearance.LIGHT, systemDark = false)
            Look.BUILT_IN_DARK -> mappedThemeOf(null, Appearance.DARK, systemDark = true)
            Look.OPERATOR_LIGHT -> mappedThemeOf(OPERATOR_THEME, Appearance.LIGHT, systemDark = false)
            Look.OPERATOR_DARK -> mappedThemeOf(OPERATOR_THEME, Appearance.DARK, systemDark = true)
        }
        val density = LocalDensity.current
        CompositionLocalProvider(
            LocalSdkLanguage provides language,
            LocalLayoutDirection provides if (language == "ar") LayoutDirection.Rtl else LayoutDirection.Ltr,
            LocalDensity provides Density(density.density, fontScale),
            LocalScreenEnvironment provides environment,
            LocalUriHandler provides RecordingUriHandler(),
        ) {
            MaterialTheme(colorScheme = mapped.colorScheme, shapes = mapped.shapes) {
                Surface(color = MaterialTheme.colorScheme.background, content = content)
            }
        }
    }

    // The screens --------------------------------------------------------------------------------

    private val options = listOf(ComponentOption("a", "alpha", "about.option.a"), ComponentOption("b", "beta", "about.option.b"))

    internal val contentScreen = ScreenStep(
        "about",
        listOf(
            TextComponent("title", "title", "about.title.title"),
            StepperComponent("steps", listOf("about.step.one", "about.step.two", "about.step.three"), current = 1),
            TextComponent("intro", "body", "about.intro.body"),
            ImageComponent("logo", "tas_synthetic", altKey = "about.logo.alt", decorative = false),
            SpacerComponent("gap", "m"),
            ContainerComponent(
                "names",
                "horizontal",
                listOf(TextInputComponent("given", "given_name", "about.given.label"), TextInputComponent("family", "family_name", "about.family.label")),
            ),
            TextComponent("note", "caption", "about.note.caption"),
            FooterComponent(
                "foot",
                listOf(
                    ButtonComponent("next", "about.next.button", "submit"),
                    ButtonComponent("stop", "about.stop.button", "cancel"),
                    ButtonComponent("help", "about.help.button", "link", link = "help-url"),
                ),
            ),
        ),
    )

    /** Every form component of C148's catalogue, each with its label and some with a hint. */
    internal val formScreen = ScreenStep(
        "details",
        listOf(
            TextComponent("title", "title", "about.form.title"),
            TextInputComponent("nickname", "nickname", "about.nickname.label", hintKey = "about.nickname.hint", required = true, minLength = 2),
            TextAreaComponent("bio", "bio", "about.bio.label"),
            NumberComponent("count", "count", "about.count.label", min = 1.0, max = 10.0),
            DateComponent("birthdate", "birthdate", "about.birthdate.label", required = true),
            EmailComponent("email", "email", "about.email.label", required = true),
            UrlComponent("site", "site", "about.site.label"),
            PhoneComponent("phone", "phone", "about.phone.label", allowedCountries = listOf("US")),
            MaskedTextComponent("secret", "secret", "about.secret.label"),
            SelectComponent("kind", "kind", "about.kind.label", required = true, options = options),
            CountrySelectComponent("country", "country", "about.country.label", allowedCountries = listOf("US", "CA")),
            RadioGroupComponent("plan", "plan", "about.plan.label", required = true, options = options),
            CheckboxComponent("agree", "agree", "about.agree.label", required = true),
            CheckboxGroupComponent("topics", "topics", "about.topics.label", options = options),
            MultiSelectComponent("tags", "tags", "about.tags.label", options = options),
            AddressComponent(
                "home",
                "about.home.label",
                AddressFields(street1 = "street", street2 = "street_extra", city = "city", subdivision = "region", postalCode = "postal", country = "home_country"),
                required = true,
                allowedCountries = listOf("US"),
            ),
            ButtonComponent("next", "about.next.button", "submit"),
        ),
    )

    /** The text-heavy form of the locale and font-scale matrix: one of each kind of field. */
    internal val matrixScreen = ScreenStep(
        "details",
        listOf(
            TextComponent("title", "title", "about.form.title"),
            TextInputComponent("nickname", "nickname", "about.nickname.label", hintKey = "about.nickname.hint", required = true, minLength = 2),
            SelectComponent("kind", "kind", "about.kind.label", required = true, options = options),
            RadioGroupComponent("plan", "plan", "about.plan.label", required = true, options = options),
            CheckboxComponent("agree", "agree", "about.agree.label", required = true),
            AddressComponent("home", "about.home.label", AddressFields(street1 = "street", city = "city", postalCode = "postal", country = "home_country"), required = true),
            ButtonComponent("next", "about.next.button", "submit"),
        ),
    )

    /** Synthetic values for the filled form. */
    internal val filled: Map<String, FlowValue> = mapOf(
        "nickname" to FlowValue.Text("Sam"),
        "bio" to FlowValue.Text("Synthetic notes about nothing in particular."),
        "count" to FlowValue.Number(3.0),
        "birthdate" to FlowValue.Text("1990-04-23"),
        "email" to FlowValue.Text("sam@example.com"),
        "site" to FlowValue.Text("https://example.com"),
        "secret" to FlowValue.Set,
        "kind" to FlowValue.Text("alpha"),
        "country" to FlowValue.Text("CA"),
        "plan" to FlowValue.Text("beta"),
        "agree" to FlowValue.Bool(true),
        "topics" to FlowValue.Texts(listOf("alpha", "beta")),
        "tags" to FlowValue.Texts(listOf("beta")),
        "street" to FlowValue.Text("1 Synthetic Way"),
        "city" to FlowValue.Text("Exampleton"),
        "region" to FlowValue.Text("EX"),
        "postal" to FlowValue.Text("00000"),
        "home_country" to FlowValue.Text("US"),
    )

    internal fun state(step: ScreenStep, values: Map<String, FlowValue> = emptyMap(), submitting: Boolean = false, refusedFields: Set<String> = emptySet(), refused: Boolean = false) =
        FlowState.Screen(step, values, submitting, refusedFields, refused)

    internal val contestLink = FlowContestRoute(url = "https://review.example.com/contest", host = "review.example.com", contact = "Synthetic review desk")
    internal val contestContact = FlowContestRoute(url = null, host = null, contact = "Synthetic review desk")

    /** The operator's words of these screens in [language] (synthetic copy, as an operator writes it for each enabled locale). */
    internal fun environment(language: String, contestRoute: FlowContestRoute? = null): ScreenEnvironment =
        screenEnvironment(COPY.getValue(language), language = language, links = FlowLinks("https://example.com/help", null), contestRoute = contestRoute)

    private val KEYS = listOf(
        "about.title.title", "about.step.one", "about.step.two", "about.step.three", "about.intro.body", "about.logo.alt",
        "about.given.label", "about.family.label", "about.note.caption", "about.next.button", "about.stop.button", "about.help.button",
        "about.form.title", "about.nickname.label", "about.nickname.hint", "about.bio.label", "about.count.label", "about.birthdate.label",
        "about.email.label", "about.site.label", "about.phone.label", "about.secret.label", "about.kind.label", "about.country.label",
        "about.plan.label", "about.agree.label", "about.topics.label", "about.tags.label", "about.home.label", "about.option.a", "about.option.b",
    )

    private val WORDS: Map<String, List<String>> = mapOf(
        "en" to listOf(
            "About you", "Details", "Documents", "Review", "Tell us a little about yourself before you continue.", "Synthetic logo",
            "Given name", "Family name", "We use these details only for this verification.", "Continue", "Stop for now", "Get help",
            "Your details", "Nickname", "As your friends call you", "About you", "How many", "Date of birth",
            "Email address", "Website", "Phone number", "Passphrase", "Kind", "Country",
            "Plan", "I agree to the terms", "Topics", "Tags", "Home address", "Alpha", "Beta",
        ),
        "es" to listOf(
            "Sobre usted", "Datos", "Documentos", "Revisión", "Cuéntenos un poco sobre usted antes de continuar.", "Logotipo sintético",
            "Nombre", "Apellido", "Usamos estos datos solo para esta verificación.", "Continuar", "Parar por ahora", "Obtener ayuda",
            "Sus datos", "Apodo", "Como le llaman sus amigos", "Sobre usted", "Cuántos", "Fecha de nacimiento",
            "Correo electrónico", "Sitio web", "Número de teléfono", "Frase de acceso", "Tipo", "País",
            "Plan", "Acepto las condiciones", "Temas", "Etiquetas", "Domicilio", "Alfa", "Beta",
        ),
        "fr" to listOf(
            "À propos de vous", "Informations", "Documents", "Vérification", "Parlez-nous un peu de vous avant de continuer.", "Logo fictif",
            "Prénom", "Nom de famille", "Nous utilisons ces informations uniquement pour cette vérification.", "Continuer", "Arrêter pour le moment", "Obtenir de l’aide",
            "Vos informations", "Surnom", "Comme vos amis vous appellent", "À propos de vous", "Combien", "Date de naissance",
            "Adresse e-mail", "Site web", "Numéro de téléphone", "Phrase secrète", "Type", "Pays",
            "Formule", "J’accepte les conditions", "Sujets", "Étiquettes", "Adresse du domicile", "Alpha", "Bêta",
        ),
        "de" to listOf(
            "Über Sie", "Angaben", "Dokumente", "Prüfung", "Erzählen Sie uns kurz etwas über sich, bevor Sie fortfahren.", "Synthetisches Logo",
            "Vorname", "Nachname", "Wir verwenden diese Angaben nur für diese Verifizierung.", "Weiter", "Vorerst aufhören", "Hilfe erhalten",
            "Ihre Angaben", "Spitzname", "Wie Ihre Freunde Sie nennen", "Über Sie", "Wie viele", "Geburtsdatum",
            "E-Mail-Adresse", "Website", "Telefonnummer", "Passphrase", "Art", "Land",
            "Tarif", "Ich stimme den Bedingungen zu", "Themen", "Schlagwörter", "Wohnadresse", "Alpha", "Beta",
        ),
        "ar" to listOf(
            "معلومات عنك", "البيانات", "المستندات", "المراجعة", "أخبرنا قليلًا عن نفسك قبل المتابعة.", "شعار تجريبي",
            "الاسم الأول", "اسم العائلة", "نستخدم هذه البيانات لهذا التحقق فقط.", "متابعة", "التوقف الآن", "الحصول على مساعدة",
            "بياناتك", "اللقب", "كما يناديك أصدقاؤك", "نبذة عنك", "العدد", "تاريخ الميلاد",
            "البريد الإلكتروني", "الموقع الإلكتروني", "رقم الهاتف", "عبارة المرور", "النوع", "البلد",
            "الخطة", "أوافق على الشروط", "المواضيع", "الوسوم", "عنوان السكن", "ألفا", "بيتا",
        ),
    )

    private val COPY: Map<String, Map<String, String>> = WORDS.mapValues { (_, words) -> KEYS.zip(words).toMap() }

    /** The screen as a golden draws it: [ScreenStepScreen] over a recording of its actions. */
    @Composable
    internal fun Screen(state: FlowState.Screen) {
        ScreenStepScreen(state, ScreenActions())
    }

    internal val ALL_FORM_COMPONENTS: List<FlowComponent> get() = formScreen.components
}
