/**
 * C224.2 for NFC (Phase 10, Workflow 10C; `api-nfc`) against Postgres 17 (Testcontainers), through
 * the flow routes with the SDK's `User-Agent` and `OpenVerify-Flow-Spec: 2`, and the server's real
 * C62 checks (`processVerification` over `@openverify/emrtd`; only vision is a fake, which answers
 * a face by the image it is given).
 *
 * - **client-unable** (C207.9): the report takes the `nfc` step's `exhausted` edge, ends the
 *   verification `canceled` and sends the inquiry to review; a second report and a report for a
 *   step that is not the current one are refused.
 * - **The sandbox test chip** (C208): refused in production (the generic 404) and without the test
 *   anchor (409 `sandbox_chip_anchor_missing`); `trust:sandbox-utopia` installs the anchor in
 *   production mode, never visible to a production loader; then each scenario's chip, uploaded
 *   through the real upload route and submitted with the chip's signature, is judged as it should
 *   be: `match` passes every required check, `mrz-mismatch` fails `document_number_mismatch`,
 *   `face-mismatch` fails `face_mismatch` where faces are configured and answers 422 where they
 *   are not, `tampered-dg1` fails `dg_hash_mismatch`, and `no-active-authentication` answers
 *   `chip_auth_not_server_verifiable`. No answer carries a selfie's bytes, and the same chip in a
 *   production environment fails `specimen_issuer` (C62.3).
 *
 * Every key, chip, MRZ and image is synthetic; the "faces" are JPEG stand-ins made here.
 */
import { createHash, randomBytes } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { FLOW_SPEC_HEADER, newId, type FlowSandboxChipResponse } from '@openverify/contracts';
import {
  createDatabase,
  createFile,
  createGovernmentIdExtraction,
  createInquirySession,
  createKeyring,
  createVerification,
  encryptBytes,
  getInquiry,
  getVerification,
  hashSessionToken,
  listInquiryFlowSteps,
  listVerificationFiles,
  loadTrustStore,
  recordInquirySessionConsent,
  runMigrations,
  setDefaultKeyring,
  setVerificationStatus,
  transitionInquiryStatus,
  type Database,
  type FileKind,
  type Keyring,
} from '@openverify/db';
import {
  createIntegrationPool,
  createTestInquiry,
  createTestTenant,
  startIntegrationPostgres,
} from '@openverify/db/testing';
import { flowV2Schema, type FlowV2 } from '@openverify/flow-spec';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import type { Pool } from 'pg';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../app.js';
import { runTrustSandboxUtopia } from '../operator-commands/trust-sandbox-utopia.js';
import { processVerification, type ProcessVerificationDeps } from '../jobs/process-verification.js';
import {
  createCapturingLogger,
  createFakeVision,
  embedFaceAnswer,
  FAKE_PNG,
  governmentIdFixture,
} from '../jobs/testing.js';
import { systemClock, ulidIdGenerator, type VisionFace, type VisionImage } from '../ports.js';
import { createInMemoryFileStorage, type InMemoryFileStorage } from '../storage/index.js';
import {
  createAllowAllRateLimiter,
  createCapturingMailer,
  createRecordingAuditLogger,
  createRecordingEventPublisher,
  createRecordingQueue,
  createRecordingRedactionService,
  phase5TestDependencies,
} from '../test-support/fakes.js';
import { multipart } from '../test-support/harness.js';
import {
  nfcTemplateAttributes,
  seedNfcInquiry,
  td3ExtractionFields,
  testChip,
} from './chip-challenges/testing.js';
import { createDbAccountsService } from './inquiries.test-support.js';
import { SANDBOX_CHIP_FACES_ENV, SANDBOX_CHIP_OTHER_FACE_FILE } from './sandbox-chip.js';

const FLOW = '/api/v1/flow';
/** The SDK's `User-Agent` (Phase 7 C94.5): the server reads it as `mobile-sdk-name`. */
const SDK_AGENT = 'OpenVerify-Android/0.1.0';
const DESKTOP_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

/** JPEG stand-ins (magic bytes and padding, no face): the person's selfie, and another person's. */
const SELFIE = new Uint8Array([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 1, 0xff, 0xd9,
]);
const OTHER_FACE = new Uint8Array([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 2, 2, 2, 2, 0xff, 0xd9,
]);

