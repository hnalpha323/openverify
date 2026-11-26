/**
 * The Phase 3 government ID job (C29-C35): the C31 extraction built from the v2 analysis and
 * stored encrypted with its blind index and pHash, the document's country and class, every
 * §4.1 evaluator fed with its inputs (environment, flow step, models, history, references, the
 * selfie, providers), and the C30.3 last-attempt rule. Vision answers are the recorded C32
 * golden fixtures (`contracts/fixtures/vision`); every holder is a fictional Utopia one.
 */
import { createHash, randomBytes } from 'node:crypto';
import { extractGovernmentId } from '@openverify/checks';
import {
  defaultInquiryTemplateAttributes,
  eventPayloadSchema,
  newId,
  type VerificationConfig,
} from '@openverify/contracts';
import {
  createFile,
  createGovernmentIdExtraction,
  createInquiry,
  createVerification,
  encryptBytes,
  extractionIndexOf,
  getGovernmentIdExtraction,
  getVerification,
  listEvents,
  redactGovernmentIdExtractions,
  redactInquiryRecords,
  setVerificationStatus,
  transitionInquiryStatus,
  type Db,
  type FileKind,
  type IdClass,
  type Keyring,
} from '@openverify/db';
import {
  createTestDatabase,
  createTestInquiry,
  createTestTenant,
  type TestDatabase,
} from '@openverify/db/testing';
import type { Flow } from '@openverify/flow-spec';
import { sql } from 'drizzle-orm';
import { createFakeCompromisedIdLookup } from '../test-support/fakes.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createEventPublisher } from '../events/index.js';
import type { FaceEmbeddingResult, ProviderBindings } from '../ports.js';
import { ProviderError, createProviderBindings, NO_PROVIDERS } from '../providers/index.js';
import {
  VisionResponseError,
  VisionServiceError,
  VisionUnavailableError,
} from '../vision/index.js';
import { createWebhookDeliveryScheduler } from '../webhooks/queue.js';
import { MODEL_DIGESTS } from './models.js';
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
  governmentIdFixture,
  visionFixture,
  phase3SelfieTemplate,
} from './testing.js';

const NOW = new Date('2026-10-20T12:00:00.000Z');
// The Phase 1-3 selfie step and checks; the C45.1 default is tested in process-selfie.test.ts.
const defaults = phase3SelfieTemplate(defaultInquiryTemplateAttributes());
/** A public test key (bytes 0x00..0x1f), never a deployment's. */
const BLIND_INDEX_KEY = Uint8Array.from({ length: 32 }, (_, index) => index);

let database: TestDatabase;
let db: Db;
let keyring: Keyring;
let sandboxId: string;
let productionId: string;
const storage = createMemoryStorage();

beforeAll(async () => {
  database = await createTestDatabase();
  db = database.db;
  keyring = database.keyring;
  sandboxId = (await createTestTenant(db)).environment.id;
  productionId = (await createTestTenant(db, { kind: 'production' })).environment.id;
}, 60_000);

afterAll(async () => {
  await database.close();
});

// Templates ---------------------------------------------------------------------

interface GovernmentIdChecks {
  required?: readonly string[];
  advisory?: readonly string[];
  config?: Readonly<Record<string, Record<string, unknown>>>;
  allowedIdClasses?: readonly IdClass[];
}

/** The default flow and selfie config, with these government ID checks. */
function template(checks: GovernmentIdChecks): VerificationConfig {
  const entries = [
    ...(checks.required ?? ['id_blur_detection']).map((id) => [id, true] as const),
    ...(checks.advisory ?? []).map((id) => [id, false] as const),
  ];
  return {
    'government-id': {
      checks: Object.fromEntries(
        entries.map(([id, required]) => [
          id,
          {
            enabled: true,
            required,
            ...(checks.config?.[id] === undefined ? {} : { config: checks.config[id] }),
          },
        ]),
      ),
      ...(checks.allowedIdClasses === undefined
        ? {}
        : { 'allowed-id-classes': [...checks.allowedIdClasses] }),
    },
    selfie: defaults['verification-config'].selfie,
  };
}

/** The default flow, its government ID step changed by `step`. */
function flowWith(step: Record<string, unknown> = {}): Flow {
  return {
    ...defaults.flow,
    steps: defaults.flow.steps.map((candidate) =>
      candidate.type === 'government_id' ? { ...candidate, ...step } : candidate,
    ),
  };
}

// Data ----------------------------------------------------------------------------

const syntheticJpeg = () => Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, ...randomBytes(48)]);
const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

interface InquiryOptions {
  environmentId?: string;
  config?: VerificationConfig;
  flow?: Flow;
  fields?: Record<string, string>;
  /** Another inquiry of this account. */
  accountId?: string;
}

async function pendingInquiry(options: InquiryOptions = {}) {
  const environmentId = options.environmentId ?? sandboxId;
  const { inquiry, template: created } = await createTestInquiry(db, environmentId, {
    flow: options.flow ?? defaults.flow,
    verificationConfig: options.config ?? template({}),
    fields: options.fields ?? {},
  });
  const owner =
    options.accountId === undefined
      ? inquiry
      : await createInquiry(db, environmentId, {
          id: newId('inq'),
          inquiryTemplateId: created.id,
          inquiryTemplateVersionId: created.latestVersion.id,
          accountId: options.accountId,
        });
  await transitionInquiryStatus(db, environmentId, owner.id, { from: 'created', to: 'pending' });
  return { environmentId, inquiryId: owner.id, accountId: owner.accountId };
}

