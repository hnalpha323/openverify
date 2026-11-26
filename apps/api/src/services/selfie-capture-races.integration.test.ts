/**
 * C40.6 against Postgres 17 row locks (Testcontainers), Workflow 4A Stage 3 (api-flow): every
 * writer of a capture or a selfie file runs in one transaction that locks the inquiry (its
 * `redacted_at` and status re-checked), then the verification, then the capture. Each test holds
 * the competing writer's locks in a transaction of its own connection, as a concurrent request,
 * job or redaction would, and runs the service:
 * - create, upload, submit and the capture-cap cancel wait for a redaction and then write nothing;
 * - an upload waits for a supersede and is refused; the stale upload (its checks passed before a
 *   supersede committed) is refused at its insert;
 * - submit waits for a supersede and is refused; a create waits for a submit and is refused;
 * - an upload waits for the inquiry `expire` action and is refused;
 * - an operator decline waits for a face data write and then deletes what it wrote.
 * Every value is synthetic.
 */
import { randomBytes } from 'node:crypto';
import {
  defaultInquiryTemplateAttributes,
  newId,
  SELFIE_CAPTURE_LIMIT,
  SELFIE_POSE_FILE_KINDS,
  type SelfiePose,
} from '@openverify/contracts';
import {
  createEnvironment,
  createFaceTemplate,
  createInquiry,
  createInquirySession,
  createInquiryTemplate,
  createKeyring,
  createOrganization,
  createSelfieBackground,
  createVerification,
  createDatabase,
  getSelfieCapture,
  getVerification,
  hashSessionToken,
  listSelfieCaptures,
  listVerificationFiles,
  lockInquiry,
  recordInquirySessionConsent,
  runMigrations,
  setDefaultKeyring,
  transitionInquiryStatus,
  type Database,
  type Db,
} from '@openverify/db';
import { createIntegrationPool, testId, startIntegrationPostgres, ifSet } from '@openverify/db/testing';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { sql } from 'drizzle-orm';
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { FlowSession } from '../auth/flow-session.js';
import { UNMASKED } from '../auth/pii.js';
import { ConflictError, RedactedError } from '../errors.js';
import { runInquiryExpiry } from '../jobs/inquiry-expiry.js';
import { createCapturingLogger } from '../jobs/testing.js';
import { ulidIdGenerator } from '../ports.js';
import { createInMemoryFileStorage, type InMemoryFileStorage } from '../storage/index.js';
import {
  createAllowAllRateLimiter,
  createCapturingMailer,
  createRecordingAuditLogger,
  createRecordingEventPublisher,
  createRecordingQueue,
  createRecordingRedactionService,
  fixedClock,
  phase5TestDependencies,
} from '../test-support/fakes.js';
import { createAccountsService } from './accounts.js';
import type { ApiDependencies } from './context.js';
import { createFlowSelfieCapture, submitVerification, uploadFile } from './flow.js';
import { performInquiryAction, type Acting } from './inquiries.js';
import { SelfieCaptureConflictError } from './selfie-captures.js';

const keyring = createKeyring(randomBytes(32));
const defaults = defaultInquiryTemplateAttributes();
/** Long enough for a service that takes no lock to finish first. */
const WAIT_MS = 1_500;

let container: StartedPostgreSqlContainer | undefined;
let pool: Pool;
let db: Database;
let deps: ApiDependencies;
let storage: InMemoryFileStorage;
let environmentId: string;
let templateId: string;
let versionId: string;

