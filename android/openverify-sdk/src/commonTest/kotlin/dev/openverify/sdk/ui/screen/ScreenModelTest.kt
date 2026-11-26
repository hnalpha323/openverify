package dev.openverify.sdk.ui.screen

import dev.openverify.sdk.flow.logic.VisibilityRuleRefused
import dev.openverify.sdk.model.AddressComponent
import dev.openverify.sdk.model.AddressFields
import dev.openverify.sdk.model.CheckboxComponent
import dev.openverify.sdk.model.ComponentOption
import dev.openverify.sdk.model.ContainerComponent
import dev.openverify.sdk.model.CountrySelectComponent
import dev.openverify.sdk.model.DateComponent
import dev.openverify.sdk.model.EmailComponent
import dev.openverify.sdk.model.FlowComponent
import dev.openverify.sdk.model.FlowValue
import dev.openverify.sdk.model.FooterComponent
import dev.openverify.sdk.model.MaskedTextComponent
import dev.openverify.sdk.model.MultiSelectComponent
import dev.openverify.sdk.model.NumberComponent
import dev.openverify.sdk.model.PhoneComponent
import dev.openverify.sdk.model.ScreenStep
import dev.openverify.sdk.model.SelectComponent
import dev.openverify.sdk.model.StepperComponent
import dev.openverify.sdk.model.TextAreaComponent
import dev.openverify.sdk.model.TextComponent
import dev.openverify.sdk.model.TextInputComponent
import dev.openverify.sdk.model.UnsupportedComponent
import dev.openverify.sdk.model.UrlComponent
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertNull

/**
 * C195.4-C195.9 (Workflow 10A, android-screens): the screen step's form, pure, as the web flow's
 * `screen-model.ts` holds and checks it. Synthetic values only (rule 9).
 */
internal class ScreenModelTest {

    private fun screen(vararg components: FlowComponent) = ScreenStep("about", components.toList())

    private fun equals(field: String, value: String): JsonObject =
        JsonObject(mapOf("===" to JsonArray(listOf(JsonObject(mapOf("var" to JsonPrimitive("screen.$field"))), JsonPrimitive(value)))))

    private val nickname = TextInputComponent("nickname", "nickname", "about.nickname.label", required = true, minLength = 2, maxLength = 5)
    private val address = AddressComponent(
        "home",
        "about.home.label",
        AddressFields(street1 = "address_street_1", street2 = "address_street_2", city = "address_city", postalCode = "address_postal_code", country = "address_country_code"),
        required = true,
        allowedCountries = listOf("US", "CA"),
    )

    @Test
    fun `the bound fields are every form component's field an address's parts in their order depth first`() {
        val step = screen(
            TextComponent("intro", "title", "about.intro.title"),
            ContainerComponent("box", "vertical", listOf(nickname, address)),
            FooterComponent("foot", listOf(CheckboxComponent("agree", "agree", "about.agree.label"))),
        )

        assertEquals(
            listOf(
                "nickname" to null,
                "address_street_1" to AddressPart.STREET1,
                "address_street_2" to AddressPart.STREET2,
                "address_city" to AddressPart.CITY,
                "address_postal_code" to AddressPart.POSTAL_CODE,
                "address_country_code" to AddressPart.COUNTRY,
                "agree" to null,
            ),
            boundFields(step).map { it.key to it.part },
        )
    }

