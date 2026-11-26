/**
 * C160.4 (Workflow 9A Stage 1a, (H); built by `api-themes` in Workflow 9B): the contrast gate's
 * frozen pairs, its vectors (`#000000` on `#ffffff` 21, `#767676` 4.542, `#949494` 3.033, engineering
 * note [B2]) and the built-in palettes' pairs, asserted by the same function the API runs on every
 * save (review F13), against the hex tokens of `packages/ui/src/styles.css` (review H29).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import * as core from '../index.js';
import {
  CONTRAST_ENHANCED_MINIMUM,
  CONTRAST_NON_TEXT_MINIMUM,
  CONTRAST_PAIRS,
  CONTRAST_PALETTE_TOKENS,
  CONTRAST_TEXT_MINIMUM,
  BUILTIN_PALETTES,
  BUILTIN_PALETTE_VARIANTS,
  checkPaletteContrast,
  contrastRatio,
  relativeLuminance,
  type ContrastPair,
  type ContrastPalette,
} from './index.js';

describe('the contrast pairs (C160.4, review F13)', () => {
  it('reads the stylesheet twelve colour tokens', () => {
    expect(CONTRAST_PALETTE_TOKENS).toEqual([
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
    ]);
  });

  it('uses the WCAG 2.2 minimums, 4.5 for text, 3 for non-text and 7 to warn', () => {
    expect([CONTRAST_TEXT_MINIMUM, CONTRAST_NON_TEXT_MINIMUM, CONTRAST_ENHANCED_MINIMUM]).toEqual([
      4.5, 3, 7,
    ]);
  });

  it('checks exactly the sixteen pairs of each palette, and never line', () => {
    expect(
      CONTRAST_PAIRS.map((pair: ContrastPair) => [
        pair.foreground,
        pair.background,
        pair.required,
        pair.enhanced,
      ]),
    ).toEqual([
      ['ink', 'surface', 4.5, 7],
      ['ink', 'canvas', 4.5, 7],
      ['ink-muted', 'surface', 4.5, 7],
      ['ink-muted', 'canvas', 4.5, 7],
      ['danger', 'surface', 4.5, 7],
      ['danger', 'canvas', 4.5, 7],
      ['on-primary', 'primary', 4.5, 7],
      ['on-primary', 'primary-hover', 4.5, 7],
      ['on-primary', 'danger', 4.5, 7],
      ['on-primary', 'danger-hover', 4.5, 7],
      ['primary', 'surface', 4.5, 7],
      ['control', 'surface', 3, null],
      ['control', 'canvas', 3, null],
      ['focus', 'surface', 3, null],
      ['focus', 'canvas', 3, null],
      ['focus', 'primary', 3, null],
    ]);
    expect(Object.isFrozen(CONTRAST_PAIRS)).toBe(true);
    expect(CONTRAST_PAIRS.every((pair: ContrastPair) => Object.isFrozen(pair))).toBe(true);
    expect(
      CONTRAST_PAIRS.some(
        (pair: ContrastPair) => pair.foreground === 'line' || pair.background === 'line',
      ),
    ).toBe(false);
  });

  it('is exported by the package', () => {
    expect(core).toHaveProperty('checkPaletteContrast');
    expect(core).toHaveProperty('CONTRAST_PAIRS');
  });
});

/** A complete palette with every token `colour`. */
const flat = (colour: string): ContrastPalette =>
  Object.fromEntries(CONTRAST_PALETTE_TOKENS.map((token) => [token, colour])) as ContrastPalette;

describe('relative luminance (WCAG 2.2, 8-bit sRGB)', () => {
  it.each([
    ['#000000', 0],
    ['#ffffff', 1],
    ['#ff0000', 0.2126],
    ['#00ff00', 0.7152],
    ['#0000ff', 0.0722],
  ])('%s is %d', (colour, luminance) => {
    expect(relativeLuminance(colour)).toBeCloseTo(luminance, 12);
  });

  it('linearises below the 0.04045 threshold by /12.92 and above it by the 2.4 power', () => {
    // 10/255 = 0.0392 is below the threshold; 11/255 = 0.0431 above it.
    expect(relativeLuminance('#0a0a0a')).toBeCloseTo(10 / 255 / 12.92, 15);
    expect(relativeLuminance('#0b0b0b')).toBeCloseTo(((11 / 255 + 0.055) / 1.055) ** 2.4, 15);
  });

  it.each(['#fff', '#GGGGGG', '000000', '#0000000', 'red', 'rgb(0,0,0)', 'var(--x)', ''])(
    'refuses %j, which is not #rrggbb',
    (colour) => {
      expect(() => relativeLuminance(colour)).toThrow(RangeError);
    },
  );
});

