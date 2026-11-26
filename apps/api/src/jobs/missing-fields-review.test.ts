/**
 * Phase 12A C8: under the default template, a government ID whose extraction lacks a required
 * field goes to manual review instead of failing the inquiry. The card is the synthetic Texas
 * vector of `contracts/fixtures/aamva/valid.json` (a fictional holder, marked as OpenVerify
 * synthetic test data) with its first name element removed, and a front whose OCR reads the
 * other fields; every other required check passes on it in a sandbox.
 */
import { createHash, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { defaultInquiryTemplateAttributes, eventPayloadSchema, newId } from '@openverify/contracts';
import {
  createFile,
  createVerification,
  encryptBytes,
  getInquiry,
  getVerification,
  listEvents,
  setVerificationStatus,
  transitionInquiryStatus,
  type Db,
  type FileKind,
  type Keyring,
} from '@openverify/db';
import {
  createTestDatabase,
  createTestInquiry,
  createTestTenant,
  type TestDatabase,
} from '@openverify/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createEventPublisher } from '../events/index.js';
import type { GovernmentIdAnalysis } from '../ports.js';
import { createWebhookDeliveryScheduler } from '../webhooks/queue.js';
import { processVerification, type ProcessVerificationDeps } from './process-verification.js';
import {
  createCapturingLogger,
  createFakeVision,
  createMemoryStorage,
  createRecordingQueue,
  governmentIdFixture,
  phase3SelfieTemplate,
} from './testing.js';

const NOW = new Date('2026-10-20T12:00:00.000Z');
/** The default template, with the Phase 1-3 passive centre selfie the fake vision answers. */
const defaults = phase3SelfieTemplate(defaultInquiryTemplateAttributes());

let database: TestDatabase;
let db: Db;
let keyring: Keyring;
let environmentId: string;
const storage = createMemoryStorage();

beforeAll(async () => {
  database = await createTestDatabase();
  db = database.db;
  keyring = database.keyring;
  environmentId = (await createTestTenant(db)).environment.id;
}, 60_000);

afterAll(async () => {
  await database.close();
});

/** An AAMVA vector's payload by id (`contracts/fixtures/aamva/valid.json`). */
function vectorPayload(id: string): string {
  const file = path.resolve(import.meta.dirname, '../../../../contracts/fixtures/aamva/valid.json');
  const { vectors } = JSON.parse(readFileSync(file, 'utf8')) as {
    vectors: { id: string; payload: string }[];
  };
  const found = vectors.find((vector) => vector.id === id);
  if (found === undefined) {
    throw new Error(`no AAMVA vector ${id}`);
  }
  return found.payload;
}

/** The payload without one element, its designators recomputed (AAMVA Annex D). */
function withoutElement(payload: string, element: string): string {
  const count = Number(payload.slice(19, 21));
  const header = payload.slice(0, 21);
  const subfiles = Array.from({ length: count }, (_, index) => {
    const designator = payload.slice(21 + index * 10, 31 + index * 10);
    const offset = Number(designator.slice(2, 6));
    const body = payload.slice(offset, offset + Number(designator.slice(6, 10)));
    const kept = body
      .split('\n')
      .filter((line, position) => position === 0 || !line.startsWith(element))
      .join('\n');
    return { type: designator.slice(0, 2), body: kept };
  });
  let offset = header.length + 10 * count;
  const designators = subfiles.map(({ type, body }) => {
    const designator = `${type}${String(offset).padStart(4, '0')}${String(body.length).padStart(4, '0')}`;
    offset += body.length;
    return designator;
  });
  return header + designators.join('') + subfiles.map(({ body }) => body).join('');
}

/** A printed line of the front, as vision returns it. */
const printed = (text: string, row: number) => ({
  text,
  confidence: 0.96,
  box: [40, 100 + row * 30, 260, 22] as const,
  stroke_width_mean: 3.2,
  stroke_width_cv: 0.14,
});

/**
 * The Texas card with no first name anywhere: the barcode lacks `DAC`, and the front prints the
 * surname, birth date, number and expiry under their labels, but no given names.
 */
function cardWithoutFirstName(): GovernmentIdAnalysis {
  const analysis = governmentIdFixture();
  const payload = withoutElement(vectorPayload('dl-636015-version-08-zip-plus-4'), 'DAC');
  const noMrz = { found: false, format_guess: null, lines: [], line_confidences: [], box: null };
  analysis.sides.front.mrz = noMrz;
  analysis.sides.front.text = [
    ['SURNAME', 'QUILLFEATHER'],
    ['DOB', '03/15/1988'],
    ['DL NO', '12345678'],
    ['EXP', '08/01/2033'],
  ].flatMap(([label = '', value = ''], index) => [
    printed(label, index * 2),
    printed(value, index * 2 + 1),
  ]);
  const back = analysis.sides.back;
  if (back === null) {
    throw new Error('the golden fixture has a back');
  }
  back.mrz = noMrz;
  back.text = [];
  back.barcodes = [
    {
      format: 'PDF417',
      bytes_b64: Buffer.from(payload, 'latin1').toString('base64'),
      text: payload,
      quad: [
        [96, 160],
        [928, 160],
        [928, 480],
        [96, 480],
      ],
    },
  ];
  return analysis;
}

const syntheticJpeg = () => Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, ...randomBytes(48)]);
const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

