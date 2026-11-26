/**
 * C160.4 (behaviour note T3; decision 26): the contrast gate, its signature frozen in Workflow 9A
 * (Stage 1a, (H)) and built by `api-themes` in Workflow 9B, which owns this folder, its vectors and
 * its tests. Pure: the console runs it live and the API on every save. It proves the palette's pairs,
 * not a screen (C160.10): text over images, the logo, thin fonts, forced colours, the embedding page
 * and operator copy are outside it (`docs/themes/README.md`).
 *
 * The rule: WCAG 2.2's relative luminance (8-bit sRGB, the 0.04045 threshold, 0.2126, 0.7152 and
 * 0.0722) and `(L1 + 0.05) / (L2 + 0.05)`, never rounded, so 4.499 fails 4.5. The pairs are
 * `CONTRAST_PAIRS`, checked in each palette (light and dark); `line` is decorative and has none.
 */

/**
 * The palette's twelve tokens, the built-in stylesheet's colour tokens (`packages/ui/src/styles.css`).
 * The contracts' `THEME_PALETTE_TOKENS` is the same list, by a contracts test.
 */
export const CONTRAST_PALETTE_TOKENS = Object.freeze([
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
] as const);
export type ContrastToken = (typeof CONTRAST_PALETTE_TOKENS)[number];

/** A complete palette: each token a `#rrggbb` colour. */
export type ContrastPalette = Readonly<Record<ContrastToken, string>>;

/** WCAG 2.2 1.4.3 (text) and 1.4.11 (non-text); the 7:1 of 1.4.6 warns only. */
export const CONTRAST_TEXT_MINIMUM = 4.5;
export const CONTRAST_NON_TEXT_MINIMUM = 3;
export const CONTRAST_ENHANCED_MINIMUM = 7;

/** What a pair's foreground is: text, a link, a button's label, a control's outline or the focus ring. */
export type ContrastPurpose = 'text' | 'link' | 'button-label' | 'control' | 'focus';

export interface ContrastPair {
  readonly foreground: ContrastToken;
  readonly background: ContrastToken;
  readonly purpose: ContrastPurpose;
  /** The minimum that refuses a save. */
  readonly required: typeof CONTRAST_TEXT_MINIMUM | typeof CONTRAST_NON_TEXT_MINIMUM;
  /** The 7:1 that warns only, for text; `null` for a non-text pair. */
  readonly enhanced: typeof CONTRAST_ENHANCED_MINIMUM | null;
}

const pair = (
  foreground: ContrastToken,
  background: ContrastToken,
  purpose: ContrastPurpose,
): ContrastPair =>
  Object.freeze({
    foreground,
    background,
    purpose,
    required:
      purpose === 'control' || purpose === 'focus'
        ? CONTRAST_NON_TEXT_MINIMUM
        : CONTRAST_TEXT_MINIMUM,
    enhanced: purpose === 'control' || purpose === 'focus' ? null : CONTRAST_ENHANCED_MINIMUM,
  });

/**
 * C160.4 (review F13): the pairs of each palette. Text (`ink`, `ink-muted`, `danger`) on `surface`
 * and `canvas`; `on-primary` on `primary`, `primary-hover`, `danger` and `danger-hover` (the danger
 * button's label is `on-primary`); `primary` on `surface` (links are underlined, so 1.4.1 never
 * rests on colour); `control` on `surface` and `canvas`; `focus` on `surface`, `canvas` and
 * `primary`.
 */
export const CONTRAST_PAIRS: readonly ContrastPair[] = Object.freeze([
  pair('ink', 'surface', 'text'),
  pair('ink', 'canvas', 'text'),
  pair('ink-muted', 'surface', 'text'),
  pair('ink-muted', 'canvas', 'text'),
  pair('danger', 'surface', 'text'),
  pair('danger', 'canvas', 'text'),
  pair('on-primary', 'primary', 'button-label'),
  pair('on-primary', 'primary-hover', 'button-label'),
  pair('on-primary', 'danger', 'button-label'),
  pair('on-primary', 'danger-hover', 'button-label'),
  pair('primary', 'surface', 'link'),
  pair('control', 'surface', 'control'),
  pair('control', 'canvas', 'control'),
  pair('focus', 'surface', 'focus'),
  pair('focus', 'canvas', 'focus'),
  pair('focus', 'primary', 'focus'),
]);