    @Test
    fun `the session's values fill only the screen's own fields and a value the server keeps reads as set - C151_5 C195_5`() {
        val step = screen(
            nickname,
            NumberComponent("age", "age", "about.age.label"),
            CheckboxComponent("agree", "agree", "about.agree.label"),
            MultiSelectComponent("tags", "tags", "about.tags.label", options = listOf(ComponentOption("a", "alpha", "about.tags.a"))),
            MaskedTextComponent("secret", "secret", "about.secret.label"),
        )
        val state = initialScreenState(
            step,
            mapOf(
                "nickname" to FlowValue.Text("Sam"),
                "age" to FlowValue.Number(42.0),
                "agree" to FlowValue.Bool(true),
                "tags" to FlowValue.Texts(listOf("alpha")),
                "secret" to FlowValue.Set,
                "elsewhere" to FlowValue.Text("not on this screen"),
            ),
        )

        assertEquals(
            mapOf(
                "nickname" to ScreenValue.Text("Sam"),
                "age" to ScreenValue.Text("42"),
                "agree" to ScreenValue.Bool(true),
                "tags" to ScreenValue.Texts(listOf("alpha")),
                "secret" to ScreenValue.Text(""),
            ),
            state.values,
        )
        assertEquals(setOf("secret"), state.set)
    }

    @Test
    fun `a value the control cannot hold starts empty never as something else`() {
        val step = screen(nickname, CheckboxComponent("agree", "agree", "about.agree.label"))

        val state = initialScreenState(step, mapOf("nickname" to FlowValue.Texts(listOf("x")), "agree" to FlowValue.Text("yes")))

        assertEquals(mapOf("nickname" to ScreenValue.Text(""), "agree" to ScreenValue.Bool(false)), state.values)
    }

    @Test
    fun `visibility hides and disables through the strict evaluator and a container passes its state down - C148_4`() {
        val kind = SelectComponent("kind", "kind", "about.kind.label", options = listOf(ComponentOption("p", "person", "about.kind.p"), ComponentOption("b", "business", "about.kind.b")))
        val business = TextInputComponent("company", "company", "about.company.label", visibleWhen = equals("kind", "business"))
        val box = ContainerComponent("box", "vertical", listOf(nickname), enabledWhen = equals("kind", "person"))
        val step = screen(kind, business, box)

        val chosen = initialScreenState(step, mapOf("kind" to FlowValue.Text("business"))).values

        assertEquals(
            mapOf("kind" to Visibility.VISIBLE, "company" to Visibility.VISIBLE, "box" to Visibility.DISABLED, "nickname" to Visibility.DISABLED),
            visibilityOf(step, chosen),
        )
        assertEquals(Visibility.HIDDEN, visibilityOf(step, initialScreenState(step, emptyMap()).values)["company"])
    }

    @Test
    fun `a rule outside the strict subset is refused and renders the whole screen unsupported - C196_1`() {
        val rule = JsonObject(mapOf(">" to JsonArray(listOf(JsonObject(mapOf("var" to JsonPrimitive("screen.nickname"))), JsonPrimitive(3)))))
        val step = screen(nickname, TextInputComponent("other", "other", "about.other.label", visibleWhen = rule))

        assertFailsWith<VisibilityRuleRefused> { visibilityOf(step, initialScreenState(step, emptyMap()).values) }
        assertEquals("screen visibility", screenUnsupportedReason(step))
    }

    @Test
    fun `a later component kind renders the whole screen unsupported never a part of it - C194_3`() {
        val step = screen(nickname, ContainerComponent("box", "vertical", listOf(UnsupportedComponent("future", "signature_pad"))))

        assertEquals("screen component", screenUnsupportedReason(step))
    }

    @Test
    fun `a screen above C148_6's limits renders unsupported - C195_9`() {
        val many = (1..41).map { TextComponent("t$it", "body", "about.t$it.body") }
        assertEquals("screen limits", screenUnsupportedReason(ScreenStep("about", many)))
        assertNull(screenUnsupportedReason(ScreenStep("about", many.take(40))))

        fun nest(depth: Int): FlowComponent = if (depth == 0) nickname else ContainerComponent("c$depth", "vertical", listOf(nest(depth - 1)))
        assertNull(screenUnsupportedReason(screen(nest(3))))
        assertEquals("screen limits", screenUnsupportedReason(screen(nest(4))))

        val options = (1..1001).map { ComponentOption("o$it", "v$it", "about.pick.o$it") }
        assertEquals("screen limits", screenUnsupportedReason(screen(SelectComponent("pick", "pick", "about.pick.label", options = options))))
        assertNull(screenUnsupportedReason(screen(SelectComponent("pick", "pick", "about.pick.label", options = options.take(1000)))))

        assertEquals("screen limits", screenUnsupportedReason(screen(StepperComponent("steps", listOf("about.s1", "about.s2"), current = 2))))
    }

