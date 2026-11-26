/**
 * Workflow 8B Stage 1b, checkpoint (F) (C135.3, C138.1, C143.1; V19, V27; orchestrator decision 5
 * after Workflow 8A): the shared files reach a rendition or an export only through a hook in
 * `api-case-files`' paths. Each hook is replaced here by what its owner would write, and the shared
 * file must answer it:
 *
 * - `deleteRenditionsForFilesInTx` where an inquiry's files are redacted or deleted outright: the
 *   inquiry's redaction, a child inquiry's, a replaced server-written file and a discarded selfie
 *   capture; each deletes the keys it answers after its commit (Stage 1a amendment 9);
 * - `purgeDiscardedRenditions` and `runCaseExportRetention` in the C16 pass, each with its count;
 * - `requestRenditionsForFiles` after the verification job's commit, whose failure fails nothing.
 *
 * Every value is synthetic.
 */
import { createHash, randomBytes } from 'node:crypto';
import { defaultInquiryTemplateAttributes, newId } from '@openverify/contracts';
import {
  createFile,
  createSelfieCapture,
  createVerification,
  encryptBytes,
  setVerificationStatus,
  transitionInquiryStatus,
  type Db,
  type FileKind,
} from '@openverify/db';
import {
  createTestDatabase,
  createTestInquiry,
  createTestTenant,
  seedTransaction,
  seedTransactionType,
  testId,
  type TestDatabase,
} from '@openverify/db/testing';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createEventPublisher } from './events/index.js';
import { processVerification } from './jobs/process-verification.js';
import {
  FAKE_PNG,
  createCapturingLogger,
  createFakeVision,
  createMemoryStorage,
  createRecordingQueue,
  phase3SelfieTemplate,
} from './jobs/testing.js';
import type { CaseRenditionQueue } from './ports.js';
import { createRedactionService } from './services/redaction.js';
import { runRetention } from './services/retention.js';
import { errorOpenSelfieCaptureInTx } from './services/selfie-captures.js';
import { storeServerFile } from './services/server-files.js';
import { createRecordingEventPublisher, fixedClock } from './test-support/fakes.js';
import { createWebhookDeliveryScheduler, type WebhookDeliveryJob } from './webhooks/queue.js';
import { redactTransactionChildrenInTx } from './workflows/actions/transactions/children.js';

/** What `api-case-files` would answer: one page of each file, keyed by the file's id. */
const renditionKeyOf = (fileId: string) => `renditions/${fileId}/1`;

const owners = vi.hoisted(() => ({
  deleteRenditionsForFilesInTx: vi.fn(),
  purgeDiscardedRenditions: vi.fn(),
  requestRenditionsForFiles: vi.fn(),
  runCaseExportRetention: vi.fn(),
}));

vi.mock('./services/cases/attachments/renditions.js', () => ({
  deleteRenditionsForFilesInTx: owners.deleteRenditionsForFilesInTx,
  purgeDiscardedRenditions: owners.purgeDiscardedRenditions,
  requestRenditionsForFiles: owners.requestRenditionsForFiles,
}));
vi.mock('./services/cases/exports/retention.js', () => ({
  runCaseExportRetention: owners.runCaseExportRetention,
}));

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

beforeEach(() => {
  owners.deleteRenditionsForFilesInTx.mockReset();
  owners.deleteRenditionsForFilesInTx.mockImplementation(
    (_tx: Db, files: { fileIds: readonly string[] }) =>
      Promise.resolve(files.fileIds.map(renditionKeyOf)),
  );
  owners.purgeDiscardedRenditions.mockReset();
  owners.purgeDiscardedRenditions.mockResolvedValue(0);
  owners.requestRenditionsForFiles.mockReset();
  owners.requestRenditionsForFiles.mockResolvedValue(undefined);
  owners.runCaseExportRetention.mockReset();
  owners.runCaseExportRetention.mockResolvedValue({
    expiredCaseExports: 0,
    failedCaseExportDeletes: 0,
  });
});

const storage = createMemoryStorage();