async function addFile(environmentId: string, verificationId: string, kind: FileKind) {
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
  return { id, bytes, storageKey };
}

async function submitted(
  inquiry: { environmentId: string; inquiryId: string },
  type: 'government_id' | 'selfie' = 'government_id',
  options: { country?: string; idClass?: IdClass; kinds?: FileKind[] } = {},
) {
  const id = newId('ver');
  await createVerification(db, inquiry.environmentId, {
    id,
    inquiryId: inquiry.inquiryId,
    type,
    ...(options.country === undefined ? {} : { country: options.country }),
    ...(options.idClass === undefined ? {} : { idClass: options.idClass }),
  });
  const kinds = options.kinds ?? (type === 'government_id' ? ['front', 'back'] : ['selfie-center']);
  const files: Partial<Record<FileKind, Awaited<ReturnType<typeof addFile>>>> = {};
  for (const kind of kinds) {
    files[kind] = await addFile(inquiry.environmentId, id, kind);
  }
  await setVerificationStatus(db, inquiry.environmentId, id, { to: 'submitted' });
  return { id, files };
}

function setup(providers?: ProviderBindings) {
  const vision = createFakeVision();
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
    blindIndexKey: BLIND_INDEX_KEY,
    ...(providers === undefined ? {} : { providers }),
  };
  return { deps, vision, logger };
}

const job = (environmentId: string, verificationId: string) => ({ environmentId, verificationId });

async function checksOf(environmentId: string, verificationId: string) {
  const stored = await getVerification(db, environmentId, verificationId);
  return Object.fromEntries((stored?.checks ?? []).map((check) => [check.name, check]));
}

/** The golden card's extraction, as the checks package builds it. */
const golden = () => extractGovernmentId(governmentIdFixture(), { now: NOW });

/** The golden card issued by Germany (`D`): the MRZ issuer and nationality changed only. */
function germanCard() {
  const analysis = governmentIdFixture();
  const back = analysis.sides.back;
  if (back === null) {
    throw new Error('the golden fixture has a back');
  }
  back.mrz = {
    ...back.mrz,
    lines: back.mrz.lines.map((line, index) =>
      index === 0 ? line.replace('I<UTO', 'I<D<<') : line.replace('UTO', 'D<<'),
    ),
  };
  return analysis;
}

const SANDBOX_PROVIDERS = createProviderBindings({
  sandbox: { aamva: 'sandbox', publicFigure: 'sandbox', ageEstimate: 'sandbox' },
  production: NO_PROVIDERS.production,
});

// The extraction ------------------------------------------------------------------

describe('the government ID extraction (C31)', () => {
  it('stores the extraction encrypted, with its sources, blind index, pHash and class group', async () => {
    const inquiry = await pendingInquiry();
    const gov = await submitted(inquiry);
    const { deps } = setup();

    await processVerification(job(inquiry.environmentId, gov.id), deps);

    const expected = golden();
    expect(expected.consolidated.fields['name-last']).toBe('VALEMONT');
    expect(await getGovernmentIdExtraction(db, inquiry.environmentId, gov.id)).toMatchObject({
      fields: expected.consolidated.fields,
      fieldSources: expected.consolidated.fieldSources,
      identificationNumberIndex: extractionIndexOf(BLIND_INDEX_KEY, {
        environmentId: inquiry.environmentId,
        fields: expected.consolidated.fields,
        classGroup: 'national_id',
      }),
      frontPhash: governmentIdFixture().sides.front.phash,
      idClassGroup: 'national_id',
      redactedAt: null,
    });
    const raw = await database.db.execute(
      sql`select fields from government_id_extractions where verification_id = ${gov.id}`,
    );
    expect(JSON.stringify(raw.rows)).not.toContain('VALEMONT');
  });

  it('keeps the country null for the test issuer and sets the class it established (C30.7)', async () => {
    const inquiry = await pendingInquiry();
    const gov = await submitted(inquiry);
    const { deps } = setup();

    await processVerification(job(inquiry.environmentId, gov.id), deps);

    expect(await getVerification(db, inquiry.environmentId, gov.id)).toMatchObject({
      country: null,
      idClass: 'national_id',
    });
  });

  it('sets the country of an issuer with an alpha-2 code, unless the user chose one', async () => {
    const inquiry = await pendingInquiry();
    const chosen = await submitted(inquiry, 'government_id', {
      country: 'NL',
      idClass: 'residence_permit',
    });
    const unchosen = await submitted(inquiry);
    const { deps, vision } = setup();
    vision.answers.governmentId = germanCard();

    await processVerification(job(inquiry.environmentId, unchosen.id), deps);
    await processVerification(job(inquiry.environmentId, chosen.id), deps);

    expect(await getVerification(db, inquiry.environmentId, unchosen.id)).toMatchObject({
      country: 'DE',
      idClass: 'national_id',
    });
    expect(await getVerification(db, inquiry.environmentId, chosen.id)).toMatchObject({
      country: 'NL',
      idClass: 'residence_permit',
    });
  });

  it('publishes the verification with its extraction attributes (C31.6 event payloads)', async () => {
    const inquiry = await pendingInquiry();
    const gov = await submitted(inquiry);
    const { deps } = setup();

    await processVerification(job(inquiry.environmentId, gov.id), deps);

    const [event] = (await listEvents(db, inquiry.environmentId, { size: 100 })).items.filter(
      (candidate) => eventPayloadSchema.parse(candidate.payload).data.id === gov.id,
    );
    expect(eventPayloadSchema.parse(event?.payload).data.attributes).toMatchObject({
      status: 'passed',
      'name-last': 'VALEMONT',
      'identification-number': 'X12K45P78',
      'extraction-sources': { 'name-last': ['mrz', 'viz'] },
    });
  });

  it('keeps extracted values out of the logs and the check metadata (C29.3)', async () => {
    const inquiry = await pendingInquiry({
      config: template({
        required: ['id_blur_detection', 'id_mrz_inconsistency_detection'],
        advisory: ['id_extracted_properties_detection', 'id_extraction_inconsistency_detection'],
      }),
    });
    const gov = await submitted(inquiry);
    const { deps, logger } = setup();

    await processVerification(job(inquiry.environmentId, gov.id), deps);

    const checks = await checksOf(inquiry.environmentId, gov.id);
    const stored = JSON.stringify([checks, logger.entries]);
    for (const value of ['VALEMONT', 'QUINN', 'X12K45P78', '1990-02-14', 'LANTERN']) {
      expect(stored).not.toContain(value);
    }
  });
});