let postgres: StartedPostgreSqlContainer | undefined;
let pool: Pool | undefined;
let db: Database;
let keyring: Keyring;
let storage: InMemoryFileStorage;
let sandboxEnv: string;
let productionEnv: string;
let app: ReturnType<typeof buildApp> | undefined;
let jobDeps: ProcessVerificationDeps;
let facesDirectory: string;

beforeAll(async () => {
  postgres = await startIntegrationPostgres();
  pool = createIntegrationPool(postgres.getConnectionUri(), { max: 8 });
  db = createDatabase(pool);
  keyring = createKeyring(randomBytes(32));
  setDefaultKeyring(keyring);
  await runMigrations(db);
  sandboxEnv = (await createTestTenant(db, { organizationName: 'Nfc 10C Org' })).environment.id;
  productionEnv = (await createTestTenant(db, { kind: 'production' })).environment.id;
  storage = createInMemoryFileStorage();
  const events = createRecordingEventPublisher();
  const queue = createRecordingQueue();
  const phase5 = phase5TestDependencies();
  app = buildApp({
    lookupApiKey: () => Promise.resolve(null),
    logger: false,
    mode: 'test',
    api: {
      db,
      keyring,
      storage,
      events,
      queue,
      clock: systemClock,
      ids: ulidIdGenerator,
      flowPublicUrl: 'https://flow.example.test',
      flowCorsOrigins: ['https://flow.example.test'],
      accounts: createDbAccountsService(),
      redaction: createRecordingRedactionService(),
      audit: createRecordingAuditLogger(),
      rateLimiter: createAllowAllRateLimiter(),
      mailer: createCapturingMailer(),
      ...phase5,
    },
  });
  await app.ready();
  // The worker's side: the real checks, and a vision that answers a face by the image it is given.
  const portrait = governmentIdFixture().sides.front.portrait;
  if (portrait === null) {
    throw new Error('the golden ID front has a portrait');
  }
  const face: VisionFace = portrait;
  const otherFace: VisionFace = {
    ...face,
    embedding: face.embedding.map((value, index) => (index % 2 === 0 ? -value : value)),
  };
  const vision = createFakeVision();
  vision.answers.embedFace = (image: VisionImage) =>
    embedFaceAnswer(Buffer.from(image.bytes).equals(Buffer.from(OTHER_FACE)) ? otherFace : face);
  vision.answers.convertPortrait = FAKE_PNG;
  jobDeps = {
    db,
    storage,
    keyring,
    vision: vision.client,
    events,
    clock: systemClock,
    logger: createCapturingLogger(),
    blindIndexKey: phase5.blindIndexKey,
    queue,
  };
  facesDirectory = await mkdtemp(path.join(tmpdir(), 'openverify-sandbox-faces-'));
  await writeFile(path.join(facesDirectory, SANDBOX_CHIP_OTHER_FACE_FILE), OTHER_FACE);
}, 180_000);

