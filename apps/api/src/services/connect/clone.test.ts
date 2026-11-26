/**
 * C234.3, C234.4, C235.1, C235.2 (Workflow 11A, `api-redeem`): the clone writer copies exactly what
 * the policy shares onto a destination inquiry: the verification with its source's status and times
 * and `provenance`, only the shared checks with ADR 0002's labels kept and `connect_provenance`, only
 * the shared files re-encrypted under a new data key as a new object, and the extracted data only
 * with `extracted-data` (a government ID's without its blind index or front hash, so the clone joins
 * no repeat search). It stages no event.
 *
 * Synthetic rows and bytes only (rule 9).
 */
import { createHash } from 'node:crypto';
import { newId } from '@openverify/contracts';
import type { SharedVerification } from '@openverify/core';
import {
  decryptBytes,
  encryptBytes,
  getGovernmentIdExtraction,
  getVerification,
  listInquiryVerifications,
  listVerificationFiles,
  type Db,
  type Keyring,
} from '@openverify/db';
import type { ExtractedFields } from '@openverify/core';
import {
  createTestDatabase,
  createTestInquiry,
  createTestTenant,
  type TestDatabase,
} from '@openverify/db/testing';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ulidIdGenerator } from '../../ports.js';
import { createInMemoryFileStorage } from '../../storage/index.js';
import {
  cloneVerificationsInTx,
  type CloneWriter,
  type SourceVerificationMaterial,
} from './clone.js';

let database: TestDatabase;
let db: Db;
let environmentId: string;
let keyring: Keyring;

beforeAll(async () => {
  database = await createTestDatabase();
  db = database.db;
  keyring = database.keyring;
  environmentId = (await createTestTenant(db)).environment.id;
}, 120_000);

afterAll(async () => {
  await database.close();
});

/** The value, or a failed test when it is missing. */
function must<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) {
    throw new Error('the test expected a value');
  }
  return value;
}

const PROVENANCE = {
  kind: 'connect-clone',
  'share-token-id': 'cnst_01M5CN0000000000000011A320',
  'source-organization-name': 'Example Partner',
  'source-environment-kind': 'sandbox',
  'cloned-at': '2026-11-12T10:00:00.000Z',
};
const provenanceOf = (source: { createdAt: Date; status: string }) => ({
  ...PROVENANCE,
  'source-created-at': source.createdAt.toISOString(),
  'source-status': source.status,
});

const FIELDS: ExtractedFields = {
  'name-first': 'QUINN',
  'name-middle': null,
  'name-last': 'VALEMONT synthetic',
  birthdate: '1990-02-14',
  sex: 'X',
  nationality: 'UTO',
  'identification-number': 'X12K45P78',
  'personal-number': null,
  'issue-date': '2024-03-01',
  'expiration-date': '2034-02-28',
  'issuing-authority-code': 'UTO',
  'address-street-1': '12 LANTERN ROW',
  'address-street-2': null,
  'address-city': 'NORTH HAVEN',
  'address-subdivision': null,
  'address-postal-code': 'UT 1024',
  'address-country-code': null,
  endorsements: null,
  restrictions: null,
  'vehicle-class': null,
};

const SOURCE_CREATED = new Date('2026-11-01T09:00:00.000Z');
const SOURCE_DECIDED = new Date('2026-11-01T09:05:00.000Z');
const BYTES = new Uint8Array(Buffer.from('synthetic front image bytes'));

async function sourceMaterial(
  storage: ReturnType<typeof createInMemoryFileStorage>,
): Promise<SourceVerificationMaterial> {
  const fileId = newId('file');
  const sealed = encryptBytes(BYTES, keyring, { context: fileId });
  const storageKey = `${environmentId}/synthetic-source-object`;
  await storage.put(storageKey, sealed.ciphertext);
  const check = (name: string, status: 'passed' | 'failed') => ({
    name,
    status,
    type: 'fraud' as const,
    requirement: 'required' as const,
    reasons: status === 'failed' ? ['synthetic_reason'] : [],
    metadata: { score: 0.9 },
    stage: 'ga' as const,
    confidence: 0.75,
    provenance: { implementation: 'synthetic@1' } as never,
    createdAt: SOURCE_DECIDED,
  });
  return {
    id: newId('ver'),
    type: 'government_id',
    status: 'passed',
    country: 'UT',
    idClass: 'passport',
    submittedAt: SOURCE_CREATED,
    completedAt: SOURCE_DECIDED,
    createdAt: SOURCE_CREATED,
    checks: [check('id_expired', 'passed'), check('id_barcode_detection', 'failed')],
    files: [
      {
        id: fileId,
        kind: 'front',
        mimeType: 'image/png',
        byteSize: BYTES.byteLength,
        sha256: createHash('sha256').update(BYTES).digest('hex'),
        storageKey,
        wrappedDek: sealed.wrappedDek,
        createdAt: SOURCE_CREATED,
      },
      {
        id: newId('file'),
        kind: 'back',
        mimeType: 'image/png',
        byteSize: 1,
        sha256: 'f'.repeat(64),
        storageKey: `${environmentId}/never-read`,
        wrappedDek: sealed.wrappedDek,
        createdAt: SOURCE_CREATED,
      },
    ],
    governmentIdExtraction: {
      fields: FIELDS,
      fieldSources: { 'name-last': ['mrz', 'viz'], birthdate: ['mrz'] },
      idClassGroup: 'passport',
    },
  };
}

const sharedOf = (
  source: SourceVerificationMaterial,
  more: Partial<SharedVerification> = {},
): SharedVerification => ({
  id: source.id,
  kind: 'government-id',
  status: source.status,
  base: { status: source.status },
  extracted: {},
  checks: [{ name: 'id_expired', status: 'passed' }],
  files: source.files.slice(0, 1).map(({ id }) => ({ id, kind: 'document-image' as const })),
  ...more,
});

