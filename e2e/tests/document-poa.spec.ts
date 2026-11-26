/**
 * C60, C65.5 (Workflow 5B): proof of address, full stack, on the generated C65.2 set (synthetic
 * bills of a synthetic holder, `fixtures/generated/poa/`). Each inquiry is prefilled with the
 * sidecar's `inquiry_fields`, the reference the name and address comparisons read (C60.6). Vision
 * parses every PDF in its guarded child (C60.2) and the worker judges the analysis.
 * - A current bill uploaded in the hosted flow passes; the console lists its preview, a PNG
 *   vision rendered of page 1, and serves the original PDF as an attachment only.
 * - A bill whose amount is hidden under a white box fails the advisory fabrication check with
 *   its components (a strong cue), and the verification still passes.
 * - A bill dated 200 days back fails `document_too_old` with a retry hint, the inquiry stays open,
 *   and a current bill then passes it.
 */
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { DEFAULT_DOCUMENT_CHECKS } from '@openverify/contracts';
import { expect, test } from '@playwright/test';
import { poaFixture } from '../src/paths.js';
import { readStackInfo } from '../src/stack-info.js';
import { collectConsoleErrors, giveConsent } from './support/flow.js';
import { phase5Template, typeConfig } from './support/phase5.js';
import {
  consoleFileContent,
  consoleFiles,
  phase5bFlow,
  startPrefilledInquiry,
} from './support/phase5b.js';
import {
  flowApi,
  giveFlowConsent,
  recordingClient,
  settledFlowVerification,
} from './support/platform.js';
import { sessionTokenAs } from './support/ui.js';

const BILL = poaFixture('en/utility-bill/happy.pdf');
const COVERED = poaFixture('en/utility-bill/edited-covered-amount.pdf');
const TOO_OLD = poaFixture('en/utility-bill/too-old.pdf');

/** A proof-of-address step taking a bill or a bank statement as an upload. */
const TEMPLATE_STEPS: Parameters<typeof phase5Template>[1] = [
  {
    id: 'proof',
    type: 'document',
    documentTypes: ['utility_bill', 'bank_statement'],
    captureMethods: ['upload'],
  },
];
const CONFIG = { document: typeConfig(DEFAULT_DOCUMENT_CHECKS) };

/** The holder the bills are addressed to, as the sidecar gives the inquiry's fields. */
async function holderFields(): Promise<Record<string, string>> {
  const sidecar = JSON.parse(await readFile(poaFixture('en/utility-bill/happy.json'), 'utf8')) as {
    inquiry_fields: Record<string, string>;
  };
  return sidecar.inquiry_fields;
}

async function prefilledInquiry(name: string) {
  const stack = readStackInfo();
  const run = randomUUID();
  return startPrefilledInquiry(
    stack,
    phase5Template(`e2e-${name}-${run}`, TEMPLATE_STEPS, CONFIG),
    `e2e-${name}-${run}`,
    await holderFields(),
  );
}

/** A document attempt through the flow API: create, upload `file`, submit, wait for the decision. */
async function documentAttempt(sessionToken: string, file: string) {
  const stack = readStackInfo();
  const phase5b = phase5bFlow(stack, sessionToken);
  const verificationId = await phase5b.create('document');
  await phase5b.upload(verificationId, 'document', await readFile(file));
  await phase5b.submit(verificationId);
  const settled = await settledFlowVerification(
    flowApi(stack.apiUrl, sessionToken),
    verificationId,
    60_000,
  );
  return { verificationId, settled };
}

async function serverVerification(verificationId: string) {
  const stack = readStackInfo();
  const { client } = recordingClient(stack.apiUrl, stack.apiKey);
  const { data } = await client.verifications.retrieve(verificationId);
  return {
    status: data.attributes.status,
    checks: Object.fromEntries(data.attributes.checks.map((check) => [check.name, check])),
    attributes: data.attributes as Record<string, unknown>,
  };
}

async function inquiryStatus(inquiryId: string): Promise<string> {
  const stack = readStackInfo();
  const { client } = recordingClient(stack.apiUrl, stack.apiKey);
  return (await client.inquiries.retrieve(inquiryId)).data.attributes.status;
}

