// @vitest-environment node
/**
 * C173.3 under C142.5's rules (8C Stage 1 amendment 32): the inquiry, report and verification pages
 * each print as themselves through their own stylesheet, every rule inside `@media print` and read
 * through the page's own mark, so no other page's printout changes. jsdom applies no print styles,
 * so this reads each stylesheet and its page; the full-stack spec prints in Chromium.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const app = join(dirname(fileURLToPath(import.meta.url)), '../../app');
const read = (path: string) => {
  try {
    return readFileSync(join(app, path), 'utf8');
  } catch {
    return '';
  }
};

describe.each([
  ['inquiry', 'inquiries/[id]'],
  ['report', 'reports/[id]'],
  ['verification', 'verifications/[id]'],
] as const)('the %s print view', (kind, folder) => {
  const css = read(`${folder}/print.css`).trim();
  const mark = `[data-${kind}-print]`;

  it('is imported by its page', () => {
    expect(read(`${folder}/page.tsx`)).toMatch(/^import '\.\/print\.css';$/m);
  });

  it('keeps every rule inside @media print', () => {
    const outside = css.replace(/\/\*[\s\S]*?\*\//g, '').trim();
    expect(outside).toMatch(/^@media print\s*\{[\s\S]*\}$/);
  });

  it('hides the navigation, the header and every control only on its own page, and shows its footer', () => {
    for (const selector of ['nav', 'header', '[data-live-region]', 'button', 'form']) {
      expect(css).toContain(`body:has(${mark}) ${selector}`);
    }
    expect(css).toMatch(
      new RegExp(`\\[data-${kind}-print-footer\\][^{]*\\{[^}]*display:\\s*block`),
    );
  });
});
