// @vitest-environment node
/// <reference types="node" />
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/postcss';
import postcss from 'postcss';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const stylesPath = fileURLToPath(new URL('./styles.css', import.meta.url));

// A class that appears only in this test file. Tests must not leak utilities into app CSS.
const TEST_ONLY_CLASS = 'tracking-[0.123em]';

describe('@openverify/ui/styles.css', () => {
  let appDir: string;
  let css: string;

  beforeAll(async () => {
    // Compile the shared entry the way an app would, from an app directory that has no
    // sources of its own, so every component utility must come from the entry's @source.
    appDir = mkdtempSync(path.join(tmpdir(), 'openverify-ui-app-'));
    const result = await postcss([tailwindcss({ base: appDir })]).process(
      readFileSync(stylesPath, 'utf8'),
      { from: stylesPath },
    );
    css = result.css;
  });

  afterAll(() => {
    rmSync(appDir, { recursive: true, force: true });
  });

  it('is a full Tailwind CSS v4 entry (theme, preflight and utilities layers)', () => {
    expect(css).toContain('@layer theme, base, components, utilities;');
    expect(css).toMatch(/@layer base\s*{/);
  });

  it.each([
    'primary',
    'primary-hover',
    'on-primary',
    'danger',
    'surface',
    'canvas',
    'ink',
    'ink-muted',
    'line',
    'control',
    'focus',
  ])('defines the --color-%s design token', (token) => {
    expect(css).toMatch(new RegExp(`--color-${token}:\\s*#[0-9a-f]{6};`));
  });

  it.each([
    String.raw`.bg-primary`,
    String.raw`.text-on-primary`,
    String.raw`.bg-danger`,
    String.raw`.text-danger`,
    String.raw`.border-line`,
    String.raw`.border-control`,
    String.raw`.focus-visible\:outline-focus`,
  ])('generates %s for the shared components without the app scanning them', (selector) => {
    // The class may be followed by a pseudo-class (variants) but not by more of a longer name.
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    expect(css).toMatch(new RegExp(`${escaped}[\\s:{]`));
  });

  it('gives form controls a border of at least 3:1 against surface and canvas (Workflow 2D F010, WCAG 1.4.11)', () => {
    const control = luminanceOf(css, 'control');

    expect(contrast(control, luminanceOf(css, 'surface'))).toBeGreaterThanOrEqual(3);
    expect(contrast(control, luminanceOf(css, 'canvas'))).toBeGreaterThanOrEqual(3);
    // `line` stays for decorative separators: it is far below 3:1, so no control may use it.
    expect(contrast(luminanceOf(css, 'line'), luminanceOf(css, 'surface'))).toBeLessThan(3);
  });

  it('does not scan test files for class names', () => {
    expect(TEST_ONLY_CLASS).toBe('tracking-[0.123em]');
    expect(css).not.toContain(String.raw`.tracking-\[0\.123em\]`);
  });
});

/**
 * The relative luminance (WCAG 2) of the `--color-<token>: #rrggbb` the CSS defines (C160.4: the
 * tokens are stored as hex; the contrast gate in `@openverify/core` asserts every pair).
 */
function luminanceOf(css: string, token: string): number {
  const match = new RegExp(`--color-${token}:\\s*#([0-9a-f]{6});`).exec(css);
  if (match === null) {
    throw new Error(`--color-${token} is not a #rrggbb value`);
  }
  const hex = match[1] ?? '';
  const [red, green, blue] = [0, 2, 4].map((at) => {
    const channel = Number.parseInt(hex.slice(at, at + 2), 16) / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

/** The WCAG contrast ratio of two relative luminances. */
function contrast(first: number, second: number): number {
  const [darker, lighter] = [first, second].sort((x, y) => x - y) as [number, number];
  return (lighter + 0.05) / (darker + 0.05);
}