beforeAll(async () => {
  container = await startIntegrationPostgres();
  pool = createIntegrationPool(container.getConnectionUri(), { max: 10 });
  db = createDatabase(pool);
  await runMigrations(db);
  setDefaultKeyring(keyring);
  const clock = fixedClock(new Date());
  const events = createRecordingEventPublisher();
  storage = createInMemoryFileStorage();
  deps = {
    db,
    keyring,
    storage,
    events,
    queue: createRecordingQueue(),
    clock,
    ids: ulidIdGenerator,
    flowPublicUrl: 'https://flow.example.test',
    flowCorsOrigins: ['https://flow.example.test'],
    accounts: createAccountsService({ events }),
    redaction: createRecordingRedactionService(clock),
    audit: createRecordingAuditLogger(),
    rateLimiter: createAllowAllRateLimiter(clock),
    mailer: createCapturingMailer(),
    ...phase5TestDependencies(clock),
  };
  const organization = await createOrganization(db, { id: newId('org'), name: 'Race Org' });
  environmentId = (
    await createEnvironment(db, {
      id: newId('env'),
      organizationId: organization.id,
      kind: 'sandbox',
    })
  ).id;
  const template = await createInquiryTemplate(db, environmentId, {
    id: newId('itmpl'),
    name: 'Selfie races',
    version: {
      id: newId('itmplv'),
      flow: defaults.flow,
      verificationConfig: defaults['verification-config'],
    },
  });
  templateId = template.id;
  versionId = template.currentVersion.id;
}, 180_000);

afterAll(async () => {
  setDefaultKeyring(undefined);
  await ifSet(pool)?.end();
  await container?.stop();
});

/** C128.1: a decline writes a record, whose actor must be a real id. */
const ACTOR_KEY = testId('key');

const acting = (): Acting => ({
  ctx: { organizationId: 'org_X', environmentId },
  actor: { type: 'api-key', id: ACTOR_KEY },
  mask: UNMASKED,
  environmentKind: 'sandbox',
});

/** A pending inquiry whose session consented, with a selfie verification of the default step. */
async function consentedSelfie(): Promise<{ session: FlowSession; verificationId: string }> {
  const inquiry = await createInquiry(db, environmentId, {
    id: newId('inq'),
    inquiryTemplateId: templateId,
    inquiryTemplateVersionId: versionId,
  });
  await transitionInquiryStatus(db, environmentId, inquiry.id, { from: 'created', to: 'pending' });
  const session = await createInquirySession(db, environmentId, {
    id: newId('iqse'),
    inquiryId: inquiry.id,
    tokenHash: hashSessionToken(`ovs_${randomBytes(16).toString('hex')}`),
    expiresAt: new Date(Date.now() + 86_400_000),
  });
  await recordInquirySessionConsent(db, environmentId, session.id, {
    acceptedAt: new Date(),
    textKeys: ['consent.biometric', 'consent.processing'],
    optionalTextKeys: [],
    locale: 'en',
    ip: null,
    userAgent: null,
  });
  const verificationId = newId('ver');
  await createVerification(db, environmentId, { id: verificationId, inquiryId: inquiry.id, type: 'selfie' });
  return { session: { id: session.id, environmentId, inquiryId: inquiry.id }, verificationId };
}

interface Capture {
  id: string;
  nonce: string;
  prompts: SelfiePose[];
}

async function create(flow: { session: FlowSession; verificationId: string }): Promise<Capture> {
  const { data } = await createFlowSelfieCapture(deps, flow.session, flow.verificationId, {
    method: 'camera',
  });
  return { id: data.id, nonce: data.attributes.nonce, prompts: [...data.attributes.prompts] };
}

function upload(
  flow: { session: FlowSession; verificationId: string },
  capture: Capture,
  pose: SelfiePose,
) {
  return uploadFile(deps, flow.session, flow.verificationId, () =>
    Promise.resolve({
      kind: SELFIE_POSE_FILE_KINDS[pose],
      bytes: Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, ...randomBytes(32)]),
      capture: { id: capture.id, nonce: capture.nonce, clientElapsedMs: 1000 },
    }),
  );
}

function submit(flow: { session: FlowSession; verificationId: string }, capture: Capture) {
  return submitVerification(deps, flow.session, flow.verificationId, {
    capture: { id: capture.id, nonce: capture.nonce },
  });
}

async function uploadAll(flow: { session: FlowSession; verificationId: string }, capture: Capture) {
  for (const pose of capture.prompts) {
    await upload(flow, capture, pose);
  }
}

/**
 * Runs `held` in a transaction of its own connection (the competing writer, holding its locks)
 * and keeps it open while `service` starts, then commits. Resolves with whether `service` waited
 * for the commit, and its outcome (a value or the error it threw).
 */