describe('a redaction while the government ID is analysed (C16, C31.7; G002)', () => {
  /** The payloads of the events about the verification, as stored. */
  async function payloadsAbout(environmentId: string, verificationId: string) {
    return (await listEvents(db, environmentId, { size: 100 })).items
      .map((event) => eventPayloadSchema.parse(event.payload))
      .filter((payload) => payload.data.id === verificationId);
  }

  it('stores no extraction and publishes none, and the worker then fails the verification without data', async () => {
    const tenant = (await createTestTenant(db)).environment.id;
    const inquiry = await pendingInquiry({ environmentId: tenant });
    const gov = await submitted(inquiry);
    const { deps, vision } = setup();
    deps.vision = {
      ...vision.client,
      analyzeGovernmentId: async (input) => {
        // An operator redacts the inquiry while vision analyses the decrypted images.
        await redactInquiryRecords(db, tenant, inquiry.inquiryId, { at: NOW });
        return vision.client.analyzeGovernmentId(input);
      },
    };

    const outcome = await processVerification(job(tenant, gov.id), deps).then(
      (value: unknown) => value,
      (error: unknown) => error,
    );

    expect(await getGovernmentIdExtraction(db, tenant, gov.id)).toBeNull();
    expect(JSON.stringify(await payloadsAbout(tenant, gov.id))).not.toContain('VALEMONT');
    expect(outcome).toMatchObject({ name: 'PermanentJobError', reason: 'inquiry_redacted' });
    expect(await getVerification(db, tenant, gov.id)).toMatchObject({
      status: 'submitted',
      checks: [],
    });

    // The worker fails a job that cannot succeed (worker.ts), as for a file the redaction deleted.
    await failVerificationAfterError(job(tenant, gov.id), deps, 'PermanentJobError');
    expect(await getVerification(db, tenant, gov.id)).toMatchObject({
      status: 'failed',
      checks: [],
    });
    expect(await getGovernmentIdExtraction(db, tenant, gov.id)).toBeNull();
    const payloads = await payloadsAbout(tenant, gov.id);
    // Workflow 8B: a case comment, which has no status, joined the payload union.
    const statuses = payloads.map(
      (payload) => (payload.data.attributes as { status?: unknown }).status,
    );
    expect(statuses).toEqual(['failed']);
    expect(JSON.stringify(payloads)).not.toContain('VALEMONT');
  });
});

// The evaluator inputs ---------------------------------------------------------------

