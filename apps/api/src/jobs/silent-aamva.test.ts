/**
 * C59.6: the silent AAMVA step. Its attempts are created by the worker, in the decision
 * transaction of every government ID decision of an inquiry whose flow has an `aamva` step with
 * `source: government_id`:
 * - an eligible `passed` or `needs_review` decision (a US or territory driver licence or ID card
 *   the document itself established, whose extraction holds the name, birth date, number and an
 *   AAMVA issuer) creates an attempt bound to that ID verification, with the values copied and
 *   re-sealed, moves it to `submitted` and enqueues its job after commit, even after a server skip
 *   or an attempt bound to an earlier ID;
 * - any other final decision creates it `skipped`; a retryable ID failure with attempts left
 *   creates nothing; nothing is created for another type, another source, or a decided inquiry,
 *   and never twice for one ID decision.
 * The last block runs the whole path through the worker. Every value is synthetic.
 */
import { createHash, randomBytes } from 'node:crypto';
import { eventPayloadSchema, newId, type SupportedVerificationType } from '@openverify/contracts';
import {
  defaultTemplateConfig,
  emptyExtractedFields,
  type ExtractedFields,
  type ExtractionFieldSources,
  type VerificationTemplateConfig,
} from '@openverify/core';
import {
  createFile,
  createGovernmentIdExtraction,
  createVerification,
  encryptBytes,
  getInquiry,
  getVerification,
  getVerificationInputs,
  listEvents,
  listInquiryVerifications,
  markQueueRowsAdmitted,
  replaceVerificationChecks,
  setVerificationStatus,
  transitionInquiryStatus,
  type Db,
  type IdClassGroup,
} from '@openverify/db';
import {
  createTestDatabase,
  createTestInquiry,
  createTestTenant,
  seedVerificationInputs,
  type TestDatabase,
} from '@openverify/db/testing';
import { flowSchema, type Flow } from '@openverify/flow-spec';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createEventPublisher } from '../events/index.js';
import type { GovernmentIdAnalysis, ProcessVerificationJob, ProviderBindings } from '../ports.js';
import { createSandboxAamvaProvider } from '../providers/sandbox.js';
import { createWebhookDeliveryScheduler } from '../webhooks/queue.js';
import {
  failVerificationAfterError,
  processVerification,
  type ProcessVerificationDeps,
} from './process-verification.js';
import {
  createCapturingLogger,
  createFakeVision,
  createMemoryStorage,
  createRecordingQueue,
  visionFixture,
} from './testing.js';
import { submittedVerificationSweepJob } from './repeatable/submitted-verifications.js';
import { aamvaJob } from './types/aamva.js';

const NOW = new Date('2026-10-23T12:00:00.000Z');

const consent = {
  id: 'consent',
  type: 'consent',
  textKeys: ['consent.processing'],
  required: true,
};
const governmentIdStep = {
  id: 'government_id',
  type: 'government_id',
  sides: 'front',
  maxAttempts: 2,
  captureMethods: ['upload'],
};
const flowWith = (aamvaSource: 'government_id' | 'form' | null): Flow =>
  flowSchema.parse({
    metadata: { specVersion: 1, id: 'silent-aamva', version: 1, name: 'Silent AAMVA' },
    steps: [
      consent,
      governmentIdStep,
      ...(aamvaSource === null ? [] : [{ id: 'aamva', type: 'aamva', source: aamvaSource }]),
      { id: 'completion', type: 'completion', messageKey: 'flow.completion' },
    ],
    transitions: [],
  });
const SILENT = flowWith('government_id');

/** A US driver licence as the C31 extraction reads its barcode (California's IIN). */
const LICENCE: ExtractedFields = {
  ...emptyExtractedFields(),
  'name-first': 'JORDAN',
  'name-last': 'TESTWORTH',
  birthdate: '1990-02-14',
  'identification-number': 'Y9876543',
  'issuing-authority-code': '636014',
  'issue-date': '2023-02-14',
  'expiration-date': '2031-02-14',
  'address-postal-code': '940431234',
};
const BARCODE: ExtractionFieldSources = {
  'name-first': ['barcode'],
  'name-last': ['barcode'],
  birthdate: ['barcode'],
  'identification-number': ['barcode'],
  'issuing-authority-code': ['barcode'],
};
const VISUAL_ZONE: ExtractionFieldSources = {
  'name-first': ['viz'],
  'name-last': ['viz'],
  birthdate: ['viz'],
  'identification-number': ['viz'],
  'issuing-authority-code': ['viz'],
};
/** What the attempt copies from {@link LICENCE}, as the AAMVA body names it. */
const COPIED = {
  'name-first': 'JORDAN',
  'name-last': 'TESTWORTH',
  birthdate: '1990-02-14',
  'identification-number': 'Y9876543',
  'issuing-authority': 'CA',
  'issue-date': '2023-02-14',
  'expiration-date': '2031-02-14',
  'address-postal-code': '94043-1234',
};

