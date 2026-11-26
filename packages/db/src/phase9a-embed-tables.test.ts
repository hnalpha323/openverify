/**
 * Workflow 9A Stage 1b, checkpoint (F): what `foundation-9a` builds in the database for the flow
 * client, its server and the embed (C153.2, C158.1, C158.4):
 *
 * - `files.capture_method`, how a file was captured (`camera` or `upload`, C153.2), held by a CHECK
 *   and `null` when the client did not say;
 * - `inquiries.redirect_uri`, the redirect an inquiry was created with (C158.4), at most 2,048
 *   characters, `null` when none;
 * - the embedding settings of an environment (`allowed-embed-origins`, `allowed-redirect-origins`),
 *   stored with the other C16 settings.
 *
 * Every value is synthetic; every origin is a reserved name.
 */
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createKeyring, setDefaultKeyring } from './crypto.js';
import { FILE_CAPTURE_METHODS } from '@openverify/core';
import {
  createFile,
  createInquiry,
  getEnvironment,
  getInquiry,
  updateEnvironmentSettings,
} from './repositories/index.js';
import {
  createTestDatabase,
  createTestInquiry,
  createTestTenant,
  createTestVerificationOnEarlierSchema,
  testId,
  type TestDatabase,
} from './testing.js';

let database: TestDatabase;

beforeAll(async () => {
  database = await createTestDatabase({ keyring: createKeyring(randomBytes(32)) });
}, 120_000);

afterAll(async () => {
  setDefaultKeyring(undefined);
  await database.close();
});

const refused = async (text: string, params: unknown[]) =>
  database.client.query(text, params).then(
    () => 'accepted',
    (error: unknown) => (error instanceof Error ? error.message : String(error)),
  );

async function seededVerification() {
  const { environment } = await createTestTenant(database.db);
  const { inquiry, template } = await createTestInquiry(database.db, environment.id);
  const verification = await createTestVerificationOnEarlierSchema(database.db, environment.id, {
    inquiryId: inquiry.id,
    type: 'government_id',
  });
  return { environmentId: environment.id, inquiry, template, verificationId: verification.id };
}

const fileInput = (verificationId: string) => ({
  id: testId('file'),
  verificationId,
  kind: 'front' as const,
  storageKey: `synthetic/${testId('file')}`,
  mimeType: 'image/png',
  byteSize: 10,
  sha256: '0'.repeat(64),
  wrappedDek: `ov1.${'A'.repeat(11)}.${'B'.repeat(80)}`,
});

describe('files.capture_method (C153.2)', () => {
  it('names the two capture methods the flow offers', () => {
    expect(FILE_CAPTURE_METHODS).toEqual(['upload', 'camera']);
  });

  it('keeps how a file was captured, and null when the client did not say', async () => {
    const { environmentId, verificationId } = await seededVerification();

    const camera = await createFile(database.db, environmentId, {
      ...fileInput(verificationId),
      captureMethod: 'camera',
    });
    const unsaid = await createFile(database.db, environmentId, {
      ...fileInput(verificationId),
      kind: 'back',
    });

    expect(camera.captureMethod).toBe('camera');
    expect(unsaid.captureMethod).toBeNull();
  });

  it('refuses any other method', async () => {
    const { environmentId, verificationId } = await seededVerification();
    const file = await createFile(database.db, environmentId, fileInput(verificationId));

    expect(
      await refused(`update files set capture_method = 'scanner' where id = $1`, [file.id]),
    ).toContain('files_capture_method_valid');
  });
});

describe('inquiries.redirect_uri (C158.4)', () => {
  it('keeps the redirect an inquiry was created with, and none by default', async () => {
    const { environmentId, template } = await seededVerification();

    const redirected = await createInquiry(database.db, environmentId, {
      id: testId('inq'),
      inquiryTemplateId: template.id,
      inquiryTemplateVersionId: template.latestVersion.id,
      referenceId: null,
      fields: {},
      redirectUri: 'https://shop.example.com/done',
    });
    const plain = await createTestInquiry(database.db, environmentId);

    expect((await getInquiry(database.db, environmentId, redirected.id))?.redirectUri).toBe(
      'https://shop.example.com/done',
    );
    expect(plain.inquiry.redirectUri).toBeNull();
  });

  it('refuses one longer than 2,048 characters', async () => {
    const { environmentId, inquiry } = await seededVerification();

    expect(
      await refused(
        `update inquiries set redirect_uri = $1 where environment_id = $2 and id = $3`,
        [`https://shop.example.com/${'a'.repeat(2048)}`, environmentId, inquiry.id],
      ),
    ).toContain('inquiries_redirect_uri_length');
  });
});

describe('the embedding settings (C158.1, C158.4)', () => {
  it('are stored with the other settings of the environment', async () => {
    const { environment } = await createTestTenant(database.db);

    await updateEnvironmentSettings(database.db, environment.id, {
      'allowed-embed-origins': ['https://shop.example.com', 'https://*.example.org'],
      'allowed-redirect-origins': null,
    });

    expect((await getEnvironment(database.db, environment.id))?.settings).toMatchObject({
      'allowed-embed-origins': ['https://shop.example.com', 'https://*.example.org'],
      'allowed-redirect-origins': null,
    });
  });
});
