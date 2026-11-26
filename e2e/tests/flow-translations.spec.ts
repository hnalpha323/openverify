/**
 * C178.4, C162.7 (Workflow 9A): a template's translations exported as CSV and imported again on the
 * full stack. Budget: 90 s.
 *
 * A draft of a new template enables `en` and `ar` and overrides two texts: an English one that
 * starts with `=` (a formula to a spreadsheet) and an Arabic one. The CSV export neutralises the
 * formula cell (C107's writer), and importing the file unchanged writes the draft with the texts
 * as they were, the formula's text and the Arabic text included, and publishes nothing. Every
 * value is synthetic.
 */
import { randomUUID } from 'node:crypto';
import { defaultInquiryTemplateAttributes } from '@openverify/contracts';
import { expect, test } from '@playwright/test';
import { readStackInfo } from '../src/stack-info.js';
import { recordingClient } from './support/platform.js';

const FORMULA = '=SUM(1,2) is not a formula';
const ARABIC = 'تم إرسال طلب التحقق';

test('a template’s translations survive a CSV export and import unchanged, the formula cell neutralised (C162.7)', async () => {
  test.setTimeout(90_000);
  const stack = readStackInfo();
  const { client } = recordingClient(stack.apiUrl, stack.apiKey);
  const defaults = defaultInquiryTemplateAttributes();
  const { data: template } = await client.inquiryTemplates.create({
    ...defaults,
    name: `e2e translations ${randomUUID().slice(0, 8)}`,
  });
  const { data: draft } = await client.inquiryTemplateVersions.create({
    'inquiry-template-id': template.id,
    flow: defaults.flow,
    'verification-config': defaults['verification-config'],
    'enabled-locales': ['en', 'ar'],
    copy: { messages: { en: { 'completion.title': FORMULA }, ar: { 'completion.title': ARABIC } } },
  } as never);

  const csvUrl = `${stack.apiUrl}/api/v1/inquiry-templates/${template.id}/translations.csv`;
  const headers = { authorization: `Bearer ${stack.apiKey}` };
  const exported = await fetch(csvUrl, { headers });
  expect(exported.status).toBe(200);
  expect(exported.headers.get('content-type')).toMatch(/^text\/csv/);
  const csv = await exported.text();
  expect(csv.split('\r\n')[0]).toBe('"step","component","attribute","en","ar"');
  // C107: a cell a spreadsheet would run is written so it never runs.
  expect(csv).not.toContain(`"${FORMULA}"`);
  expect(csv).toContain(ARABIC);

  const imported = await fetch(csvUrl, {
    method: 'POST',
    headers: { ...headers, 'content-type': 'text/csv' },
    body: csv,
  });
  expect(imported.status, await imported.clone().text()).toBe(200);

  const { data: read } = await client.inquiryTemplateTranslations.retrieve(template.id);
  const values = read.attributes.translations.flatMap((row) =>
    row['locale-values'].map(({ locale, value }) => [locale, value]),
  );
  expect(values).toEqual(
    expect.arrayContaining([
      ['en', FORMULA],
      ['ar', ARABIC],
    ]),
  );
  // The import wrote the draft and published nothing.
  const { data: version } = await client.inquiryTemplateVersions.retrieve(draft.id);
  expect(version.attributes.status).toBe('draft');
});