describe('the §4.1 evaluators and their inputs (C29)', () => {
  it('passes the golden card on the R-tier checks in a sandbox, with stage and provenance', async () => {
    const required = [
      'id_blur_detection',
      'id_glare_detection',
      'id_portrait_detection',
      'id_double_side_detection',
      'id_mrz_detection',
      'id_mrz_inconsistency_detection',
      'id_extracted_properties_detection',
      'id_extraction_inconsistency_detection',
      'id_number_format_inconsistency_detection',
      'id_expired_detection',
      'id_valid_dates_detection',
      'id_disallowed_country_detection',
      'id_disallowed_type_detection',
      'id_compromised_detection',
    ];
    const inquiry = await pendingInquiry({ config: template({ required }) });
    const gov = await submitted(inquiry);
    const { deps } = setup();

    expect(await processVerification(job(inquiry.environmentId, gov.id), deps)).toMatchObject({
      verificationStatus: 'passed',
    });
    const checks = await checksOf(inquiry.environmentId, gov.id);
    for (const id of required) {
      expect(checks[id]?.status, id).toBe('passed');
    }
    expect(checks.id_expired_detection?.provenance).toEqual({
      'implementation-version': 1,
      thresholds: { 'grace-days': 0 },
    });
    expect(checks.id_mrz_detection?.stage).toBe('beta');
  });

  it("judges each check against the template's config, listing it in provenance", async () => {
    const inquiry = await pendingInquiry({
      config: template({
        required: ['id_expired_detection', 'id_valid_dates_detection'],
        config: {
          id_expired_detection: { 'grace-days': 30 },
          id_valid_dates_detection: { 'max-validity-years': 5 },
        },
      }),
    });
    const gov = await submitted(inquiry);
    const { deps } = setup();

    await processVerification(job(inquiry.environmentId, gov.id), deps);

    const checks = await checksOf(inquiry.environmentId, gov.id);
    expect(checks.id_expired_detection?.provenance?.thresholds).toEqual({ 'grace-days': 30 });
    expect(checks.id_valid_dates_detection?.provenance?.thresholds).toMatchObject({
      'max-validity-years': 5,
    });
  });

  it('names the pinned models a result rests on (C29.2)', async () => {
    const inquiry = await pendingInquiry({
      config: template({ required: ['id_portrait_detection'] }),
    });
    const gov = await submitted(inquiry);
    const { deps } = setup();

    await processVerification(job(inquiry.environmentId, gov.id), deps);

    expect((await checksOf(inquiry.environmentId, gov.id)).id_portrait_detection).toMatchObject({
      provenance: {
        models: [{ id: 'yunet-2026may', sha256: MODEL_DIGESTS['yunet-2026may']?.sha256 }],
      },
    });
  });

  it('fails the test issuer as a specimen in a production environment (C30.7)', async () => {
    const inquiry = await pendingInquiry({
      environmentId: productionId,
      config: template({ required: ['id_compromised_detection'] }),
    });
    const gov = await submitted(inquiry);
    const { deps } = setup();

    expect(await processVerification(job(productionId, gov.id), deps)).toMatchObject({
      verificationStatus: 'failed',
    });
    expect((await checksOf(productionId, gov.id)).id_compromised_detection).toMatchObject({
      status: 'failed',
      reasons: expect.arrayContaining(['specimen_issuer']) as unknown,
    });
  });

  describe('the compromised-number lookup (C99.9, H09)', () => {
    async function run(answer: { matched: boolean } | null) {
      const inquiry = await pendingInquiry({
        config: template({ required: ['id_compromised_detection'] }),
      });
      const gov = await submitted(inquiry);
      const { deps } = setup();
      const compromisedIds = createFakeCompromisedIdLookup();
      compromisedIds.answer = answer === null ? null : { ...answer, unscreened: [] };
      await processVerification(job(sandboxId, gov.id), { ...deps, compromisedIds });
      return {
        compromisedIds,
        reasons: (await checksOf(sandboxId, gov.id)).id_compromised_detection?.reasons,
      };
    }

    it('fails the check on a listed number, with the extraction’s number and class', async () => {
      const { compromisedIds, reasons } = await run({ matched: true });

      expect(reasons).toContain('compromised_list_match');
      expect(compromisedIds.calls).toEqual([
        {
          identificationNumber: golden().consolidated.fields['identification-number'],
          idClass: golden().document.idClass,
        },
      ]);
    });

    it('leaves the input absent when the lookup answers null, as with no configured list', async () => {
      const { compromisedIds, reasons } = await run(null);

      expect(compromisedIds.calls).toHaveLength(1);
      expect(reasons).not.toContain('compromised_list_match');
    });
  });

  it("enforces the flow step's ID classes when the template sets none (C29.5)", async () => {
    const inquiry = await pendingInquiry({
      flow: flowWith({ allowedIdClasses: ['passport'] }),
      config: template({ required: ['id_disallowed_type_detection'] }),
    });
    const gov = await submitted(inquiry);
    const { deps } = setup();

    await processVerification(job(inquiry.environmentId, gov.id), deps);

    expect(
      (await checksOf(inquiry.environmentId, gov.id)).id_disallowed_type_detection,
    ).toMatchObject({ status: 'failed' });
  });
});

// C34 ------------------------------------------------------------------------------------

describe('repeat detection (C34)', () => {
  const repeatTemplate = (config?: Record<string, unknown>) =>
    template({
      required: ['id_repeat_detection'],
      ...(config === undefined ? {} : { config: { id_repeat_detection: config } }),
    });

  it('passes the first use of a number and fails its use by another account', async () => {
    const tenant = (await createTestTenant(db)).environment.id;
    const { deps } = setup();
    const first = await pendingInquiry({ environmentId: tenant, config: repeatTemplate() });
    const earlier = await submitted(first);
    await processVerification(job(first.environmentId, earlier.id), deps);
    const second = await pendingInquiry({ environmentId: tenant, config: repeatTemplate() });
    const later = await submitted(second);

    await processVerification(job(second.environmentId, later.id), deps);

    expect((await checksOf(first.environmentId, earlier.id)).id_repeat_detection).toMatchObject({
      status: 'passed',
    });
    expect((await checksOf(second.environmentId, later.id)).id_repeat_detection).toMatchObject({
      status: 'failed',
      reasons: ['id_repeat_detected'],
      metadata: {
        'matched-by': ['identification-number'],
        'matched-verification-ids': expect.arrayContaining([earlier.id]) as unknown,
      },
    });
  });

  it("does not count the same account's earlier uses, nor redacted ones", async () => {
    const tenant = (await createTestTenant(db)).environment.id;
    const { deps } = setup();
    const own = await pendingInquiry({ environmentId: tenant, config: repeatTemplate() });
    const ownEarlier = await submitted(own);
    await processVerification(job(tenant, ownEarlier.id), deps);
    const redactedInquiry = await pendingInquiry({
      environmentId: tenant,
      config: repeatTemplate(),
    });
    const redacted = await submitted(redactedInquiry);
    await processVerification(job(tenant, redacted.id), deps);
    await redactGovernmentIdExtractions(db, tenant, [redacted.id], NOW);
    const again = await pendingInquiry({
      environmentId: tenant,
      config: repeatTemplate(),
      accountId: own.accountId,
    });
    const later = await submitted(again);

    await processVerification(job(tenant, later.id), deps);

    expect((await checksOf(tenant, later.id)).id_repeat_detection).toMatchObject({
      status: 'passed',
      metadata: { matches: 0, lookups: ['identification-number'] },
    });
  });

  it('finds a front within max-phash-distance through the bands', async () => {
    const tenant = (await createTestTenant(db)).environment.id;
    const { deps } = setup();
    const earlierInquiry = await pendingInquiry({ environmentId: tenant });
    const earlier = await submitted(earlierInquiry);
    await createGovernmentIdExtraction(db, tenant, {
      verificationId: earlier.id,
      fields: golden().consolidated.fields,
      fieldSources: {},
      identificationNumberIndex: 'f'.repeat(64),
      // One bit away from the golden front.
      frontPhash: 'c3a59e1f0b6d7249',
      idClassGroup: 'national_id',
    });
    const inquiry = await pendingInquiry({
      environmentId: tenant,
      config: repeatTemplate({ 'max-phash-distance': 1 }),
    });
    const gov = await submitted(inquiry);

    await processVerification(job(tenant, gov.id), deps);

    expect((await checksOf(tenant, gov.id)).id_repeat_detection).toMatchObject({
      status: 'failed',
      metadata: { 'matched-by': ['image'], 'matched-verification-ids': [earlier.id] },
      provenance: { thresholds: { 'max-phash-distance': 1 } },
    });
  });
});