/**
 * One pair below its minimum (`fail`, which refuses the save with 422 `theme_contrast_insufficient`)
 * or a text pair below 7:1 (`warn`, which never blocks). `ratio` is never rounded.
 */
export interface ContrastFinding {
  readonly foreground: ContrastToken;
  readonly background: ContrastToken;
  readonly ratio: number;
  readonly required: number;
  readonly level: 'fail' | 'warn';
}

/**
 * Thrown by every function here until `api-themes` built the gate (Workflow 9B). Kept, with its
 * name and members, for callers that still name it; nothing here throws it any more.
 */
export class ContrastNotBuiltError extends Error {
  readonly owner = 'api-themes';
  /** How many inputs the stub was given; their values are never kept. */
  readonly inputs: number;

  constructor(name: string, inputs = 0) {
    super(`${name} is not built yet (api-themes, Workflow 9B)`);
    this.name = 'ContrastNotBuiltError';
    this.inputs = inputs;
  }
}

const HEX_COLOUR = /^#[0-9a-f]{6}$/;

/** One 8-bit sRGB channel, linearised: /12.92 at or below 0.04045, the 2.4 power above it. */
function linear(byte: number): number {
  const channel = byte / 255;
  return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
}

/**
 * WCAG 2.2's relative luminance of a `#rrggbb` colour (lower case, the only form a theme stores),
 * in [0, 1]: 0.2126 R + 0.7152 G + 0.0722 B over the linearised channels.
 * @throws {RangeError} for anything that is not `#rrggbb`.
 */
export function relativeLuminance(colour: string): number {
  if (!HEX_COLOUR.test(colour)) {
    throw new RangeError('A colour is #rrggbb, in lower case.');
  }
  const [red, green, blue] = [1, 3, 5].map((at) =>
    linear(Number.parseInt(colour.slice(at, at + 2), 16)),
  );
  return 0.2126 * (red ?? 0) + 0.7152 * (green ?? 0) + 0.0722 * (blue ?? 0);
}

/**
 * The contrast ratio of two `#rrggbb` colours, `(L1 + 0.05) / (L2 + 0.05)` with L1 the lighter, in
 * [1, 21] and never rounded, so 4.499 fails 4.5. The order of the two does not matter.
 * @throws {RangeError} for anything that is not `#rrggbb`.
 */
export function contrastRatio(foreground: string, background: string): number {
  const first = relativeLuminance(foreground);
  const second = relativeLuminance(background);
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

/**
 * Every finding of `palette` over `CONTRAST_PAIRS`, in their order: `fail` below the pair's
 * minimum, `warn` for a text pair at or above it but below 7:1; empty when every pair passes its
 * 7:1 too. A non-text pair (control, focus) never warns.
 * @throws {RangeError} for a token that is not `#rrggbb`.
 */
export function checkPaletteContrast(palette: ContrastPalette): ContrastFinding[] {
  const findings: ContrastFinding[] = [];
  for (const pair of CONTRAST_PAIRS) {
    const ratio = contrastRatio(palette[pair.foreground], palette[pair.background]);
    const level =
      ratio < pair.required
        ? 'fail'
        : pair.enhanced !== null && ratio < pair.enhanced
          ? 'warn'
          : null;
    if (level !== null) {
      findings.push({
        foreground: pair.foreground,
        background: pair.background,
        ratio,
        required: pair.required,
        level,
      });
    }
  }
  return findings;
}

// C160.4 (reviews F13, H29): the built-in palettes, the stylesheet's tokens as hex.
export {
  BUILTIN_PALETTE_VARIANTS,
  BUILTIN_PALETTES,
  type BuiltinPaletteVariant,
} from './builtin-palettes.js';
