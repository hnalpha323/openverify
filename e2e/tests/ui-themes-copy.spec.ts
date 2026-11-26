/**
 * Workflow 9C (`dashboard-themes-copy`): theme sets and translations in the console on the full
 * stack (C160, C161.5, C162; C178.4's console specs). Budget: 90 s per test.
 *
 * 1. A developer edits a theme set: a palette the contrast gate refuses is listed with its pairs,
 *    an accepted one is saved as a revision, an earlier revision is restored, and a logo made by
 *    code is uploaded through the vision rendition.
 * 2. A developer opens a template's translations: the machine-drafted Arabic catalog says so, the
 *    CSV download neutralises a formula-like text, an edited file is imported into the draft (the
 *    text read back unchanged), a file with an unknown column is refused by row and column, and the
 *    theme tab shows the draft's picker.
 *
 * Every page is checked by axe at each state and records zero `securitypolicyviolation` events under
 * the console's real header. Every object is made inside the spec and ended in `afterAll`; the
 * operator signs in through `signInAs`. No OTP is sent and no setting is changed.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { readStackInfo } from '../src/stack-info.js';
import { expectAccessible } from './support/accessible.js';
import { parseCsv, syntheticPng } from './support/platform-9b.js';
import { recordCspViolations } from './support/ui-graph.js';
import {
  ARABIC_TEXT,
  COPY_KEY,
  FORMULA_TEXT,
  archiveSpecTemplate,
  archiveSpecThemeSet,
  csvRecord,
  specCopyTemplate,
  specThemeSet,
  themesCopySuffix,
  type CopyTemplate,
} from './support/ui-themes-copy.js';
import { signInAs } from './support/ui.js';

const suffix = themesCopySuffix();
let themeSetId: string | undefined;
let copyTemplate: CopyTemplate | undefined;

test.beforeAll(async () => {
  test.setTimeout(60_000);
  const stack = readStackInfo();
  themeSetId = await specThemeSet(stack, suffix);
  copyTemplate = await specCopyTemplate(stack, suffix);
});

test.afterAll(async () => {
  const stack = readStackInfo();
  await archiveSpecThemeSet(stack, themeSetId);
  await archiveSpecTemplate(stack, copyTemplate);
});

function made<T>(value: T | undefined): T {
  if (value === undefined) {
    throw new Error('beforeAll made nothing');
  }
  return value;
}

async function expectNoViolations(read: () => Promise<string[]>) {
  expect(await read()).toEqual([]);
}

const inkField = (page: Page) =>
  page.getByRole('group', { name: 'Light palette' }).getByRole('textbox', { name: 'Ink (text)' });

test('a palette refused with its pairs, an accepted one saved and restored from a revision, a logo uploaded (C160)', async ({
  page,
}) => {
  test.setTimeout(90_000);
  const stack = readStackInfo();
  const id = made(themeSetId);
  const violations = await recordCspViolations(page);
  await signInAs(page, stack, 'developer');

  await page.goto(`${stack.dashboardUrl}/theme-sets?status=active`);
  await expect(page.getByRole('heading', { level: 1, name: 'Theme sets' })).toBeVisible();
  await expectAccessible(page, { where: '/theme-sets' });

  await page.goto(`${stack.dashboardUrl}/theme-sets/${id}`);
  await expect(
    page.getByRole('heading', { level: 1, name: `e2e ui theme ${suffix}` }),
  ).toBeVisible();
  await expect(
    page.getByText(/Revision 1: flows that use this set render this revision/),
  ).toBeVisible();
  await expect(page.getByRole('group', { name: 'Theme set actions' })).toMatchAriaSnapshot(`
    - group "Theme set actions":
      - button "Duplicate"
      - button "Archive"
  `);
  await expectAccessible(page, { where: '/theme-sets/[id]' });

  // Live: the gate's own function, unrounded; then the API's refusal with its pairs.
  await inkField(page).fill('#cccccc');
  const light = page.getByRole('table', { name: 'Light palette: every pair the gate checks' });
  await expect(light.locator('tr[data-level="fail"]').first()).toContainText('Fails');
  await page.getByRole('button', { name: 'Save styles' }).click();
  const refused = page.getByRole('alert').filter({ hasText: 'The API refused the save' });
  await expect(refused).toContainText('ink on surface');
  await expect(refused).toContainText('/data/attributes/styles/light/palette/ink');
  await expectAccessible(page, { where: '/theme-sets/[id] refused' });

  await inkField(page).fill('#101828');
  await page.getByRole('button', { name: 'Save styles' }).click();
  await expect(page.getByText('Saved as revision 2.')).toBeVisible();
  await expect(page.getByText(/Revision 2: flows that use this set render/)).toBeVisible();

  const revisions = page.getByRole('table', { name: 'Revisions' });
  await revisions.getByRole('button', { name: 'Restore 1' }).click();
  const dialog = page.getByRole('dialog', { name: 'Restore revision 1?' });
  await expectAccessible(page, { where: '/theme-sets/[id] restore dialog' });
  await dialog.getByRole('button', { name: 'Restore' }).click();
  await expect(page.getByText(/Revision 3: flows that use this set render/)).toBeVisible();
  await expect(revisions.getByText('Restored from revision 1')).toBeVisible();

  const logo = join(tmpdir(), `e2e-ui-logo-${suffix}.png`);
  writeFileSync(logo, syntheticPng(96, 32));
  const upload = page.getByRole('form', { name: 'Logo and font files' });
  await upload.locator('input[type="file"]').setInputFiles(logo);
  await upload.getByRole('button', { name: 'Upload' }).click();
  await expect(upload.getByText(/The logo was stored as tsa_/)).toBeVisible({ timeout: 30_000 });
  await expectAccessible(page, { where: '/theme-sets/[id] uploaded' });

  await expectNoViolations(violations);
});

test('translations: the machine-drafted locale said, a CSV round trip with the formula cell neutralised, a refused file by row and column (C161.5, C162)', async ({
  page,
}) => {
  test.setTimeout(90_000);
  const stack = readStackInfo();
  const { templateId } = made(copyTemplate);
  const violations = await recordCspViolations(page);
  await signInAs(page, stack, 'developer');

  await page.goto(`${stack.dashboardUrl}/templates/${templateId}/translations`);
  await expect(page.getByRole('heading', { level: 1, name: 'Translations' })).toBeVisible();
  const status = page.getByRole('table', { name: 'Review status of the built-in texts' });
  await expect(status.getByRole('row', { name: /Arabic/ })).toContainText('Machine-drafted');
  await expect(status.getByRole('row', { name: /English/ })).toContainText('Source language');
  await expect(page.getByRole('textbox', { name: `${COPY_KEY}, en` })).toHaveValue(FORMULA_TEXT);
  await expectAccessible(page, { where: '/templates/[id]/translations' });

  const downloading = page.waitForEvent('download');
  await page.getByRole('link', { name: 'Download translations.csv' }).click();
  const file = await (await downloading).path();
  const exported = readFileSync(file, 'utf8');
  const [header = [], row = []] = parseCsv(exported);
  expect(header).toEqual(['step', 'component', 'attribute', 'en', 'ar']);
  expect(row[2]).toBe(COPY_KEY);
  // C107: the formula-like text is written so a spreadsheet never runs it.
  expect(row[3]).not.toBe(FORMULA_TEXT);
  expect(row[3]).toContain(FORMULA_TEXT);

  const edited = join(tmpdir(), `e2e-ui-translations-${suffix}.csv`);
  writeFileSync(
    edited,
    [
      csvRecord(header),
      csvRecord([row[0] ?? '', row[1] ?? '', COPY_KEY, row[3] ?? '', ARABIC_TEXT]),
    ].join('\r\n'),
  );
  const importForm = page.getByRole('form', { name: 'Import CSV' });
  await importForm.getByLabel('CSV file').setInputFiles(edited);
  await importForm.getByRole('button', { name: 'Import CSV' }).click();
  await expect(page.getByText(/The file was imported into the draft/)).toBeVisible();
  await page.reload();
  await expect(page.getByRole('textbox', { name: `${COPY_KEY}, en` })).toHaveValue(FORMULA_TEXT);
  await expect(page.getByRole('textbox', { name: `${COPY_KEY}, ar` })).toHaveValue(ARABIC_TEXT);

  const broken = join(tmpdir(), `e2e-ui-translations-broken-${suffix}.csv`);
  writeFileSync(
    broken,
    [
      csvRecord(['step', 'component', 'attribute', 'xx']),
      csvRecord(['', '', COPY_KEY, 'synthetic']),
    ].join('\r\n'),
  );
  await importForm.getByLabel('CSV file').setInputFiles(broken);
  await importForm.getByRole('button', { name: 'Import CSV' }).click();
  const refusal = page.getByRole('alert').filter({ hasText: 'The file was refused' });
  await expect(refusal).toContainText('Header: A column is not a built-in language.');
  await expect(refusal).not.toContainText('synthetic');
  await expectAccessible(page, { where: '/templates/[id]/translations refused' });

  await page.goto(`${stack.dashboardUrl}/templates/${templateId}/theme`);
  await expect(page.getByRole('heading', { level: 1, name: 'Theme' })).toBeVisible();
  await expect(
    page.getByRole('form', { name: 'Theme' }).getByRole('combobox', { name: 'Theme set' }),
  ).toBeEnabled();
  await expectAccessible(page, { where: '/templates/[id]/theme' });

  await expectNoViolations(violations);
});
