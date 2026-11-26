import { expect, test } from '@playwright/test';
import { expectAccessible } from './support/accessible';

// C171.2 (Workflow 9A Stage 1b (A11Y)): the helper every step's states call. It runs axe with the
// WCAG 2.0-2.2 A and AA tags, fails on any violation, and attaches the incomplete results for the
// manual pass. Synthetic pages only, so this checks the helper, never the flow.

const PAGE = (body: string) =>
  `<!doctype html><html lang="en"><head><title>Synthetic</title></head><body><main>${body}</main></body></html>`;

test('passes a page with no violation and attaches its incomplete results', async ({ page }) => {
  await page.setContent(PAGE('<h1>Synthetic page</h1><p>Nothing to fix.</p>'));

  await expectAccessible(page, { where: 'synthetic-clean' });

  expect(test.info().attachments.map(({ name }) => name)).toContain('axe-incomplete');
});

test('fails a violation with its rule, impact and target', async ({ page }) => {
  await page.setContent(PAGE('<h1>Synthetic page</h1><img src="data:," class="logo">'));

  await expect(expectAccessible(page, { where: 'synthetic-violation' })).rejects.toThrow(
    /image-alt \(critical\) at img: /,
  );
});

test('checks only what include names, and nothing exclude names', async ({ page }) => {
  await page.setContent(
    PAGE(
      '<h1>Synthetic page</h1><section id="clean"><p>Fine.</p></section><img src="data:," class="logo">',
    ),
  );

  await expectAccessible(page, { include: '#clean', where: 'synthetic-include' });
  await expectAccessible(page, { exclude: 'img.logo', where: 'synthetic-exclude' });
});