let database: TestDatabase;
let db: Db;
let environmentId: string;
const storage = createMemoryStorage();

/** A synthetic front image of `verificationId`, sealed and stored as the API stores uploads. */
async function addFront(verificationId: string): Promise<void> {
  const id = newId('file');
  const bytes = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, ...randomBytes(48)]);
  const sealed = encryptBytes(bytes, database.keyring, { context: id });
  await storage.put(`${environmentId}/${id}`, sealed.ciphertext);
  await createFile(db, environmentId, {
    id,
    verificationId,
    kind: 'front',
    storageKey: `${environmentId}/${id}`,
    mimeType: 'image/jpeg',
    byteSize: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    wrappedDek: sealed.wrappedDek,
  });
}

beforeAll(async () => {
  database = await createTestDatabase();
  db = database.db;
  environmentId = (await createTestTenant(db)).environment.id;
}, 60_000);

afterAll(async () => {
  await database.close();
});

function setup(options: { aamva?: boolean; analysis?: GovernmentIdAnalysis } = {}) {
  const logger = createCapturingLogger();
  const events = createEventPublisher({
    db,
    deliveries: createWebhookDeliveryScheduler(createRecordingQueue()),
    logger,
  });
  const enqueued: ProcessVerificationJob[] = [];
  const vision = createFakeVision();
  if (options.analysis !== undefined) {
    vision.answers.governmentId = options.analysis;
  }
  const providers: ProviderBindings = {
    sandbox: options.aamva === true ? { aamva: createSandboxAamvaProvider() } : {},
    production: {},
  };
  const deps: ProcessVerificationDeps = {
    db,
    storage,
    keyring: database.keyring,
    vision: vision.client,
    events,
    clock: { now: () => NOW },
    logger,
    providers,
    queue: {
      enqueueProcessVerification: (job) => {
        enqueued.push(job);
        return Promise.resolve();
      },
    },
  };
  return { deps, enqueued };
}

async function pendingInquiry(
  flow: Flow = SILENT,
  governmentIdConfig: VerificationTemplateConfig = defaultTemplateConfig('government_id'),
) {
  const { inquiry } = await createTestInquiry(db, environmentId, {
    flow,
    verificationConfig: {
      'government-id': governmentIdConfig,
      ...(flow.steps.some((step) => step.type === 'aamva')
        ? { aamva: defaultTemplateConfig('aamva') }
        : {}),
    },
  });
  await transitionInquiryStatus(db, environmentId, inquiry.id, { from: 'created', to: 'pending' });
  return inquiry.id;
}

type Decision = 'passed' | 'needs_review' | 'failed';

/** A decided government ID verification with its extraction (or none) and checks. */
async function decidedId(
  inquiryId: string,
  decision: Decision,
  options: {
    fields?: ExtractedFields | null;
    sources?: ExtractionFieldSources;
    idClass?: IdClassGroup;
    failure?: 'user_behavior' | 'fraud';
  } = {},
): Promise<string> {
  const id = newId('ver');
  await createVerification(db, environmentId, { id, inquiryId, type: 'government_id' });
  const fields = options.fields === undefined ? LICENCE : options.fields;
  if (fields !== null) {
    await createGovernmentIdExtraction(db, environmentId, {
      verificationId: id,
      fields,
      fieldSources: options.sources ?? BARCODE,
      identificationNumberIndex: null,
      frontPhash: null,
      idClassGroup: options.idClass ?? 'drivers_license',
    });
  }
  if (decision === 'failed') {
    await replaceVerificationChecks(db, environmentId, id, [
      {
        name: 'id_blur_detection',
        status: 'failed',
        type: options.failure ?? 'fraud',
        requirement: 'required',
        reasons: ['blurry'],
        metadata: {},
      },
    ]);
  }
  await setVerificationStatus(db, environmentId, id, { to: 'submitted' });
  await setVerificationStatus(db, environmentId, id, { to: decision });
  return id;
}