afterAll(async () => {
  await app?.close();
  await pool?.end();
  await postgres?.stop();
  setDefaultKeyring(undefined);
  await rm(facesDirectory, { recursive: true, force: true });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

const edge = (id: string, from: string, port: string, to: string) => ({ id, from, port, to });

const STEPS = [
  {
    id: 'consent',
    type: 'consent',
    textKeys: ['consent.biometric', 'consent.processing'],
    required: true,
  },
  {
    id: 'id_card',
    type: 'government_id',
    sides: 'front',
    maxAttempts: 3,
    captureMethods: ['camera', 'upload'],
  },
  { id: 'face', type: 'selfie', poses: ['center'], liveness: 'passive', maxAttempts: 3 },
  { id: 'chip', type: 'nfc', androidOnly: true },
  {
    id: 'about',
    type: 'screen',
    components: [
      { id: 'nick', kind: 'text_input', field: 'nickname', labelKey: 'about.nickname' },
      { id: 'go', kind: 'button', labelKey: 'screen.continue', action: 'submit' },
    ],
  },
  { id: 'done', type: 'completion' },
];

/** consent, a one-sided ID, a selfie, the chip, completion; the chip's fallback leads to `fallback`. */
function chipFlow(fallback: 'done' | 'about' | null): FlowV2 {
  return flowV2Schema.parse({
    metadata: { specVersion: 2, id: `chip-${String(fallback)}`, version: 1, name: 'Chip' },
    entry: 'consent',
    steps: STEPS,
    edges: [
      edge('e1', 'consent', 'next', 'id_card'),
      edge('e2', 'id_card', 'next', 'face'),
      edge('e3', 'face', 'next', 'chip'),
      edge('e4', 'chip', 'next', 'done'),
      edge('e5', 'about', 'next', 'done'),
      ...(fallback === null ? [] : [edge('e6', 'chip', 'exhausted', fallback)]),
    ],
  });
}

const MRZ_SOURCES = Object.fromEntries(
  (
    [
      'name-first',
      'name-last',
      'birthdate',
      'sex',
      'nationality',
      'identification-number',
      'expiration-date',
      'issuing-authority-code',
    ] as const
  ).map((field) => [field, ['mrz'] as const]),
);

async function storeFile(
  environmentId: string,
  verificationId: string,
  kind: FileKind,
  bytes: Uint8Array,
): Promise<void> {
  const id = newId('file');
  const sealed = encryptBytes(bytes, keyring, { context: id });
  const storageKey = `${environmentId}/${id}`;
  await storage.put(storageKey, sealed.ciphertext);
  await createFile(db, environmentId, {
    id,
    verificationId,
    kind,
    storageKey,
    mimeType: 'image/jpeg',
    byteSize: bytes.byteLength,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    wrappedDek: sealed.wrappedDek,
  });
}

interface Opened {
  inquiryId: string;
  token: string;
}

/**
 * An inquiry whose person consented and passed the ID (a Utopia passport reading) and the selfie,
 * so the first session read finds the position at the chip step; and its session token.
 */
async function atChipStep(flow: FlowV2, environmentId = sandboxEnv): Promise<Opened> {
  const { inquiry } = await createTestInquiry(db, environmentId, {
    flow,
    verificationConfig: nfcTemplateAttributes()['verification-config'],
  });
  await transitionInquiryStatus(db, environmentId, inquiry.id, { from: 'created', to: 'pending' });
  const token = `ovs_synthetic${randomBytes(32).toString('base64url').slice(0, 34)}`;
  const session = await createInquirySession(db, environmentId, {
    id: newId('iqse'),
    inquiryId: inquiry.id,
    tokenHash: hashSessionToken(token),
    expiresAt: new Date(Date.now() + 3_600_000),
  });
  await recordInquirySessionConsent(db, environmentId, session.id, {
    acceptedAt: new Date(),
    textKeys: ['consent.biometric', 'consent.processing'],
    optionalTextKeys: [],
    locale: 'en',
    ip: null,
    userAgent: null,
  });
  const idCard = newId('ver');
  await createVerification(db, environmentId, {
    id: idCard,
    inquiryId: inquiry.id,
    type: 'government_id',
    idClass: 'passport',
  });
  await createGovernmentIdExtraction(db, environmentId, {
    verificationId: idCard,
    fields: td3ExtractionFields(),
    fieldSources: MRZ_SOURCES,
    identificationNumberIndex: null,
    frontPhash: null,
  });
  await setVerificationStatus(db, environmentId, idCard, { to: 'submitted' });
  await setVerificationStatus(db, environmentId, idCard, { to: 'passed' });
  const selfie = newId('ver');
  await createVerification(db, environmentId, {
    id: selfie,
    inquiryId: inquiry.id,
    type: 'selfie',
  });
  await storeFile(environmentId, selfie, 'selfie-center', SELFIE);
  await setVerificationStatus(db, environmentId, selfie, { to: 'submitted' });
  await setVerificationStatus(db, environmentId, selfie, { to: 'passed' });
  return { inquiryId: inquiry.id, token };
}

interface Answer<Body = Record<string, unknown>> {
  status: number;
  body: Body;
  text: string;
}

async function call<Body = Record<string, unknown>>(
  method: 'GET' | 'POST',
  url: string,
  token: string,
  payload?: Record<string, unknown>,
  agent: string = SDK_AGENT,
): Promise<Answer<Body>> {
  const server = app;
  if (server === undefined) {
    throw new Error('the app did not start');
  }
  const response = await server.inject({
    method,
    url: `${FLOW}${url}`,
    headers: {
      'user-agent': agent,
      [FLOW_SPEC_HEADER.toLowerCase()]: '2',
      authorization: `Bearer ${token}`,
    },
    remoteAddress: '192.0.2.10',
    ...(payload === undefined ? {} : { payload }),
  });
  return { status: response.statusCode, body: response.json<Body>(), text: response.body };
}

interface SessionBody {
  position?: { 'step-id': string | null; state: string };
  step?: Record<string, unknown>;
}

/** Reads the session (which positions the inquiry at the chip step) and creates the chip attempt. */
async function startChipAttempt(
  target: Opened,
  agent: string = SDK_AGENT,
): Promise<{ session: SessionBody; verificationId: string }> {
  const session = await call<SessionBody>('GET', '/session', target.token, undefined, agent);
  expect(session.status).toBe(200);
  expect(session.body.position).toMatchObject({ 'step-id': 'chip', state: 'active' });
  const created = await call<{ data: { id: string } }>(
    'POST',
    '/verifications',
    target.token,
    { type: 'government-id-nfc' },
    agent,
  );
  expect(created.status, created.text).toBe(201);
  return { session: session.body, verificationId: created.body.data.id };
}

const statusOf = async (environmentId: string, inquiryId: string) =>
  (await getInquiry(db, environmentId, inquiryId))?.status;

describe('client-unable (C207.9, C224.2)', () => {
  it('takes the exhausted edge, ends the verification canceled and sends the inquiry to review', async () => {
    const target = await atChipStep(chipFlow('done'));
    const { session, verificationId } = await startChipAttempt(target);
    expect(session.step).toMatchObject({ type: 'nfc', fallbackAvailable: true });

    const report = await call(
      'POST',
      `/verifications/${verificationId}/client-unable`,
      target.token,
      {
        reason: 'nfc_unavailable',
      },
    );

    expect(report.status, report.text).toBe(200);
    expect(report.body).toEqual({ 'verification-id': verificationId, status: 'canceled' });
    expect(report.text).not.toMatch(/review/i);
    expect((await getVerification(db, sandboxEnv, verificationId))?.status).toBe('canceled');
    const record = await listInquiryFlowSteps(db, sandboxEnv, target.inquiryId);
    const chip = record.find((entry) => entry.stepId === 'chip');
    expect(chip).toMatchObject({ exitPort: 'exhausted', outcome: 'client_unable' });
    expect(chip?.notes).toEqual(
      expect.arrayContaining([
        'client-unable',
        'client-unable-reason:nfc_unavailable',
        'client-unable-platform:android',
      ]),
    );
    expect(chip?.notes).not.toContain('fallback-continue');
    expect(record.at(-1)?.stepId).toBe('done');
    expect(await statusOf(sandboxEnv, target.inquiryId)).toBe('needs_review');
  });

  it('names the web flow’s platform when a browser reports platform_unsupported', async () => {
    const target = await atChipStep(chipFlow('about'));
    const { verificationId } = await startChipAttempt(target, DESKTOP_AGENT);

    const report = await call(
      'POST',
      `/verifications/${verificationId}/client-unable`,
      target.token,
      { reason: 'platform_unsupported' },
      DESKTOP_AGENT,
    );

    expect(report.status, report.text).toBe(200);
    const chip = (await listInquiryFlowSteps(db, sandboxEnv, target.inquiryId)).find(
      (entry) => entry.stepId === 'chip',
    );
    expect(chip?.notes).toEqual(
      expect.arrayContaining([
        'client-unable-reason:platform_unsupported',
        'client-unable-platform:web',
      ]),
    );
  });

  it('refuses a second report, and one once the chip step is no longer the current step', async () => {
    const target = await atChipStep(chipFlow('about'));
    const { verificationId } = await startChipAttempt(target);
    const first = await call(
      'POST',
      `/verifications/${verificationId}/client-unable`,
      target.token,
      {
        reason: 'reader_not_installed',
      },
    );
    expect(first.status, first.text).toBe(200);
    const after = await call<SessionBody>('GET', '/session', target.token);
    expect(after.body.position).toMatchObject({ 'step-id': 'about', state: 'active' });
    expect(await statusOf(sandboxEnv, target.inquiryId)).toBe('pending');
    const before = await listInquiryFlowSteps(db, sandboxEnv, target.inquiryId);

    const second = await call(
      'POST',
      `/verifications/${verificationId}/client-unable`,
      target.token,
      {
        reason: 'reader_not_installed',
      },
    );
    // Another chip attempt, written directly: the flow API creates none away from the chip step.
    const later = newId('ver');
    await createVerification(db, sandboxEnv, {
      id: later,
      inquiryId: target.inquiryId,
      type: 'government_id_nfc',
    });
    const elsewhere = await call('POST', `/verifications/${later}/client-unable`, target.token, {
      reason: 'reader_not_installed',
    });

    expect(second.status).toBe(409);
    expect(elsewhere.status).toBe(409);
    expect(elsewhere.body).toMatchObject({ code: 'client_unable_not_allowed' });
    expect((await getVerification(db, sandboxEnv, later))?.status).toBe('initiated');
    expect(await listInquiryFlowSteps(db, sandboxEnv, target.inquiryId)).toEqual(before);
  });

  it('refuses an nfc step without an exhausted edge, and moves nothing', async () => {
    const target = await atChipStep(chipFlow(null));
    const { session, verificationId } = await startChipAttempt(target);
    expect(session.step).toMatchObject({ type: 'nfc', fallbackAvailable: false });

    const report = await call(
      'POST',
      `/verifications/${verificationId}/client-unable`,
      target.token,
      {
        reason: 'nfc_unavailable',
      },
    );

    expect(report.status).toBe(409);
    expect(report.body).toMatchObject({ code: 'client_unable_not_allowed' });
    expect((await getVerification(db, sandboxEnv, verificationId))?.status).toBe('initiated');
    expect(await statusOf(sandboxEnv, target.inquiryId)).toBe('pending');
  });
});

// The sandbox test chip ------------------------------------------------------------------------

interface Challenge {
  id: string;
  nonce: string;
}

async function challengeOf(target: Opened, verificationId: string): Promise<Challenge> {
  const answer = await call<Challenge>(
    'POST',
    `/verifications/${verificationId}/chip-challenges`,
    target.token,
    {},
  );
  expect(answer.status, answer.text).toBe(201);
  return answer.body;
}

const takeChip = (target: Opened, verificationId: string, challengeId: string, scenario?: string) =>
  call<FlowSandboxChipResponse & { code?: string }>(
    'POST',
    `/verifications/${verificationId}/sandbox-chip`,
    target.token,
    { 'challenge-id': challengeId, ...(scenario === undefined ? {} : { scenario }) },
  );

/** Uploads the answered files through the real upload route. */
async function uploadChipFiles(
  target: Opened,
  verificationId: string,
  chip: FlowSandboxChipResponse,
): Promise<void> {
  const server = app;
  if (server === undefined) {
    throw new Error('the app did not start');
  }
  for (const file of chip.files) {
    const body = await multipart({
      kind: file.kind,
      file: { bytes: Buffer.from(file.content, 'base64'), filename: `${file.kind}.bin` },
    });
    const uploaded = await server.inject({
      method: 'POST',
      url: `${FLOW}/verifications/${verificationId}/files`,
      headers: {
        ...body.headers,
        'user-agent': SDK_AGENT,
        authorization: `Bearer ${target.token}`,
      },
      remoteAddress: '192.0.2.10',
      payload: body.payload,
    });
    expect(uploaded.statusCode, `${file.kind}: ${uploaded.body}`).toBe(201);
  }
}

/** Uploads the answered files through the real upload route, then submits with the signature. */
async function uploadAndSubmit(
  target: Opened,
  verificationId: string,
  challenge: Challenge,
  chip: FlowSandboxChipResponse,
): Promise<void> {
  await uploadChipFiles(target, verificationId, chip);
  const response = chip['active-authentication-response'];
  const submitted = await call('POST', `/verifications/${verificationId}/submit`, target.token, {
    chip: {
      'challenge-id': challenge.id,
      nonce: challenge.nonce,
      ...(response === undefined ? {} : { 'active-authentication-response': response }),
    },
  });
  expect(submitted.status, submitted.text).toBeLessThan(300);
}

/** The whole sandbox read of `scenario`, judged by the server's checks. */
async function readAndJudge(scenario: string | undefined) {
  const target = await atChipStep(chipFlow('done'));
  const { session, verificationId } = await startChipAttempt(target);
  const challenge = await challengeOf(target, verificationId);
  const chip = await takeChip(target, verificationId, challenge.id, scenario);
  expect(chip.status, chip.text).toBe(200);
  await uploadAndSubmit(target, verificationId, challenge, chip.body);
  await processVerification({ environmentId: sandboxEnv, verificationId }, jobDeps, {
    lastAttempt: true,
  });
  const verification = await getVerification(db, sandboxEnv, verificationId);
  const checks = Object.fromEntries(
    (verification?.checks ?? []).map((check) => [check.name, check]),
  );
  return { target, session, verificationId, chip, verification, checks };
}

/** The verification's stored files of `kind`, oldest first. */
const storedOf = async (verificationId: string, kind: FileKind) =>
  (await listVerificationFiles(db, sandboxEnv, [verificationId])).filter(
    (file) => file.kind === kind,
  );

const sha256Of = (content: string) =>
  createHash('sha256').update(Buffer.from(content, 'base64')).digest('hex');

const contentOf = (chip: FlowSandboxChipResponse, kind: string): string => {
  const file = chip.files.find((candidate) => candidate.kind === kind);
  if (file === undefined) {
    throw new Error(`the chip answered no ${kind}`);
  }
  return file.content;
};

/**
 * One verification read twice (KP10-39): after a submit refused with `chip_challenge_invalid` the
 * SDK returns to "I'm ready" and uploads every file again from the new read, under a fresh
 * challenge. Reads `first`, uploads it without submitting, then reads `second` under a new
 * challenge, uploads and submits it, and has the server judge the verification.
 */
async function readTwiceAndJudge(first: string, second: string) {
  const target = await atChipStep(chipFlow('done'));
  const { verificationId } = await startChipAttempt(target);
  const firstChallenge = await challengeOf(target, verificationId);
  const firstChip = await takeChip(target, verificationId, firstChallenge.id, first);
  expect(firstChip.status, firstChip.text).toBe(200);
  await uploadChipFiles(target, verificationId, firstChip.body);
  const firstStored = await storedOf(verificationId, 'chip-dg1');

  const secondChallenge = await challengeOf(target, verificationId);
  const secondChip = await takeChip(target, verificationId, secondChallenge.id, second);
  expect(secondChip.status, secondChip.text).toBe(200);
  await uploadAndSubmit(target, verificationId, secondChallenge, secondChip.body);
  const secondStored = await storedOf(verificationId, 'chip-dg1');
  await processVerification({ environmentId: sandboxEnv, verificationId }, jobDeps, {
    lastAttempt: true,
  });
  const verification = await getVerification(db, sandboxEnv, verificationId);
  const checks = Object.fromEntries(
    (verification?.checks ?? []).map((check) => [check.name, check]),
  );
  return {
    verificationId,
    verification,
    checks,
    firstStored,
    secondStored,
    firstDg1: sha256Of(contentOf(firstChip.body, 'chip-dg1')),
    secondDg1: sha256Of(contentOf(secondChip.body, 'chip-dg1')),
  };
}

describe('the sandbox test chip before the anchor is installed (C208.1)', () => {
  it('answers 409 sandbox_chip_anchor_missing, and the session offers no test chip', async () => {
    const target = await atChipStep(chipFlow('done'));
    const { session, verificationId } = await startChipAttempt(target);
    const challenge = await challengeOf(target, verificationId);

    const chip = await takeChip(target, verificationId, challenge.id);

    expect(chip.status).toBe(409);
    expect(chip.body).toMatchObject({ code: 'sandbox_chip_anchor_missing' });
    expect(session.step).not.toHaveProperty('sandboxChipAvailable');
    // The MRZ key fields are served to the SDK at this step whatever the anchor.
    expect(session.step).toMatchObject({
      prefillMrz: { documentNumber: 'UT1234567', birthDate: '900412', expiryDate: '310411' },
    });
  });
});

describe('trust:sandbox-utopia in production mode (C208.1; decision 69)', () => {
  it('installs the sandbox-only anchor, which no production loader sees', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    const lines: string[] = [];

    const result = await runTrustSandboxUtopia({
      db,
      clock: systemClock,
      out: (line) => lines.push(line),
    });

    expect(result.outcome).toBe('installed');
    expect(lines).toHaveLength(1);
    const sandbox = await loadTrustStore(db, { environmentKind: 'sandbox' });
    expect(
      sandbox.anchors.map((anchor) => [anchor.id, anchor.sandboxOnly, anchor.withdrawn]),
    ).toEqual([[result.anchorId, true, false]]);
    expect((await loadTrustStore(db, { environmentKind: 'production' })).anchors).toEqual([]);
  });
});

describe('the sandbox test chip, through the server’s checks (C208, C224.2)', () => {
  it('is refused in production with the 404 of an unknown route', async () => {
    const target = await atChipStep(chipFlow('done'), productionEnv);
    const known = await call(
      'POST',
      '/verifications/ver_01M5CK3190XEVBM5ZXA76E1JSM/sandbox-chip',
      target.token,
      { 'challenge-id': 'chc_01M5CK3190XEVBM5ZXA76E1JSM' },
    );
    const unknown = await call(
      'POST',
      '/verifications/ver_01M5CK3190XEVBM5ZXA76E1JSM/no-such-route',
      target.token,
      { 'challenge-id': 'chc_01M5CK3190XEVBM5ZXA76E1JSM' },
    );
    const session = await call<SessionBody>('GET', '/session', target.token);

    expect(known.status).toBe(404);
    expect(known.body).not.toHaveProperty('code');
    expect(known.body.title).toBe(unknown.body.title);
    expect(session.body.step).not.toHaveProperty('sandboxChipAvailable');
  });

  it('match: passes every required NFC check, labelled as a sandbox chip, and no answer carries the selfie', async () => {
    const { session, chip, verification, checks, verificationId } = await readAndJudge(undefined);

    expect(session.step).toMatchObject({ sandboxChipAvailable: true });
    expect(chip.body.files.map((file) => file.kind)).not.toContain('chip-dg2');
    expect(chip.body['dg2-attached']).toBe(true);
    expect(chip.text).not.toContain(Buffer.from(SELFIE).toString('base64'));
    expect(verification?.status).toBe('passed');
    expect(
      Object.fromEntries(Object.entries(checks).map(([name, check]) => [name, check.status])),
    ).toEqual({
      id_nfc_expired_detection: 'passed',
      id_nfc_passive_authentication_detection: 'passed',
      id_nfc_chip_authentication_detection: 'passed',
      id_nfc_mrz_comparison: 'passed',
      id_nfc_selfie_comparison: 'passed',
      id_nfc_repeat_detection: 'passed',
    });
    expect(checks.id_nfc_passive_authentication_detection?.metadata).toMatchObject({
      integrity: 'established',
    });
    const { sandboxChipLabelOf } = await import('./sandbox-chip.js');
    expect(await sandboxChipLabelOf(db, { environmentId: sandboxEnv, id: verificationId })).toBe(
      'match',
    );
  });

  it('mrz-mismatch: fails the MRZ comparison on the document number', async () => {
    const { verification, checks } = await readAndJudge('mrz-mismatch');

    expect(checks.id_nfc_mrz_comparison).toMatchObject({
      status: 'failed',
      reasons: ['document_number_mismatch'],
    });
    expect(checks.id_nfc_passive_authentication_detection?.status).toBe('passed');
    expect(verification?.status).toBe('failed');
  });

  it('tampered-dg1: fails Passive Authentication with dg_hash_mismatch', async () => {
    const { verification, checks } = await readAndJudge('tampered-dg1');

    expect(checks.id_nfc_passive_authentication_detection).toMatchObject({
      status: 'failed',
      reasons: ['dg_hash_mismatch'],
    });
    expect(verification?.status).toBe('failed');
  });

  it('no-active-authentication: answers chip_auth_not_server_verifiable, never a pass of that check', async () => {
    const { chip, checks } = await readAndJudge('no-active-authentication');

    expect(chip.body).not.toHaveProperty('active-authentication-response');
    expect(checks.id_nfc_chip_authentication_detection).toMatchObject({
      status: 'not_applicable',
      reasons: ['chip_auth_not_server_verifiable'],
    });
    expect(checks.id_nfc_passive_authentication_detection?.status).toBe('passed');
  });

  it('face-mismatch: 422 sandbox_chip_scenario_unavailable where no fixture faces are configured', async () => {
    vi.stubEnv(SANDBOX_CHIP_FACES_ENV, '');
    const target = await atChipStep(chipFlow('done'));
    const { verificationId } = await startChipAttempt(target);
    const challenge = await challengeOf(target, verificationId);

    const chip = await takeChip(target, verificationId, challenge.id, 'face-mismatch');

    expect(chip.status).toBe(422);
    expect(chip.body).toMatchObject({ code: 'sandbox_chip_scenario_unavailable' });
  });

  it('face-mismatch: fails the selfie comparison where faces are configured, and no image leaves the server', async () => {
    vi.stubEnv(SANDBOX_CHIP_FACES_ENV, facesDirectory);

    const { chip, verification, checks } = await readAndJudge('face-mismatch');

    expect(chip.text).not.toContain(Buffer.from(OTHER_FACE).toString('base64'));
    expect(chip.text).not.toContain(Buffer.from(SELFIE).toString('base64'));
    expect(checks.id_nfc_selfie_comparison).toMatchObject({
      status: 'failed',
      reasons: ['face_mismatch'],
    });
    expect(checks.id_nfc_passive_authentication_detection?.status).toBe('passed');
    expect(verification?.status).toBe('failed');
  });

  it('the same chip in a production environment fails specimen_issuer (C62.3)', async () => {
    const target = await atChipStep(chipFlow('done'));
    const { verificationId } = await startChipAttempt(target);
    const challenge = await challengeOf(target, verificationId);
    const chip = await takeChip(target, verificationId, challenge.id);
    expect(chip.status, chip.text).toBe(200);
    const now = new Date();

    const seeded = await seedNfcInquiry(db, {
      environmentId: productionEnv,
      storage,
      keyring,
      now,
      chip: testChip({ now, seed: 'nfc-10c/production' }),
      uploads: chip.body.files.map((file) => [file.kind, Buffer.from(file.content, 'base64')]),
      activeAuthentication: 'none',
    });
    await processVerification(
      { environmentId: productionEnv, verificationId: seeded.verificationId },
      jobDeps,
      { lastAttempt: true },
    );

    const judged = await getVerification(db, productionEnv, seeded.verificationId);
    expect(
      judged?.checks.find((check) => check.name === 'id_nfc_passive_authentication_detection'),
    ).toMatchObject({ status: 'failed', reasons: ['specimen_issuer'] });
    expect(judged?.status).toBe('failed');
  });
});

describe('a chip file kind uploaded twice to one verification (KP10-39; C207.2, C52.4)', () => {
  it('is replaced: an altered first read is not evidence once a sound second read is submitted', async () => {
    const read = await readTwiceAndJudge('tampered-dg1', 'match');

    expect(read.firstDg1).not.toBe(read.secondDg1);
    expect(read.firstStored.map((file) => file.sha256)).toEqual([read.firstDg1]);
    // One file of the kind: the second upload's row replaced the first's, whose object is gone.
    expect(read.secondStored.map((file) => file.sha256)).toEqual([read.secondDg1]);
    expect(read.secondStored[0]?.id).not.toBe(read.firstStored[0]?.id);
    expect(await storage.get(read.firstStored[0]?.storageKey ?? '')).toBeNull();
    expect(await storage.get(read.secondStored[0]?.storageKey ?? '')).not.toBeNull();
    const kinds = (await listVerificationFiles(db, sandboxEnv, [read.verificationId])).map(
      (file) => file.kind,
    );
    expect(new Set(kinds).size).toBe(kinds.length);
    expect(read.verification?.status).toBe('passed');
    expect(read.checks.id_nfc_passive_authentication_detection).toMatchObject({
      status: 'passed',
      metadata: { integrity: 'established' },
    });
  });

  it('is replaced the other way too: a sound first read does not pass an altered second read', async () => {
    const read = await readTwiceAndJudge('match', 'tampered-dg1');

    expect(read.secondStored.map((file) => file.sha256)).toEqual([read.secondDg1]);
    expect(await storage.get(read.firstStored[0]?.storageKey ?? '')).toBeNull();
    expect(read.verification?.status).toBe('failed');
    expect(read.checks.id_nfc_passive_authentication_detection).toMatchObject({
      status: 'failed',
      reasons: ['dg_hash_mismatch'],
    });
  });

  it('never holds two files of a kind: the table refuses a second row beside the first', async () => {
    const target = await atChipStep(chipFlow('done'));
    const { verificationId } = await startChipAttempt(target);
    await storeFile(sandboxEnv, verificationId, 'chip-dg1', new Uint8Array([0x61, 1, 2]));

    await expect(
      storeFile(sandboxEnv, verificationId, 'chip-dg1', new Uint8Array([0x61, 3, 4])),
    ).rejects.toMatchObject({
      cause: { constraint: 'files_environment_id_verification_id_kind_key' },
    });
  });
});