describe('inconsistent repeat detection (C34, C31.9)', () => {
  const inconsistentTemplate = () => template({ required: ['id_inconsistent_repeat_detection'] });

  async function earlierWith(tenant: string, fields: Record<string, string>) {
    const inquiry = await pendingInquiry({ environmentId: tenant });
    const earlier = await submitted(inquiry);
    const goldenFields = golden().consolidated.fields;
    await createGovernmentIdExtraction(db, tenant, {
      verificationId: earlier.id,
      fields: { ...goldenFields, ...fields },
      fieldSources: {},
      identificationNumberIndex: extractionIndexOf(BLIND_INDEX_KEY, {
        environmentId: tenant,
        fields: goldenFields,
        classGroup: 'national_id',
      }),
      frontPhash: null,
      idClassGroup: 'national_id',
    });
    return earlier;
  }

  it('fails the same number with another name, re-embedding the earlier front', async () => {
    const tenant = (await createTestTenant(db)).environment.id;
    const earlier = await earlierWith(tenant, { 'name-first': 'ROWAN' });
    const inquiry = await pendingInquiry({ environmentId: tenant, config: inconsistentTemplate() });
    const gov = await submitted(inquiry);
    const { deps, vision } = setup();

    await processVerification(job(tenant, gov.id), deps);

    expect(vision.calls.map((call) => call.endpoint)).toEqual(['government-id', 'embed-face']);
    expect(vision.calls[1]?.images.image?.bytes).toEqual([...(earlier.files.front?.bytes ?? [])]);
    // K101: an earlier ID front is re-embedded as a document.
    expect(vision.calls[1]?.subject).toBe('document');
    expect((await checksOf(tenant, gov.id)).id_inconsistent_repeat_detection).toMatchObject({
      status: 'failed',
      reasons: ['inconsistent_repeat_detected'],
      metadata: {
        'face-compared': true,
        'disagreeing-fields': ['name-first'],
        'inconsistent-verification-ids': [earlier.id],
      },
    });
  });

  it('fails the same number with another face', async () => {
    const tenant = (await createTestTenant(db)).environment.id;
    const earlier = await earlierWith(tenant, {});
    const inquiry = await pendingInquiry({ environmentId: tenant, config: inconsistentTemplate() });
    const gov = await submitted(inquiry);
    const { deps, vision } = setup();
    // The recorded embedding of another person's face (similarity 0.05).
    vision.answers.embedFace = visionFixture('embed-face') as FaceEmbeddingResult;

    await processVerification(job(tenant, gov.id), deps);

    expect((await checksOf(tenant, gov.id)).id_inconsistent_repeat_detection).toMatchObject({
      status: 'failed',
      metadata: { 'disagreeing-fields': ['face'], 'inconsistent-verification-ids': [earlier.id] },
    });
  });

  it('compares names and birth dates only once the earlier files are gone, and never fails for it', async () => {
    const tenant = (await createTestTenant(db)).environment.id;
    const earlier = await earlierWith(tenant, {});
    await storage.delete(earlier.files.front?.storageKey ?? '');
    const inquiry = await pendingInquiry({ environmentId: tenant, config: inconsistentTemplate() });
    const gov = await submitted(inquiry);
    const { deps, vision } = setup();

    expect(await processVerification(job(tenant, gov.id), deps)).toMatchObject({
      verificationStatus: 'passed',
    });
    expect(vision.calls.map((call) => call.endpoint)).toEqual(['government-id']);
    expect((await checksOf(tenant, gov.id)).id_inconsistent_repeat_detection).toMatchObject({
      status: 'passed',
      metadata: { candidates: 1, 'face-compared': false },
    });
  });
});