/** Runs the AAMVA hook in a transaction for the decision of `decidedId`, then dispatches. */
async function decide(
  inquiryId: string,
  decidedVerificationId: string,
  flow: Flow = SILENT,
  deps: ProcessVerificationDeps = setup().deps,
) {
  const result = await db.transaction(async (tx) => {
    const inquiry = await getInquiry(tx, environmentId, inquiryId);
    const decided = await getVerification(tx, environmentId, decidedVerificationId);
    if (inquiry === null || decided === null) {
      throw new Error('seeded rows missing');
    }
    const hooked = await aamvaJob.onInquiryVerificationDecided?.(tx, {
      deps,
      environmentId,
      inquiry,
      inquiryStatus: inquiry.status,
      flow,
      decided,
      now: NOW,
    });
    if (hooked === undefined) {
      throw new Error('the aamva job has no decision hook');
    }
    return hooked;
  });
  await deps.events.dispatch(result.staged);
  return result;
}

async function attemptsOf(inquiryId: string, type: SupportedVerificationType = 'aamva') {
  return (await listInquiryVerifications(db, environmentId, inquiryId)).filter(
    (verification) => verification.type === type,
  );
}

async function eventNames(resourceId: string): Promise<string[]> {
  const page = await listEvents(db, environmentId, { size: 100 });
  return page.items
    .filter((event) => eventPayloadSchema.parse(event.payload).data.id === resourceId)
    .reverse()
    .map((event) => event.name);
}

