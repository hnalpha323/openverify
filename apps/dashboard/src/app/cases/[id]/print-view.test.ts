// @vitest-environment node
/**
 * C142.5 (editor note 6.4): the case page prints as itself through `@media print` and `@page`, with
 * the navigation, the toasts and every control hidden, each image kept with its caption, and the
 * footer shown. jsdom applies no print styles, so this reads the stylesheet the page imports; the
 * full-stack spec prints the page in Chromium with print media emulated.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, 'print.css'), 'utf8');
const page = readFileSync(join(here, 'page.tsx'), 'utf8');

/** The rules inside the stylesheet's `@media print` block. */
const printRules = /@media print\s*\{([\s\S]*)\}\s*$/.exec(css.trim())?.[1] ?? '';

describe('the case print view (C142.5)', () => {
  it('is imported by the case page', () => {
    expect(page).toMatch(/^import '\.\/print\.css';$/m);
  });

  it('sets the printed page and its margins', () => {
    expect(printRules).toMatch(/@page\s*\{[^}]*margin:/);
  });

  it('hides the navigation, the header, the toasts and every control, only on a case page', () => {
    for (const selector of ['nav', 'header', '[data-live-region]', 'button', 'form']) {
      expect(printRules).toContain(`body:has([data-case-print]) ${selector}`);
    }
    expect(printRules).toMatch(/display:\s*none\s*!important/);
  });

  it('keeps each image with its caption, and shows the footer', () => {
    expect(printRules).toMatch(/\[data-case-print\] figure[^{]*\{[^}]*break-inside:\s*avoid/);
    expect(printRules).toMatch(/\[data-case-print-footer\][^{]*\{[^}]*display:\s*block/);
  });
});