describe('re-embedding failures (C30.3)', () => {
  const reembedding = template({
    required: ['id_blur_detection', 'id_inconsistent_repeat_detection'],
    advisory: ['id_selfie_comparison'],
  });

  async function withEarlierCard(tenant: string) {
    const inquiry = await pendingInquiry({ environmentId: tenant });
    const earlier = await submitted(inquiry);
    const fields = golden().consolidated.fields;
    await createGovernmentIdExtraction(db, tenant, {
      verificationId: earlier.id,
      fields,
      fieldSources: {},
      identificationNumberIndex: extractionIndexOf(BLIND_INDEX_KEY, {
        environmentId: tenant,
        fields,
        classGroup: 'national_id',
      }),
      frontPhash: null,
      idClassGroup: 'national_id',
    });
  }

  it('retries a failed re-embedding, then records it on its own checks only', async () => {
    const tenant = (await createTestTenant(db)).environment.id;
    await withEarlierCard(tenant);
    const inquiry = await pendingInquiry({ environmentId: tenant, config: reembedding });
    await submitted(inquiry, 'selfie');
    const gov = await submitted(inquiry);
    const { deps, vision } = setup();
    vision.answers.embedFace = new VisionServiceError('/v1/embed/face', 503);

    await expect(processVerification(job(tenant, gov.id), deps)).rejects.toThrow(
      VisionServiceError,
    );
    expect(
      await processVerification(job(tenant, gov.id), deps, { lastAttempt: true }),
    ).toMatchObject({ verificationStatus: 'needs_review' });

    const checks = await checksOf(tenant, gov.id);
    expect(checks.id_inconsistent_repeat_detection).toMatchObject({
      status: 'not_applicable',
      reasons: ['execution_error'],
    });
    expect(checks.id_selfie_comparison).toMatchObject({
      status: 'not_applicable',
      reasons: ['execution_error'],
    });
    expect(checks.id_blur_detection?.status).toBe('passed');
  });

  it('does not compare a stored image vision cannot read, nor a selfie without its center image', async () => {
    const tenant = (await createTestTenant(db)).environment.id;
    await withEarlierCard(tenant);
    const inquiry = await pendingInquiry({ environmentId: tenant, config: reembedding });
    await submitted(inquiry, 'selfie', { kinds: ['selfie-left'] });
    const gov = await submitted(inquiry);
    const { deps, vision } = setup();
    vision.answers.embedFace = new VisionServiceError('/v1/embed/face', 422);

    expect(await processVerification(job(tenant, gov.id), deps)).toMatchObject({
      verificationStatus: 'passed',
    });
    const checks = await checksOf(tenant, gov.id);
    expect(checks.id_inconsistent_repeat_detection).toMatchObject({
      status: 'passed',
      metadata: { candidates: 1, 'face-compared': false },
    });
    expect(checks.id_selfie_comparison).toMatchObject({
      status: 'not_applicable',
      reasons: ['input_missing'],
    });
  });
});

describe('inquiry and account comparisons (C34)', () => {
  const comparisons = template({
    required: ['id_inquiry_comparison'],
    advisory: ['id_account_comparison'],
  });

  it("compares the extraction with the inquiry's fields", async () => {
    const matching = await pendingInquiry({
      config: comparisons,
      fields: { name_first: 'Quinn', name_last: 'Valemont', birthdate: '1990-02-14' },
    });
    const differing = await pendingInquiry({
      config: comparisons,
      fields: { name_first: 'Quinn', name_last: 'Valemont', birthdate: '1991-02-14' },
    });
    const first = await submitted(matching);
    const second = await submitted(differing);
    const { deps } = setup();

    await processVerification(job(matching.environmentId, first.id), deps);
    await processVerification(job(differing.environmentId, second.id), deps);

    expect((await checksOf(matching.environmentId, first.id)).id_inquiry_comparison).toMatchObject({
      status: 'passed',
      metadata: { 'compared-fields': ['name', 'birthdate'] },
    });
    expect(
      (await checksOf(differing.environmentId, second.id)).id_inquiry_comparison,
    ).toMatchObject({ status: 'failed', reasons: ['birthdate_mismatch'] });
  });

  it('records which compared fields were set at creation and which were entered later (C149.4)', async () => {
    // B47 (Workflow 9B, api-flow-carry): the name came with POST /inquiries, the birthdate later.
    const { inquiry: first, template: created } = await createTestInquiry(db, sandboxId, {
      flow: defaults.flow,
      verificationConfig: comparisons,
    });
    const prefilled = await createInquiry(db, sandboxId, {
      id: newId('inq'),
      inquiryTemplateId: created.id,
      inquiryTemplateVersionId: created.latestVersion.id,
      accountId: first.accountId,
      fields: { name_first: 'Quinn', name_last: 'Valemont', birthdate: '1990-02-14' },
      initialFields: { name_first: 'Quinn', name_last: 'Valemont' },
    });
    await transitionInquiryStatus(db, sandboxId, prefilled.id, { from: 'created', to: 'pending' });
    const inquiry = { environmentId: sandboxId, inquiryId: prefilled.id };
    const gov = await submitted(inquiry);
    const { deps } = setup();

    await processVerification(job(sandboxId, gov.id), deps);

    const checks = await checksOf(sandboxId, gov.id);
    expect(checks.id_inquiry_comparison).toMatchObject({
      status: 'passed',
      metadata: {
        'compared-fields': ['name', 'birthdate'],
        'comparison-source': { name: 'initial', birthdate: 'entered' },
      },
    });
    expect(checks.id_account_comparison?.metadata).not.toHaveProperty('comparison-source');
  });

  it('has no reference data without inquiry or account fields', async () => {
    const inquiry = await pendingInquiry({ config: comparisons });
    const gov = await submitted(inquiry);
    const { deps } = setup();

    await processVerification(job(inquiry.environmentId, gov.id), deps);

    const checks = await checksOf(inquiry.environmentId, gov.id);
    expect(checks.id_inquiry_comparison).toMatchObject({
      status: 'not_applicable',
      reasons: ['no_reference_data'],
    });
    expect(checks.id_account_comparison).toMatchObject({
      status: 'not_applicable',
      reasons: ['no_reference_data'],
    });
  });
});