async function whileHeld(
  held: (tx: Db) => Promise<void>,
  service: () => Promise<unknown>,
): Promise<{ waited: boolean; outcome: unknown }> {
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let ready: () => void = () => undefined;
  const holding = new Promise<void>((resolve) => {
    ready = resolve;
  });
  const holder = db.transaction(async (tx) => {
    await held(tx);
    ready();
    await gate;
  });
  await holding;
  let settled = false;
  const running = service().then(
    (value: unknown) => value,
    (error: unknown) => error,
  );
  void running.then(() => {
    settled = true;
  });
  await Promise.race([running, new Promise((resolve) => setTimeout(resolve, WAIT_MS))]);
  const waited = !settled;
  release();
  await holder;
  return { waited, outcome: await running };
}

/** As a redaction does first: lock the inquiry and stamp it (C16, G002). */
const redacting = (inquiryId: string) => async (tx: Db) => {
  await lockInquiry(tx, environmentId, inquiryId);
  await tx.execute(sql`update inquiries set redacted_at = now() where id = ${inquiryId}`);
};

describe('C40.6: the capture writers and a redaction of the inquiry', () => {
  it('a create waits for the redaction, then refuses (410) and writes no capture', async () => {
    const flow = await consentedSelfie();

    const { waited, outcome } = await whileHeld(redacting(flow.session.inquiryId), () =>
      create(flow),
    );

    expect(waited).toBe(true);
    expect(outcome).toBeInstanceOf(RedactedError);
    expect(
      await listSelfieCaptures(db, environmentId, { verificationId: flow.verificationId }),
    ).toEqual([]);
  });

  it('an upload waits for the redaction, then refuses (410), keeping no row and no object', async () => {
    const flow = await consentedSelfie();
    const capture = await create(flow);
    const objects = storage.keys().length;

    const { waited, outcome } = await whileHeld(redacting(flow.session.inquiryId), () =>
      upload(flow, capture, 'center'),
    );

    expect(waited).toBe(true);
    expect(outcome).toBeInstanceOf(RedactedError);
    expect(await listVerificationFiles(db, environmentId, [flow.verificationId])).toEqual([]);
    expect(storage.keys()).toHaveLength(objects);
  });

  it('a submit waits for the redaction, then refuses (410), consuming nothing', async () => {
    const flow = await consentedSelfie();
    const capture = await create(flow);
    await uploadAll(flow, capture);

    const { waited, outcome } = await whileHeld(redacting(flow.session.inquiryId), () =>
      submit(flow, capture),
    );

    expect(waited).toBe(true);
    expect(outcome).toBeInstanceOf(RedactedError);
    expect(await getSelfieCapture(db, environmentId, capture.id)).toMatchObject({
      status: 'initiated',
    });
    expect((await getVerification(db, environmentId, flow.verificationId))?.status).toBe(
      'initiated',
    );
  });

  it('the capture-cap cancel waits for the redaction, then refuses (410), canceling nothing', async () => {
    const flow = await consentedSelfie();
    for (let index = 0; index < SELFIE_CAPTURE_LIMIT; index += 1) {
      await create(flow);
    }

    const { waited, outcome } = await whileHeld(redacting(flow.session.inquiryId), () =>
      create(flow),
    );

    expect(waited).toBe(true);
    expect(outcome).toBeInstanceOf(RedactedError);
    expect((await getVerification(db, environmentId, flow.verificationId))?.status).toBe(
      'initiated',
    );
    const captures = await listSelfieCaptures(db, environmentId, {
      verificationId: flow.verificationId,
    });
    expect(captures).toHaveLength(SELFIE_CAPTURE_LIMIT);
    expect(captures[0]?.status).toBe('initiated');
  });
});