describe('the silent AAMVA hook (C59.6)', () => {
  it.each([
    ['passed', 'drivers_license', BARCODE],
    ['needs_review', 'drivers_license', BARCODE],
    ['passed', 'national_id', VISUAL_ZONE],
    ['needs_review', 'national_id', BARCODE],
  ] as const)(
    'a %s decision on a US %s read from %o creates a submitted attempt bound to it and enqueues it',
    async (decision, idClass, sources) => {
      const inquiryId = await pendingInquiry();
      const governmentId = await decidedId(inquiryId, decision, { idClass, sources });

      const result = await decide(inquiryId, governmentId);

      const [attempt, ...others] = await attemptsOf(inquiryId);
      expect(others).toEqual([]);
      expect(attempt?.status).toBe('submitted');
      expect(result.enqueue).toEqual([{ environmentId, verificationId: attempt?.id }]);
      expect(await getVerificationInputs(db, environmentId, attempt?.id ?? '')).toMatchObject({
        values: COPIED,
        source: 'government_id',
        sourceVerificationId: governmentId,
      });
      expect(await eventNames(attempt?.id ?? '')).toEqual([
        'verification.created',
        'verification.submitted',
      ]);
    },
  );

  it.each([
    [
      'a passport',
      { idClass: 'passport' as const, fields: { ...LICENCE, 'issuing-authority-code': 'UTO' } },
    ],
    ['a class the document did not establish', { idClass: 'unknown' as const }],
    ['a Canadian licence', { fields: { ...LICENCE, 'issuing-authority-code': '604432' } }],
    [
      'the State Department card, which has no AAMVA jurisdiction',
      { fields: { ...LICENCE, 'issuing-authority-code': '636027' } },
    ],
    ['a licence without its issuer', { fields: { ...LICENCE, 'issuing-authority-code': null } }],
    ['a licence without its birth date', { fields: { ...LICENCE, birthdate: null } }],
    ['a licence without its number', { fields: { ...LICENCE, 'identification-number': null } }],
    ['an ID without an extraction', { fields: null }],
  ] as const)('a passed decision on %s creates a skipped attempt', async (_label, options) => {
    const inquiryId = await pendingInquiry();
    const governmentId = await decidedId(inquiryId, 'passed', options);

    const result = await decide(inquiryId, governmentId);

    const [attempt] = await attemptsOf(inquiryId);
    expect(attempt?.status).toBe('skipped');
    expect(result.enqueue).toEqual([]);
    expect(await getVerificationInputs(db, environmentId, attempt?.id ?? '')).toMatchObject({
      values: {},
      source: 'government_id',
      sourceVerificationId: governmentId,
    });
    expect(await eventNames(attempt?.id ?? '')).toEqual([
      'verification.created',
      'verification.skipped',
    ]);
  });

  it('a final failure skips the step, even on an eligible licence', async () => {
    const inquiryId = await pendingInquiry();
    const governmentId = await decidedId(inquiryId, 'failed', { failure: 'fraud' });

    await decide(inquiryId, governmentId);

    expect((await attemptsOf(inquiryId)).map((attempt) => attempt.status)).toEqual(['skipped']);
  });

  it('a retryable failure with an attempt left creates nothing; the last one skips', async () => {
    const inquiryId = await pendingInquiry();
    const first = await decidedId(inquiryId, 'failed', { failure: 'user_behavior' });

    expect(await decide(inquiryId, first)).toEqual({ staged: [], enqueue: [] });
    expect(await attemptsOf(inquiryId)).toEqual([]);

    const second = await decidedId(inquiryId, 'failed', { failure: 'user_behavior' });
    await decide(inquiryId, second);

    expect((await attemptsOf(inquiryId)).map((attempt) => attempt.status)).toEqual(['skipped']);
  });

  it('creates nothing for another type, a form AAMVA step, a flow without one, or a decided inquiry', async () => {
    const inquiryId = await pendingInquiry();
    const selfie = newId('ver');
    await createVerification(db, environmentId, { id: selfie, inquiryId, type: 'selfie' });
    await setVerificationStatus(db, environmentId, selfie, { to: 'submitted' });
    await setVerificationStatus(db, environmentId, selfie, { to: 'passed' });
    expect(await decide(inquiryId, selfie)).toEqual({ staged: [], enqueue: [] });

    const form = await pendingInquiry(flowWith('form'));
    expect(await decide(form, await decidedId(form, 'passed'), flowWith('form'))).toEqual({
      staged: [],
      enqueue: [],
    });
    const none = await pendingInquiry(flowWith(null));
    expect(await decide(none, await decidedId(none, 'passed'), flowWith(null))).toEqual({
      staged: [],
      enqueue: [],
    });

    const decided = await pendingInquiry();
    const governmentId = await decidedId(decided, 'passed');
    await transitionInquiryStatus(db, environmentId, decided, { from: 'pending', to: 'completed' });
    expect(await decide(decided, governmentId)).toEqual({ staged: [], enqueue: [] });

    for (const id of [inquiryId, form, none, decided]) {
      expect(await attemptsOf(id)).toEqual([]);
    }
  });

  it('never creates a second attempt for one ID decision', async () => {
    const inquiryId = await pendingInquiry();
    const governmentId = await decidedId(inquiryId, 'passed');
    await decide(inquiryId, governmentId);

    expect(await decide(inquiryId, governmentId)).toEqual({ staged: [], enqueue: [] });
    expect(await attemptsOf(inquiryId)).toHaveLength(1);
  });

  it('an ID reviewed on a passport, then passed on a US licence: skipped, then a new submitted attempt (V02)', async () => {
    const inquiryId = await pendingInquiry();
    const passport = await decidedId(inquiryId, 'needs_review', {
      idClass: 'passport',
      fields: { ...LICENCE, 'issuing-authority-code': 'UTO' },
    });
    await decide(inquiryId, passport);
    const licence = await decidedId(inquiryId, 'passed');

    const result = await decide(inquiryId, licence);

    const attempts = await attemptsOf(inquiryId);
    expect(attempts.map((attempt) => attempt.status)).toEqual(['skipped', 'submitted']);
    expect(result.enqueue).toEqual([{ environmentId, verificationId: attempts[1]?.id }]);
    expect(
      (await getVerificationInputs(db, environmentId, attempts[1]?.id ?? ''))?.sourceVerificationId,
    ).toBe(licence);
  });

  it('a new eligible decision gets its own attempt while an earlier one is still bound to another ID', async () => {
    const inquiryId = await pendingInquiry();
    const earlier = await decidedId(inquiryId, 'needs_review');
    await decide(inquiryId, earlier);
    const later = await decidedId(inquiryId, 'passed');

    await decide(inquiryId, later);

    expect((await attemptsOf(inquiryId)).map((attempt) => attempt.status)).toEqual([
      'submitted',
      'submitted',
    ]);
  });
});

