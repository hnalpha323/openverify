/**
 * The `document` job (C60, C54.1) through `processVerification`: the decrypted upload goes to
 * vision's `/v1/analyze/document` as the type it was sniffed as, and the C60.5 and C60.6
 * evaluators of `@openverify/checks` judge the answer against the step's classes and the
 * references (the inquiry's fields, else its latest passed or reviewed government ID, else the
 * account). The decision transaction writes the extraction (`document_extractions`) and the page-1
 * preview vision renders (`document-preview`, through `storeServerFile`, replacing any earlier
 * one) before the verification event. Vision's refusals are the type check's user-behaviour
 * failures; an outage is retried, then `execution_error` (review); a preview that cannot be
 * rendered on the last attempt is left out, never invented. No extracted value is logged or put in
 * check metadata. Every document and value is synthetic.
 */
import { createHash } from 'node:crypto';
import { eventPayloadSchema, newId } from '@openverify/contracts';
import {
  defaultTemplateConfig,
  emptyExtractedFields,
  type VerificationTemplateConfig,
} from '@openverify/core';
import {
  createFile,
  createGovernmentIdExtraction,
  createVerification,
  decryptBytes,
  encryptBytes,
  getDocumentExtraction,
  getInquiry,
  getVerification,
  listEvents,
  listVerificationFiles,
  openDocumentExtractionFields,
  setVerificationStatus,
  transitionInquiryStatus,
  updateAccount,
  type Db,
  type Keyring,
} from '@openverify/db';
import {
  createTestDatabase,
  createTestInquiry,
  createTestTenant,
  type TestDatabase,
} from '@openverify/db/testing';
import { flowSchema, type FlowStep } from '@openverify/flow-spec';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createEventPublisher } from '../events/index.js';
import type { DocumentAnalysis } from '../ports.js';
import {
  VisionResponseError,
  VisionServiceError,
  VisionUnavailableError,
} from '../vision/index.js';
import { createWebhookDeliveryScheduler } from '../webhooks/queue.js';
import { MODEL_DIGESTS } from './models.js';
import {
  failVerificationAfterError,
  isPermanentJobFailure,
  processVerification,
  type ProcessVerificationDeps,
} from './process-verification.js';
import {
  FAKE_PNG,
  createCapturingLogger,
  createFakeVision,
  createMemoryStorage,
  createRecordingQueue,
  documentAnalysisFixture,
} from './testing.js';
import { documentJob } from './types/document.js';

const NOW = new Date('2026-10-23T12:00:00.000Z');

const STEP: FlowStep = {
  id: 'proof-of-address',
  type: 'document',
  documentTypes: ['utility_bill', 'bank_statement'],
  captureMethods: ['upload', 'camera'],
};

function flowWith(step: FlowStep) {
  return flowSchema.parse({
    metadata: { specVersion: 1, id: 'proof-of-address', version: 1, name: 'Proof of address' },
    steps: [
      { id: 'consent', type: 'consent', textKeys: ['consent.processing'], required: true },
      step,
      { id: 'completion', type: 'completion', messageKey: 'flow.completion' },
    ],
    transitions: [],
  });
}

/** The holder of the golden bill, as an inquiry prefills it (snake_case inquiry fields). */
const HOLDER_FIELDS = {
  name_first: 'Quinn',
  name_last: 'Valemont',
  address_street_1: '14 Lantern Row',
  address_city: 'Meridale',
  address_subdivision: 'UT',
  address_postal_code: '00000',
  address_country_code: 'US',
};

/** What the golden bill prints, as the extraction stores it. */
const EXTRACTED = {
  name: 'QUINN VALEMONT',
  'address-street-1': '14 LANTERN ROW',
  'address-street-2': null,
  'address-city': 'MERIDALE',
  'address-subdivision': 'UT',
  'address-postal-code': '00000',
  'address-country-code': 'US',
  'issue-date': '2026-09-30',
  issuer: 'UTOPIA WATER BOARD',
  'expiration-date': null,
};

