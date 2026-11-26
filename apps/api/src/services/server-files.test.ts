/** C54.1: storeServerFile keeps one sealed PNG per server-written kind across job re-runs. */
import { createHash } from 'node:crypto';
import { newId } from '@openverify/contracts';
import {
  createVerification,
  decryptBytes,
  listVerificationFiles,
  setVerificationStatus,
} from '@openverify/db';
import { createTestDatabase, createTestInquiry, createTestTenant, type TestDatabase } from '@openverify/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createInMemoryFileStorage } from '../storage/index.js';
import { IMAGES } from '../test-support/harness.js';
import { storeServerFile } from './server-files.js';

let database: TestDatabase;

beforeAll(async () => {
  database = await createTestDatabase();
}, 60_000);

afterAll(async () => {
  await database.close();
});

async function processingDocument() {
  const { environment } = await createTestTenant(database.db);
  const { inquiry } = await createTestInquiry(database.db, environment.id);
  const verification = await createVerification(database.db, environment.id, {
    id: newId('ver'),
    inquiryId: inquiry.id,
    type: 'document',
  });
  await setVerificationStatus(database.db, environment.id, verification.id, { to: 'submitted' });
  return { environmentId: environment.id, verificationId: verification.id };
}

describe('storeServerFile (C54.1)', () => {
  it('seals the PNG under a new key and writes its row while the verification is processed', async () => {
    const storage = createInMemoryFileStorage();
    const target = await processingDocument();

    const stored = await database.db.transaction((tx) =>
      storeServerFile(tx, { storage, keyring: database.keyring }, {
        ...target,
        kind: 'document-preview',
        bytes: IMAGES.png,
      }),
    );

    expect(stored.replacedStorageKeys).toEqual([]);
    expect(stored.file).toMatchObject({
      kind: 'document-preview',
      mimeType: 'image/png',
      byteSize: IMAGES.png.byteLength,
      sha256: createHash('sha256').update(IMAGES.png).digest('hex'),
    });
    const ciphertext = await storage.get(stored.file.storageKey);
    expect(ciphertext).not.toBeNull();
    expect(
      decryptBytes({ wrappedDek: stored.file.wrappedDek, ciphertext: ciphertext ?? new Uint8Array() }, database.keyring, {
        context: stored.file.id,
      }),
    ).toEqual(Buffer.from(IMAGES.png));
  });

  it('replaces the kind earlier file on a re-run and returns its object to delete', async () => {
    const storage = createInMemoryFileStorage();
    const target = await processingDocument();
    const store = () =>
      database.db.transaction((tx) =>
        storeServerFile(tx, { storage, keyring: database.keyring }, {
          ...target,
          kind: 'document-preview',
          bytes: IMAGES.png,
        }),
      );

    const first = await store();
    const second = await store();

    expect(second.replacedStorageKeys).toEqual([first.file.storageKey]);
    const files = await listVerificationFiles(database.db, target.environmentId, [
      target.verificationId,
    ]);
    expect(files.map((file) => file.id)).toEqual([second.file.id]);
  });

  it('refuses bytes that are not a PNG', async () => {
    const storage = createInMemoryFileStorage();
    const target = await processingDocument();

    await expect(
      database.db.transaction((tx) =>
        storeServerFile(tx, { storage, keyring: database.keyring }, {
          ...target,
          kind: 'chip-portrait',
          bytes: IMAGES.jpeg,
        }),
      ),
    ).rejects.toBeInstanceOf(RangeError);
  });
});
