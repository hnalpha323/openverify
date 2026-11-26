import { createHash, randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { decryptBytes, encryptBytes } from '../crypto.js';
import {
  createTestDatabase,
  createTestInquiry,
  createTestTenant,
  testId,
  type TestDatabase,
} from '../testing.js';
import {
  createFile,
  getFile,
  listVerificationFiles,
  replaceServerWrittenFile,
  replaceVerificationFile,
  SERVER_WRITTEN_FILE_KINDS,
} from './files.js';
import { createVerification, setVerificationStatus } from './verifications.js';

let database: TestDatabase;

beforeAll(async () => {
  database = await createTestDatabase();
});

afterAll(async () => {
  await database.close();
});

async function newVerification() {
  const { environment } = await createTestTenant(database.db);
  const { inquiry } = await createTestInquiry(database.db, environment.id);
  const verification = await createVerification(database.db, environment.id, {
    id: testId('ver'),
    inquiryId: inquiry.id,
    type: 'government_id',
  });
  return { environment, verification };
}

function newFile(verificationId: string, kind: 'front' | 'back', environmentId: string) {
  const id = testId('file');
  // Synthetic bytes standing in for an image.
  const plaintext = randomBytes(256);
  const sealed = encryptBytes(plaintext, database.keyring, { context: id });
  const input = {
    id,
    verificationId,
    kind,
    storageKey: `${environmentId}/${id}`,
    mimeType: 'image/jpeg',
    byteSize: plaintext.length,
    sha256: createHash('sha256').update(plaintext).digest('hex'),
    wrappedDek: sealed.wrappedDek,
  };
  return { input, plaintext, ciphertext: sealed.ciphertext };
}

async function upload(environmentId: string, verificationId: string, kind: 'front' | 'back') {
  const { input, plaintext, ciphertext } = newFile(verificationId, kind, environmentId);
  const file = await createFile(database.db, environmentId, input);
  return { file, plaintext, ciphertext };
}

describe('files', () => {
  it('stores the metadata and wrapped DEK needed to decrypt the stored object', async () => {
    const { environment, verification } = await newVerification();
    const { file, plaintext, ciphertext } = await upload(environment.id, verification.id, 'front');

    const read = await getFile(database.db, environment.id, file.id);

    expect(read).toEqual(file);
    expect(read).toMatchObject({
      verificationId: verification.id,
      kind: 'front',
      mimeType: 'image/jpeg',
      byteSize: 256,
    });
    const opened = decryptBytes(
      { wrappedDek: read?.wrappedDek ?? '', ciphertext },
      database.keyring,
      { context: file.id },
    );
    expect(opened.equals(plaintext)).toBe(true);
    expect(createHash('sha256').update(opened).digest('hex')).toBe(read?.sha256);
  });

  it('lists the files of several verifications', async () => {
    const { environment, verification } = await newVerification();
    const front = await upload(environment.id, verification.id, 'front');
    const back = await upload(environment.id, verification.id, 'back');

    const listed = await listVerificationFiles(database.db, environment.id, [verification.id]);

    expect(listed.map((file) => file.id).sort()).toEqual([front.file.id, back.file.id].sort());
    expect(await listVerificationFiles(database.db, environment.id, [])).toEqual([]);
  });

  it('keeps files inside their environment', async () => {
    const { environment, verification } = await newVerification();
    const { file } = await upload(environment.id, verification.id, 'front');
    const other = await createTestTenant(database.db);

    expect(await getFile(database.db, other.environment.id, file.id)).toBeNull();
    expect(
      await listVerificationFiles(database.db, other.environment.id, [verification.id]),
    ).toEqual([]);
  });
});

describe('replaceVerificationFile', () => {
  it('stores the first file of a kind and replaces nothing', async () => {
    const { environment, verification } = await newVerification();
    const { input } = newFile(verification.id, 'front', environment.id);

    const stored = await replaceVerificationFile(database.db, environment.id, input);

    expect(stored?.replaced).toEqual([]);
    expect(stored?.file).toMatchObject({ id: input.id, kind: 'front' });
    expect(await getFile(database.db, environment.id, input.id)).toEqual(stored?.file);
  });

  it('removes the earlier file of the same kind and returns it, keeping other kinds', async () => {
    const { environment, verification } = await newVerification();
    const front = await upload(environment.id, verification.id, 'front');
    const back = await upload(environment.id, verification.id, 'back');
    const { input } = newFile(verification.id, 'front', environment.id);

    const stored = await replaceVerificationFile(database.db, environment.id, input);

    expect(stored?.replaced).toEqual([front.file]);
    const listed = await listVerificationFiles(database.db, environment.id, [verification.id]);
    expect(listed.map((file) => file.id).sort()).toEqual([back.file.id, input.id].sort());
    expect(await getFile(database.db, environment.id, front.file.id)).toBeNull();
  });

  it('writes nothing once the verification is no longer initiated', async () => {
    const { environment, verification } = await newVerification();
    const front = await upload(environment.id, verification.id, 'front');
    await setVerificationStatus(database.db, environment.id, verification.id, {
      to: 'submitted',
    });
    const { input } = newFile(verification.id, 'front', environment.id);

    expect(await replaceVerificationFile(database.db, environment.id, input)).toBeNull();
    expect(
      (await listVerificationFiles(database.db, environment.id, [verification.id])).map(
        (file) => file.id,
      ),
    ).toEqual([front.file.id]);
  });

  it("writes nothing for another environment's verification", async () => {
    const { verification } = await newVerification();
    const other = await createTestTenant(database.db);
    const { input } = newFile(verification.id, 'front', other.environment.id);

    expect(await replaceVerificationFile(database.db, other.environment.id, input)).toBeNull();
    expect(await getFile(database.db, other.environment.id, input.id)).toBeNull();
  });
});

describe('replaceServerWrittenFile (C54.1)', () => {
  function serverFile(verificationId: string, environmentId: string) {
    const { input } = newFile(verificationId, 'front', environmentId);
    return { ...input, kind: 'document-preview' as const, mimeType: 'image/png' };
  }

  it('stores a server-written file whatever the status, replacing the kind earlier one', async () => {
    const { environment, verification } = await newVerification();
    await setVerificationStatus(database.db, environment.id, verification.id, {
      to: 'submitted',
    });
    const front = await upload(environment.id, verification.id, 'front');
    const first = serverFile(verification.id, environment.id);
    const second = serverFile(verification.id, environment.id);

    const stored = await replaceServerWrittenFile(database.db, environment.id, first);
    const again = await replaceServerWrittenFile(database.db, environment.id, second);

    expect(stored.replaced).toEqual([]);
    expect(again.replaced.map((file) => file.id)).toEqual([first.id]);
    const listed = await listVerificationFiles(database.db, environment.id, [verification.id]);
    expect(listed.map((file) => file.id).sort()).toEqual([front.file.id, second.id].sort());
  });

  it('refuses a kind a client uploads', async () => {
    const { environment, verification } = await newVerification();
    const { input } = newFile(verification.id, 'front', environment.id);

    await expect(
      replaceServerWrittenFile(database.db, environment.id, input),
    ).rejects.toBeInstanceOf(RangeError);
    expect(SERVER_WRITTEN_FILE_KINDS).toEqual(['document-preview', 'chip-portrait']);
  });
});