describe('the silent AAMVA step through the worker (C59.6, C50.5)', () => {
  it('a US licence read from its barcode: the attempt is created, judged and the inquiry completes', async () => {
    // The fixture card is synthetic: only its printed expiry is judged here, which it passes.
    const inquiryId = await pendingInquiry(SILENT, {
      checks: { id_expired_detection: { enabled: true, required: true } },
    });
    const governmentId = newId('ver');
    await createVerification(db, environmentId, {
      id: governmentId,
      inquiryId,
      type: 'government_id',
    });
    await addFront(governmentId);
    await setVerificationStatus(db, environmentId, governmentId, { to: 'submitted' });
    const { deps, enqueued } = setup({
      aamva: true,
      analysis: visionFixture(
        'analyze-government-id-barcode' as 'analyze-government-id',
      ) as GovernmentIdAnalysis,
    });

    const decided = await processVerification(
      { environmentId, verificationId: governmentId },
      deps,
    );

    expect(decided).toMatchObject({ outcome: 'processed', inquiryStatus: 'pending' });
    const [attempt] = await attemptsOf(inquiryId);
    expect(attempt?.status).toBe('submitted');
    expect(enqueued).toEqual([{ environmentId, verificationId: attempt?.id }]);

    const judged = await processVerification(
      enqueued[0] ?? { environmentId, verificationId: '' },
      deps,
    );

    expect(judged).toMatchObject({ verificationStatus: 'passed' });
    expect((await getVerification(db, environmentId, governmentId))?.status).toBe('passed');
    expect((await getInquiry(db, environmentId, inquiryId))?.status).toBe('completed');
  });

  it('a created attempt whose enqueue failed is enqueued by the repair sweep, and the inquiry completes (Workflow 5C review K1)', async () => {
    const inquiryId = await pendingInquiry(SILENT, {
      checks: { id_expired_detection: { enabled: true, required: true } },
    });
    const governmentId = newId('ver');
    await createVerification(db, environmentId, {
      id: governmentId,
      inquiryId,
      type: 'government_id',
    });
    await addFront(governmentId);
    await setVerificationStatus(db, environmentId, governmentId, { to: 'submitted' });
    const { deps } = setup({
      aamva: true,
      analysis: visionFixture(
        'analyze-government-id-barcode' as 'analyze-government-id',
      ) as GovernmentIdAnalysis,
    });
    // Valkey is unreachable while the decision's hook enqueues the attempt it created.
    const unreachable: ProcessVerificationDeps = {
      ...deps,
      queue: {
        enqueueProcessVerification: () => Promise.reject(new Error('Connection is closed.')),
      },
    };

    await processVerification({ environmentId, verificationId: governmentId }, unreachable);
    const [attempt] = await attemptsOf(inquiryId);
    expect(attempt?.status).toBe('submitted');
    expect((await getInquiry(db, environmentId, inquiryId))?.status).toBe('pending');

    // C251.1 (Workflow 11B, quotas): the wrapped producer admits the attempt before the enqueue
    // that fails, so the repair sweep may enqueue it again (it never enqueues a held one).
    await markQueueRowsAdmitted(
      db,
      'process-verification',
      environmentId,
      [attempt?.id ?? ''],
      NOW,
    );
    const swept: ProcessVerificationJob[] = [];
    await submittedVerificationSweepJob(
      {
        db,
        clock: { now: () => new Date(NOW.getTime() + 3 * 60_000) },
        logger: createCapturingLogger(),
      },
      {
        enqueueProcessVerification: (job) => {
          swept.push(job);
          return Promise.resolve();
        },
      },
    ).run();

    const repaired = swept.filter((job) => job.verificationId === attempt?.id);
    expect(repaired).toEqual([{ environmentId, verificationId: attempt?.id }]);
    const judged = await processVerification(
      repaired[0] ?? { environmentId, verificationId: '' },
      deps,
    );
    expect(judged).toMatchObject({ verificationStatus: 'passed' });
    expect((await getInquiry(db, environmentId, inquiryId))?.status).toBe('completed');
  });

  it('a failure the job cannot finish skips the step, and the inquiry fails with the ID', async () => {
    const inquiryId = await pendingInquiry();
    const governmentId = newId('ver');
    await createVerification(db, environmentId, {
      id: governmentId,
      inquiryId,
      type: 'government_id',
    });
    await setVerificationStatus(db, environmentId, governmentId, { to: 'submitted' });

    await failVerificationAfterError(
      { environmentId, verificationId: governmentId },
      setup().deps,
      'vision_unavailable',
    );

    expect((await attemptsOf(inquiryId)).map((attempt) => attempt.status)).toEqual(['skipped']);
    expect((await getInquiry(db, environmentId, inquiryId))?.status).toBe('failed');
  });

  it('the silent step last after a skipped attempt: the inquiry completes once the ID passed', async () => {
    const inquiryId = await pendingInquiry();
    const governmentId = await decidedId(inquiryId, 'passed', { idClass: 'passport' });
    const aamva = newId('ver');
    await createVerification(db, environmentId, { id: aamva, inquiryId, type: 'aamva' });
    await seedVerificationInputs(db, environmentId, {
      verificationId: aamva,
      inquiryId,
      values: {},
      source: 'government_id',
      sourceVerificationId: governmentId,
    });
    await setVerificationStatus(db, environmentId, aamva, { to: 'skipped' });

    // A repeat of the skipped attempt's job only settles the inquiry.
    expect(
      await processVerification({ environmentId, verificationId: aamva }, setup().deps),
    ).toMatchObject({ outcome: 'skipped', reason: 'not_submitted', inquiryStatus: 'completed' });
  });
});
