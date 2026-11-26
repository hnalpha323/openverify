/**
 * Workflow 8B Stage 3, `api-case-files` (C135, C138, C139.1): the attachment, rendition and export
 * repositories on PGlite.
 *
 * - An attachment's filename is sealed for its row and opened on read; a scan and a rendition change
 *   only a pending, unredacted attachment; a redaction keeps id, type, size and scan status, nulls the
 *   name and the digest, and answers the objects to delete (P34).
 * - A file's rendition is requested once; its pages are listed in page order until discarded; a
 *   discard marks the file's state `deleted` and answers the keys; the C16 pass finds discarded pages
 *   and pages whose source row is gone.
 * - An export's request is sealed until it finishes; only its creator lists it, newest first; one
 *   job claims it; expiry drops its file and keeps its count and times.
 *
 * Every value is synthetic.
 */
import { createHash } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createFile } from './files.js';
import {
  claimCaseExportRow,
  completeCaseExportRow,
  countCaseAttachments,
  createCaseAttachmentRow,
  createCaseExportRow,
  deleteRenditionPageRows,
  discardRenditionPagesInTx,
  expireCaseExportRow,
  failCaseExportRow,
  getCaseAttachmentRow,
  getCaseExportRow,
  getFileRendition,
  insertRenditionPages,
  listCaseAttachments,
  listCaseExports,
  listExpiredCaseExports,
  listPurgeableRenditionPages,
  listRenditionPages,
  listUndeletedRedactedCaseAttachments,
  lockCaseAttachmentRow,
  lockFileRendition,
  markCaseAttachmentsDeleted,
  recordCaseAttachmentRendition,
  recordCaseAttachmentScan,
  recordFileRendition,
  redactCaseAttachmentRows,
  requestFileRendition,
  type NewCaseAttachment,
} from './index.js';
import {
  createTestDatabase,
  createTestInquiry,
  createTestTenant,
  seedCase,
  seedCaseTemplate,
  testId,
  type TestDatabase,
} from '../testing.js';
import { createVerification } from './verifications.js';

let database: TestDatabase;

beforeAll(async () => {
  database = await createTestDatabase();
}, 120_000);

afterAll(async () => {
  await database.close();
});

const db = () => database.db;
const WRAPPED = `ov1.${'A'.repeat(11)}.${'B'.repeat(80)}`;
let objects = 0;
const storageKey = (environmentId: string) =>
  `${environmentId}/synthetic-${String((objects += 1))}`;
const sha = (text: string) => createHash('sha256').update(text).digest('hex');

const tenant = async () => (await createTestTenant(db())).environment.id;

let numbers = 0;
async function newCase(environmentId: string): Promise<string> {
  const template = await seedCaseTemplate(db(), environmentId);
  numbers += 1;
  return (
    await seedCase(db(), environmentId, {
      caseTemplateId: template.id,
      caseTemplateVersionId: template.versionId,
      key: template.key,
      number: numbers,
    })
  ).id;
}

function attachment(caseId: string, environmentId: string, extra: Partial<NewCaseAttachment> = {}) {
  return {
    id: testId('catt'),
    caseId,
    mimeType: 'image/png',
    byteSize: 2048,
    filename: 'synthetic-canary.png',
    sha256: sha('synthetic'),
    storageKey: storageKey(environmentId),
    wrappedDek: WRAPPED,
    uploader: { type: 'user', id: testId('usr') },
    scanStatus: 'pending',
    scanProvider: 'sandbox',
    ...extra,
  } satisfies NewCaseAttachment;
}

async function newFile(environmentId: string): Promise<string> {
  const { inquiry } = await createTestInquiry(db(), environmentId);
  const verification = await createVerification(db(), environmentId, {
    id: testId('ver'),
    inquiryId: inquiry.id,
    type: 'government_id',
  });
  const file = await createFile(db(), environmentId, {
    id: testId('file'),
    verificationId: verification.id,
    kind: 'front',
    storageKey: storageKey(environmentId),
    mimeType: 'image/jpeg',
    byteSize: 100,
    sha256: sha('front'),
    wrappedDek: WRAPPED,
  });
  return file.id;
}

const page = (environmentId: string, sourceId: string, number: number) => ({
  sourceId,
  page: number,
  mediaType: 'image/png' as const,
  width: 800,
  height: 600,
  byteSize: 4096,
  storageKey: storageKey(environmentId),
  wrappedDek: WRAPPED,
});

