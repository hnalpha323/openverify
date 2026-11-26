/**
 * Workflow 7B Stage 3 (`api-transactions`; C105.2, C105.4, P12, P22): a `file` field's content
 * through `PUT /transactions/:id/files/:fieldKey`, read back through the audited content route.
 * The pinned version is read before the body, the body is capped at the field's
 * `max-file-size-bytes`, the type comes from the bytes' signature, the object is sealed, and a
 * replacement deletes the object it replaced. Every byte is synthetic.
 *
 * Workflow 11B (ingestion-11b; the owner decisions after Workflow 7B, "Later phases"): a field that
 * limits pages has a PDF's pages counted by vision's guarded child (`POST /v1/count/document-pages`),
 * never in this process. The app here gets a fake counter that counts the synthetic PDFs' page
 * objects as the old in-process count did, answers 422 `pdf_unprocessable` for none, and can be
 * made to fail as vision would.
 */
import { eventAttributesSchema } from '@openverify/contracts';
import { redactTransactionRecords } from '@openverify/db';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { VisionPageCount, VisionPageCounter } from '../../ports.js';
import { VisionServiceError, VisionUnavailableError } from '../../vision/index.js';
import { createInquiryTestApi, type InquiryTestApi } from '../inquiries.test-support.js';
import { purgeRedactedTransactionFiles } from '../redaction.js';
import { bearer, multipart } from '../../test-support/harness.js';

let api: InquiryTestApi;

/** What the fake vision counter does next; `count` reads the synthetic page objects. */
let visionAnswer: 'count' | Error = 'count';
const countedDocuments: Uint8Array[] = [];
const countDocumentPages: VisionPageCounter['countDocumentPages'] = ({ document }) => {
  countedDocuments.push(document.bytes);
  if (visionAnswer !== 'count') {
    return Promise.reject(visionAnswer);
  }
  const pages =
    Buffer.from(document.bytes)
      .toString('latin1')
      .match(/\/Type\s*\/Page(?![A-Za-z])/g)?.length ?? 0;
  return pages === 0
    ? Promise.reject(new VisionServiceError('/v1/count/document-pages', 422, 'pdf_unprocessable'))
    : Promise.resolve<VisionPageCount>({ pageCount: pages });
};

beforeAll(async () => {
  api = await createInquiryTestApi({
    vision: {
      createRendition: () => Promise.reject(new Error('unused')),
      countDocumentPages,
    },
  });
});

afterAll(async () => {
  await api.close();
});

interface Resource {
  id: string;
  attributes: Record<string, unknown>;
}

const FIELDS = [
  {
    type: 'file',
    key: 'statement',
    label: 'Statement',
    config: { 'max-file-size-bytes': 200, 'supported-mime-types': ['application/pdf'] },
  },
  {
    type: 'file',
    key: 'contract',
    label: 'Contract',
    config: { 'write-policy': 'write_once' },
  },
  {
    type: 'file',
    key: 'pages',
    label: 'Pages',
    config: { 'page-count-limit-enabled': true, 'page-count-max': 1 },
  },
  { type: 'string', key: 'note', label: 'Note' },
];

/** A synthetic PDF with `pages` page objects, padded to `size` bytes. */
function pdf(pages = 1, size = 0): Buffer {
  const objects = Array.from(
    { length: pages },
    (_, index) => `${String(index + 3)} 0 obj << /Type /Page >> endobj\n`,
  );
  const text = `%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\n2 0 obj << /Type /Pages >> endobj\n${objects.join('')}%%EOF\n`;
  return Buffer.from(text.padEnd(Math.max(size, text.length), ' '));
}

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

let transactionId: string;

beforeAll(async () => {
  const created = await api.app.inject({
    method: 'POST',
    url: '/api/v1/transaction-types',
    headers: bearer(api.token),
    payload: {
      data: {
        type: 'transaction-type',
        attributes: { name: 'Synthetic', 'field-schemas': FIELDS },
      },
    },
  });
  const typeId = created.json<{ data: Resource }>().data.id;
  const result = await api.database.db.execute(
    sql`select id from transaction_type_versions where transaction_type_id = ${typeId}`,
  );
  const versionId = (result as unknown as { rows: { id: string }[] }).rows[0]?.id ?? '';
  await api.app.inject({
    method: 'POST',
    url: `/api/v1/transaction-type-versions/${versionId}/publish`,
    headers: bearer(api.token),
  });
  transactionId = (await newTransaction(typeId)).id;
  typeIdForTests = typeId;
});

let typeIdForTests: string;

async function newTransaction(typeId: string) {
  const response = await api.app.inject({
    method: 'POST',
    url: '/api/v1/transactions',
    headers: bearer(api.token),
    payload: { data: { type: 'transaction', attributes: { 'transaction-type-id': typeId } } },
  });
  expect(response.statusCode).toBe(201);
  return response.json<{ data: Resource }>().data;
}