describe('C40.2, C40.3, C40.4: supersede, upload and submit', () => {
  /** As a create does while it supersedes: lock the inquiry and the verification, error the capture. */
  const superseding = (flow: { session: FlowSession; verificationId: string }, captureId: string) =>
    async (tx: Db) => {
      await lockInquiry(tx, environmentId, flow.session.inquiryId);
      await tx.execute(sql`select id from verifications where id = ${flow.verificationId} for update`);
      await tx.execute(sql`update selfie_captures set status = 'errored', error_code = 'superseded' where id = ${captureId}`);
    };

  it('an upload waits for a supersede, then is refused (409 selfie_capture_invalid) and stores nothing', async () => {
    const flow = await consentedSelfie();
    const capture = await create(flow);
    const objects = storage.keys().length;

    const { waited, outcome } = await whileHeld(superseding(flow, capture.id), () =>
      upload(flow, capture, 'center'),
    );

    expect(waited).toBe(true);
    expect(outcome).toBeInstanceOf(SelfieCaptureConflictError);
    expect((outcome as SelfieCaptureConflictError).code).toBe('selfie_capture_invalid');
    expect(await listVerificationFiles(db, environmentId, [flow.verificationId])).toEqual([]);
    expect(storage.keys()).toHaveLength(objects);
  });

  it('the stale upload: its checks passed, a supersede commits, its insert is refused', async () => {
    const flow = await consentedSelfie();
    const capture = await create(flow);
    const put = storage.put.bind(storage);
    let superseded: Capture | undefined;
    const spy = vi.spyOn(storage, 'put').mockImplementationOnce(async (key, bytes) => {
      superseded = await create(flow);
      return put(key, bytes);
    });

    try {
      const outcome = await upload(flow, capture, 'center').catch((error: unknown) => error);

      expect(spy).toHaveBeenCalledTimes(1);
      expect(superseded).toBeDefined();
      expect(outcome).toBeInstanceOf(SelfieCaptureConflictError);
      expect(await listVerificationFiles(db, environmentId, [flow.verificationId])).toEqual([]);
      expect(await getSelfieCapture(db, environmentId, capture.id)).toMatchObject({
        status: 'errored',
        errorCode: 'superseded',
      });
    } finally {
      spy.mockRestore();
    }
  });

  it('a submit waits for a supersede, then is refused (409 selfie_capture_invalid), consuming nothing', async () => {
    const flow = await consentedSelfie();
    const capture = await create(flow);
    await uploadAll(flow, capture);

    const { waited, outcome } = await whileHeld(superseding(flow, capture.id), () =>
      submit(flow, capture),
    );

    expect(waited).toBe(true);
    expect((outcome as SelfieCaptureConflictError).code).toBe('selfie_capture_invalid');
    expect((await getVerification(db, environmentId, flow.verificationId))?.status).toBe(
      'initiated',
    );
  });

  it('a create waits for a submit that consumed the capture, then is refused (409)', async () => {
    const flow = await consentedSelfie();
    const capture = await create(flow);
    await uploadAll(flow, capture);

    const { waited, outcome } = await whileHeld(
      async (tx) => {
        await lockInquiry(tx, environmentId, flow.session.inquiryId);
        await tx.execute(sql`update verifications set status = 'submitted', submitted_at = now() where id = ${flow.verificationId}`);
        await tx.execute(sql`update selfie_captures set status = 'submitted', submitted_at = now() where id = ${capture.id}`);
      },
      () => create(flow),
    );

    expect(waited).toBe(true);
    expect(outcome).toBeInstanceOf(ConflictError);
    expect(
      await listSelfieCaptures(db, environmentId, { verificationId: flow.verificationId }),
    ).toHaveLength(1);
  });

  it('two concurrent creates leave one open capture and the other superseded', async () => {
    const flow = await consentedSelfie();

    const [first, second] = await Promise.all([create(flow), create(flow)]);

    const captures = await listSelfieCaptures(db, environmentId, {
      verificationId: flow.verificationId,
    });
    expect(captures.map((capture) => capture.id).sort()).toEqual([first.id, second.id].sort());
    expect(captures.filter((capture) => capture.status === 'initiated')).toHaveLength(1);
    expect(captures.filter((capture) => capture.errorCode === 'superseded')).toHaveLength(1);
  });
});

