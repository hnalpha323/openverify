/**
 * C42.7 `face-index:rebuild` on PGlite: only rows that exist are rebuilt, from the centre file of
 * their verification, keeping `created_at`; rows whose files are gone, show no face, lost their
 * consent or whose inquiry was redacted, declined or failed are deleted; a dry run writes nothing.
 * Every embedding and layout is synthetic.
 */
import { createHash } from 'node:crypto';
import { defaultInquiryTemplateAttributes, newId } from '@openverify/contracts';
import {
  createFile,
  createInquirySession,
  createVerification,
  encryptBytes,
  faceTemplates,
  inquiries,
  openFaceTemplate,
  recordInquirySessionConsent,
  selfieBackgrounds,
  transitionInquiryStatus,
  writeFaceData,
  type Db,
  type Keyring,
} from '@openverify/db';
import {
  createTestDatabase,
  createTestInquiry,
  createTestTenant,
  type TestDatabase,
} from '@openverify/db/testing';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { VisionServiceError } from '../vision/index.js';
import { rebuildFaceIndex } from './face-index-rebuild.js';
import { cosine, syntheticJpeg, threePoseAnalysis, unitVector } from './selfie-testing.js';
import { createFakeVision, createMemoryStorage, embedFaceAnswer } from './testing.js';

const defaults = defaultInquiryTemplateAttributes();
const CREATED = new Date('2026-09-01T00:00:00.000Z');
const OLD_EMBEDDING = unitVector(1);
const OLD_LAYOUT = Array.from({ length: 144 }, () => 50);

let database: TestDatabase;
let db: Db;
let keyring: Keyring;
const storage = createMemoryStorage();

beforeAll(async () => {
  database = await createTestDatabase();
  db = database.db;
  keyring = database.keyring;
}, 60_000);

afterAll(async () => {
  await database.close();
});

/** The face of the new model: the golden selfie's centre face. */
const NEW_FACE = () => {
  const face = threePoseAnalysis().poses.center.face;
  if (face === null) {
    throw new Error('the golden selfie has a centre face');
  }
  return face;
};

/** Each recorded consent is later than the one before, so the latest one counts. */
let consents = 0;

async function consent(environmentId: string, inquiryId: string, keys: string[]) {
  consents += 1;
  const session = await createInquirySession(db, environmentId, {
    id: newId('iqse'),
    inquiryId,
    tokenHash: createHash('sha256').update(newId('iqse')).digest('hex'),
    expiresAt: new Date('2027-01-01T00:00:00.000Z'),
  });
  await recordInquirySessionConsent(db, environmentId, session.id, {
    acceptedAt: new Date(CREATED.getTime() + consents * 1000),
    textKeys: ['consent.biometric', 'consent.processing'],
    optionalTextKeys: keys,
    locale: 'en',
    ip: null,
    userAgent: null,
  });
}

interface StoredSelfie {
  environmentId: string;
  inquiryId: string;
  verificationId: string;
  center: Uint8Array;
  storageKey: string;
  templateId: string | null;
}

/**
 * A pending inquiry of the default template with matching consent and a selfie with a centre file;
 * with `template`, a template (the old embedding) and, with `background`, its background row,
 * created at CREATED.
 */
async function storedSelfie(options: { template?: boolean; background?: boolean } = {}) {
  const environmentId = (await createTestTenant(db)).environment.id;
  const { inquiry } = await createTestInquiry(db, environmentId, {
    flow: defaults.flow,
    verificationConfig: defaults['verification-config'],
  });
  await transitionInquiryStatus(db, environmentId, inquiry.id, { from: 'created', to: 'pending' });
  await consent(environmentId, inquiry.id, ['consent.biometric-matching']);
  const verificationId = newId('ver');
  await createVerification(db, environmentId, {
    id: verificationId,
    inquiryId: inquiry.id,
    type: 'selfie',
  });
  const id = newId('file');
  const center = syntheticJpeg();
  const sealed = encryptBytes(center, keyring, { context: id });
  const storageKey = `${environmentId}/${id}`;
  await storage.put(storageKey, sealed.ciphertext);
  await createFile(db, environmentId, {
    id,
    verificationId,
    kind: 'selfie-center',
    storageKey,
    mimeType: 'image/jpeg',
    byteSize: center.length,
    sha256: createHash('sha256').update(center).digest('hex'),
    wrappedDek: sealed.wrappedDek,
  });
  let templateId: string | null = null;
  if (options.template !== false) {
    ({ templateId } = await writeFaceData(db, environmentId, {
      verificationId,
      inquiryId: inquiry.id,
      model: 'sface-2020old',
      embedding: OLD_EMBEDDING,
      background:
        options.background === false
          ? null
          : { layout: OLD_LAYOUT, validCells: '1'.repeat(48), coverage: 1 },
    }));
    await db
      .update(faceTemplates)
      .set({ createdAt: CREATED })
      .where(eq(faceTemplates.id, templateId));
    await db
      .update(selfieBackgrounds)
      .set({ createdAt: CREATED })
      .where(eq(selfieBackgrounds.faceTemplateId, templateId));
  }
  return {
    environmentId,
    inquiryId: inquiry.id,
    verificationId,
    center,
    storageKey,
    templateId,
  } satisfies StoredSelfie;
}

async function rowsOf(verificationId: string) {
  const templates = await db
    .select()
    .from(faceTemplates)
    .where(eq(faceTemplates.verificationId, verificationId));
  const backgrounds = await db
    .select()
    .from(selfieBackgrounds)
    .where(eq(selfieBackgrounds.verificationId, verificationId));
  return { templates, backgrounds };
}