describe('case attachments (C135.2, C135.5, C139.1)', () => {
  it('seals the filename for its row, opens it on read and lists a case’s in upload order', async () => {
    const environmentId = await tenant();
    const caseId = await newCase(environmentId);
    const first = await createCaseAttachmentRow(
      db(),
      environmentId,
      attachment(caseId, environmentId),
    );
    const second = await createCaseAttachmentRow(
      db(),
      environmentId,
      attachment(caseId, environmentId, { scanStatus: 'not_scanned', scanProvider: null }),
    );

    const stored = await database.client.query<{ original_filename: string }>(
      'select original_filename from case_attachments where id = $1',
      [first.id],
    );
    expect(stored.rows[0]?.original_filename).not.toContain('synthetic-canary');
    expect(await getCaseAttachmentRow(db(), environmentId, first.id)).toMatchObject({
      filename: 'synthetic-canary.png',
      scanStatus: 'pending',
      scanProvider: 'sandbox',
      renditionStatus: 'pending',
    });
    expect(await getCaseAttachmentRow(db(), await tenant(), first.id)).toBeNull();
    expect((await listCaseAttachments(db(), environmentId, [caseId])).map(({ id }) => id)).toEqual([
      first.id,
      second.id,
    ]);
    expect(await countCaseAttachments(db(), environmentId, caseId)).toBe(2);
    expect(
      await db().transaction(
        async (tx) => (await lockCaseAttachmentRow(tx, environmentId, second.id))?.scanStatus,
      ),
    ).toBe('not_scanned');
  });

  it('records a scan and a rendition only on a pending attachment', async () => {
    const environmentId = await tenant();
    const caseId = await newCase(environmentId);
    const { id } = await createCaseAttachmentRow(
      db(),
      environmentId,
      attachment(caseId, environmentId),
    );
    const at = new Date('2026-11-03T10:00:00.000Z');

    const errored = await recordCaseAttachmentScan(db(), environmentId, id, {
      status: 'pending',
      scannedAt: null,
      attempts: 1,
    });
    const clean = await recordCaseAttachmentScan(db(), environmentId, id, {
      status: 'clean',
      scannedAt: at,
      attempts: 2,
    });
    const again = await recordCaseAttachmentScan(db(), environmentId, id, {
      status: 'infected',
      scannedAt: at,
      attempts: 3,
    });
    const ready = await recordCaseAttachmentRendition(db(), environmentId, id, {
      status: 'ready',
      pageCount: 2,
      truncated: false,
      renderedAt: at,
    });
    const late = await recordCaseAttachmentRendition(db(), environmentId, id, {
      status: 'failed',
      errorCode: 'rendition_unavailable',
    });

    expect(errored).toMatchObject({ scanStatus: 'pending', scanAttempts: 1 });
    expect(clean).toMatchObject({ scanStatus: 'clean', scannedAt: at, scanAttempts: 2 });
    expect(again).toBeNull();
    expect(ready).toMatchObject({
      renditionStatus: 'ready',
      renditionPageCount: 2,
      renditionAttempts: 1,
      renderedAt: at,
    });
    expect(late).toBeNull();
  });

  it('redacts a case’s attachments once, keeping id, type, size and scan status (P34)', async () => {
    const environmentId = await tenant();
    const caseId = await newCase(environmentId);
    const made = await createCaseAttachmentRow(
      db(),
      environmentId,
      attachment(caseId, environmentId),
    );
    const at = new Date('2026-11-03T11:00:00.000Z');

    const first = await redactCaseAttachmentRows(db(), environmentId, [caseId], at);
    const second = await redactCaseAttachmentRows(db(), environmentId, [caseId], at);

    expect(first).toEqual([{ id: made.id, environmentId, storageKey: made.storageKey }]);
    expect(second).toEqual([]);
    expect(await getCaseAttachmentRow(db(), environmentId, made.id)).toMatchObject({
      filename: null,
      sha256: null,
      mimeType: 'image/png',
      byteSize: 2048,
      scanStatus: 'pending',
      renditionStatus: 'deleted',
      redactedAt: at,
      deletedAt: null,
    });
    expect(
      await recordCaseAttachmentScan(db(), environmentId, made.id, {
        status: 'clean',
        scannedAt: at,
        attempts: 1,
      }),
    ).toBeNull();
    expect(
      (await listUndeletedRedactedCaseAttachments(db(), 100)).filter(
        ({ environmentId: env }) => env === environmentId,
      ),
    ).toEqual([{ id: made.id, environmentId, storageKey: made.storageKey }]);

    expect(await markCaseAttachmentsDeleted(db(), environmentId, [made.id], at)).toBe(1);
    expect(await getCaseAttachmentRow(db(), environmentId, made.id)).toMatchObject({
      storageKey: null,
      wrappedDek: null,
      deletedAt: at,
    });
    expect(
      (await listUndeletedRedactedCaseAttachments(db(), 100)).map(({ id }) => id),
    ).not.toContain(made.id);
  });
});