/** A file of a verification, its object stored, and a rendition page's object beside it. */
async function storedFile(verificationId: string, kind: FileKind, selfieCaptureId?: string) {
  const id = newId('file');
  // A JPEG's magic bytes, then synthetic bytes standing in for an image.
  const bytes = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, ...randomBytes(48)]);
  const sealed = encryptBytes(bytes, database.keyring, { context: id });
  const storageKey = `${environmentId}/${id}`;
  await storage.put(storageKey, sealed.ciphertext);
  await storage.put(renditionKeyOf(id), new Uint8Array([1, 2, 3]));
  await createFile(db, environmentId, {
    id,
    verificationId,
    kind,
    storageKey,
    mimeType: 'image/jpeg',
    byteSize: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    wrappedDek: sealed.wrappedDek,
    ...(selfieCaptureId === undefined ? {} : { selfieCaptureId }),
  });
  return id;
}

async function inquiryWithFile(type: 'government_id' | 'selfie' = 'government_id') {
  const { inquiry } = await createTestInquiry(db, environmentId);
  const verificationId = newId('ver');
  await createVerification(db, environmentId, { id: verificationId, inquiryId: inquiry.id, type });
  const fileId = await storedFile(verificationId, type === 'selfie' ? 'selfie-center' : 'front');
  return { inquiryId: inquiry.id, verificationId, fileId };
}

function hookCalledFor(fileIds: string[]): void {
  expect(owners.deleteRenditionsForFilesInTx).toHaveBeenCalledWith(expect.anything(), {
    environmentId,
    fileIds,
  });
}

describe('deleteRenditionsForFilesInTx where a file is redacted (C135.3, V19)', () => {
  it('runs in the inquiry’s redaction, whose objects go after the commit', async () => {
    const { inquiryId, fileId } = await inquiryWithFile();
    const service = createRedactionService({
      db,
      storage,
      events: createRecordingEventPublisher(),
      clock: fixedClock(),
    });

    await service.redactInquiry({ environmentId, organizationId }, inquiryId, null);

    hookCalledFor([fileId]);
    expect(await storage.get(renditionKeyOf(fileId))).toBeNull();
  });

  it('runs in a child inquiry’s redaction, whose keys the cascade answers', async () => {
    const { inquiryId, fileId } = await inquiryWithFile();
    const type = await seedTransactionType(db, environmentId);
    const transaction = await seedTransaction(db, environmentId, {
      transactionTypeId: type.id,
      transactionTypeVersionId: type.versionId,
    });
    await db.execute(sql`
      insert into transaction_children (environment_id, transaction_id, child_type, child_id,
        workflow_run_id)
      values (${environmentId}, ${transaction.id}, 'inquiry', ${inquiryId}, ${testId('wfr')})`);

    const redacted = await db.transaction((tx) =>
      redactTransactionChildrenInTx(
        tx,
        { events: createRecordingEventPublisher(), clock: fixedClock() },
        { environmentId, transactionId: transaction.id, at: new Date() },
      ),
    );

    hookCalledFor([fileId]);
    expect(redacted.storageKeys).toContain(renditionKeyOf(fileId));
  });
});

describe('deleteRenditionsForFilesInTx where a file row is deleted outright (Stage 1a amendment 9)', () => {
  it('runs when a server-written file is replaced, adding its keys to the replaced objects', async () => {
    const { verificationId } = await inquiryWithFile();
    const write = () =>
      db.transaction((tx) =>
        storeServerFile(
          tx,
          { storage, keyring: database.keyring },
          { environmentId, verificationId, kind: 'document-preview', bytes: FAKE_PNG },
        ),
      );
    const first = await write();

    const second = await write();

    hookCalledFor([first.file.id]);
    expect(second.replacedStorageKeys).toEqual(
      expect.arrayContaining([first.file.storageKey, renditionKeyOf(first.file.id)]),
    );
  });

  it('runs when an open selfie capture is discarded, adding its keys to the objects to delete', async () => {
    const { inquiry } = await createTestInquiry(db, environmentId);
    const verificationId = newId('ver');
    await createVerification(db, environmentId, {
      id: verificationId,
      inquiryId: inquiry.id,
      type: 'selfie',
    });
    const captureId = newId('self');
    await createSelfieCapture(db, environmentId, {
      id: captureId,
      verificationId,
      inquiryId: inquiry.id,
      method: 'camera',
      liveness: 'active',
      prompts: ['center', 'left', 'right'],
      nonceSha256: randomBytes(32),
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 180_000),
    });
    const fileId = await storedFile(verificationId, 'selfie-center', captureId);

    const errored = await db.transaction((tx) =>
      errorOpenSelfieCaptureInTx(
        tx,
        createRecordingEventPublisher(),
        environmentId,
        verificationId,
        'superseded',
      ),
    );

    hookCalledFor([fileId]);
    expect(errored.storageKeys).toEqual(
      expect.arrayContaining([`${environmentId}/${fileId}`, renditionKeyOf(fileId)]),
    );
  });
});

