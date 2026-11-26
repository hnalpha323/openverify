/**
 * The theme editor's model (C160.3, C160.4; Workflow 9C, `dashboard-themes-copy`), pure: the editor
 * state and the sparse `styles` tree it saves, and the live contrast of each palette from the same
 * gate the API runs on every save (`checkPaletteContrast`'s pairs and `contrastRatio` of
 * `@openverify/core`). An empty cell takes the built-in token, as the API resolves it; both
 * palettes are checked whether or not the dark variant is offered, as the API does.
 */
import type { ThemeStyles } from '@openverify/contracts';
import {
  BUILTIN_PALETTES,
  CONTRAST_PAIRS,
  CONTRAST_PALETTE_TOKENS,
  contrastRatio,
  type ContrastPalette,
  type ContrastPurpose,
  type ContrastToken,
} from '@openverify/core';

export type ThemeVariant = 'light' | 'dark';
export const THEME_VARIANTS: readonly ThemeVariant[] = ['light', 'dark'];

/** One pair of the gate in one palette, its ratio never rounded. */
export interface ContrastRow {
  readonly foreground: ContrastToken;
  readonly background: ContrastToken;
  readonly purpose: ContrastPurpose;
  readonly ratio: number;
  readonly required: number;
  /** 7 for a text pair, which warns below it; `null` for a control or focus pair. */
  readonly enhanced: number | null;
  readonly level: 'pass' | 'warn' | 'fail';
}

/** What the editor's controls hold: each cell as typed, so a half-typed value is kept. */
export interface ThemeEditorState {
  readonly useDark: boolean;
  readonly preferred: ThemeVariant | null;
  readonly cells: Readonly<Record<ThemeVariant, Readonly<Partial<Record<ContrastToken, string>>>>>;
  /** Whether the stored tree has a `dark` member (it may be empty: every cell built in). */
  readonly darkPresent: boolean;
  readonly radius: string;
  readonly fontAssetId: string | null;
  readonly logo: {
    readonly assetId: string;
    readonly decorative: boolean;
    readonly altKey: string;
  } | null;
}

/** A control whose value the tree cannot hold: a colour that is not hex, or the radius. */
export interface InvalidCell {
  readonly variant: ThemeVariant | null;
  readonly token: ContrastToken | 'radius';
}

const HEX = /^#[0-9a-fA-F]{6}$/u;

/** A typed colour as the tree stores it (lower-case `#rrggbb`), or `null` when it is not one. */
export function hexOf(text: string): string | null {
  const value = text.trim();
  return HEX.test(value) ? value.toLowerCase() : null;
}

/** The variant's palette: the set's cells over the built-in tokens. */
export function resolvedPalette(styles: ThemeStyles, variant: ThemeVariant): ContrastPalette {
  const palette: Record<string, string> = { ...BUILTIN_PALETTES[variant] };
  for (const [token, colour] of Object.entries(styles[variant]?.palette ?? {})) {
    if (colour !== undefined) {
      palette[token] = colour;
    }
  }
  return palette as ContrastPalette;
}

/** Every pair of the gate in `CONTRAST_PAIRS` order, with its unrounded ratio and its result. */
export function contrastRows(styles: ThemeStyles, variant: ThemeVariant): ContrastRow[] {
  const palette = resolvedPalette(styles, variant);
  return CONTRAST_PAIRS.map((pair) => {
    const ratio = contrastRatio(palette[pair.foreground], palette[pair.background]);
    const level =
      ratio < pair.required
        ? 'fail'
        : pair.enhanced !== null && ratio < pair.enhanced
          ? 'warn'
          : 'pass';
    return {
      foreground: pair.foreground,
      background: pair.background,
      purpose: pair.purpose,
      ratio,
      required: pair.required,
      enhanced: pair.enhanced,
      level,
    };
  });
}

/** A stored palette's cells as the editor holds them, absent ones left out. */
function definedCells(
  palette: Readonly<Partial<Record<string, string | undefined>>> | undefined,
): Partial<Record<ContrastToken, string>> {
  const cells: Partial<Record<ContrastToken, string>> = {};
  for (const token of CONTRAST_PALETTE_TOKENS) {
    const colour = palette?.[token];
    if (colour !== undefined) {
      cells[token] = colour;
    }
  }
  return cells;
}

/** The editor state of a stored tree. */
export function editorStateOf(styles: ThemeStyles): ThemeEditorState {
  const font = styles.typography?.font;
  const logo = styles.branding?.logo;
  return {
    useDark: styles.settings?.['use-dark-theme'] === true,
    preferred: styles.settings?.['preferred-theme-variant'] ?? null,
    cells: {
      light: definedCells(styles.light?.palette),
      dark: definedCells(styles.dark?.palette),
    },
    darkPresent: styles.dark !== undefined,
    radius: styles.shape?.radius === undefined ? '' : String(styles.shape.radius),
    fontAssetId: font?.kind === 'uploaded' ? font['asset-id'] : null,
    logo:
      logo === undefined
        ? null
        : { assetId: logo['asset-id'], decorative: logo.decorative, altKey: logo['alt-key'] ?? '' },
  };
}

/**
 * The sparse tree the editor saves, and the controls whose value it cannot hold (the save is
 * refused in the browser until they are corrected; the API would refuse them too).
 */
export function stylesOfEditor(state: ThemeEditorState): {
  styles: ThemeStyles;
  invalid: InvalidCell[];
} {
  const invalid: InvalidCell[] = [];
  const palettes: Partial<Record<ThemeVariant, Partial<Record<ContrastToken, string>>>> = {};
  for (const variant of THEME_VARIANTS) {
    for (const token of CONTRAST_PALETTE_TOKENS) {
      const text = state.cells[variant][token]?.trim() ?? '';
      if (text === '') {
        continue;
      }
      const hex = hexOf(text);
      if (hex === null) {
        invalid.push({ variant, token });
      } else {
        (palettes[variant] ??= {})[token] = hex;
      }
    }
  }
  const radiusText = state.radius.trim();
  const radius = /^[0-9]{1,2}$/u.test(radiusText) ? Number(radiusText) : null;
  if (radiusText !== '' && (radius === null || radius > 24)) {
    invalid.push({ variant: null, token: 'radius' });
  }
  const darkTyped = Object.values(state.cells.dark).some((text) => text.trim() !== '');
  const styles: ThemeStyles = {
    ...(state.useDark || state.preferred !== null
      ? {
          settings: {
            ...(state.useDark ? { 'use-dark-theme': true } : {}),
            ...(state.preferred === null ? {} : { 'preferred-theme-variant': state.preferred }),
          },
        }
      : {}),
    ...(palettes.light === undefined ? {} : { light: { palette: palettes.light } }),
    ...(palettes.dark !== undefined
      ? { dark: { palette: palettes.dark } }
      : state.darkPresent || state.useDark || darkTyped
        ? { dark: {} }
        : {}),
    ...(radius !== null && radius <= 24 && radiusText !== '' ? { shape: { radius } } : {}),
    ...(state.fontAssetId === null
      ? {}
      : { typography: { font: { kind: 'uploaded' as const, 'asset-id': state.fontAssetId } } }),
    ...(state.logo === null
      ? {}
      : {
          branding: {
            logo: {
              'asset-id': state.logo.assetId,
              decorative: state.logo.decorative,
              ...(state.logo.altKey.trim() === '' ? {} : { 'alt-key': state.logo.altKey.trim() }),
            },
          },
        }),
  };
  return { styles, invalid };
}
