/**
 * C52.4, C66 on `GET /api/v1/dashboard/files/:id/content`: a document's PDF is served as an
 * attachment under a name the server makes (the file's kind and id, never anything a client
 * sent), so a browser downloads it and never renders it; a photo of a document and the
 * server-written `document-preview` and `chip-portrait` PNGs are served inline as images; every
 * kind's content must be what that kind holds (per-kind sniffing, `detectUploadMimeType`) and what
 * its record says, else an opaque 500 and no audit entry; the raw chip files have no content the
 * console serves (404, no audit entry). Every file is synthetic.
 */
import { createHash, randomBytes } from 'node:crypto';
import {
  FILE_CONTENT_CACHE_CONTROL,
  FILE_VIEWED_AUDIT_ACTION,
  newId,
  type FileKind,
} from '@openverify/contracts';
import { createFile, createVerification, encryptBytes } from '@openverify/db';
import { createTestDatabase, createTestInquiry, type TestDatabase } from '@openverify/db/testing';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  createDashboardHarness,
  type DashboardHarness,
  type TestOrganization,
} from './dashboard.test-support.js';

const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  randomBytes(32),
]);
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), randomBytes(32)]);
const PDF = Buffer.from('%PDF-1.7\n% a synthetic bill\n1 0 obj\n<<>>\nendobj\n%%EOF\n');
/** A DG1 as a chip stores it: one TLV with tag 0x61 (synthetic content). */
const DG1 = Buffer.from([0x61, 0x03, 0x5f, 0x1f, 0x00]);

let database: TestDatabase;
const harnesses: DashboardHarness[] = [];

beforeAll(async () => {
  database = await createTestDatabase();
}, 60_000);

afterEach(async () => {
  await Promise.all(harnesses.splice(0).map((harness) => harness.close()));
});

afterAll(async () => {
  await database.close();
});

const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

async function setup() {
  const api = await createDashboardHarness(database);
  harnesses.push(api);
  const organization = await api.organization();
  const token = await api.signIn((await api.operator(organization, { roles: ['reviewer'] })).email);
  return { api, organization, token };
}

/** Seals `bytes` as a file of `kind`, its record saying `mimeType`. */
async function seedFile(
  api: DashboardHarness,
  organization: TestOrganization,
  type: 'document' | 'government_id_nfc' | 'government_id',
  kind: FileKind,
  bytes: Uint8Array,
  mimeType: string,
) {
  const environmentId = organization.sandboxId;
  const { inquiry } = await createTestInquiry(database.db, environmentId);
  const verification = await createVerification(database.db, environmentId, {
    id: newId('ver'),
    inquiryId: inquiry.id,
    type,
  });
  const id = newId('file');
  const sealed = encryptBytes(bytes, database.keyring, { context: id });
  const storageKey = `${environmentId}/${id}`;
  await api.storage.put(storageKey, sealed.ciphertext);
  await createFile(database.db, environmentId, {
    id,
    verificationId: verification.id,
    kind,
    storageKey,
    mimeType,
    byteSize: bytes.byteLength,
    sha256: sha256(bytes),
    wrappedDek: sealed.wrappedDek,
  });
  return id;
}

describe('GET /files/:id/content for documents and server-written files (C52.4, C66)', () => {
  it('serves a document’s PDF as an attachment named by the server, uncached, and audits the view', async () => {
    const { api, organization, token } = await setup();
    const id = await seedFile(api, organization, 'document', 'document', PDF, 'application/pdf');

    const response = await api.call('GET', `/files/${id}/content`, { token });

    expect(response.statusCode).toBe(200);
    expect(response.rawPayload.equals(PDF)).toBe(true);
    expect(response.headers['content-type']).toBe('application/pdf');
    expect(response.headers['content-disposition']).toBe(
      `attachment; filename="document-${id}.pdf"`,
    );
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['cache-control']).toBe(FILE_CONTENT_CACHE_CONTROL);
    const [entry, ...more] = await api.audit(organization.sandboxId, FILE_VIEWED_AUDIT_ACTION);
    expect(more).toEqual([]);
    expect(entry).toMatchObject({ resourceId: id, metadata: { kind: 'document' } });
  });

  it.each([
    ['a photo of a document', 'document', JPEG, 'image/jpeg'],
    ['the document preview', 'document-preview', PNG, 'image/png'],
  ] as const)('serves %s inline as the image it is', async (_, kind, bytes, mimeType) => {
    const { api, organization, token } = await setup();
    const id = await seedFile(api, organization, 'document', kind, bytes, mimeType);

    const response = await api.call('GET', `/files/${id}/content`, { token });

    expect(response.statusCode).toBe(200);
    expect(response.rawPayload.equals(bytes)).toBe(true);
    expect(response.headers['content-type']).toBe(mimeType);
    expect(response.headers['content-disposition']).toBeUndefined();
  });

  it('serves the chip portrait inline as a PNG', async () => {
    const { api, organization, token } = await setup();
    const id = await seedFile(
      api,
      organization,
      'government_id_nfc',
      'chip-portrait',
      PNG,
      'image/png',
    );

    const response = await api.call('GET', `/files/${id}/content`, { token });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toBe('image/png');
  });

  it.each([
    ['a preview that is not a PNG', 'document', 'document-preview', JPEG, 'image/jpeg'],
    ['a chip portrait that is not a PNG', 'government_id_nfc', 'chip-portrait', JPEG, 'image/jpeg'],
    ['an ID photo that is a PDF', 'government_id', 'front', PDF, 'application/pdf'],
    ['a document whose record names another type', 'document', 'document', PDF, 'image/jpeg'],
    [
      'a document that is neither image nor PDF',
      'document',
      'document',
      Buffer.from('plain text'),
      'application/pdf',
    ],
  ] as const)(
    'refuses %s with an opaque 500 and audits nothing',
    async (_, type, kind, bytes, mimeType) => {
      const { api, organization, token } = await setup();
      const id = await seedFile(api, organization, type, kind, bytes, mimeType);

      const response = await api.call('GET', `/files/${id}/content`, { token });

      expect(response.statusCode).toBe(500);
      expect(response.headers['content-type']).toMatch(/^application\/problem\+json/);
      expect(response.headers['cache-control']).toBe(FILE_CONTENT_CACHE_CONTROL);
      expect(await api.audit(organization.sandboxId, FILE_VIEWED_AUDIT_ACTION)).toEqual([]);
    },
  );

  it('serves no raw chip file: 404, and no audit entry', async () => {
    const { api, organization, token } = await setup();
    const id = await seedFile(
      api,
      organization,
      'government_id_nfc',
      'chip-dg1',
      DG1,
      'application/octet-stream',
    );

    const response = await api.call('GET', `/files/${id}/content`, { token });

    expect(response.statusCode).toBe(404);
    expect(response.headers['content-type']).toMatch(/^application\/problem\+json/);
    expect(response.rawPayload.includes(DG1)).toBe(false);
    expect(await api.audit(organization.sandboxId, FILE_VIEWED_AUDIT_ACTION)).toEqual([]);
  });
});
