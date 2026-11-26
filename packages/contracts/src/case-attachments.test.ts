import { describe, expect, it } from 'vitest';
import {
  CASE_ATTACHMENT_BODY_PII_MEMBERS,
  PII_CASE_ATTACHMENT_ATTRIBUTES,
  base64DecodedLength,
  buildCaseAttachment,
  caseAttachmentContentPath,
  caseAttachmentParamsSchema,
  caseAttachmentSchema,
  caseAttachmentUploadsSchema,
  fileRenditionParamsSchema,
  renditionPageQuerySchema,
  renditionPendingDocumentSchema,
  type CaseAttachmentRecord,
} from './case-attachments.js';
import { updateCaseBodySchema } from './cases.js';
import { readFixture } from './test-support.js';

const CASE = 'case_01M5CN00000000000000000001';
const ATTACHMENT = 'catt_01M5CN00000000000000000019';
const AT = new Date('2026-10-20T12:00:00.000Z');
const LATER = new Date('2026-10-20T12:05:00.000Z');

/** The golden case's attachment, read alone so this file stands without the case schema. */
const golden = readFixture('api/case.json') as {
  data: { attributes: { attachments: readonly unknown[] } };
};
const served = caseAttachmentSchema.parse(golden.data.attributes.attachments[0]);

const record: CaseAttachmentRecord = {
  id: ATTACHMENT,
  caseId: CASE,
  filename: 'synthetic-statement.pdf',
  byteSize: 48213,
  attachmentType: 'pdf',
  scanStatus: 'clean',
  scanProvider: 'sandbox',
  scannedAt: LATER,
  renditionStatus: 'ready',
  pageCount: 2,
  createdAt: AT,
};

const fits = (patch: Record<string, unknown>) =>
  caseAttachmentSchema.safeParse({ ...served, ...patch }).success;

describe('case attachments (C135)', () => {
  it('builds the golden attachment, its url the content route', () => {
    expect(buildCaseAttachment(record)).toEqual(served);
    expect(served.url).toBe(caseAttachmentContentPath(CASE, ATTACHMENT));
  });

  it('serves no storage url and no other route as the url (C135.4)', () => {
    expect(fits({ url: 'https://storage.example.com/bucket/key' })).toBe(false);
    expect(fits({ url: `/api/v1/cases/${CASE}/attachments/${ATTACHMENT}/original` })).toBe(false);
  });

  it('takes a null filename, masked or redacted, and lists it for the masks (P34, C143.5)', () => {
    expect(fits({ filename: null })).toBe(true);
    expect(buildCaseAttachment({ ...record, filename: null }).filename).toBeNull();
    expect(PII_CASE_ATTACHMENT_ATTRIBUTES).toEqual(['filename']);
    expect(CASE_ATTACHMENT_BODY_PII_MEMBERS).toEqual(['data', 'filename']);
  });

  it('refuses clean without the scanner that said so, and a provider without a scan (H20)', () => {
    expect(fits({ 'scan-provider': null })).toBe(false);
    expect(fits({ 'scan-status': 'not_scanned', 'scan-provider': null, 'scanned-at': null })).toBe(
      true,
    );
    expect(fits({ 'scan-status': 'not_scanned', 'scanned-at': null })).toBe(false);
    expect(fits({ 'scan-status': 'pending', 'scanned-at': null })).toBe(true);
    expect(fits({ 'scan-status': 'pending' })).toBe(false);
    expect(fits({ 'scan-status': 'infected', 'scan-provider': 'clamd' })).toBe(true);
    expect(fits({ 'scan-status': 'clean', 'scanned-at': null })).toBe(false);
    expect(fits({ 'scan-status': 'error', 'scanned-at': null })).toBe(true);
    expect(fits({ 'scan-provider': 'none' })).toBe(false);
  });

  it('has its pages exactly when its rendition is ready (C135.3)', () => {
    expect(fits({ 'rendition-status': 'pending', 'page-count': null })).toBe(true);
    expect(fits({ 'rendition-status': 'deleted', 'page-count': null })).toBe(true);
    expect(fits({ 'rendition-status': 'pending' })).toBe(false);
    expect(fits({ 'page-count': null })).toBe(false);
    expect(fits({ 'page-count': 21 })).toBe(false);
  });

  it('holds an attachment to 10 MiB and its four types (decision 62)', () => {
    expect(fits({ 'byte-size': 10 * 1024 * 1024 })).toBe(true);
    expect(fits({ 'byte-size': 10 * 1024 * 1024 + 1 })).toBe(false);
    expect(fits({ 'attachment-type': 'gif' })).toBe(false);
  });

  it('takes PATCH attachments within 10 MiB decoded in all (C135.1, H31)', () => {
    const upload = (bytes: number) => ({
      data: Buffer.alloc(bytes, 7).toString('base64'),
      filename: 'synthetic.png',
    });
    expect(base64DecodedLength(upload(10).data)).toBe(10);
    expect(base64DecodedLength(upload(11).data)).toBe(11);
    expect(base64DecodedLength(upload(12).data)).toBe(12);
    expect(caseAttachmentUploadsSchema.safeParse([upload(16)]).success).toBe(true);
    expect(
      caseAttachmentUploadsSchema.safeParse([upload(6 * 1024 * 1024), upload(4 * 1024 * 1024)])
        .success,
    ).toBe(true);
    expect(
      caseAttachmentUploadsSchema.safeParse([upload(6 * 1024 * 1024), upload(4 * 1024 * 1024 + 1)])
        .success,
    ).toBe(false);
    expect(caseAttachmentUploadsSchema.safeParse([]).success).toBe(false);
    expect(
      caseAttachmentUploadsSchema.safeParse([{ data: 'not base64!', filename: 'x.png' }]).success,
    ).toBe(false);
    expect(
      updateCaseBodySchema.safeParse({ data: { attributes: { attachments: [upload(16)] } } })
        .success,
    ).toBe(true);
  });

  it('reads the attachment routes by camelCase parameters and a 1-based page', () => {
    expect(
      caseAttachmentParamsSchema.safeParse({ id: CASE, attachmentId: ATTACHMENT }).success,
    ).toBe(true);
    expect(
      caseAttachmentParamsSchema.safeParse({ id: CASE, 'attachment-id': ATTACHMENT }).success,
    ).toBe(false);
    expect(renditionPageQuerySchema.parse({ page: '2' })).toEqual({ page: 2 });
    expect(renditionPageQuerySchema.safeParse({ page: '0' }).success).toBe(false);
    expect(renditionPageQuerySchema.safeParse({ page: '21' }).success).toBe(false);
    expect(
      fileRenditionParamsSchema.safeParse({ id: 'file_01M5CN00000000000000000021' }).success,
    ).toBe(true);
  });

  it('answers a rendition not made yet with the time to ask again (C135.3)', () => {
    expect(
      renditionPendingDocumentSchema.parse(readFixture('api/case-rendition-pending.json')),
    ).toEqual({ meta: { 'rendition-status': 'pending', 'retry-after-seconds': 5 } });
    expect(
      renditionPendingDocumentSchema.safeParse({
        meta: { 'rendition-status': 'ready', 'retry-after-seconds': 5 },
      }).success,
    ).toBe(false);
  });
});