test('a current bill uploaded in the hosted flow passes, with a PNG preview and the PDF served as an attachment (C60, C64.1)', async ({
  page,
}) => {
  const stack = readStackInfo();
  const { inquiryId, flowUrl } = await prefilledInquiry('document-poa');
  const errors = collectConsoleErrors(page);
  await page.goto(flowUrl);
  await giveConsent(page);
  await expect(page.getByRole('heading', { level: 1, name: 'Upload a document' })).toBeVisible();
  await page.getByLabel('Choose a file of your document', { exact: true }).setInputFiles(BILL);
  await expect(page.getByText(/^Your file: /)).toBeVisible();
  await page.getByRole('button', { name: 'Upload this file' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Verification submitted' })).toBeVisible(
    { timeout: 60_000 },
  );
  expect(errors).toEqual([]);
  await expect.poll(() => inquiryStatus(inquiryId)).toBe('completed');

  const { client } = recordingClient(stack.apiUrl, stack.apiKey);
  const document = await client.inquiries.retrieve(inquiryId, { include: 'verifications' });
  const [verification] = document.included ?? [];
  const { status, checks, attributes } = await serverVerification(verification?.id ?? '');
  expect(status).toBe('passed');
  for (const name of [
    'document_type_detection',
    'document_extracted_properties_detection',
    'document_recency_detection',
    'document_name_comparison',
  ]) {
    expect(checks[name], name).toMatchObject({ status: 'passed', requirement: 'required' });
  }
  expect(checks.document_name_comparison?.metadata).toMatchObject({
    'reference-source': 'inquiry',
  });
  expect(checks.document_type_detection).toMatchObject({ stage: 'beta' });
  expect(attributes).toMatchObject({
    'document-type': 'utility_bill',
    'page-count': 1,
    'mime-type': 'application/pdf',
  });

  // C52.4, C66: the console lists the upload and the preview; the PDF comes as an attachment.
  const token = await sessionTokenAs(stack, 'reviewer');
  const files = await consoleFiles(stack, token, inquiryId);
  const pdf = files.find((file) => file.kind === 'document');
  const preview = files.find((file) => file.kind === 'document-preview');
  expect(pdf).toMatchObject({ mimeType: 'application/pdf' });
  expect(preview).toMatchObject({ mimeType: 'image/png' });
  const image = await consoleFileContent(stack, token, preview?.id ?? '');
  expect(image.status).toBe(200);
  expect(image.headers.get('content-type')).toBe('image/png');
  expect([...image.bytes.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  expect(image.headers.get('content-disposition')).toBeNull();
  const original = await consoleFileContent(stack, token, pdf?.id ?? '');
  expect(original.status).toBe(200);
  expect(original.headers.get('content-disposition')).toBe(
    `attachment; filename="document-${pdf?.id ?? ''}.pdf"`,
  );
  expect(new TextDecoder().decode(original.bytes.subarray(0, 5))).toBe('%PDF-');
});

test('text hidden under a white box over the amount fails the advisory fabrication check with its components, and the bill still passes (C60.6)', async () => {
  const stack = readStackInfo();
  const { inquiryId, sessionToken } = await prefilledInquiry('document-covered');
  await giveFlowConsent(flowApi(stack.apiUrl, sessionToken));
  const { verificationId, settled } = await documentAttempt(sessionToken, COVERED);
  expect(settled.attributes.status).toBe('passed');

  const { checks } = await serverVerification(verificationId);
  const fabrication = checks.document_fabrication_detection;
  expect(fabrication).toMatchObject({
    status: 'failed',
    requirement: 'not_required',
    stage: 'beta',
    reasons: expect.arrayContaining(['pdf_hidden_text']),
    metadata: {
      components: expect.arrayContaining([
        expect.objectContaining({ id: 'hidden-text-over-field', strength: 'strong' }),
      ]) as unknown,
    },
  });
  expect(fabrication?.confidence).toBeGreaterThan(0);
  expect(fabrication?.confidence).toBeLessThanOrEqual(0.6);
  await expect.poll(() => inquiryStatus(inquiryId)).toBe('completed');
});

test('a bill dated 200 days back fails document_too_old with a retry hint, and a current bill then passes (C60.6)', async () => {
  const stack = readStackInfo();
  const { inquiryId, sessionToken } = await prefilledInquiry('document-too-old');
  await giveFlowConsent(flowApi(stack.apiUrl, sessionToken));

  const old = await documentAttempt(sessionToken, TOO_OLD);
  expect(old.settled.attributes.status).toBe('failed');
  expect(old.settled.attributes['retry-hints']).toEqual([
    { name: 'document_recency_detection', reasons: ['document_too_old'] },
  ]);
  const { checks } = await serverVerification(old.verificationId);
  expect(checks.document_recency_detection).toMatchObject({
    status: 'failed',
    reasons: ['document_too_old'],
  });
  expect(await inquiryStatus(inquiryId)).toBe('pending');

  const fresh = await documentAttempt(sessionToken, BILL);
  expect(fresh.settled.attributes.status).toBe('passed');
  await expect.poll(() => inquiryStatus(inquiryId)).toBe('completed');
});