    @Test
    fun `a renderable screen has no reason`() {
        assertNull(screenUnsupportedReason(screen(TextComponent("intro", "title", "about.intro.title"), nickname, address)))
    }

    private fun errorsOf(step: ScreenStep, values: Map<String, FlowValue>): Map<String, FieldError> {
        val state = initialScreenState(step, values)
        return screenErrors(step, state, visibilityOf(step, state.values))
    }

    @Test
    fun `required fields must hold a value but not one the server already holds - C148_7`() {
        val masked = MaskedTextComponent("secret", "secret", "about.secret.label", required = true)
        val step = screen(nickname, masked)

        assertEquals(mapOf("nickname" to FieldError(FieldErrorCode.REQUIRED), "secret" to FieldError(FieldErrorCode.REQUIRED)), errorsOf(step, emptyMap()))
        assertEquals(mapOf("nickname" to FieldError(FieldErrorCode.REQUIRED)), errorsOf(step, mapOf("secret" to FlowValue.Set)))
    }

    @Test
    fun `lengths count code points and the bound is named in ASCII digits`() {
        val step = screen(nickname)

        assertEquals(FieldError(FieldErrorCode.TOO_SHORT, "2"), errorsOf(step, mapOf("nickname" to FlowValue.Text("a")))["nickname"])
        assertEquals(FieldError(FieldErrorCode.TOO_LONG, "5"), errorsOf(step, mapOf("nickname" to FlowValue.Text("abcdef")))["nickname"])
        // Five characters outside the BMP are five, not ten.
        assertNull(errorsOf(step, mapOf("nickname" to FlowValue.Text("😀".repeat(5))))["nickname"])
    }

    @Test
    fun `a pattern is matched by the restricted matcher and a pattern it refuses fails closed - C196_2`() {
        val code = TextInputComponent("code", "code", "about.code.label", pattern = "[A-Z]{2}[0-9]{3}")
        val broken = TextInputComponent("other", "other", "about.other.label", pattern = "(?=lookahead)")
        val step = screen(code, broken)

        val errors = errorsOf(step, mapOf("code" to FlowValue.Text("AB12"), "other" to FlowValue.Text("lookahead")))
        assertEquals(mapOf("code" to FieldError(FieldErrorCode.PATTERN), "other" to FieldError(FieldErrorCode.PATTERN)), errors)
        assertNull(errorsOf(step, mapOf("code" to FlowValue.Text("AB123")))["code"])
    }

    @Test
    fun `numbers are decimals the server reads within the component's range`() {
        val step = screen(NumberComponent("age", "age", "about.age.label", min = 18.0, max = 120.5))

        assertEquals(FieldError(FieldErrorCode.NUMBER), errorsOf(step, mapOf("age" to FlowValue.Text("12d")))["age"])
        assertEquals(FieldError(FieldErrorCode.NUMBER), errorsOf(step, mapOf("age" to FlowValue.Text("NaN")))["age"])
        assertEquals(FieldError(FieldErrorCode.NUMBER), errorsOf(step, mapOf("age" to FlowValue.Text("0x20")))["age"])
        assertEquals(FieldError(FieldErrorCode.TOO_SMALL, "18"), errorsOf(step, mapOf("age" to FlowValue.Text("17")))["age"])
        assertEquals(FieldError(FieldErrorCode.TOO_LARGE, "120.5"), errorsOf(step, mapOf("age" to FlowValue.Text("1.21e2")))["age"])
        assertNull(errorsOf(step, mapOf("age" to FlowValue.Text(" 42 ")))["age"])
        assertEquals(42.0, parseNumber(" 42 "))
        assertNull(parseNumber("4 2"))
    }