async function clone(
  extractedData: boolean,
  shared?: (s: SourceVerificationMaterial) => SharedVerification,
) {
  const storage = createInMemoryFileStorage();
  const source = await sourceMaterial(storage);
  const { inquiry } = await createTestInquiry(db, environmentId);
  const counts = await db.transaction(async (tx) => {
    const writer: CloneWriter = {
      tx,
      environmentId,
      storage,
      keyring,
      ids: ulidIdGenerator,
      provenanceOf,
      extractedData,
    };
    return cloneVerificationsInTx(
      writer,
      inquiry.id,
      [(shared ?? sharedOf)(source)],
      new Map([[source.id, source]]),
    );
  });
  const [copy] = await listInquiryVerifications(db, environmentId, inquiry.id);
  return { storage, source, inquiry, counts, copy: must(copy) };
}

describe('the clone writer (C234.3)', () => {
  it('copies the verification with its source’s status and decision time, and its provenance', async () => {
    const { source, counts, copy } = await clone(false);
    expect(copy.id).not.toBe(source.id);
    expect(copy).toMatchObject({
      type: 'government_id',
      status: 'passed',
      country: 'UT',
      idClass: 'passport',
      completedAt: SOURCE_DECIDED,
      createdBySessionId: null,
      provenance: provenanceOf(source),
    });
    expect(counts).toMatchObject({ verifications: 1, checks: 1, files: 1 });
  });

  it('copies only the shared checks, keeping ADR 0002’s labels with connect_provenance (C235.2)', async () => {
    const { copy } = await clone(false);
    const stored = must(await getVerification(db, environmentId, copy.id));
    expect(stored.checks.map(({ name }) => name)).toEqual(['id_expired']);
    expect(stored.checks[0]).toMatchObject({
      status: 'passed',
      type: 'fraud',
      requirement: 'required',
      stage: 'ga',
      confidence: 0.75,
      provenance: { implementation: 'synthetic@1' },
      connectProvenance: { kind: 'connect-clone', 'source-status': 'passed' },
    });
  });

  it('re-encrypts a shared file under a new data key as a new object, and copies no other', async () => {
    const { storage, source, counts, copy } = await clone(false);
    const [stored, ...others] = await listVerificationFiles(db, environmentId, [copy.id]);
    const file = must(stored);
    const sourceFile = must(source.files[0]);
    expect(others).toEqual([]);
    expect(file.id).not.toBe(sourceFile.id);
    expect(file.storageKey).not.toBe(sourceFile.storageKey);
    expect(file.wrappedDek).not.toBe(sourceFile.wrappedDek);
    expect(file.provenance).toMatchObject({ kind: 'connect-clone' });
    expect(counts.storageKeys).toEqual([file.storageKey]);
    expect(counts.fileBytes).toBe(BYTES.byteLength);
    const ciphertext = must(await storage.get(file.storageKey));
    expect(
      Buffer.from(
        decryptBytes({ ciphertext, wrappedDek: file.wrappedDek }, keyring, { context: file.id }),
      ),
    ).toEqual(Buffer.from(BYTES));
  });

  it('copies a government ID’s extracted data only with extracted-data, with no index or front hash', async () => {
    const without = await clone(false);
    expect(await getGovernmentIdExtraction(db, environmentId, without.copy.id)).toBeNull();
    const withData = await clone(true);
    expect(await getGovernmentIdExtraction(db, environmentId, withData.copy.id)).toMatchObject({
      fields: FIELDS,
      identificationNumberIndex: null,
      frontPhash: null,
    });
  });

  it('names a type whose extracted data has no writer, and copies nothing else of it', async () => {
    const storage = createInMemoryFileStorage();
    const source = { ...(await sourceMaterial(storage)), type: 'database', files: [] };
    const { inquiry } = await createTestInquiry(db, environmentId);
    const counts = await db.transaction((tx) =>
      cloneVerificationsInTx(
        {
          tx,
          environmentId,
          storage,
          keyring,
          ids: ulidIdGenerator,
          provenanceOf,
          extractedData: true,
        },
        inquiry.id,
        [sharedOf(source, { kind: 'database', files: [] })],
        new Map([[source.id, source]]),
      ),
    );
    expect(counts.extractionsNotCopied).toEqual(['database']);
  });

  it('refuses a file whose bytes do not match its digest, writing nothing', async () => {
    const storage = createInMemoryFileStorage();
    const source = await sourceMaterial(storage);
    const tampered = {
      ...source,
      files: [{ ...must(source.files[0]), sha256: '0'.repeat(64) }],
    };
    const { inquiry } = await createTestInquiry(db, environmentId);
    await expect(
      db.transaction((tx) =>
        cloneVerificationsInTx(
          {
            tx,
            environmentId,
            storage,
            keyring,
            ids: ulidIdGenerator,
            provenanceOf,
            extractedData: false,
          },
          inquiry.id,
          [sharedOf(tampered)],
          new Map([[tampered.id, tampered]]),
        ),
      ),
    ).rejects.toThrow(/digest/);
    expect(await listInquiryVerifications(db, environmentId, inquiry.id)).toEqual([]);
  });

  it('stages no event: no outbox row is written for a clone (C235.7(a))', async () => {
    const count = async () => {
      const result: unknown = await db.execute(sql`select count(*)::int as n from events`);
      return (result as { rows: { n: number }[] }).rows[0]?.n;
    };
    const before = await count();
    await clone(true);
    expect(await count()).toBe(before);
  });
});
