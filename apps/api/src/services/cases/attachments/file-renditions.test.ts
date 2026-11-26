/**
 * C135.3 (Workflow 8B Stage 3, `api-case-files`; decision 63, V19, V27, P22, P38): an inquiry file's
 * rendition and its lifecycle.
 *
 * - The console's route answers 202 on a first request (writing it `pending` and enqueueing it) and on
 *   every request while it is made, then the page, audited as `file.viewed` before a byte is sent; 422
 *   `rendition_unavailable` when vision could not make it; 404 for a deleted or redacted source, a
 *   kind no rendition is made of, and a page past the rendered ones.
 * - `deleteRenditionsForFilesInTx` discards a file's pages and marks its rendition `deleted`, answering
 *   the keys; `purgeDiscardedRenditions` deletes the objects of discarded and orphaned pages and then
 *   their rows, and finishes a redacted attachment whose object a failed delete left;
 *   `requestRenditionsForFiles` asks for the images and PDFs of a verification, not the chip files.
 *
 * Every value is synthetic.
 */
import { createHash, randomBytes } from 'node:crypto';
import { newId } from '@openverify/contracts';
import {
  createFile,
  createVerification,
  encryptBytes,
  getFileRendition,
  type Db,
  type FileKind,
} from '@openverify/db';
import {
  createTestDatabase,
  createTestInquiry,
  createTestTenant,
  seedCase,
  seedCaseAttachment,
  seedCaseTemplate,
  seedRenditionPage,
  testId,
  type TestDatabase,
} from '@openverify/db/testing';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createCaseRenditionQueue } from '../../../jobs/case-file-queues.js';
import { processCaseRendition } from '../../../jobs/cases/index.js';
import {
  FAKE_PNG,
  createCapturingLogger,
  createFakeVision,
  createMemoryStorage,
  createRecordingQueue,
} from '../../../jobs/testing.js';
import type { CaseRenditionJob } from '../../../ports.js';
import type { DashboardContext } from '../../../routes/dashboard/context.js';
import { fixedClock } from '../../../test-support/fakes.js';
import { VisionServiceError } from '../../../vision/index.js';
import { getFileRenditionContent } from './file-renditions.js';
import {
  deleteRenditionsForFilesInTx,
  purgeDiscardedRenditions,
  requestRenditionsForFiles,
} from './renditions.js';

let database: TestDatabase;
let db: Db;
let environmentId: string;
let organizationId: string;

beforeAll(async () => {
  database = await createTestDatabase();
  db = database.db;
  const tenant = await createTestTenant(db);
  environmentId = tenant.environment.id;
  organizationId = tenant.organization.id;
}, 120_000);

afterAll(async () => {
  await database.close();
});

const storage = createMemoryStorage();
const jobs = createRecordingQueue<CaseRenditionJob>();
const clock = fixedClock();
const vision = createFakeVision();
const RENDERED = new Uint8Array([...FAKE_PNG, 9, 9, 9]);

const context = (): DashboardContext => ({
  db,
  storage,
  operatorAuth: undefined as never,
  keyring: () => database.keyring,
  caseRenditions: createCaseRenditionQueue({ queue: jobs }),
});

const USER = testId('usr');
const view = (fileId: string, page = 1) =>
  getFileRenditionContent(context(), {
    ctx: { organizationId, environmentId, requestId: 'synthetic-request' },
    actor: { type: 'user', id: USER },
    fileId,
    page,
  });

const render = (fileId: string) =>
  processCaseRendition(
    { environmentId, sourceId: fileId },
    {
      db,
      storage,
      keyring: database.keyring,
      vision: vision.client,
      events: undefined as never,
      clock,
      logger: createCapturingLogger(),
    },
  );

/** A file of a verification, its object sealed and stored. */
async function storedFile(
  options: { kind?: FileKind; mimeType?: string; inquiryId?: string } = {},
): Promise<{ fileId: string; inquiryId: string; verificationId: string }> {
  const inquiryId = options.inquiryId ?? (await createTestInquiry(db, environmentId)).inquiry.id;
  const verificationId = newId('ver');
  await createVerification(db, environmentId, {
    id: verificationId,
    inquiryId,
    type: 'government_id',
  });
  const id = newId('file');
  const bytes = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, ...randomBytes(48)]);
  const sealed = encryptBytes(bytes, database.keyring, { context: id });
  const storageKey = `${environmentId}/${id}`;
  await storage.put(storageKey, sealed.ciphertext);
  await createFile(db, environmentId, {
    id,
    verificationId,
    kind: options.kind ?? 'front',
    storageKey,
    mimeType: options.mimeType ?? 'image/jpeg',
    byteSize: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    wrappedDek: sealed.wrappedDek,
  });
  return { fileId: id, inquiryId, verificationId };
}

const onePage = () => ({
  source: 'image' as const,
  pageCount: 1,
  truncated: false,
  pages: [{ page: 1, mediaType: 'image/png' as const, width: 1, height: 1, bytes: RENDERED }],
});

const auditRows = (fileId: string) =>
  database.client.query<{ action: string; metadata: unknown }>(
    'select action, metadata from audit_logs where resource_id = $1 order by created_at',
    [fileId],
  );

