/**
 * C60, C64.1 in the browser, against the mocked API: the document step. Its verification is made
 * when the screen opens, so the guidance's accepted documents (each with its window), formats and
 * page limit are named before the user picks a file. The file input takes only the accepted media
 * types; a camera capture takes images from the back camera. A picked file is shown by its name
 * and size only, never rendered, and uploaded as the type its bytes say; a refused file is said
 * where the user can pick another, with focus on the refusal when the server gave it.
 */
import { expect, test } from '@playwright/test';
import {
  API_ORIGIN,
  MockFlowApi,
  PHASE5_CONSENT_GIVEN,
  flowLink,
  phase5Flow,
} from './support/mock-flow-api';
import { collectUnexpectedErrors, expectTargetSize, heading, inLiveRegion } from './support/phase5';

/** A synthetic PDF: a header, then nothing a reader needs; it is never parsed here. */
const PDF = {
  name: 'alex-example-statement.pdf',
  mimeType: 'application/pdf',
  buffer: Buffer.from('%PDF-1.7\n%synthetic e2e document\n', 'latin1'),
};

/** A text file dressed as a PDF: its bytes are no accepted type. */
const NOT_A_PDF = {
  name: 'bill.pdf',
  mimeType: 'application/pdf',
  buffer: Buffer.from('just some text, not a document', 'utf8'),
};

function documentApi(): MockFlowApi {
  const api = new MockFlowApi();
  api.flow = phase5Flow('proof', {
    id: 'proof',
    type: 'document',
    documentTypes: ['utility_bill', 'bank_statement', 'lease', 'tax_document'],
    captureMethods: ['upload', 'camera'],
  });
  api.consent = { ...PHASE5_CONSENT_GIVEN, textKeys: [...PHASE5_CONSENT_GIVEN.textKeys] };
  return api;
}

test('uploads a PDF: the guidance read on opening, the accepted types only, the file shown by name and size, never rendered (C60, C64.1)', async ({
  page,
}) => {
  const errors = collectUnexpectedErrors(page);
  const api = documentApi();
  api.pendingPolls = 1;
  await api.install(page);
  await page.goto(flowLink());

  await expect(heading(page, 'Upload a document')).toBeFocused();
  await expect(page.getByText('Attempt 1 of 3')).toBeVisible();
  // C52.2: the attempt's verification is made on opening, and its guidance names the window.
  const accepted = page.getByRole('list', { name: 'You can upload one of these:' });
  await expect(accepted.getByRole('listitem')).toHaveText([
    'A utility bill dated within the last 90 days',
    'A bank statement dated within the last 90 days',
    'A lease or rental agreement that is still in force',
    'A tax document from the latest tax year',
  ]);
  await expect(
    page.getByText('Upload it as a PDF, JPEG, PNG, or WebP file of up to 10 MB.'),
  ).toBeVisible();
  await expect(page.getByText('A PDF can have up to 50 pages.')).toBeVisible();
  expect(api.verifications.map(({ type, status }) => [type, status])).toEqual([
    ['verification/document', 'initiated'],
  ]);

  const fileInput = page.getByLabel('Choose a file of your document', { exact: true });
  const cameraInput = page.getByLabel('Take a photo of your document', { exact: true });
  await expect(fileInput).toHaveAttribute(
    'accept',
    'application/pdf,image/jpeg,image/png,image/webp',
  );
  await expect(cameraInput).toHaveAttribute('accept', 'image/jpeg,image/png,image/webp');
  await expect(cameraInput).toHaveAttribute('capture', 'environment');
  const choose = page.getByRole('button', { name: 'Choose a file' });
  await expectTargetSize(choose);
  await expectTargetSize(page.getByRole('button', { name: 'Take a photo' }));

  // The button opens the file input itself, one file at a time.
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), choose.click()]);
  expect(chooser.isMultiple()).toBe(false);
  await chooser.setFiles(PDF);

  const summary = page.getByText(`Your file: ${PDF.name}, ${String(PDF.buffer.length)} bytes`);
  await expect(summary).toBeFocused();
  // C64.1: a PDF is never rendered, and no preview of the file is made.
  await expect(page.locator('img, iframe, object, embed, canvas, video')).toHaveCount(0);
  const upload = page.getByRole('button', { name: 'Upload this file' });
  await expectTargetSize(upload);
  await upload.click();

  await expect(heading(page, 'Checking your verification')).toBeFocused();
  await expect(heading(page, 'Verification submitted')).toBeFocused();
  // Named after its kind and its sniffed type, never the user's own file name.
  expect(
    api.uploads.map(({ kind, mimeType, fileName, size }) => [kind, mimeType, fileName, size]),
  ).toEqual([['document', 'application/pdf', 'document.pdf', PDF.buffer.length]]);
  expect(api.submits).toEqual([{ verificationId: api.verifications[0]?.id, body: null }]);
  expect(errors).toEqual([]);
});