describe('C40.2: the other cancel paths', () => {
  it('an upload waits for the expire action, then is refused (409) and stores nothing', async () => {
    const flow = await consentedSelfie();
    const capture = await create(flow);

    const { waited, outcome } = await whileHeld(
      async (tx) => {
        await lockInquiry(tx, environmentId, flow.session.inquiryId);
        await tx.execute(sql`update inquiries set status = 'expired' where id = ${flow.session.inquiryId}`);
      },
      () => upload(flow, capture, 'center'),
    );

    expect(waited).toBe(true);
    expect(outcome).toBeInstanceOf(ConflictError);
    expect(await listVerificationFiles(db, environmentId, [flow.verificationId])).toEqual([]);
  });

  it('the expire action waits for an upload holding the inquiry, then cancels the capture and deletes its file', async () => {
    const flow = await consentedSelfie();
    const capture = await create(flow);
    await upload(flow, capture, 'center');

    const { waited } = await whileHeld(
      async (tx) => {
        await lockInquiry(tx, environmentId, flow.session.inquiryId);
      },
      () => performInquiryAction(deps, acting(), flow.session.inquiryId, 'expired'),
    );

    expect(waited).toBe(true);
    expect(await getSelfieCapture(db, environmentId, capture.id)).toMatchObject({
      status: 'errored',
      errorCode: 'canceled',
    });
    expect(await listVerificationFiles(db, environmentId, [flow.verificationId])).toEqual([]);
  });
});

describe('C40.2: the inquiry expiry job and a capture writer', () => {
  it('skips an inquiry a writer holds, then cancels its capture on the next run', async () => {
    const flow = await consentedSelfie();
    const capture = await create(flow);
    await pool.query("update inquiries set expires_at = now() - interval '1 minute' where id = $1", [
      flow.session.inquiryId,
    ]);
    const job = () =>
      runInquiryExpiry({
        db,
        storage,
        events: deps.events,
        clock: { now: () => new Date() },
        logger: createCapturingLogger(),
      });

    const { waited, outcome } = await whileHeld(
      async (tx) => {
        await lockInquiry(tx, environmentId, flow.session.inquiryId);
      },
      job,
    );
    const held = await getSelfieCapture(db, environmentId, capture.id);
    await job();

    expect(waited).toBe(false);
    expect(outcome).toMatchObject({ failedInquiries: 0 });
    expect(held).toMatchObject({ status: 'initiated' });
    expect(await getSelfieCapture(db, environmentId, capture.id)).toMatchObject({
      status: 'errored',
      errorCode: 'canceled',
    });
  });
});

describe('C42.2: an operator decline and a face data write', () => {
  it('the decline waits for the write holding the inquiry, then deletes what it wrote', async () => {
    const flow = await consentedSelfie();
    await transitionInquiryStatus(db, environmentId, flow.session.inquiryId, {
      from: 'pending',
      to: 'completed',
    });
    const ids = { verificationId: flow.verificationId, inquiryId: flow.session.inquiryId };

    const { waited } = await whileHeld(
      async (tx) => {
        await lockInquiry(tx, environmentId, flow.session.inquiryId);
        const template = await createFaceTemplate(tx, environmentId, {
          id: testId('ftpl'),
          ...ids,
          model: 'sface-2021dec',
          embedding: Array.from({ length: 128 }, () => 0.088),
        });
        await createSelfieBackground(tx, environmentId, {
          id: testId('sbg'),
          ...ids,
          faceTemplateId: template.id,
          layout: Array.from({ length: 144 }, (_, index) => index / 4),
          validCells: '1'.repeat(48),
          coverage: 1,
        });
      },
      () => performInquiryAction(deps, acting(), flow.session.inquiryId, 'declined'),
    );

    expect(waited).toBe(true);
    const { rows } = await pool.query<{ templates: number; backgrounds: number }>(
      `select (select count(*)::int from face_templates where inquiry_id = $1) as templates,
              (select count(*)::int from selfie_backgrounds where inquiry_id = $1) as backgrounds`,
      [flow.session.inquiryId],
    );
    expect(rows[0]).toEqual({ templates: 0, backgrounds: 0 });
  });
});