async function upload(id: string, fieldKey: string, bytes: Buffer, filename = 'synthetic.pdf') {
  const form = await multipart({ file: { filename, bytes } });
  return api.app.inject({
    method: 'PUT',
    url: `/api/v1/transactions/${id}/files/${fieldKey}`,
    headers: { ...bearer(api.token), ...form.headers },
    payload: form.payload,
  });
}

const content = (id: string, fileId: string, token = api.token) =>
  api.app.inject({
    url: `/api/v1/transactions/${id}/files/${fileId}/content`,
    headers: bearer(token),
  });

const codeOf = (response: { json: () => unknown }) => (response.json() as { code?: string }).code;

describe('uploading a file field (C105.2, P22)', () => {
  it('seals the content, serves the value without a URL, and reads it back audited', async () => {
    const bytes = pdf();
    const response = await upload(transactionId, 'statement', bytes, 'synthetic-statement.pdf');

    expect(response.statusCode).toBe(200);
    const value = (
      response.json<{ data: Resource }>().data.attributes.fields as Record<
        string,
        { type: string; value: Record<string, unknown> }
      >
    ).statement;
    expect(value).toMatchObject({
      type: 'file',
      value: {
        filename: 'synthetic-statement.pdf',
        'byte-size': bytes.length,
        'mime-type': 'application/pdf',
      },
    });
    const fileId = String(value?.value['file-id']);
    expect(fileId).toMatch(/^txnf_/);
    for (const key of api.storage.keys()) {
      const stored = await api.storage.get(key);
      expect(Buffer.from(stored ?? []).includes(Buffer.from('%PDF-1.4'))).toBe(false);
    }
    const event = api.events.named('transaction.updated-fields').at(-1);
    expect(
      eventAttributesSchema.safeParse({
        name: 'transaction.updated-fields',
        payload: event?.payload,
        'created-at': new Date().toISOString(),
      }).success,
    ).toBe(true);

    const read = await content(transactionId, fileId);
    expect(read.statusCode).toBe(200);
    expect(read.rawPayload.equals(bytes)).toBe(true);
    expect(read.headers['content-type']).toBe('application/pdf');
    expect(read.headers['cache-control']).toBe('private, no-store');
    expect(api.audit.withAction('transaction-file.viewed').at(-1)).toMatchObject({
      resourceType: 'transaction-file',
      resourceId: fileId,
    });
  });

  it('refuses content beyond the field’s cap (413) and of a type it does not take (422)', async () => {
    const big = await upload(transactionId, 'statement', pdf(1, 400));
    expect(big.statusCode).toBe(413);
    expect(codeOf(big)).toBe('transaction_file_too_large');

    const png = await upload(transactionId, 'statement', PNG, 'synthetic.png');
    expect(png.statusCode).toBe(422);
    expect(codeOf(png)).toBe('transaction_file_refused');
  });

  it('refuses a field that is not a file field of the pinned version', async () => {
    const response = await upload(transactionId, 'note', pdf());
    expect(response.statusCode).toBe(422);
    expect(codeOf(response)).toBe('field_schema_invalid');
  });

  it('refuses a PDF past the page count, and one whose pages cannot be counted', async () => {
    const two = await upload(transactionId, 'pages', pdf(2));
    expect(two.statusCode).toBe(422);
    expect(codeOf(two)).toBe('transaction_file_refused');
    const uncounted = await upload(transactionId, 'pages', Buffer.from('%PDF-1.7\n%%EOF\n'));
    expect(codeOf(uncounted)).toBe('transaction_file_refused');
    expect((await upload(transactionId, 'pages', pdf(1))).statusCode).toBe(200);
  });

  it('counts pages with vision only for a PDF of a field that limits pages (Workflow 11B)', async () => {
    countedDocuments.length = 0;
    expect((await upload(transactionId, 'statement', pdf())).statusCode).toBe(200);
    expect((await upload(transactionId, 'pages', PNG, 'synthetic.png')).statusCode).toBe(200);
    expect(countedDocuments).toEqual([]);
    const counted = pdf(1);
    expect((await upload(transactionId, 'pages', counted)).statusCode).toBe(200);
    expect(countedDocuments.map((bytes) => Buffer.from(bytes))).toEqual([counted]);
  });

  it('answers a retryable 503 while vision cannot count, never a pass (Workflow 11B)', async () => {
    try {
      for (const failure of [
        new VisionUnavailableError('/v1/count/document-pages', 'timeout'),
        new VisionServiceError('/v1/count/document-pages', 503, 'guarded_worker_failed'),
      ]) {
        visionAnswer = failure;
        const response = await upload(transactionId, 'pages', pdf(1));
        expect(response.statusCode).toBe(503);
        expect(response.headers['retry-after']).toBe('30');
      }
      visionAnswer = new VisionServiceError('/v1/count/document-pages', 422, 'pdf_encrypted');
      expect(codeOf(await upload(transactionId, 'pages', pdf(1)))).toBe('transaction_file_refused');
    } finally {
      visionAnswer = 'count';
    }
  });

  it('replaces a field’s file, deleting the object it replaced, but never a write_once one', async () => {
    const own = await newTransaction(typeIdForTests);
    await upload(own.id, 'statement', pdf());
    const before = new Set(api.storage.keys());
    await upload(own.id, 'statement', pdf(1, 50));
    const after = new Set(api.storage.keys());
    expect([...after].filter((key) => !before.has(key))).toHaveLength(1);
    expect([...before].filter((key) => !after.has(key))).toHaveLength(1);

    expect((await upload(own.id, 'contract', pdf())).statusCode).toBe(200);
    const again = await upload(own.id, 'contract', pdf(1, 60));
    expect(again.statusCode).toBe(409);
    expect(codeOf(again)).toBe('field_write_once');
  });

  describe('a replaced file whose object could not be deleted (K7B-5, owner decision 9)', () => {
    const uploadedFileId = async (id: string, key: string) => {
      const rows = await api.database.db.execute(
        sql`select id, storage_key, deleted_at, redacted_at, filename from transaction_files
             where transaction_id = ${id} and field_key = ${key} order by created_at, id`,
      );
      return (
        rows as unknown as {
          rows: {
            id: string;
            storage_key: string;
            deleted_at: Date | null;
            redacted_at: Date | null;
            filename: string | null;
          }[];
        }
      ).rows;
    };

    async function replacedWithFailingDelete() {
      const own = await newTransaction(typeIdForTests);
      await upload(own.id, 'statement', pdf());
      const [first] = await uploadedFileId(own.id, 'statement');
      const realDelete = api.storage.delete.bind(api.storage);
      api.storage.delete = () => Promise.reject(new Error('storage is down'));
      try {
        expect((await upload(own.id, 'statement', pdf(1, 50))).statusCode).toBe(200);
      } finally {
        api.storage.delete = realDelete;
      }
      return { own, first };
    }

    it('keeps the row findable, its name gone, until the object is gone', async () => {
      const { own, first } = await replacedWithFailingDelete();

      const [replaced, live] = await uploadedFileId(own.id, 'statement');

      expect(replaced).toMatchObject({ id: first?.id, deleted_at: null, filename: null });
      expect(replaced?.redacted_at).not.toBeNull();
      expect(live).toMatchObject({ deleted_at: null, redacted_at: null });
      expect(api.storage.keys()).toContain(first?.storage_key);
    });

    it('is finished by the C16 pass, and the row then reads deleted', async () => {
      const { own, first } = await replacedWithFailingDelete();

      await purgeRedactedTransactionFiles({ db: api.database.db, storage: api.storage });

      expect(api.storage.keys()).not.toContain(first?.storage_key);
      const [replaced] = await uploadedFileId(own.id, 'statement');
      expect(replaced?.deleted_at).not.toBeNull();
    });

    it('is reached by a redaction of the transaction, then the C16 pass', async () => {
      const { own, first } = await replacedWithFailingDelete();

      await redactTransactionRecords(api.database.db, api.environmentId, own.id, {});
      await purgeRedactedTransactionFiles({ db: api.database.db, storage: api.storage });

      expect(api.storage.keys()).not.toContain(first?.storage_key);
    });

    it('answers 404 for the replaced file’s content, and 200 for the live one', async () => {
      const { own, first } = await replacedWithFailingDelete();
      const [, live] = await uploadedFileId(own.id, 'statement');
      const content = (fileId: string) =>
        api.app.inject({
          url: `/api/v1/transactions/${own.id}/files/${fileId}/content`,
          headers: bearer(api.token),
        });

      expect((await content(first?.id ?? '')).statusCode).toBe(404);
      expect((await content(live?.id ?? '')).statusCode).toBe(200);
    });

    it('marks the row deleted when the object did go', async () => {
      const own = await newTransaction(typeIdForTests);
      await upload(own.id, 'statement', pdf());
      await upload(own.id, 'statement', pdf(1, 50));

      const [replaced] = await uploadedFileId(own.id, 'statement');

      expect(replaced?.deleted_at).not.toBeNull();
    });
  });

  it('answers 410 for the content of a redacted transaction’s file, and its upload', async () => {
    const own = await newTransaction(typeIdForTests);
    const uploaded = await upload(own.id, 'statement', pdf());
    const fields = uploaded.json<{ data: Resource }>().data.attributes.fields as Record<
      string,
      { value: Record<string, unknown> }
    >;
    const fileId = String(fields.statement?.value['file-id']);
    await redactTransactionRecords(api.database.db, api.environmentId, own.id, {});

    const read = await content(own.id, fileId);
    expect(read.statusCode).toBe(410);
    expect(codeOf(read)).toBe('transaction_redacted');
    expect((await upload(own.id, 'statement', pdf())).statusCode).toBe(410);
  });

  it('answers 404 for a file of another transaction', async () => {
    const own = await newTransaction(typeIdForTests);
    const uploaded = await upload(own.id, 'statement', pdf());
    const fields = uploaded.json<{ data: Resource }>().data.attributes.fields as Record<
      string,
      { value: Record<string, unknown> }
    >;
    expect(
      (await content(transactionId, String(fields.statement?.value['file-id']))).statusCode,
    ).toBe(404);
  });
});
