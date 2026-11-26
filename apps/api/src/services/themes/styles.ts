/**
 * C160.3, C160.4, C160.7 (`api-themes`, Workflow 9B): what a theme set's sparse `styles` tree
 * resolves to, pure. An absent cell takes the built-in token (`BUILTIN_PALETTES` of
 * `@openverify/core`, the stylesheet's hex tokens); every pair of both palettes is held to the
 * contrast gate, and a failure names the foreground cell's JSON Pointer, also when that cell was
 * absent and took the built-in token.
 *
 * The documented defaults (ours, recorded in `docs/themes/README.md`): `use-dark-theme` false (so
 * the flow keeps today's light look), `preferred-theme-variant` light, radius 6 CSS px (the
 * stylesheet's `rounded-md`), the system font and no logo in the header.
 */
import {
  BUILTIN_PALETTES,
  checkPaletteContrast,
  type BuiltinPaletteVariant,
  type ContrastFinding,
  type ContrastPalette,
} from '@openverify/core';
import { themeStylesSchema, type FlowTheme, type ThemeStyles } from '@openverify/contracts';

/** C160.3: the radius when `shape.radius` is absent, the stylesheet's `rounded-md` (0.375rem). */
export const BUILTIN_THEME_RADIUS = 6;

/** Where a theme set's `styles` sit in a request: the resource's attributes. */
export const STYLES_POINTER = '/data/attributes/styles';

/** The resolved palette of one variant: the set's cells over the built-in tokens. */
export function paletteOf(styles: ThemeStyles, variant: BuiltinPaletteVariant): ContrastPalette {
  const cells = styles[variant]?.palette ?? {};
  const palette: Record<string, string> = { ...BUILTIN_PALETTES[variant] };
  for (const [token, colour] of Object.entries(cells)) {
    if (colour !== undefined) {
      palette[token] = colour;
    }
  }
  return palette as ContrastPalette;
}

/** Whether the set offers a dark variant (`settings.use-dark-theme`, default false). */
export const usesDarkTheme = (styles: ThemeStyles): boolean =>
  styles.settings?.['use-dark-theme'] === true;

/** One finding of the gate, with the pointer of its foreground cell. */
export interface PointedFinding extends ContrastFinding {
  pointer: string;
}

/**
 * Every finding of both resolved palettes, light first, each in `CONTRAST_PAIRS` order: `fail`
 * below the minimum, `warn` below 7:1 for text. The dark palette is checked whether or not the set
 * uses it, so a set never stores a failing dark palette it may switch on later.
 */
export function contrastFindingsOf(
  styles: ThemeStyles,
  base: string = STYLES_POINTER,
): PointedFinding[] {
  return (['light', 'dark'] as const).flatMap((variant) =>
    checkPaletteContrast(paletteOf(styles, variant)).map((finding) => ({
      ...finding,
      pointer: `${base}/${variant}/palette/${finding.foreground}`,
    })),
  );
}

/** A set as the session theme reads it: its id, its saved revision and its styles. */
export interface ThemeSource {
  id: string | null;
  revision: number | null;
  styles: ThemeStyles;
}

/**
 * C160.7 (T15): the theme a session (or the preview) renders. `mode` is `auto` (the device's
 * `prefers-color-scheme`) when the set uses its dark theme, `light` otherwise; `dark` is `null` for
 * a set without one; an uploaded font is `platforms: ["web"]` (review P18).
 */
export function flowThemeOf(source: ThemeSource): FlowTheme {
  const { styles } = source;
  const dark = usesDarkTheme(styles);
  const font = styles.typography?.font;
  const logo = styles.branding?.logo;
  return {
    'theme-set-id': source.id,
    revision: source.revision,
    mode: dark ? 'auto' : 'light',
    light: paletteOf(styles, 'light'),
    dark: dark ? paletteOf(styles, 'dark') : null,
    radius: styles.shape?.radius ?? BUILTIN_THEME_RADIUS,
    font:
      font?.kind === 'uploaded'
        ? { kind: 'uploaded', 'asset-id': font['asset-id'], platforms: ['web'] }
        : { kind: 'system', platforms: ['web', 'android'] },
    logo:
      logo === undefined
        ? null
        : { 'asset-id': logo['asset-id'], 'alt-key': logo['alt-key'] ?? null, decorative: logo.decorative },
    placement: styles.branding?.['logo-placement'] ?? 'header',
  };
}

/**
 * The built-in theme, with no set: both built-in palettes, light by default (the flow's look before
 * Phase 9), so a `style-variant=dark` still has a dark palette to show (review F13).
 */
export function builtinFlowTheme(): FlowTheme {
  return {
    ...flowThemeOf({ id: null, revision: null, styles: {} }),
    dark: { ...BUILTIN_PALETTES.dark },
  };
}

/** A stored `styles` tree, read back through its schema; `null` when it no longer parses. */
export function storedStylesOf(stored: unknown): ThemeStyles | null {
  const parsed = themeStylesSchema.safeParse(stored);
  return parsed.success ? parsed.data : null;
}
