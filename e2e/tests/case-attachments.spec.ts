/**
 * C135, C146.3 (Workflow 8B): an attachment uploaded to a case, scanned by the sandbox scanner and
 * downloaded as a rendition without EXIF. Budget: 90 s.
 *
 * The upload is a synthetic JPEG carrying an EXIF segment with a GPS IFD and a description canary.
 * The worker's sandbox scanner reads it clean (only the EICAR string is infected); the API, bound to
 * the same scanner by name, holds it at 409 until then (C135.5). Vision re-encodes it from a fresh
 * copy of its pixels, so the rendition the content route serves has no APP1 segment and no canary,
 * while the sealed original keeps both (P23: only `cases:redact` reads it).
 */
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { OpenVerifyApiError, type CaseFileContent } from '@openverify/node';
import { expect, test } from '@playwright/test';
import { FIXTURES } from '../src/paths.js';
import { readStackInfo } from '../src/stack-info.js';
import { APP1_MARKER, jpegMarkers, publishedCaseTemplate, withGpsExif } from './support/cases.js';
import { adminClient } from './support/workflows.js';

const CANARY = 'synthetic-gps-canary';

test('an attachment is scanned by the sandbox scanner and downloaded as a rendition without EXIF (C135, C146.3)', async () => {
  test.setTimeout(90_000);
  const stack = readStackInfo();
  const admin = await adminClient(stack);
  const run = randomUUID().slice(0, 8);
  const template = await publishedCaseTemplate(admin, `e2e-case-attachments-${run}`);
  const { data: made } = await admin.cases.create({ 'case-template-id': template.id });
  const original = withGpsExif(readFileSync(FIXTURES.idBack), CANARY);
  expect(jpegMarkers(original)).toContain(APP1_MARKER);

  const { data: uploaded } = await admin.cases.uploadAttachment(made.id, {
    bytes: original,
    filename: `synthetic-gps-${run}.jpg`,
    mimeType: 'image/jpeg',
  });
  const attachment = uploaded.attributes.attachments.at(-1);
  expect(attachment).toMatchObject({
    'attachment-type': 'jpeg',
    'scan-provider': 'sandbox',
    'byte-size': original.byteLength,
  });
  const attachmentId = attachment?.id ?? '';

  // 409 while the scan is pending, 202 while the rendition is made, then the rendition.
  let rendition: CaseFileContent | undefined;
  await expect
    .poll(
      async () => {
        try {
          const content = await admin.cases.attachmentContent(made.id, attachmentId);
          if (content.mimeType?.startsWith('image/') === true) {
            rendition = content;
          }
          return content.mimeType;
        } catch (error) {
          if (error instanceof OpenVerifyApiError && error.status === 409) {
            return 'scan pending';
          }
          throw error;
        }
      },
      { timeout: 60_000, intervals: [500, 1_000, 2_000] },
    )
    .toBe('image/jpeg');

  const bytes = rendition?.bytes ?? new Uint8Array();
  expect(jpegMarkers(bytes)).not.toContain(APP1_MARKER);
  expect(Buffer.from(bytes).includes(Buffer.from(CANARY))).toBe(false);
  const { data: served } = await admin.cases.retrieve(made.id);
  expect(served.attributes.attachments.find(({ id }) => id === attachmentId)).toMatchObject({
    'scan-status': 'clean',
    'scan-provider': 'sandbox',
    'rendition-status': 'ready',
    'page-count': 1,
  });

  // The sealed original keeps what the rendition dropped.
  const kept = await admin.cases.attachmentOriginal(made.id, attachmentId);
  expect(Buffer.from(kept.bytes).includes(Buffer.from(CANARY))).toBe(true);
});