/** Values that must never reach a log or check metadata. */
const PRINTED = ['QUINN', 'VALEMONT', 'LANTERN', 'MERIDALE', 'UTOPIA WATER'];

const PDF_BYTES = new TextEncoder().encode(
  '%PDF-1.7\n% a synthetic bill\n1 0 obj\n<<>>\nendobj\n%%EOF\n',
);
const JPEG_BYTES = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);

/** The golden bill without its covered line: a genuine bill, as far as the cues can tell. */
function genuineBill(): DocumentAnalysis {
  const analysis = documentAnalysisFixture();
  return {
    ...analysis,
    pages: analysis.pages.map((page) => ({
      ...page,
      text_layer: page.text_layer.filter((line) => line.visible),
    })),
  };
}

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

const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

interface StoredObject {
  id: string;
  storageKey: string;
}

/** Seals `bytes` as a file of `kind` of the verification, as the upload route and the job store them. */
async function addFile(
  verificationId: string,
  kind: 'document' | 'document-preview',
  bytes: Uint8Array,
  mimeType: 'application/pdf' | 'image/jpeg' | 'image/png',
): Promise<StoredObject> {
  const id = newId('file');
  const sealed = encryptBytes(bytes, keyring, { context: id });
  const storageKey = `${environmentId}/${id}`;
  await storage.put(storageKey, sealed.ciphertext);
  await createFile(db, environmentId, {
    id,
    verificationId,
    kind,
    storageKey,
    mimeType,
    byteSize: bytes.byteLength,
    sha256: sha256(bytes),
    wrappedDek: sealed.wrappedDek,
  });
  return { id, storageKey };
}

interface SubmittedOptions {
  step?: FlowStep;
  config?: VerificationTemplateConfig;
  fields?: Record<string, string>;
  upload?: { bytes: Uint8Array; mimeType: 'application/pdf' | 'image/jpeg' } | null;
}

/** A pending inquiry with a submitted document verification and its upload. */
async function submittedDocument(options: SubmittedOptions = {}) {
  const { inquiry } = await createTestInquiry(db, environmentId, {
    flow: flowWith(options.step ?? STEP),
    verificationConfig: { document: options.config ?? defaultTemplateConfig('document') },
    fields: options.fields ?? HOLDER_FIELDS,
  });
  await transitionInquiryStatus(db, environmentId, inquiry.id, { from: 'created', to: 'pending' });
  const id = newId('ver');
  await createVerification(db, environmentId, { id, inquiryId: inquiry.id, type: 'document' });
  const upload =
    options.upload === undefined
      ? { bytes: PDF_BYTES, mimeType: 'application/pdf' as const }
      : options.upload;
  const file =
    upload === null ? null : await addFile(id, 'document', upload.bytes, upload.mimeType);
  await setVerificationStatus(db, environmentId, id, { to: 'submitted' });
  return { inquiry, id, file };
}

function setup(analysis: DocumentAnalysis | Error = genuineBill()) {
  const vision = createFakeVision();
  vision.answers.analyzeDocument = analysis;
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
  return { deps, vision, logger };
}

const job = (verificationId: string) => ({ environmentId, verificationId });

async function rejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('expected a rejection');
}

async function checksOf(id: string) {
  const checks = (await getVerification(db, environmentId, id))?.checks ?? [];
  return Object.fromEntries(checks.map((check) => [check.name, check]));
}

async function previewsOf(id: string) {
  return (await listVerificationFiles(db, environmentId, [id])).filter(
    (file) => file.kind === 'document-preview',
  );
}

/** The stored payloads of the events about `resourceId`, oldest first. */
async function payloadsAbout(resourceId: string) {
  const page = await listEvents(db, environmentId, { size: 100 });
  return page.items
    .map((event) => ({ name: event.name, payload: eventPayloadSchema.parse(event.payload) }))
    .filter(({ payload }) => payload.data.id === resourceId)
    .reverse();
}

