/**
 * C253.2 (Workflow 11B, `dsar-export`): a listed file read from its live object: a live verification
 * or transaction file, one whose object was deleted or whose inquiry or transaction was redacted
 * (redacted: the route's 410), and one that is gone (missing: the generic 404). Synthetic values.
 */
import { markFilesDeleted, markTransactionFilesDeleted, type Db } from '@openverify/db';
import { createTestDatabase, createTestTenant, type TestDatabase } from '@openverify/db/testing';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createInMemoryFileStorage } from '../../storage/index.js';
import { seedPiiSubject, type SeededPiiSubject } from '../redaction.test-support.js';
import { readLiveFile } from './files.js';
import type { AccountExportFile } from './manifest.js';

let database: TestDatabase;
let db: Db;
let environmentId: string;
let subject: SeededPiiSubject;

beforeAll(async () => {
  database = await createTestDatabase();
  db = database.db;
});

afterAll(async () => {
  await database.close();
});

beforeEach(async () => {
  const { environment } = await createTestTenant(db);
  environmentId = environment.id;
  subject = await seedPiiSubject({
    db,
    storage: createInMemoryFileStorage(),
    keyring: database.keyring,
    environmentId,
  });
});

const listed = (
  id: string,
  kind: AccountExportFile['kind'],
  belongsTo: string,
): AccountExportFile => ({
  id,
  kind,
  'media-type': 'image/jpeg',
  size: 1,
  sha256: '0'.repeat(64),
  'belongs-to': belongsTo,
});

const verificationFile = () =>
  listed(subject.fileIds[0] ?? '', 'verification-file', subject.verificationId);
const transactionFile = () =>
  listed(subject.transactions.account.fileId, 'transaction-file', subject.transactions.account.id);

describe('readLiveFile (C253.2)', () => {
  it('reads a live verification file’s object, key and media type', async () => {
    const file = await readLiveFile(db, environmentId, verificationFile());
    expect(file).toMatchObject({ state: 'live', storageKey: subject.storageKeys[0] });
    expect(file.state === 'live' && file.wrappedDek.length > 0).toBe(true);
  });

  it('reads a live transaction file', async () => {
    expect(await readLiveFile(db, environmentId, transactionFile())).toMatchObject({
      state: 'live',
      storageKey: subject.transactions.account.storageKey,
    });
  });

  it('reads a verification file whose object was deleted as redacted', async () => {
    await markFilesDeleted(db, environmentId, [verificationFile().id]);
    expect(await readLiveFile(db, environmentId, verificationFile())).toEqual({
      state: 'redacted',
    });
  });

  it('reads a verification file of a redacted inquiry as redacted', async () => {
    await db.execute(sql`update inquiries set redacted_at = now() where id = ${subject.inquiryId}`);
    expect(await readLiveFile(db, environmentId, verificationFile())).toEqual({
      state: 'redacted',
    });
  });

  it('reads a transaction file whose object was deleted, or of a redacted transaction, as redacted', async () => {
    await markTransactionFilesDeleted(db, environmentId, [transactionFile().id], new Date());
    expect(await readLiveFile(db, environmentId, transactionFile())).toEqual({
      state: 'redacted',
    });
    const other = listed(
      subject.transactions.inquiry.fileId,
      'transaction-file',
      subject.transactions.inquiry.id,
    );
    await db.execute(
      sql`update transactions set redacted_at = now() where id = ${subject.transactions.inquiry.id}`,
    );
    expect(await readLiveFile(db, environmentId, other)).toEqual({ state: 'redacted' });
  });

  it('reads a file of another environment, or none, as missing', async () => {
    const other = await createTestTenant(db);
    expect(await readLiveFile(db, other.environment.id, verificationFile())).toEqual({
      state: 'missing',
    });
    expect(
      await readLiveFile(
        db,
        environmentId,
        listed('file_01M5CN0000000000000011B999', 'verification-file', subject.verificationId),
      ),
    ).toEqual({ state: 'missing' });
  });
});