describe('ID-selfie comparison (C34)', () => {
  const selfieComparison = template({
    required: ['id_blur_detection'],
    advisory: ['id_selfie_comparison'],
  });

  it("compares the portrait with the inquiry's newest selfie, re-embedded", async () => {
    const inquiry = await pendingInquiry({ config: selfieComparison });
    const selfie = await submitted(inquiry, 'selfie');
    const gov = await submitted(inquiry);
    const { deps, vision } = setup();

    await processVerification(job(inquiry.environmentId, gov.id), deps);

    expect(vision.calls.map((call) => call.endpoint)).toEqual(['government-id', 'embed-face']);
    expect(vision.calls[1]?.images.image?.bytes).toEqual([
      ...(selfie.files['selfie-center']?.bytes ?? []),
    ]);
    // K101: a selfie is sent without a subject (vision's default, the largest face).
    expect(vision.calls[1]).not.toHaveProperty('subject');
    expect((await checksOf(inquiry.environmentId, gov.id)).id_selfie_comparison).toMatchObject({
      status: 'passed',
      metadata: { similarity: 1, 'selfie-verification-id': selfie.id },
    });
  });

  it('compares with the latest passed, submitted or needs_review selfie, never a failed one (C43)', async () => {
    const inquiry = await pendingInquiry({ config: selfieComparison });
    const earlier = await submitted(inquiry, 'selfie');
    await setVerificationStatus(db, inquiry.environmentId, earlier.id, { to: 'passed' });
    const failed = await submitted(inquiry, 'selfie');
    await setVerificationStatus(db, inquiry.environmentId, failed.id, { to: 'failed' });
    const gov = await submitted(inquiry);
    const { deps, vision } = setup();

    await processVerification(job(inquiry.environmentId, gov.id), deps);

    expect(vision.calls[1]?.images.image?.bytes).toEqual([
      ...(earlier.files['selfie-center']?.bytes ?? []),
    ]);
    expect((await checksOf(inquiry.environmentId, gov.id)).id_selfie_comparison).toMatchObject({
      metadata: { 'selfie-verification-id': earlier.id },
    });
  });

  it('has no input with only a failed selfie', async () => {
    const inquiry = await pendingInquiry({ config: selfieComparison });
    const failed = await submitted(inquiry, 'selfie');
    await setVerificationStatus(db, inquiry.environmentId, failed.id, { to: 'failed' });
    const gov = await submitted(inquiry);
    const { deps, vision } = setup();

    await processVerification(job(inquiry.environmentId, gov.id), deps);

    expect(vision.calls.map((call) => call.endpoint)).toEqual(['government-id']);
    expect((await checksOf(inquiry.environmentId, gov.id)).id_selfie_comparison).toMatchObject({
      status: 'not_applicable',
      reasons: ['input_missing'],
    });
  });

  it('has no input before the selfie, as in the default flow', async () => {
    const inquiry = await pendingInquiry({ config: selfieComparison });
    const gov = await submitted(inquiry);
    const { deps } = setup();

    await processVerification(job(inquiry.environmentId, gov.id), deps);

    expect((await checksOf(inquiry.environmentId, gov.id)).id_selfie_comparison).toMatchObject({
      status: 'not_applicable',
      reasons: ['input_missing'],
    });
  });
});

// C35 --------------------------------------------------------------------------------------