    @Test
    fun `dates are real calendar days within the component's range`() {
        val step = screen(DateComponent("start", "start", "about.start.label", min = "2024-01-01", max = "2024-12-31"))

        assertEquals(FieldError(FieldErrorCode.DATE), errorsOf(step, mapOf("start" to FlowValue.Text("2024-02-30")))["start"])
        assertEquals(FieldError(FieldErrorCode.DATE), errorsOf(step, mapOf("start" to FlowValue.Text("24-02-03")))["start"])
        assertEquals(FieldError(FieldErrorCode.DATE_TOO_EARLY, "2024-01-01"), errorsOf(step, mapOf("start" to FlowValue.Text("2023-12-31")))["start"])
        assertEquals(FieldError(FieldErrorCode.DATE_TOO_LATE, "2024-12-31"), errorsOf(step, mapOf("start" to FlowValue.Text("2025-01-01")))["start"])
        assertNull(errorsOf(step, mapOf("start" to FlowValue.Text("2024-02-29")))["start"])
        assertEquals(listOf(true, false, true, false), listOf("2000-02-29", "1900-02-29", "2024-04-30", "2024-04-31").map(::isCalendarDate))
    }

    @Test
    fun `emails web addresses and phone numbers are checked for their shape only the server decides`() {
        val step = screen(
            EmailComponent("email", "email", "about.email.label"),
            UrlComponent("site", "site", "about.site.label"),
            PhoneComponent("phone", "phone", "about.phone.label"),
        )

        assertEquals(
            mapOf("email" to FieldError(FieldErrorCode.EMAIL), "site" to FieldError(FieldErrorCode.URL), "phone" to FieldError(FieldErrorCode.PHONE)),
            errorsOf(step, mapOf("email" to FlowValue.Text("name@example"), "site" to FlowValue.Text("ftp://example.com"), "phone" to FlowValue.Text("555 0100"))),
        )
        assertEquals(
            emptyMap(),
            errorsOf(step, mapOf("email" to FlowValue.Text("name@example.com"), "site" to FlowValue.Text("https://example.com/help"), "phone" to FlowValue.Text("+1 202-555-0100"))),
        )
        assertEquals(FieldError(FieldErrorCode.PHONE), errorsOf(step, mapOf("phone" to FlowValue.Text("+1 2345")))["phone"])
        assertEquals(FieldError(FieldErrorCode.PHONE), errorsOf(step, mapOf("phone" to FlowValue.Text("+1234567890123456")))["phone"])
    }

    @Test
    fun `choices must be among the component's options or countries`() {
        val step = screen(
            SelectComponent("kind", "kind", "about.kind.label", options = listOf(ComponentOption("p", "person", "about.kind.p"))),
            MultiSelectComponent("tags", "tags", "about.tags.label", options = listOf(ComponentOption("a", "alpha", "about.tags.a"))),
            CountrySelectComponent("country", "country", "about.country.label", allowedCountries = listOf("US")),
            address,
        )

        assertEquals(
            mapOf(
                "kind" to FieldError(FieldErrorCode.OPTION),
                "tags" to FieldError(FieldErrorCode.OPTION),
                "country" to FieldError(FieldErrorCode.COUNTRY),
                "address_street_1" to FieldError(FieldErrorCode.REQUIRED),
                "address_city" to FieldError(FieldErrorCode.REQUIRED),
                "address_postal_code" to FieldError(FieldErrorCode.REQUIRED),
                "address_country_code" to FieldError(FieldErrorCode.COUNTRY),
            ),
            errorsOf(
                step,
                mapOf(
                    "kind" to FlowValue.Text("robot"),
                    "tags" to FlowValue.Texts(listOf("alpha", "beta")),
                    "country" to FlowValue.Text("CA"),
                    "address_country_code" to FlowValue.Text("MX"),
                ),
            ),
        )
    }