describe('an inquiry file’s rendition (C135.3)', () => {
  it('answers 202 until it is made, then the page, audited as file.viewed', async () => {
    const { fileId, verificationId } = await storedFile();
    const queued = jobs.jobs.length;

    const first = await view(fileId);
    const again = await view(fileId);
    vision.answers.createRendition = onePage();
    await render(fileId);
    const page = await view(fileId);

    expect(first).toEqual({
      kind: 'pending',
      document: { meta: { 'rendition-status': 'pending', 'retry-after-seconds': 5 } },
      retryAfterSeconds: 5,
    });
    expect(again.kind).toBe('pending');
    expect(jobs.jobs.slice(queued).map(({ data }) => data.sourceId)).toEqual([fileId, fileId]);
    expect(page).toMatchObject({ kind: 'bytes', mediaType: 'image/png' });
    expect(page.kind === 'bytes' && Buffer.from(page.bytes).equals(Buffer.from(RENDERED))).toBe(
      true,
    );
    expect(vision.calls.at(-1)?.endpoint).toBe('create-rendition');
    expect((await auditRows(fileId)).rows).toEqual([
      {
        action: 'file.viewed',
        metadata: { kind: 'front', verificationId, page: 1, rendition: true },
      },
    ]);
    await expect(view(fileId, 2)).rejects.toMatchObject({ status: 404 });
  });

  it('answers 422 when vision cannot make it, and 404 for a source deleted, redacted or of no image', async () => {
    const failed = await storedFile();
    const deleted = await storedFile();
    const redacted = await storedFile();
    const chip = await storedFile({ kind: 'chip-dg1', mimeType: 'application/octet-stream' });
    await view(failed.fileId);
    vision.answers.createRendition = new VisionServiceError('/v1/renditions', 415, 'unsupported');
    await render(failed.fileId);
    await db.execute(sql`update files set deleted_at = now() where id = ${deleted.fileId}`);
    await db.execute(
      sql`update inquiries set redacted_at = now() where id = ${redacted.inquiryId}`,
    );

    await expect(view(failed.fileId)).rejects.toMatchObject({
      status: 422,
      code: 'rendition_unavailable',
    });
    for (const fileId of [deleted.fileId, redacted.fileId, chip.fileId, testId('file')]) {
      await expect(view(fileId)).rejects.toMatchObject({ status: 404 });
    }
  });
});

describe('the rendition lifecycle (V19, V27, P22)', () => {
  it('discards a redacted file’s pages, answering their keys, and serves none after', async () => {
    const { fileId } = await storedFile();
    await view(fileId);
    vision.answers.createRendition = onePage();
    await render(fileId);
    const [page] = (
      await database.client.query<{ storage_key: string }>(
        'select storage_key from rendition_pages where source_id = $1',
        [fileId],
      )
    ).rows;

    const keys = await db.transaction((tx) =>
      deleteRenditionsForFilesInTx(tx, { environmentId, fileIds: [fileId] }),
    );

    expect(keys).toEqual([page?.storage_key]);
    expect((await getFileRendition(db, environmentId, fileId))?.status).toBe('deleted');
    await expect(view(fileId)).rejects.toMatchObject({ status: 404 });
  });

  it('purges discarded and orphaned pages, and finishes a redacted attachment', async () => {
    const { fileId } = await storedFile();
    const orphan = testId('file');
    const discardedKey = `${environmentId}/renditions/${fileId}/1`;
    const orphanKey = `${environmentId}/renditions/${orphan}/1`;
    await seedRenditionPage(db, environmentId, { sourceId: fileId });
    await seedRenditionPage(db, environmentId, { sourceId: orphan });
    await storage.put(discardedKey, new Uint8Array([1]));
    await storage.put(orphanKey, new Uint8Array([2]));
    await db.transaction((tx) =>
      deleteRenditionsForFilesInTx(tx, { environmentId, fileIds: [fileId] }),
    );
    const template = await seedCaseTemplate(db, environmentId);
    const { id: caseId } = await seedCase(db, environmentId, {
      caseTemplateId: template.id,
      caseTemplateVersionId: template.versionId,
      key: template.key,
      number: 1,
    });
    const attachment = await seedCaseAttachment(db, environmentId, { caseId });
    await storage.put(attachment.storageKey, new Uint8Array([3]));
    await db.execute(
      sql`update case_attachments set redacted_at = now(), original_filename = null, sha256 = null
          where id = ${attachment.id}`,
    );

    const purged = await purgeDiscardedRenditions({ db, storage, clock, limit: 1000 });

    expect(purged).toBeGreaterThanOrEqual(2);
    expect(storage.objects.has(discardedKey)).toBe(false);
    expect(storage.objects.has(orphanKey)).toBe(false);
    expect(storage.objects.has(attachment.storageKey)).toBe(false);
    const left = await database.client.query<{ n: number }>(
      'select count(*)::int as n from rendition_pages where source_id in ($1, $2)',
      [fileId, orphan],
    );
    expect(left.rows).toEqual([{ n: 0 }]);
    const row = await database.client.query<{ storage_key: string | null; deleted: boolean }>(
      'select storage_key, deleted_at is not null as deleted from case_attachments where id = $1',
      [attachment.id],
    );
    expect(row.rows).toEqual([{ storage_key: null, deleted: true }]);
  });

  it('asks for the renditions of a verification’s images and PDFs, not its chip files', async () => {
    const image = await storedFile();
    const pdf = await storedFile({ kind: 'document', mimeType: 'application/pdf' });
    const chip = await storedFile({ kind: 'chip-dg1', mimeType: 'application/octet-stream' });
    const queued = jobs.jobs.length;

    await requestRenditionsForFiles(
      {
        db,
        renditions: createCaseRenditionQueue({ queue: jobs }),
        logger: createCapturingLogger(),
      },
      { environmentId, fileIds: [image.fileId, pdf.fileId, chip.fileId, testId('file')] },
    );

    expect(jobs.jobs.slice(queued).map(({ data }) => data.sourceId)).toEqual([
      image.fileId,
      pdf.fileId,
    ]);
    expect((await getFileRendition(db, environmentId, image.fileId))?.status).toBe('pending');
    expect(await getFileRendition(db, environmentId, chip.fileId)).toBeNull();
  });
});
