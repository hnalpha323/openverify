/**
 * C160.4 (reviews F13, H29; `api-themes`, Workflow 9B): the built-in light and dark palettes, the
 * hex tokens of `packages/ui/src/styles.css`, as one typed constant. Phase 10 (C221.8) generates
 * `contracts/fixtures/theme/builtin-palettes.json` from it, and the API resolves an absent cell of a
 * theme set's palette to it (C160.3). Keep the name and its shape stable.
 *
 * - **light** is the stylesheet's former `oklch()` tokens converted once, as Chromium 156 renders
 *   them (a 2D canvas filled with each value and read back with `getImageData`, 8-bit sRGB; review
 *   H29: what a browser renders, not our own OKLab conversion), except `focus`: the converted
 *   `#155dfc` is 1.30:1 on `primary` (`#1447e6`), below the 3:1 C160.4 asks of `focus` on
 *   `primary`, and only a near-black passes it while keeping 3:1 on white, so `focus` is `#000000`
 *   (3.07:1 on `primary`, 21:1 on `surface`). The record is `docs/themes/README.md`.
 * - **dark** is ours (review F13), checked by the same gate. In the stylesheet it applies only under
 *   `:root[data-openverify-variant='dark']`, which only the flow sets, so the console keeps its
 *   light look.
 */
import type { ContrastPalette } from './index.js';

/** The two built-in variants. */
export const BUILTIN_PALETTE_VARIANTS = Object.freeze(['light', 'dark'] as const);
export type BuiltinPaletteVariant = (typeof BUILTIN_PALETTE_VARIANTS)[number];

const LIGHT: ContrastPalette = Object.freeze({
  primary: '#1447e6',
  'primary-hover': '#193cb8',
  'on-primary': '#ffffff',
  danger: '#c10007',
  'danger-hover': '#9f0712',
  surface: '#ffffff',
  canvas: '#f9fafb',
  ink: '#101828',
  'ink-muted': '#4a5565',
  line: '#d1d5dc',
  control: '#6a7282',
  focus: '#000000',
});

const DARK: ContrastPalette = Object.freeze({
  primary: '#3b8bff',
  'primary-hover': '#8ec5ff',
  'on-primary': '#030712',
  danger: '#ff6467',
  'danger-hover': '#ffa2a2',
  surface: '#101828',
  canvas: '#030712',
  ink: '#f9fafb',
  'ink-muted': '#99a1af',
  line: '#364153',
  control: '#6a7282',
  focus: '#ffffff',
});

/** The built-in palettes, each a complete `#rrggbb` palette over the twelve tokens. */
export const BUILTIN_PALETTES: Readonly<Record<BuiltinPaletteVariant, ContrastPalette>> =
  Object.freeze({ light: LIGHT, dark: DARK });