describe('the C16 pass (C135.3, C138.1, C143.1)', () => {
  it('purges discarded renditions and expires exports, each with its count', async () => {
    owners.purgeDiscardedRenditions.mockResolvedValueOnce(3);
    owners.runCaseExportRetention.mockResolvedValueOnce({
      expiredCaseExports: 2,
      failedCaseExportDeletes: 1,
    });

    const report = await runRetention({
      db,
      storage: createMemoryStorage(),
      redaction: createRedactionService({
        db,
        storage: createMemoryStorage(),
        events: createRecordingEventPublisher(),
        clock: fixedClock(),
      }),
      clock: fixedClock(),
    });

    expect(report).toMatchObject({
      purgedRenditionPages: 3,
      expiredCaseExports: 2,
      failedCaseExportDeletes: 1,
    });
    expect(owners.purgeDiscardedRenditions).toHaveBeenCalledWith(expect.objectContaining({ db }));
    expect(owners.runCaseExportRetention).toHaveBeenCalledWith(
      expect.objectContaining({ db }),
      expect.objectContaining({ now: fixedClock().now() }),
    );
  });
});

describe('requestRenditionsForFiles after the verification job’s commit (C135.3, V27)', () => {
  const defaults = phase3SelfieTemplate(defaultInquiryTemplateAttributes());

  async function submittedGovernmentId() {
    const { inquiry } = await createTestInquiry(db, environmentId, {
      flow: defaults.flow,
      verificationConfig: defaults['verification-config'],
    });
    await transitionInquiryStatus(db, environmentId, inquiry.id, {
      from: 'created',
      to: 'pending',
    });
    const verificationId = newId('ver');
    await createVerification(db, environmentId, {
      id: verificationId,
      inquiryId: inquiry.id,
      type: 'government_id',
    });
    const front = await storedFile(verificationId, 'front');
    const back = await storedFile(verificationId, 'back');
    await setVerificationStatus(db, environmentId, verificationId, { to: 'submitted' });
    return { verificationId, fileIds: [front, back] };
  }

  function deps() {
    const logger = createCapturingLogger();
    const renditions: CaseRenditionQueue = { enqueueCaseRendition: () => Promise.resolve() };
    return {
      logger,
      renditions,
      deps: {
        db,
        storage,
        keyring: database.keyring,
        vision: createFakeVision().client,
        events: createEventPublisher({
          db,
          deliveries: createWebhookDeliveryScheduler(createRecordingQueue<WebhookDeliveryJob>()),
          logger,
        }),
        clock: fixedClock(),
        logger,
        renditions,
      },
    };
  }

  it('asks for the renditions of the verification’s files, with the rendition producer', async () => {
    const { verificationId, fileIds } = await submittedGovernmentId();
    const { deps: jobDeps, renditions } = deps();

    const result = await processVerification({ environmentId, verificationId }, jobDeps);

    expect(result.outcome).toBe('processed');
    expect(owners.requestRenditionsForFiles).toHaveBeenCalledWith(
      expect.objectContaining({ db, renditions }),
      { environmentId, fileIds: expect.arrayContaining(fileIds) as unknown },
    );
  });

  it('logs a failed request and processes the verification all the same', async () => {
    owners.requestRenditionsForFiles.mockRejectedValueOnce(new Error('synthetic outage'));
    const { verificationId } = await submittedGovernmentId();
    const { deps: jobDeps, logger } = deps();

    const result = await processVerification({ environmentId, verificationId }, jobDeps);

    expect(result.outcome).toBe('processed');
    expect(logger.entries.map(({ message }) => message)).toContain(
      'renditions could not be requested',
    );
  });
});
