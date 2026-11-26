// @vitest-environment node
/**
 * C198.2, C221.8 (Workflow 10A, api-android-10a; review F10): `contracts/fixtures/theme/
 * builtin-palettes.json`, the built-in light and dark palettes of `styles.css` as hex, which the
 * Android SDK reads as its default theme, so web and Android start from the same colours. The light
 * palette is `@theme static`, the dark one the flow's `:root[data-openverify-variant='dark']`;
 * `@openverify/core`'s contrast test holds `BUILTIN_PALETTES` to the same stylesheet.
 *
 * Assert-only (C221.8): the test fails when the committed file differs from what the stylesheet
 * gives, and writes the file only under `UPDATE_CONTRACT_FIXTURES=1`, so a plain `pnpm test`
 * never changes the working tree.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const STYLES = fileURLToPath(new URL('./styles.css', import.meta.url));
const FILE = path.resolve(
  path.dirname(STYLES),
  '../../../contracts/fixtures/theme/builtin-palettes.json',
);

/** The twelve colour tokens of a palette (C160.3), in the stylesheet's order. */
const TOKENS = [
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

const HEX = /^#[0-9a-f]{6}$/;

/** The `--color-<token>: <value>` declarations of the CSS block `block`, in order. */
function declarations(block: string): [string, string][] {
  return [...block.matchAll(/--color-([a-z-]+):\s*([^;]+);/g)].map((match): [string, string] => [
    match[1] ?? '',
    (match[2] ?? '').trim(),
  ]);
}

/** One palette of the stylesheet: exactly the twelve tokens, each a lower-case `#rrggbb`. */
function paletteOf(css: string, selector: RegExp): Record<string, string> {
  const block = selector.exec(css)?.[1];
  if (block === undefined) {
    throw new Error(`no block ${selector.source} in styles.css`);
  }
  const found = declarations(block);
  const names = found.map(([name]) => name);
  if (names.join(',') !== TOKENS.join(',')) {
    throw new Error(`the block declares ${names.join(', ')}, not the twelve tokens`);
  }
  const wrong = found.filter(([, value]) => !HEX.test(value));
  if (wrong.length > 0) {
    throw new Error(`not #rrggbb: ${wrong.map(([name]) => name).join(', ')}`);
  }
  return Object.fromEntries(found);
}

function builtinPalettesExport(css: string): Record<string, unknown> {
  return {
    format: 1,
    description:
      "C160.3, C198.2: the built-in light and dark palettes of packages/ui/src/styles.css as hex (light: @theme static; dark: :root[data-openverify-variant='dark'], the flow's), the twelve tokens in order; BUILTIN_PALETTES of @openverify/core is held to the same stylesheet. Written by packages/ui/src/export-palettes.test.ts with UPDATE_CONTRACT_FIXTURES=1; never edited by hand. The Android SDK's default theme.",
    tokens: [...TOKENS],
    light: paletteOf(css, /@theme static \{([^}]*)\}/),
    dark: paletteOf(css, /:root\[data-openverify-variant='dark'\] \{([^}]*)\}/),
  };
}

/** The file as the repository's Prettier prints it: objects expanded, the token list one per line. */
function printed(value: Record<string, unknown>): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

describe('contracts/fixtures/theme/builtin-palettes.json (C198.2)', () => {
  const css = readFileSync(STYLES, 'utf8');

  it('holds both palettes over the twelve tokens, as lower-case hex', () => {
    const exported = builtinPalettesExport(css) as {
      tokens: string[];
      light: Record<string, string>;
      dark: Record<string, string>;
    };
    expect(exported.tokens).toEqual([...TOKENS]);
    for (const palette of [exported.light, exported.dark]) {
      expect(Object.keys(palette)).toEqual([...TOKENS]);
      expect(Object.values(palette).every((colour) => HEX.test(colour))).toBe(true);
    }
    expect(exported.light.surface).toBe('#ffffff');
    expect(exported.dark).not.toEqual(exported.light);
  });

  it('refuses a stylesheet whose palette is not the twelve hex tokens', () => {
    const light = /@theme static \{([^}]*)\}/;
    expect(() => paletteOf('@theme static { --color-primary: #1447e6; }', light)).toThrow(
      /not the twelve tokens/,
    );
    expect(() =>
      paletteOf(css.replace('--color-focus: #000000;', '--color-focus: oklch(0 0 0);'), light),
    ).toThrow(/not #rrggbb: focus/);
    expect(() => paletteOf('', light)).toThrow(/no block/);
  });

  it('is the committed file', () => {
    const expected = printed(builtinPalettesExport(css));
    if (process.env.UPDATE_CONTRACT_FIXTURES === '1') {
      writeFileSync(FILE, expected);
    }
    expect(existsSync(FILE) ? readFileSync(FILE, 'utf8') : null).toBe(expected);
  });
});
