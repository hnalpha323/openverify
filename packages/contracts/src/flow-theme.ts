/**
 * C160.3, C160.7 (Workflow 9A Stage 1a): the closed palette of the built-in stylesheet and the
 * theme a session renders. Defined with (T), because the preview of C156.1 carries it; the theme-set
 * resource, its routes and assets are the (H) family's. The palette's twelve tokens are exactly
 * `packages/ui/src/styles.css`'s colour tokens (review F13); colours are `#rrggbb` only, so a value
 * copied into a custom property can never make a request or inject a rule.
 */
import { z } from 'zod';
import { idSchema } from './ids.js';

/** C160.3: the closed token set, the stylesheet's twelve colour tokens. */
export const THEME_PALETTE_TOKENS = [
  'primary',
  'primary-hover',
  'on-primary',
  'danger',
  'danger-hover',
  'surface',
  'canvas',
  'ink',
  'ink-muted',
  'line',
  'control',
  'focus',
] as const;
export type ThemePaletteToken = (typeof THEME_PALETTE_TOKENS)[number];

export const themeColourSchema = z.string().regex(/^#[0-9a-f]{6}$/, 'must be #rrggbb, lowercase');

/** A complete palette, as a session receives it (absent cells resolved to the built-in tokens). */
export const themePaletteSchema = z.strictObject(
  Object.fromEntries(THEME_PALETTE_TOKENS.map((token) => [token, themeColourSchema])) as Record<
    ThemePaletteToken,
    typeof themeColourSchema
  >,
);
export type ThemePalette = z.infer<typeof themePaletteSchema>;

/** C160.3: the corner radius, 0 to 24 CSS px. */
export const themeRadiusSchema = z.int().min(0).max(24);

/** C160.7 (review P18): an uploaded font is `platforms: ["web"]`; native clients use the system font. */
export const THEME_FONT_PLATFORMS = ['web', 'android'] as const;

export const flowThemeFontSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('system'), platforms: z.array(z.enum(THEME_FONT_PLATFORMS)) }),
  z.strictObject({
    kind: z.literal('uploaded'),
    'asset-id': idSchema('tsa'),
    platforms: z.array(z.enum(THEME_FONT_PLATFORMS)),
  }),
]);

/** C160.6: a raster logo by its asset; a decorative one shows `organization-display-name` as text. */
export const flowThemeLogoSchema = z
  .strictObject({
    'asset-id': idSchema('tsa'),
    'alt-key': z.string().max(200).nullable(),
    decorative: z.boolean(),
  })
  .refine((logo) => logo.decorative || logo['alt-key'] !== null, {
    message: 'a logo that is not decorative has an alt key',
    path: ['alt-key'],
  });

/**
 * C160.9: `light` and `dark` force a variant; `auto` follows `prefers-color-scheme`, starting from
 * the set's preferred variant.
 */
export const THEME_MODES = ['light', 'dark', 'auto'] as const;
export const THEME_LOGO_PLACEMENTS = ['header'] as const;

/**
 * C160.7 (T15): the theme a session renders, the contract Phase 10 renders too. `theme-set-id` and
 * `revision` are `null` for the built-in tokens; `dark` is `null` when the set has no dark palette.
 */
export const flowThemeSchema = z.strictObject({
  'theme-set-id': idSchema('theset').nullable(),
  revision: z.int().min(1).nullable(),
  mode: z.enum(THEME_MODES),
  light: themePaletteSchema,
  dark: themePaletteSchema.nullable(),
  radius: themeRadiusSchema,
  font: flowThemeFontSchema,
  logo: flowThemeLogoSchema.nullable(),
  placement: z.enum(THEME_LOGO_PLACEMENTS),
});
export type FlowTheme = z.infer<typeof flowThemeSchema>;

/** C160.3: a sparse palette; an absent cell takes the built-in token. */
export const themePaletteInputSchema = z.strictObject(
  Object.fromEntries(
    THEME_PALETTE_TOKENS.map((token) => [token, themeColourSchema.optional()]),
  ) as Record<ThemePaletteToken, z.ZodOptional<typeof themeColourSchema>>,
);

/**
 * C160.3 (ours; the public cell list is not documented): a theme set's `styles`, sparse. An unknown
 * or mistyped cell is 400 with JSON Pointers; a contradiction (no `dark` while `use-dark-theme`, a
 * contrast failure, an archived or foreign asset) is 422 (`api-themes`, Workflow 9B). Shared with
 * the preview body of C156.1, which previews unsaved styles.
 */
export const themeStylesSchema = z.strictObject({
  settings: z
    .strictObject({
      'use-dark-theme': z.boolean().optional(),
      'preferred-theme-variant': z.enum(['light', 'dark']).optional(),
    })
    .optional(),
  light: z.strictObject({ palette: themePaletteInputSchema.optional() }).optional(),
  dark: z.strictObject({ palette: themePaletteInputSchema.optional() }).optional(),
  shape: z.strictObject({ radius: themeRadiusSchema.optional() }).optional(),
  typography: z
    .strictObject({
      font: z
        .discriminatedUnion('kind', [
          z.strictObject({ kind: z.literal('system') }),
          z.strictObject({ kind: z.literal('uploaded'), 'asset-id': idSchema('tsa') }),
        ])
        .optional(),
    })
    .optional(),
  branding: z
    .strictObject({
      logo: z
        .strictObject({
          'asset-id': idSchema('tsa'),
          'alt-key': z.string().max(200).optional(),
          decorative: z.boolean(),
        })
        .optional(),
      'logo-placement': z.enum(THEME_LOGO_PLACEMENTS).optional(),
    })
    .optional(),
});
export type ThemeStyles = z.infer<typeof themeStylesSchema>;