async function pendingInquiry(verificationConfig: Record<string, unknown>) {
  const { inquiry } = await createTestInquiry(db, environmentId, {
    flow: defaults.flow,
    verificationConfig,
  });
  await transitionInquiryStatus(db, environmentId, inquiry.id, { from: 'created', to: 'pending' });
  return inquiry.id;
}

async function addFile(verificationId: string, kind: FileKind) {
  const id = newId('file');
  const bytes = syntheticJpeg();
  const sealed = encryptBytes(bytes, keyring, { context: id });
  const storageKey = `${environmentId}/${id}`;
  await storage.put(storageKey, sealed.ciphertext);
  await createFile(db, environmentId, {
    id,
    verificationId,
    kind,
    storageKey,
    mimeType: 'image/jpeg',
    byteSize: bytes.length,
    sha256: sha256(bytes),
    wrappedDek: sealed.wrappedDek,
  });
}

async function submitted(inquiryId: string, type: 'government_id' | 'selfie') {
  const id = newId('ver');
  await createVerification(db, environmentId, { id, inquiryId, type });
  for (const kind of type === 'government_id' ? (['front', 'back'] as const) : ['selfie-center']) {
    await addFile(id, kind as FileKind);
  }
  await setVerificationStatus(db, environmentId, id, { to: 'submitted' });
  return id;
}

function setup() {
  const vision = createFakeVision();
  vision.answers.governmentId = cardWithoutFirstName();
  const logger = createCapturingLogger();
  const events = createEventPublisher({
    db,
    deliveries: createWebhookDeliveryScheduler(createRecordingQueue()),
    logger,
  });
  const deps: ProcessVerificationDeps = {
    db,
    storage,
    keyring,
    vision: vision.client,
    events,
    clock: { now: () => NOW },
    logger,
  };
  return { deps };
}

/** Names of the events about `resourceId`, oldest first. */
async function eventNames(resourceId: string): Promise<string[]> {
  const page = await listEvents(db, environmentId, { size: 100 });
  return page.items
    .filter((event) => eventPayloadSchema.parse(event.payload).data.id === resourceId)
    .reverse()
    .map((event) => event.name);
}

const job = (verificationId: string) => ({ environmentId, verificationId });

describe('a required field the extraction lacks, under the default template (C8)', () => {
  it('sends the verification to review; the inquiry completes, then is marked for review', async () => {
    const inquiryId = await pendingInquiry(defaults['verification-config']);
    const gov = await submitted(inquiryId, 'government_id');
    const { deps } = setup();

    expect(await processVerification(job(gov), deps)).toEqual({
      outcome: 'processed',
      verificationStatus: 'needs_review',
      inquiryStatus: 'pending',
    });
    const stored = await getVerification(db, environmentId, gov);
    const extracted = stored?.checks.find(
      (check) => check.name === 'id_extracted_properties_detection',
    );
    expect(extracted).toMatchObject({
      status: 'not_applicable',
      reasons: ['required_fields_missing'],
      metadata: { 'missing-fields': ['name-first'] },
    });
    // Every other required check had its evidence: the missing field is the one review reason.
    const required = Object.entries(defaults['verification-config']['government-id']?.checks ?? {})
      .filter(([, check]) => check.enabled && check.required)
      .map(([id]) => id);
    const blocking = (stored?.checks ?? []).filter(
      (check) =>
        required.includes(check.name) &&
        check.name !== 'id_extracted_properties_detection' &&
        (check.status === 'failed' ||
          (check.status === 'not_applicable' &&
            !['feature_absent', 'not_requested'].includes(check.reasons[0] ?? ''))),
    );
    expect(blocking.map((check) => [check.name, check.status, check.reasons])).toEqual([]);

    const selfie = await submitted(inquiryId, 'selfie');
    expect(await processVerification(job(selfie), deps)).toEqual({
      outcome: 'processed',
      verificationStatus: 'passed',
      inquiryStatus: 'needs_review',
    });
    expect(await getInquiry(db, environmentId, inquiryId)).toMatchObject({
      status: 'needs_review',
      completedAt: NOW,
    });
    const names = await eventNames(inquiryId);
    expect(names).toEqual(
      expect.arrayContaining(['inquiry.completed', 'inquiry.marked-for-review']),
    );
    expect(names.indexOf('inquiry.completed')).toBeLessThan(
      names.indexOf('inquiry.marked-for-review'),
    );
    expect(names).not.toContain('inquiry.failed');
  });

  it('fails the verification instead when the template does not opt in (the fail default)', async () => {
    const config = structuredClone(defaults['verification-config']);
    const extracted = config['government-id']?.checks.id_extracted_properties_detection;
    if (extracted === undefined) {
      throw new Error('the default template requires id_extracted_properties_detection');
    }
    delete extracted.config;
    const inquiryId = await pendingInquiry(config);
    const gov = await submitted(inquiryId, 'government_id');
    const { deps } = setup();

    expect(await processVerification(job(gov), deps)).toMatchObject({
      verificationStatus: 'failed',
    });
    const stored = await getVerification(db, environmentId, gov);
    expect(
      stored?.checks.find((check) => check.name === 'id_extracted_properties_detection'),
    ).toMatchObject({ status: 'failed', reasons: ['required_fields_missing'] });
  });
});