describe('A-tier checks and their providers (C35)', () => {
  const aTier = template({
    required: ['id_public_figure_detection'],
    advisory: ['id_aamva_database_lookup', 'id_age_inconsistency_detection'],
  });

  it('answers provider_not_configured without a provider, and sends a required one to review', async () => {
    const inquiry = await pendingInquiry({ config: aTier });
    const gov = await submitted(inquiry);
    const { deps } = setup();

    expect(await processVerification(job(inquiry.environmentId, gov.id), deps)).toMatchObject({
      verificationStatus: 'needs_review',
    });
    const checks = await checksOf(inquiry.environmentId, gov.id);
    for (const id of ['id_public_figure_detection', 'id_age_inconsistency_detection']) {
      expect(checks[id], id).toMatchObject({
        status: 'not_applicable',
        reasons: ['provider_not_configured'],
      });
    }
    // A Utopia identity card is no US AAMVA card: nothing to look up, whatever is bound.
    expect(checks.id_aamva_database_lookup).toMatchObject({
      status: 'not_applicable',
      reasons: ['feature_absent'],
    });
  });

  it('asks the sandbox providers bound to sandbox environments, labelling their results', async () => {
    const inquiry = await pendingInquiry({ config: aTier });
    const gov = await submitted(inquiry);
    const { deps } = setup(SANDBOX_PROVIDERS);

    expect(await processVerification(job(inquiry.environmentId, gov.id), deps)).toMatchObject({
      verificationStatus: 'passed',
    });
    const checks = await checksOf(inquiry.environmentId, gov.id);
    expect(checks.id_public_figure_detection).toMatchObject({
      status: 'passed',
      provenance: { provider: { id: 'sandbox', sandbox: true } },
    });
    expect(checks.id_age_inconsistency_detection).toMatchObject({
      status: 'passed',
      confidence: 0.9,
      provenance: { provider: { id: 'sandbox', sandbox: true } },
    });
  });

  it('binds nothing to production environments, whatever sandbox has', async () => {
    const inquiry = await pendingInquiry({ environmentId: productionId, config: aTier });
    const gov = await submitted(inquiry);
    const { deps } = setup(SANDBOX_PROVIDERS);

    await processVerification(job(productionId, gov.id), deps);

    expect((await checksOf(productionId, gov.id)).id_public_figure_detection).toMatchObject({
      reasons: ['provider_not_configured'],
    });
  });

  it('retries a provider failure, then records it on its check on the last attempt (C30.3)', async () => {
    const failing: ProviderBindings = {
      sandbox: {
        publicFigure: {
          id: 'gallery',
          sandbox: false,
          match: () =>
            Promise.reject(new ProviderError('gallery unavailable', { retryable: true })),
        },
      },
      production: {},
    };
    const inquiry = await pendingInquiry({ config: aTier });
    const gov = await submitted(inquiry);
    const { deps } = setup(failing);

    await expect(processVerification(job(inquiry.environmentId, gov.id), deps)).rejects.toThrow(
      ProviderError,
    );
    expect((await getVerification(db, inquiry.environmentId, gov.id))?.status).toBe('submitted');

    expect(
      await processVerification(job(inquiry.environmentId, gov.id), deps, { lastAttempt: true }),
    ).toMatchObject({ verificationStatus: 'needs_review' });
    expect(
      (await checksOf(inquiry.environmentId, gov.id)).id_public_figure_detection,
    ).toMatchObject({ status: 'not_applicable', reasons: ['execution_error'] });
  });
});

// C30.3 ------------------------------------------------------------------------------------

describe('vision failures (C30.3)', () => {
  const mixed = template({
    required: ['id_blur_detection', 'id_expired_detection'],
    advisory: ['id_repeat_detection'],
  });

  it('throws a vision outage for a retry while attempts remain', async () => {
    const inquiry = await pendingInquiry({ config: mixed });
    const gov = await submitted(inquiry);
    const { deps, vision } = setup();
    vision.answers.governmentId = new VisionUnavailableError(
      '/v1/analyze/government-id',
      'network',
    );

    await expect(processVerification(job(inquiry.environmentId, gov.id), deps)).rejects.toThrow(
      VisionUnavailableError,
    );
  });

  it.each([
    ['an outage', () => new VisionUnavailableError('/v1/analyze/government-id', 'timeout')],
    ['an inference failure (500)', () => new VisionServiceError('/v1/analyze/government-id', 500)],
  ])(
    'records %s on the last attempt: execution_error for vision checks, input_missing for extraction ones',
    async (_label, failure) => {
      const inquiry = await pendingInquiry({ config: mixed });
      const gov = await submitted(inquiry);
      const { deps, vision } = setup();
      vision.answers.governmentId = failure();

      expect(
        await processVerification(job(inquiry.environmentId, gov.id), deps, { lastAttempt: true }),
      ).toMatchObject({ verificationStatus: 'needs_review' });

      const checks = await checksOf(inquiry.environmentId, gov.id);
      expect(checks.id_blur_detection).toMatchObject({
        status: 'not_applicable',
        reasons: ['execution_error'],
      });
      expect(checks.id_expired_detection).toMatchObject({
        status: 'not_applicable',
        reasons: ['input_missing'],
      });
      expect(checks.id_repeat_detection).toMatchObject({
        status: 'not_applicable',
        reasons: ['input_missing'],
      });
      expect(await getGovernmentIdExtraction(db, inquiry.environmentId, gov.id)).toBeNull();
    },
  );

  it('records a contract violation at once, without a retry', async () => {
    const inquiry = await pendingInquiry({ config: mixed });
    const gov = await submitted(inquiry);
    const { deps, vision } = setup();
    vision.answers.governmentId = new VisionResponseError('/v1/analyze/government-id', [
      { path: 'sides.front.mrz', code: 'invalid_type' },
    ]);

    expect(await processVerification(job(inquiry.environmentId, gov.id), deps)).toMatchObject({
      verificationStatus: 'needs_review',
    });
    expect((await checksOf(inquiry.environmentId, gov.id)).id_blur_detection).toMatchObject({
      reasons: ['execution_error'],
    });
  });

  it('lets the selfie compare with an ID under review, and sends the inquiry to review (C30.4, C30.5)', async () => {
    const inquiry = await pendingInquiry({ config: mixed });
    const gov = await submitted(inquiry);
    const selfie = await submitted(inquiry, 'selfie');
    const { deps, vision } = setup();
    vision.answers.governmentId = new VisionUnavailableError(
      '/v1/analyze/government-id',
      'network',
    );

    await processVerification(job(inquiry.environmentId, gov.id), deps, { lastAttempt: true });
    expect(await processVerification(job(inquiry.environmentId, selfie.id), deps)).toMatchObject({
      verificationStatus: 'passed',
      inquiryStatus: 'needs_review',
    });

    expect((await checksOf(inquiry.environmentId, selfie.id)).selfie_id_comparison).toMatchObject({
      status: 'passed',
      metadata: { id_verification_id: gov.id },
    });
    expect(vision.calls.map((call) => call.endpoint)).toEqual([
      'government-id',
      'selfie',
      'embed-face',
    ]);
  });
});