    @Test
    fun `hidden and disabled components are not checked and errors come in the order the fields are shown`() {
        val hidden = TextInputComponent("company", "company", "about.company.label", required = true, visibleWhen = equals("nickname", "x"))
        val disabled = TextInputComponent("other", "other", "about.other.label", required = true, enabledWhen = equals("nickname", "x"))
        val step = screen(TextAreaComponent("bio", "bio", "about.bio.label", required = true), hidden, disabled, nickname)

        assertEquals(listOf("bio", "nickname"), errorsOf(step, emptyMap()).keys.toList())
    }

    @Test
    fun `the submission holds the visible values digits normalised where they mean digits a number as a number - C195_7 C196_3`() {
        val step = screen(
            nickname,
            TextAreaComponent("bio", "bio", "about.bio.label"),
            NumberComponent("age", "age", "about.age.label"),
            DateComponent("start", "start", "about.start.label"),
            PhoneComponent("phone", "phone", "about.phone.label"),
            EmailComponent("email", "email", "about.email.label"),
            address,
            CheckboxComponent("agree", "agree", "about.agree.label"),
            TextInputComponent("company", "company", "about.company.label", visibleWhen = equals("nickname", "nobody")),
            MaskedTextComponent("secret", "secret", "about.secret.label"),
        )
        val state = initialScreenState(
            step,
            mapOf(
                "nickname" to FlowValue.Text("٤٢"),
                "bio" to FlowValue.Text("٤٢"),
                "age" to FlowValue.Text("۴۲"),
                "start" to FlowValue.Text("٢٠٢٤-٠١-٠٢"),
                "phone" to FlowValue.Text("+١ ٢٠٢ ٥٥٥ ٠١٠٠"),
                "email" to FlowValue.Text("٤@example.com"),
                "address_postal_code" to FlowValue.Text("٩٠٢١٠"),
                "address_city" to FlowValue.Text("٩"),
                "company" to FlowValue.Text("Hidden Ltd"),
                "secret" to FlowValue.Set,
            ),
        )

        val values = submissionValues(step, state, visibilityOf(step, state.values))

        assertEquals(
            mapOf(
                "nickname" to FlowValue.Text("42"),
                "bio" to FlowValue.Text("٤٢"),
                "age" to FlowValue.Number(42.0),
                "start" to FlowValue.Text("2024-01-02"),
                "phone" to FlowValue.Text("+1 202 555 0100"),
                "email" to FlowValue.Text("٤@example.com"),
                "address_street_1" to FlowValue.Empty,
                "address_street_2" to FlowValue.Empty,
                "address_city" to FlowValue.Text("٩"),
                "address_postal_code" to FlowValue.Text("90210"),
                "address_country_code" to FlowValue.Empty,
                "agree" to FlowValue.Bool(false),
            ),
            values,
        )
    }

    @Test
    fun `a field shown as set is sent again only once the person types a new value`() {
        val masked = MaskedTextComponent("secret", "secret", "about.secret.label")
        val step = screen(masked)
        val arrived = initialScreenState(step, mapOf("secret" to FlowValue.Set))
        val field = boundFields(step).single()

        val typed = arrived.with(field, ScreenValue.Text("٧٧"))

        assertEquals(emptySet(), typed.set)
        assertEquals(mapOf("secret" to FlowValue.Text("77")), submissionValues(step, typed, visibilityOf(step, typed.values)))
        assertEquals(emptyMap(), submissionValues(step, arrived, visibilityOf(step, arrived.values)))
    }

    @Test
    fun `a form state never shows what it holds`() {
        val step = screen(nickname)
        val state = initialScreenState(step, mapOf("nickname" to FlowValue.Text("Synthetic Sam")))

        assertEquals(false, state.toString().contains("Synthetic"))
        assertEquals(false, ScreenValue.Text("Synthetic Sam").toString().contains("Synthetic"))
    }
}