test('refuses a file that is no accepted type before sending it, and the server’s 413, with focus on its words (C52.4, WCAG 2.2 AA)', async ({
  page,
}) => {
  const errors = collectUnexpectedErrors(page);
  const api = documentApi();
  api.refusedUploads.push(413);
  await api.install(page);
  await page.goto(flowLink());
  const fileInput = page.getByLabel('Choose a file of your document', { exact: true });
  await expect(page.getByText('A utility bill dated within the last 90 days')).toBeVisible();

  await fileInput.setInputFiles(NOT_A_PDF);
  const refusal = page.getByRole('alert');
  await expect(refusal).toHaveText(
    'We cannot use this type of file. Choose a PDF, JPEG, PNG, or WebP file.',
  );
  await expect(page.getByRole('button', { name: 'Upload this file' })).toHaveCount(0);
  expect(api.uploads).toEqual([]);

  await fileInput.setInputFiles(PDF);
  await page.getByRole('button', { name: 'Upload this file' }).click();
  await expect(refusal).toHaveText(
    'This file is larger than 10 MB. Choose a smaller file, such as a photo of the document or a PDF with fewer pages.',
  );
  await expect(refusal).toBeFocused();

  await fileInput.setInputFiles(PDF);
  await page.getByRole('button', { name: 'Upload this file' }).click();
  await expect(heading(page, 'Verification submitted')).toBeVisible();
  expect(api.uploads).toHaveLength(1);
  expect(errors).toEqual([]);
});

test('says the upload is under way in a live region, then asks again with the reason the last document failed (C64.1, C51.2)', async ({
  page,
}) => {
  const errors = collectUnexpectedErrors(page);
  const api = documentApi();
  api.decisions.push({
    status: 'failed',
    hints: [{ name: 'document_recency_detection', reasons: ['document_too_old'] }],
  });
  await api.install(page);
  // Workflow 5C review P023: the upload's answer is held until the status has been read, so the
  // live region is checked on every run, never skipped because the mock answered at once.
  let release: () => void = () => undefined;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(`${API_ORIGIN}/api/v1/flow/verifications/*/files`, async (route) => {
    await held;
    await route.fallback();
  });
  await page.goto(flowLink());

  await page.getByLabel('Choose a file of your document', { exact: true }).setInputFiles(PDF);
  await page.getByRole('button', { name: 'Upload this file' }).click();
  const status = page.getByText('Uploading your document…');
  await expect(status).toBeVisible();
  expect(await inLiveRegion(status)).toBe(true);
  release();

  await expect(page.getByText('Attempt 2 of 3')).toBeVisible();
  const hint = page.getByRole('alert');
  await expect(hint).toContainText('Your last attempt did not go through');
  await expect(hint).toContainText('Your document is too old. Upload a more recent one.');
  expect(api.verifications.map(({ status: verificationStatus }) => verificationStatus)).toEqual([
    'failed',
    'initiated',
  ]);
  expect(errors).toEqual([]);
});

test('offers no camera when the guidance accepts PDFs only, and names the guidance’s own window and page limit (C52.2, C64.1)', async ({
  page,
}) => {
  const errors = collectUnexpectedErrors(page);
  const api = documentApi();
  api.documentGuidance = {
    'accepted-types': ['utility_bill'],
    'max-age-days': 30,
    'max-pages': 4,
    'accepted-mime-types': ['application/pdf'],
  };
  await api.install(page);
  await page.goto(flowLink());

  await expect(page.getByRole('listitem')).toHaveText([
    'A utility bill dated within the last 30 days',
  ]);
  await expect(page.getByText('Upload it as a PDF file of up to 10 MB.')).toBeVisible();
  await expect(page.getByText('A PDF can have up to 4 pages.')).toBeVisible();
  await expect(page.getByLabel('Take a photo of your document', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Take a photo' })).toHaveCount(0);
  await expect(page.getByLabel('Choose a file of your document', { exact: true })).toHaveAttribute(
    'accept',
    'application/pdf',
  );
  expect(errors).toEqual([]);
});

test('speaks Spanish (C64.1)', async ({ page }) => {
  const errors = collectUnexpectedErrors(page);
  const api = documentApi();
  await api.install(page);
  await page.goto(`/?lang=es${flowLink()}`.replace('/#', '#'));

  await expect(heading(page, 'Sube un documento')).toBeVisible();
  await expect(
    page.getByText('Una factura de servicios con fecha de los últimos 90 días'),
  ).toBeVisible();
  await expect(
    page.getByText('Súbelo como archivo PDF, JPEG, PNG o WebP de hasta 10 MB.'),
  ).toBeVisible();
  await page.getByLabel('Elige un archivo de tu documento', { exact: true }).setInputFiles(PDF);
  await expect(
    page.getByText(`Tu archivo: ${PDF.name}, ${String(PDF.buffer.length)} bytes`),
  ).toBeFocused();
  await expect(page.getByRole('button', { name: 'Subir este archivo' })).toBeVisible();
  expect(errors).toEqual([]);
});
