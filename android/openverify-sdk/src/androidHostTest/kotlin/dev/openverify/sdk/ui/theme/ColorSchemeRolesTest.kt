package dev.openverify.sdk.ui.theme

import androidx.compose.material3.ColorScheme
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import java.lang.reflect.Modifier

/**
 * C198.2 (review H04): the host test that enumerates `ColorScheme`'s properties. Every colour role
 * the Material on the classpath declares is one the mapping sets (`COLOR_SCHEME_ROLES`) and one the
 * common tests read (`schemeRoles`), so a role a later Material adds fails here instead of keeping
 * Material's baseline colour on an operator's screen.
 */
internal class ColorSchemeRolesTest {

    /** `getPrimary-0d7_KjU` (a `Color` getter, name-mangled for the value class) to `primary`. */
    private val roleGetters = ColorScheme::class.java.declaredMethods
        .filter { Modifier.isPublic(it.modifiers) && it.parameterCount == 0 && it.returnType == Long::class.javaPrimitiveType && it.name.startsWith("get") && '-' in it.name }
        .associateBy { method -> method.name.removePrefix("get").substringBefore('-').replaceFirstChar { it.lowercase() } }

    private val scheme = colorSchemeOf(ThemePalette.of(ThemeToken.entries.mapIndexed { index, token -> token.wire to "#${"%02x".format(java.util.Locale.ROOT, index + 16)}2030" }.toMap())!!)

    @Test
    fun everyColourRoleOfColorSchemeIsSetByTheMapping() {
        assertTrue(roleGetters.size >= 48, "ColorScheme's colour roles: ${roleGetters.keys}")
        assertEquals(roleGetters.keys.sorted(), COLOR_SCHEME_ROLES.keys.sorted())
        assertEquals(roleGetters.keys.sorted(), schemeRoles(scheme).keys.sorted())
    }

    @Test
    fun eachRoleReadByReflectionIsTheColourTheMappingChose() {
        val roles = schemeRoles(scheme)
        val wrong = roleGetters.mapNotNull { (role, getter) ->
            val packed = getter.invoke(scheme) as Long
            if (packed == roles.getValue(role).value.toLong()) null else role
        }
        assertEquals(emptyList<String>(), wrong)
    }
}