describe('renditions (C135.3)', () => {
  it('requests a file’s rendition once and records it ready with its pages in order', async () => {
    const environmentId = await tenant();
    const fileId = await newFile(environmentId);
    const at = new Date('2026-11-03T12:00:00.000Z');

    expect(await getFileRendition(db(), environmentId, fileId)).toBeNull();
    const requested = await requestFileRendition(db(), environmentId, fileId);
    const repeated = await requestFileRendition(db(), environmentId, fileId);
    await db().transaction(async (tx) => {
      expect((await lockFileRendition(tx, environmentId, fileId))?.status).toBe('pending');
      await insertRenditionPages(tx, environmentId, [
        page(environmentId, fileId, 2),
        page(environmentId, fileId, 1),
      ]);
      await recordFileRendition(tx, environmentId, fileId, {
        status: 'ready',
        pageCount: 2,
        truncated: true,
        renderedAt: at,
      });
    });

    expect(requested).toMatchObject({ fileId, status: 'pending', attempts: 0 });
    expect(repeated.createdAt).toEqual(requested.createdAt);
    expect(await getFileRendition(db(), environmentId, fileId)).toMatchObject({
      status: 'ready',
      pageCount: 2,
      truncated: true,
      attempts: 1,
      renderedAt: at,
    });
    expect((await listRenditionPages(db(), environmentId, fileId)).map(({ id }) => id)).toEqual([
      `${fileId}/1`,
      `${fileId}/2`,
    ]);
    expect(
      await recordFileRendition(db(), environmentId, fileId, {
        status: 'failed',
        errorCode: 'rendition_unavailable',
      }),
    ).toBeNull();
  });

  it('discards a source’s pages and marks a file’s rendition deleted', async () => {
    const environmentId = await tenant();
    const fileId = await newFile(environmentId);
    await requestFileRendition(db(), environmentId, fileId);
    const one = page(environmentId, fileId, 1);
    await insertRenditionPages(db(), environmentId, [one]);

    const keys = await db().transaction((tx) =>
      discardRenditionPagesInTx(tx, environmentId, [fileId]),
    );
    const again = await db().transaction((tx) =>
      discardRenditionPagesInTx(tx, environmentId, [fileId]),
    );

    expect(keys).toEqual([one.storageKey]);
    expect(again).toEqual([]);
    expect(await listRenditionPages(db(), environmentId, fileId)).toEqual([]);
    expect((await getFileRendition(db(), environmentId, fileId))?.status).toBe('deleted');
    expect(
      await recordFileRendition(db(), environmentId, fileId, { status: 'pending' }),
    ).toBeNull();
  });

  it('finds discarded pages and pages whose source is gone for the C16 pass, then deletes their rows', async () => {
    const environmentId = await tenant();
    const kept = await newFile(environmentId);
    const discarded = await newFile(environmentId);
    const gone = testId('file');
    const goneAttachment = testId('catt');
    await insertRenditionPages(db(), environmentId, [
      page(environmentId, kept, 1),
      page(environmentId, discarded, 1),
      page(environmentId, gone, 1),
      page(environmentId, goneAttachment, 1),
    ]);
    await db().transaction((tx) => discardRenditionPagesInTx(tx, environmentId, [discarded]));

    const found = (await listPurgeableRenditionPages(db(), 1000)).filter(
      ({ environmentId: env }) => env === environmentId,
    );

    expect(found.map(({ id }) => id).sort()).toEqual(
      [`${discarded}/1`, `${gone}/1`, `${goneAttachment}/1`].sort(),
    );
    expect(
      await deleteRenditionPageRows(
        db(),
        found.map(({ id }) => id),
      ),
    ).toBe(3);
    expect(await listRenditionPages(db(), environmentId, kept)).toHaveLength(1);
    const left = await db().execute(
      sql`select count(*)::int as n from rendition_pages where environment_id = ${environmentId}`,
    );
    expect(left.rows[0]).toEqual({ n: 1 });
  });
});