describe('the document job (C54.1)', () => {
  it('is built and runnable', () => {
    expect(documentJob).toMatchObject({ type: 'document', runnable: true });
  });
});

describe('processVerification: document (C60)', () => {
  it('sends the decrypted PDF to vision, passes a recent bill in the applicant’s name, stores the extraction and a preview, and completes the inquiry', async () => {
    const { inquiry, id } = await submittedDocument();
    const { deps, vision } = setup();

    const result = await processVerification(job(id), deps);

    expect(result).toEqual({
      outcome: 'processed',
      verificationStatus: 'passed',
      inquiryStatus: 'completed',
    });
    const document = { mimeType: 'application/pdf', bytes: [...PDF_BYTES] };
    expect(vision.calls).toEqual([
      { endpoint: 'analyze-document', images: { document } },
      { endpoint: 'render-document-page', images: { document }, page: 1 },
    ]);
    const checks = await checksOf(id);
    expect(Object.keys(checks).sort()).toEqual(
      Object.keys(defaultTemplateConfig('document').checks).sort(),
    );
    expect(checks.document_type_detection).toMatchObject({
      status: 'passed',
      requirement: 'required',
      stage: 'beta',
      metadata: { classification: 'utility_bill', language: 'en' },
      provenance: {
        models: [
          {
            id: 'pp-ocrv6-small-det',
            sha256: MODEL_DIGESTS['pp-ocrv6-small-det']?.sha256,
          },
          {
            id: 'pp-ocrv6-small-rec',
            sha256: MODEL_DIGESTS['pp-ocrv6-small-rec']?.sha256,
          },
        ],
      },
    });
    expect(checks.document_recency_detection).toMatchObject({ status: 'passed' });
    expect(checks.document_name_comparison).toMatchObject({
      status: 'passed',
      requirement: 'required',
      metadata: { 'reference-source': 'inquiry' },
    });
    expect(checks.document_fabrication_detection).toMatchObject({
      status: 'passed',
      requirement: 'not_required',
    });
    expect(await getDocumentExtraction(db, environmentId, id)).toMatchObject({
      inquiryId: inquiry.id,
      documentType: 'utility_bill',
      pageCount: 2,
      mimeType: 'application/pdf',
      redactedAt: null,
    });
    expect((await getDocumentExtraction(db, environmentId, id))?.typeConfidence).toBeGreaterThan(
      0.5,
    );
    expect(await openDocumentExtractionFields(db, environmentId, id)).toEqual(EXTRACTED);
    const [preview, ...more] = await previewsOf(id);
    expect(more).toEqual([]);
    expect(preview).toMatchObject({ mimeType: 'image/png', byteSize: FAKE_PNG.byteLength });
    const ciphertext = preview === undefined ? null : await storage.get(preview.storageKey);
    expect(
      preview === undefined || ciphertext === null
        ? null
        : [
            ...decryptBytes({ wrappedDek: preview.wrappedDek, ciphertext }, keyring, {
              context: preview.id,
            }),
          ],
    ).toEqual([...FAKE_PNG]);
    expect((await getInquiry(db, environmentId, inquiry.id))?.status).toBe('completed');
  });

  it('publishes verification.passed with the extraction in its payload', async () => {
    const { id } = await submittedDocument();

    await processVerification(job(id), setup().deps);

    const events = await payloadsAbout(id);
    expect(events.map((event) => event.name)).toEqual(['verification.passed']);
    expect(events[0]?.payload.data.attributes).toMatchObject({
      'document-type': 'utility_bill',
      'page-count': 2,
      'mime-type': 'application/pdf',
      fields: EXTRACTED,
    });
  });

  it('names the preview it wrote among the event’s files, as a later read lists it (C54.1)', async () => {
    const { id } = await submittedDocument();

    await processVerification(job(id), setup().deps);

    const [preview] = await previewsOf(id);
    const [event] = await payloadsAbout(id);
    const data = event?.payload.data;
    const named =
      data?.type === 'verification/document'
        ? data.relationships.files.data.map((file) => file.id)
        : [];
    expect(preview).toBeDefined();
    expect(named).toContain(preview?.id);
    expect(named).toHaveLength(2);
  });

  it('records the advisory fabrication failure of text hidden over a field, with its components, and still passes', async () => {
    const { id } = await submittedDocument();

    const result = await processVerification(job(id), setup(documentAnalysisFixture()).deps);

    expect(result).toMatchObject({ verificationStatus: 'passed' });
    const fabrication = (await checksOf(id)).document_fabrication_detection;
    expect(fabrication).toMatchObject({
      status: 'failed',
      requirement: 'not_required',
      reasons: ['pdf_hidden_text'],
      stage: 'beta',
    });
    expect(fabrication?.confidence).toBeGreaterThan(0);
    expect(fabrication?.metadata).toMatchObject({
      components: expect.arrayContaining([
        expect.objectContaining({ id: 'hidden-text-over-field', strength: 'strong' }),
      ]) as unknown,
    });
  });

  it('sends a photo of a document as the image it is, and renders its preview too', async () => {
    const { id } = await submittedDocument({
      upload: { bytes: JPEG_BYTES, mimeType: 'image/jpeg' },
    });
    const { deps, vision } = setup(documentAnalysisFixture('analyze-document-image'));

    const result = await processVerification(job(id), deps);

    expect(result).toMatchObject({ verificationStatus: 'passed' });
    const document = { mimeType: 'image/jpeg', bytes: [...JPEG_BYTES] };
    expect(vision.calls).toEqual([
      { endpoint: 'analyze-document', images: { document } },
      { endpoint: 'render-document-page', images: { document }, page: 1 },
    ]);
    expect(await getDocumentExtraction(db, environmentId, id)).toMatchObject({
      pageCount: 1,
      mimeType: 'image/jpeg',
    });
    expect(await previewsOf(id)).toHaveLength(1);
  });

  it('fails a class the step does not accept with one hint', async () => {
    const { id } = await submittedDocument({
      step: { ...STEP, documentTypes: ['bank_statement'] },
    });

    const result = await processVerification(job(id), setup().deps);

    expect(result).toMatchObject({ verificationStatus: 'failed', inquiryStatus: 'pending' });
    const checks = await checksOf(id);
    expect(checks.document_type_detection).toMatchObject({
      status: 'failed',
      reasons: ['document_type_not_accepted'],
    });
    const failed = Object.values(checks).filter(
      (check) => check.status === 'failed' && check.type === 'user_behavior',
    );
    expect(failed.map((check) => check.name)).toEqual(['document_type_detection']);
  });

  it.each([
    [413, null, 'document_too_large'],
    [422, 'too_many_pages', 'document_too_many_pages'],
    [422, 'pdf_encrypted', 'document_password_protected'],
    [422, 'pdf_unprocessable', 'document_unreadable'],
    [422, null, 'document_unreadable'],
    [415, null, 'document_unreadable'],
  ])(
    'fails the type check when vision answers %i %s (%s), stores no extraction or preview, and leaves the inquiry open for a retry',
    async (status, code, reason) => {
      const { inquiry, id } = await submittedDocument();
      const { deps, vision } = setup(new VisionServiceError('/v1/analyze/document', status, code));

      const result = await processVerification(job(id), deps);

      expect(result).toEqual({
        outcome: 'processed',
        verificationStatus: 'failed',
        inquiryStatus: 'pending',
      });
      expect((await checksOf(id)).document_type_detection).toMatchObject({
        status: 'failed',
        type: 'user_behavior',
        reasons: [reason],
      });
      expect(vision.calls.map((call) => call.endpoint)).toEqual(['analyze-document']);
      expect(await getDocumentExtraction(db, environmentId, id)).toBeNull();
      expect(await previewsOf(id)).toEqual([]);
      expect((await getInquiry(db, environmentId, inquiry.id))?.status).toBe('pending');
    },
  );

  it.each([
    [
      'a guarded worker failure',
      new VisionServiceError('/v1/analyze/document', 503, 'guarded_worker_failed'),
    ],
    ['an outage', new VisionUnavailableError('/v1/analyze/document', 'timeout')],
  ])('rethrows %s for a retry while attempts remain, writing nothing', async (_, error) => {
    const { inquiry, id } = await submittedDocument();
    const { deps } = setup(error);

    const thrown = await rejection(processVerification(job(id), deps));

    expect(thrown).toBe(error);
    expect(isPermanentJobFailure(thrown)).toBe(false);
    expect(await getVerification(db, environmentId, id)).toMatchObject({
      status: 'submitted',
      checks: [],
    });
    expect(await getDocumentExtraction(db, environmentId, id)).toBeNull();
    expect(await previewsOf(id)).toEqual([]);
    expect((await getInquiry(db, environmentId, inquiry.id))?.status).toBe('pending');
  });

  it('records execution_error on the last attempt and sends the verification to review', async () => {
    const { id } = await submittedDocument();
    const { deps, vision, logger } = setup(
      new VisionServiceError('/v1/analyze/document', 503, 'guarded_worker_failed'),
    );

    const result = await processVerification(job(id), deps, { lastAttempt: true });

    expect(result).toMatchObject({ verificationStatus: 'needs_review' });
    expect((await checksOf(id)).document_type_detection).toMatchObject({
      status: 'not_applicable',
      reasons: ['execution_error'],
    });
    expect(vision.calls.map((call) => call.endpoint)).toEqual(['analyze-document']);
    expect(await getDocumentExtraction(db, environmentId, id)).toBeNull();
    expect(logger.entries).toContainEqual(
      expect.objectContaining({
        level: 'warn',
        object: expect.objectContaining({
          verificationId: id,
          status: 503,
          code: 'guarded_worker_failed',
        }) as unknown,
      }),
    );
  });

  it('records a vision answer that breaks the contract at once, without a retry', async () => {
    const { id } = await submittedDocument();
    const { deps } = setup(
      new VisionResponseError('/v1/analyze/document', [{ path: 'pages', code: 'invalid_type' }]),
    );

    const result = await processVerification(job(id), deps);

    expect(result).toMatchObject({ verificationStatus: 'needs_review' });
    expect((await checksOf(id)).document_type_detection).toMatchObject({
      status: 'not_applicable',
      reasons: ['execution_error'],
    });
  });

  it('retries a preview outage while attempts remain, and on the last attempt decides without one', async () => {
    const { id } = await submittedDocument();
    const outage = new VisionUnavailableError('/v1/render/document-page', 'network');
    const first = setup();
    first.vision.answers.renderDocumentPage = outage;

    expect(await rejection(processVerification(job(id), first.deps))).toBe(outage);
    expect(await getDocumentExtraction(db, environmentId, id)).toBeNull();

    const last = setup();
    last.vision.answers.renderDocumentPage = outage;
    const result = await processVerification(job(id), last.deps, { lastAttempt: true });

    expect(result).toMatchObject({ verificationStatus: 'passed' });
    expect(await getDocumentExtraction(db, environmentId, id)).toMatchObject({
      documentType: 'utility_bill',
    });
    expect(await previewsOf(id)).toEqual([]);
    expect(last.logger.entries).toContainEqual(
      expect.objectContaining({
        level: 'warn',
        object: expect.objectContaining({ verificationId: id }) as unknown,
      }),
    );
  });

  it('decides without a preview when vision cannot render the page for good', async () => {
    const { id } = await submittedDocument();
    const { deps, vision } = setup();
    vision.answers.renderDocumentPage = new VisionResponseError('/v1/render/document-page', []);

    const result = await processVerification(job(id), deps);

    expect(result).toMatchObject({ verificationStatus: 'passed' });
    expect(await previewsOf(id)).toEqual([]);
  });

  it('replaces a preview an earlier run left, deleting its object once the decision committed', async () => {
    const { id } = await submittedDocument();
    const earlier = await addFile(id, 'document-preview', FAKE_PNG, 'image/png');

    await processVerification(job(id), setup().deps);

    const previews = await previewsOf(id);
    expect(previews).toHaveLength(1);
    expect(previews[0]?.id).not.toBe(earlier.id);
    expect(storage.objects.has(earlier.storageKey)).toBe(false);
    expect(storage.objects.has(previews[0]?.storageKey ?? '')).toBe(true);
  });

  it('keeps the decision when a replaced preview’s object cannot be deleted, and logs that with ids only', async () => {
    const { id } = await submittedDocument();
    await addFile(id, 'document-preview', FAKE_PNG, 'image/png');
    const { deps, logger } = setup();
    const failing: ProcessVerificationDeps = {
      ...deps,
      storage: { ...storage, delete: () => Promise.reject(new Error('storage unavailable')) },
    };

    const result = await processVerification(job(id), failing);

    expect(result).toMatchObject({ verificationStatus: 'passed' });
    expect(await previewsOf(id)).toHaveLength(1);
    expect(logger.entries).toContainEqual(
      expect.objectContaining({ level: 'warn', object: { verificationId: id, failed: 1 } }),
    );
  });

  describe('the references of the name and address comparisons (C60.6)', () => {
    async function governmentId(
      inquiryId: string,
      status: 'passed' | 'needs_review' | 'failed',
      name: { first: string; last: string },
    ) {
      const id = newId('ver');
      await createVerification(db, environmentId, { id, inquiryId, type: 'government_id' });
      await createGovernmentIdExtraction(db, environmentId, {
        verificationId: id,
        fields: {
          ...emptyExtractedFields(),
          'name-first': name.first,
          'name-last': name.last,
          'address-street-1': '14 LANTERN ROW',
          'address-city': 'MERIDALE',
          'address-postal-code': '00000',
          'address-country-code': 'US',
        },
        fieldSources: {},
        identificationNumberIndex: null,
        frontPhash: null,
      });
      await setVerificationStatus(db, environmentId, id, { to: status });
      return id;
    }

    it('compares with the latest passed or reviewed government ID when the inquiry has no fields', async () => {
      const { inquiry, id } = await submittedDocument({ fields: {} });
      await governmentId(inquiry.id, 'passed', { first: 'Avery', last: 'Example' });
      await governmentId(inquiry.id, 'needs_review', { first: 'Quinn', last: 'Valemont' });

      const result = await processVerification(job(id), setup().deps);

      expect(result).toMatchObject({ verificationStatus: 'passed' });
      expect((await checksOf(id)).document_name_comparison).toMatchObject({
        status: 'passed',
        metadata: { 'reference-source': 'government_id' },
      });
    });

    it('never compares with a failed government ID: without another reference it goes to review', async () => {
      const { inquiry, id } = await submittedDocument({ fields: {} });
      await governmentId(inquiry.id, 'failed', { first: 'Quinn', last: 'Valemont' });

      const result = await processVerification(job(id), setup().deps);

      expect(result).toMatchObject({ verificationStatus: 'needs_review' });
      expect((await checksOf(id)).document_name_comparison).toMatchObject({
        status: 'not_applicable',
        reasons: ['no_reference_data'],
      });
    });

    it('falls back to the account’s fields', async () => {
      const { inquiry, id } = await submittedDocument({ fields: {} });
      await updateAccount(db, environmentId, inquiry.accountId, { fields: HOLDER_FIELDS });

      const result = await processVerification(job(id), setup().deps);

      expect(result).toMatchObject({ verificationStatus: 'passed' });
      expect((await checksOf(id)).document_name_comparison).toMatchObject({
        status: 'passed',
        metadata: { 'reference-source': 'account' },
      });
    });

    it('fails the name of another person, the hint the user can act on', async () => {
      const { id } = await submittedDocument({
        fields: { ...HOLDER_FIELDS, name_first: 'Avery', name_last: 'Example' },
      });

      const result = await processVerification(job(id), setup().deps);

      expect(result).toMatchObject({ verificationStatus: 'failed' });
      expect((await checksOf(id)).document_name_comparison).toMatchObject({
        status: 'failed',
        type: 'user_behavior',
        reasons: ['document_name_mismatch'],
      });
    });
  });

  it.each([
    ['the stored object is missing', 'file_missing', (key: string) => storage.delete(key)],
    [
      'the ciphertext was tampered with',
      'file_undecryptable',
      (key: string) => {
        const ciphertext = Uint8Array.from(storage.objects.get(key) ?? []);
        ciphertext[20] = (ciphertext[20] ?? 0) ^ 0xff;
        return storage.put(key, ciphertext);
      },
    ],
    [
      'the content is neither an image nor a PDF',
      'file_type',
      async (key: string, fileId: string) => {
        const text = new TextEncoder().encode('plain text, not a document');
        const other = encryptBytes(text, keyring, { context: fileId });
        await database.client.query(
          'update files set wrapped_dek = $1, sha256 = $2, byte_size = $3 where id = $4',
          [other.wrappedDek, sha256(text), text.byteLength, fileId],
        );
        await storage.put(key, other.ciphertext);
      },
    ],
    [
      'the plaintext does not match its digest',
      'file_integrity',
      async (key: string, fileId: string) => {
        const other = encryptBytes(new TextEncoder().encode('%PDF-1.7 tampered'), keyring, {
          context: fileId,
        });
        await database.client.query('update files set wrapped_dek = $1 where id = $2', [
          other.wrappedDek,
          fileId,
        ]);
        await storage.put(key, other.ciphertext);
      },
    ],
  ])('fails for good, writing nothing, when %s', async (_, reason, damage) => {
    const { id, file } = await submittedDocument();
    if (file === null) {
      throw new Error('no upload');
    }
    await damage(file.storageKey, file.id);
    const { deps, vision } = setup();

    const error = await rejection(processVerification(job(id), deps));

    expect(error).toMatchObject({ name: 'PermanentJobError', reason });
    expect(vision.calls).toEqual([]);
    expect(await getVerification(db, environmentId, id)).toMatchObject({ status: 'submitted' });
    expect(await getDocumentExtraction(db, environmentId, id)).toBeNull();
  });

  it('judges nothing without an upload: every check lacks its input and the verification goes to review', async () => {
    const { id } = await submittedDocument({ upload: null });
    const { deps, vision } = setup();

    const result = await processVerification(job(id), deps);

    expect(result).toMatchObject({ verificationStatus: 'needs_review' });
    expect(vision.calls).toEqual([]);
    expect(
      Object.values(await checksOf(id)).every((check) => check.status === 'not_applicable'),
    ).toBe(true);
  });

  it('logs no extracted value and puts none in the checks', async () => {
    const { id } = await submittedDocument();
    const { deps, logger } = setup(documentAnalysisFixture());
    const refused = await submittedDocument();
    const refusing = setup(new VisionServiceError('/v1/analyze/document', 422, 'pdf_encrypted'));

    await processVerification(job(id), deps);
    await processVerification(job(refused.id), refusing.deps);

    const written = JSON.stringify([
      logger.entries,
      refusing.logger.entries,
      await checksOf(id),
      await checksOf(refused.id),
    ]);
    for (const value of PRINTED) {
      expect(written).not.toContain(value);
    }
  });

  it('fails a verification whose processing cannot finish, writing no extraction or preview', async () => {
    const { id } = await submittedDocument();

    const result = await failVerificationAfterError(job(id), setup().deps, 'PermanentJobError');

    expect(result).toMatchObject({ outcome: 'failed' });
    expect(await getVerification(db, environmentId, id)).toMatchObject({ status: 'failed' });
    expect(await getDocumentExtraction(db, environmentId, id)).toBeNull();
    expect(await previewsOf(id)).toEqual([]);
  });
});