function vision() {
  const fake = createFakeVision();
  fake.answers.embedFace = embedFaceAnswer(NEW_FACE());
  fake.answers.selfie = threePoseAnalysis();
  return fake;
}

/** Runs one rebuild over every environment, from a clean slate of other tests' rows. */
async function rebuild(fake = vision(), dryRun = false) {
  return rebuildFaceIndex({ db, storage, keyring, vision: fake.client }, { dryRun, batchSize: 2 });
}

describe('face-index:rebuild (C42.7)', () => {
  it('re-embeds an existing template from its centre file and rewrites it and its background, keeping created_at', async () => {
    await db.delete(faceTemplates);
    const selfie = await storedSelfie();
    const withoutTemplate = await storedSelfie({ template: false });
    const fake = vision();

    expect(await rebuild(fake)).toEqual({ examined: 1, rewritten: 1, deleted: 0, failed: 0 });

    const { templates, backgrounds } = await rowsOf(selfie.verificationId);
    expect(templates).toHaveLength(1);
    expect(templates[0]).toMatchObject({
      id: selfie.templateId,
      model: 'sface-2021dec',
      createdAt: CREATED,
    });
    const opened = templates[0] === undefined ? null : openFaceTemplate(templates[0]);
    expect(cosine(opened?.embedding ?? [], NEW_FACE().embedding)).toBeCloseTo(1, 5);
    expect(backgrounds).toEqual([
      expect.objectContaining({
        faceTemplateId: selfie.templateId,
        layout: threePoseAnalysis().poses.center.background?.layout,
        coverage: threePoseAnalysis().poses.center.background?.coverage,
        createdAt: CREATED,
      }),
    ]);
    // The centre file, as a selfie (vision's default subject), then the centre analysis.
    expect(fake.calls.map((call) => call.endpoint)).toEqual(['embed-face', 'selfie']);
    expect(fake.calls[0]?.images.image?.bytes).toEqual([...selfie.center]);
    expect(fake.calls[0]).not.toHaveProperty('subject');
    expect(fake.calls[1]?.images).toEqual({
      center: { mimeType: 'image/jpeg', bytes: [...selfie.center] },
    });
    // It never creates a row that does not exist.
    expect(await rowsOf(withoutTemplate.verificationId)).toEqual({
      templates: [],
      backgrounds: [],
    });
  });

  it('gives a template without a background row none, and skips the centre analysis', async () => {
    await db.delete(faceTemplates);
    const selfie = await storedSelfie({ background: false });
    const fake = vision();

    expect(await rebuild(fake)).toEqual({ examined: 1, rewritten: 1, deleted: 0, failed: 0 });

    expect((await rowsOf(selfie.verificationId)).backgrounds).toEqual([]);
    expect(fake.calls.map((call) => call.endpoint)).toEqual(['embed-face']);
  });

  it('deletes a row whose centre file is gone, or whose file shows no face to the new model', async () => {
    await db.delete(faceTemplates);
    const gone = await storedSelfie();
    await storage.delete(gone.storageKey);
    const faceless = await storedSelfie();
    const fake = vision();
    fake.answers.embedFace = embedFaceAnswer(null);

    expect(await rebuild(fake)).toEqual({ examined: 2, rewritten: 0, deleted: 2, failed: 0 });

    expect(await rowsOf(gone.verificationId)).toEqual({ templates: [], backgrounds: [] });
    expect(await rowsOf(faceless.verificationId)).toEqual({ templates: [], backgrounds: [] });
  });

  it('deletes a row whose consent no longer holds, or whose inquiry was redacted, declined or failed', async () => {
    await db.delete(faceTemplates);
    const withdrawn = await storedSelfie();
    await consent(withdrawn.environmentId, withdrawn.inquiryId, []);
    const redacted = await storedSelfie();
    await db
      .update(inquiries)
      .set({ redactedAt: new Date() })
      .where(eq(inquiries.id, redacted.inquiryId));
    const declined = await storedSelfie();
    await db
      .update(inquiries)
      .set({ status: 'declined' })
      .where(eq(inquiries.id, declined.inquiryId));
    const failed = await storedSelfie();
    await db.update(inquiries).set({ status: 'failed' }).where(eq(inquiries.id, failed.inquiryId));

    expect(await rebuild()).toEqual({ examined: 4, rewritten: 0, deleted: 4, failed: 0 });

    for (const selfie of [withdrawn, redacted, declined, failed]) {
      expect(await rowsOf(selfie.verificationId)).toEqual({ templates: [], backgrounds: [] });
    }
  });

  it('leaves a row as it is when vision fails, and counts it', async () => {
    await db.delete(faceTemplates);
    const selfie = await storedSelfie();
    const fake = vision();
    fake.answers.embedFace = new VisionServiceError('/v1/embed/face', 503);

    expect(await rebuild(fake)).toEqual({ examined: 1, rewritten: 0, deleted: 0, failed: 1 });

    const { templates } = await rowsOf(selfie.verificationId);
    expect(templates[0]).toMatchObject({ model: 'sface-2020old' });
  });

  it('counts what it would do in a dry run, and writes nothing nor calls vision', async () => {
    await db.delete(faceTemplates);
    const kept = await storedSelfie();
    const gone = await storedSelfie();
    await storage.delete(gone.storageKey);
    const fake = vision();

    expect(await rebuild(fake, true)).toEqual({ examined: 2, rewritten: 1, deleted: 1, failed: 0 });

    expect(fake.calls).toEqual([]);
    expect((await rowsOf(kept.verificationId)).templates[0]).toMatchObject({
      model: 'sface-2020old',
    });
    expect((await rowsOf(gone.verificationId)).templates).toHaveLength(1);
  });
});