describe('case exports (C138.1, P19, P26)', () => {
  const creator = { type: 'user' as const, id: testId('usr') };

  it('seals the request until the export finishes, and one job claims it', async () => {
    const environmentId = await tenant();
    const made = await createCaseExportRow(db(), environmentId, {
      id: testId('cexp'),
      creator,
      format: 'json',
      includePersonalData: true,
      request: { filter: { status: ['open'] } },
    });
    const stored = await database.client.query<{ request: string }>(
      'select request from case_exports where id = $1',
      [made.id],
    );
    const at = new Date('2026-11-03T13:00:00.000Z');
    const expires = new Date('2026-11-04T13:00:00.000Z');

    const claimed = await db().transaction((tx) => claimCaseExportRow(tx, environmentId, made.id));
    const twice = await db().transaction((tx) => claimCaseExportRow(tx, environmentId, made.id));
    const done = await db().transaction((tx) =>
      completeCaseExportRow(tx, environmentId, made.id, {
        caseCount: 3,
        byteSize: 512,
        storageKey: storageKey(environmentId),
        wrappedDek: WRAPPED,
        completedAt: at,
        expiresAt: expires,
      }),
    );

    expect(stored.rows[0]?.request).not.toContain('open');
    expect(made).toMatchObject({ status: 'pending', request: { filter: { status: ['open'] } } });
    expect(claimed).toMatchObject({ status: 'running' });
    expect(twice).toBeNull();
    expect(done).toMatchObject({ status: 'completed', request: null, caseCount: 3, byteSize: 512 });
    expect(
      (await listExpiredCaseExports(db(), new Date('2026-11-04T12:59:59.000Z'), 100)).map(
        ({ id }) => id,
      ),
    ).not.toContain(made.id);
    expect(
      (await listExpiredCaseExports(db(), expires, 100)).filter(
        ({ environmentId: env }) => env === environmentId,
      ),
    ).toEqual([{ id: made.id, environmentId, storageKey: done?.storageKey }]);

    expect(await expireCaseExportRow(db(), environmentId, made.id)).toBe(true);
    expect(await getCaseExportRow(db(), environmentId, made.id)).toMatchObject({
      status: 'expired',
      storageKey: null,
      wrappedDek: null,
      byteSize: null,
      caseCount: 3,
      completedAt: at,
      expiresAt: expires,
    });
    expect(await expireCaseExportRow(db(), environmentId, made.id)).toBe(false);
  });

  it('fails with a code alone, and lists a creator’s own newest first', async () => {
    const environmentId = await tenant();
    const other = { type: 'api-key' as const, id: testId('key') };
    const ids = [testId('cexp'), testId('cexp'), testId('cexp')];
    for (const [index, id] of ids.entries()) {
      await createCaseExportRow(db(), environmentId, {
        id,
        creator: index === 1 ? other : creator,
        format: 'csv',
        includePersonalData: false,
        request: {},
      });
      await db().execute(
        sql`update case_exports set created_at = ${new Date(Date.UTC(2026, 10, 3, index)).toISOString()}
            where id = ${id}`,
      );
    }
    const failed = await db().transaction(async (tx) => {
      await claimCaseExportRow(tx, environmentId, ids[0] ?? '');
      return failCaseExportRow(tx, environmentId, ids[0] ?? '', 'export_too_large');
    });

    const mine = await listCaseExports(db(), environmentId, { creator, page: { size: 10 } });
    const failedOnly = await listCaseExports(db(), environmentId, {
      creator,
      statuses: ['failed'],
      page: {},
    });
    const paged = await listCaseExports(db(), environmentId, { creator, page: { size: 1 } });

    expect(failed).toMatchObject({
      status: 'failed',
      errorCode: 'export_too_large',
      request: null,
    });
    expect(mine.items.map(({ id }) => id)).toEqual([ids[2], ids[0]]);
    expect(failedOnly.items.map(({ id }) => id)).toEqual([ids[0]]);
    expect(paged).toMatchObject({ next: ids[2] });
  });
});