describe('the contrast ratio (L1 + 0.05) / (L2 + 0.05), never rounded', () => {
  it.each([
    ['#000000', '#ffffff', 21, 21.0001],
    ['#767676', '#ffffff', 4.542, 4.55],
    ['#949494', '#ffffff', 3.033, 3.04],
  ])('%s on %s is %d', (foreground, background, low, high) => {
    const ratio = contrastRatio(foreground, background);
    expect(ratio).toBeGreaterThanOrEqual(low);
    expect(ratio).toBeLessThan(high);
    expect(ratio.toFixed(3)).toBe(low.toFixed(3));
  });

  it('is the same either way round, and 1 for a colour on itself', () => {
    expect(contrastRatio('#ffffff', '#767676')).toBe(contrastRatio('#767676', '#ffffff'));
    expect(contrastRatio('#1f4fd1', '#1f4fd1')).toBe(1);
  });

  it('keeps every digit, so a ratio just under 4.5 still fails it', () => {
    // #777777 on white is 4.478..., which toFixed(1) would show as 4.5.
    const ratio = contrastRatio('#777777', '#ffffff');
    expect(ratio).toBeLessThan(CONTRAST_TEXT_MINIMUM);
    expect(ratio).toBeGreaterThan(4.47);
    const findings = checkPaletteContrast({
      ...flat('#ffffff'),
      ink: '#777777',
      'ink-muted': '#000000',
      danger: '#000000',
      primary: '#000000',
      control: '#000000',
      focus: '#000000',
      'primary-hover': '#000000',
      'danger-hover': '#000000',
      canvas: '#ffffff',
    });
    expect(findings).toContainEqual({
      foreground: 'ink',
      background: 'surface',
      ratio,
      required: 4.5,
      level: 'fail',
    });
  });
});

describe('checkPaletteContrast over the sixteen pairs (C160.4)', () => {
  it('fails every pair of a palette of one colour, in pair order, each with ratio 1', () => {
    const findings = checkPaletteContrast(flat('#777777'));
    expect(findings.map(({ foreground, background }) => [foreground, background])).toEqual(
      CONTRAST_PAIRS.map((pair: ContrastPair) => [pair.foreground, pair.background]),
    );
    expect(findings.every((finding) => finding.level === 'fail' && finding.ratio === 1)).toBe(true);
    expect(findings.map(({ required }) => required)).toEqual(
      CONTRAST_PAIRS.map((pair: ContrastPair) => pair.required),
    );
  });

  it('warns, never fails, a text pair at or above its minimum but below 7:1', () => {
    const palette = { ...BUILTIN_PALETTES.light, ink: '#666666' };
    const ratio = contrastRatio('#666666', BUILTIN_PALETTES.light.surface);
    expect(ratio).toBeGreaterThanOrEqual(CONTRAST_TEXT_MINIMUM);
    expect(ratio).toBeLessThan(CONTRAST_ENHANCED_MINIMUM);
    expect(checkPaletteContrast(palette)).toContainEqual({
      foreground: 'ink',
      background: 'surface',
      ratio,
      required: 4.5,
      level: 'warn',
    });
  });

  it('never warns a non-text pair, whose minimum is 3 and which has no enhanced level', () => {
    const findings = checkPaletteContrast(BUILTIN_PALETTES.light);
    expect(findings.filter((finding) => finding.required === CONTRAST_NON_TEXT_MINIMUM)).toEqual(
      [],
    );
  });

  it('is empty for a palette whose every pair passes 7:1', () => {
    const palette: ContrastPalette = {
      ...flat('#000000'),
      surface: '#ffffff',
      canvas: '#ffffff',
      'on-primary': '#ffffff',
      primary: '#000000',
      focus: '#000000',
    };
    // focus on primary is #000000 on #000000: the one failing pair.
    expect(checkPaletteContrast(palette)).toEqual([
      { foreground: 'focus', background: 'primary', ratio: 1, required: 3, level: 'fail' },
    ]);
  });

  it('refuses a palette with a colour that is not #rrggbb', () => {
    expect(() => checkPaletteContrast({ ...flat('#000000'), ink: 'red' })).toThrow(RangeError);
  });
});

/** The `--color-<token>: #rrggbb` declarations of one CSS block. */
function declarations(block: string): Record<string, string> {
  return Object.fromEntries(
    [...block.matchAll(/--color-([a-z-]+):\s*([^;]+);/g)].map((match): [string, string] => [
      match[1] ?? '',
      (match[2] ?? '').trim(),
    ]),
  );
}

describe('the built-in palettes (C160.4; reviews F13, H29)', () => {
  const css = readFileSync(
    fileURLToPath(new URL('../../../ui/src/styles.css', import.meta.url)),
    'utf8',
  );
  const light = /@theme static \{([^}]*)\}/.exec(css)?.[1] ?? '';
  const dark = /:root\[data-openverify-variant='dark'\] \{([^}]*)\}/.exec(css)?.[1] ?? '';

  it('holds a light and a dark palette over the twelve tokens', () => {
    expect(BUILTIN_PALETTE_VARIANTS).toEqual(['light', 'dark']);
    for (const variant of BUILTIN_PALETTE_VARIANTS) {
      expect(Object.keys(BUILTIN_PALETTES[variant])).toEqual([...CONTRAST_PALETTE_TOKENS]);
      expect(
        Object.values(BUILTIN_PALETTES[variant]).every((colour) => /^#[0-9a-f]{6}$/.test(colour)),
      ).toBe(true);
    }
    expect(Object.isFrozen(BUILTIN_PALETTES)).toBe(true);
    expect(BUILTIN_PALETTES.dark).not.toEqual(BUILTIN_PALETTES.light);
  });

  it.each(BUILTIN_PALETTE_VARIANTS)('the %s palette passes every pair of the gate', (variant) => {
    expect(
      checkPaletteContrast(BUILTIN_PALETTES[variant]).filter(({ level }) => level === 'fail'),
    ).toEqual([]);
  });

  it('is what the stylesheet stores, as hex: light in @theme static, dark for the flow only', () => {
    expect(declarations(light)).toEqual(BUILTIN_PALETTES.light);
    expect(declarations(dark)).toEqual(BUILTIN_PALETTES.dark);
    expect(css).not.toMatch(/--color-[a-z-]+:\s*oklch\(/);
  });
});
