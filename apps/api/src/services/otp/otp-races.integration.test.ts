/**
 * C53.6, C40.6 for the one-time code writers against Postgres 17 row locks (Testcontainers), in the
 * pattern of `selfie-capture-races.integration.test.ts`. Every writer locks the inquiry (its
 * `redacted_at` and status re-checked), then the verification, then its OTP rows, so a concurrent
 * redaction, cancel or second request is serialized with it whichever comes first:
 * - a send waits for a redaction, then refuses (410) and stores no code;
 * - a delivery recorded after a redaction committed keeps no provider message id;
 * - a confirm waits for a redaction, then refuses (410) and confirms nothing;
 * - a confirm waits for a cancel, then refuses (409), the code closed;
 * - two right codes at once confirm once; six wrong codes at once count five attempts and exhaust
 *   the code; three sends at once store one code and send one message;
 * - a limit refusal's record waits for a redaction (lock order), then writes counts only;
 * - concurrent trips of the SMS budget write one audit entry.
 * The code's HMAC goes through `pg`'s `bytea` as a Buffer. Every value is synthetic.
 */
import { randomBytes } from 'node:crypto';
import { OTP_SMS_BUDGET_TRIPPED_AUDIT_ACTION, newId } from '@openverify/contracts';
import {
  createDatabase,
  createEnvironment,
  createInquiry,
  createInquirySession,
  createInquiryTemplate,
  createKeyring,
  createOrganization,
  createVerification,
  getOtpVerificationState,
  getVerification,
  hashSessionToken,
  listAuditLogs,
  listOtpChallenges,
  lockInquiry,
  recordInquirySessionConsent,
  redactInquiryRecords,
  runMigrations,
  setDefaultKeyring,
  transitionInquiryStatus,
  type Database,
  type Db,
} from '@openverify/db';
import { createIntegrationPool, startIntegrationPostgres, ifSet } from '@openverify/db/testing';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { sql } from 'drizzle-orm';
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FlowSession } from '../../auth/flow-session.js';
import { ConflictError, Phase5ProblemError, RedactedError } from '../../errors.js';
import { ulidIdGenerator, type SandboxSmsSender } from '../../ports.js';
import { createInMemoryFileStorage } from '../../storage/index.js';
import {
  createAllowAllRateLimiter,
  createCapturingMailer,
  createRecordingAuditLogger,
  createRecordingEventPublisher,
  createRecordingQueue,
  createRecordingRedactionService,
  fixedClock,
  phase5TestDependencies,
} from '../../test-support/fakes.js';
import { createAccountsService } from '../accounts.js';
import type { ApiDependencies } from '../context.js';
import { requireFlowVerification } from '../flow-preconditions.js';
import { cancelInitiatedVerifications } from '../verifications.js';
import { confirmOtp } from './confirm.js';
import { recordBudgetTrip } from './records.js';
import { sendOtp } from './send.js';
import {
  controllableLimiter,
  otpTemplateAttributes,
  recordingSmsSender,
  type RecordingSmsSender,
} from './testing.js';

const keyring = createKeyring(randomBytes(32));
const NUMBER = '+12025550100';
/** Long enough for a service that takes no lock to finish first. */
const WAIT_MS = 1_500;
const REQUEST = {
  ip: '198.51.100.20',
  log: { warn: () => undefined },
};

let container: StartedPostgreSqlContainer | undefined;
let pool: Pool;
let db: Database;
let deps: ApiDependencies;
let sms: RecordingSmsSender;
let environmentId: string;
let templateId: string;
let versionId: string;

beforeAll(async () => {
  container = await startIntegrationPostgres();
  pool = createIntegrationPool(container.getConnectionUri(), { max: 12 });
  db = createDatabase(pool);
  await runMigrations(db);
  setDefaultKeyring(keyring);
  const clock = fixedClock(new Date());
  const events = createRecordingEventPublisher();
  const phase5 = phase5TestDependencies(clock);
  sms = recordingSmsSender(phase5.cache, clock);
  deps = {
    db,
    keyring,
    storage: createInMemoryFileStorage(),
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
    ...phase5,
    providers: { sandbox: { sms }, production: {} },
  };
  const organization = await createOrganization(db, { id: newId('org'), name: 'Race Org' });
  environmentId = (
    await createEnvironment(db, {
      id: newId('env'),
      organizationId: organization.id,
      kind: 'sandbox',
    })
  ).id;
  const attributes = otpTemplateAttributes();
  const template = await createInquiryTemplate(db, environmentId, {
    id: newId('itmpl'),
    name: 'OTP races',
    version: {
      id: newId('itmplv'),
      flow: attributes.flow,
      verificationConfig: attributes['verification-config'],
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

interface Flow {
  session: FlowSession;
  verificationId: string;
}

/** A pending inquiry whose session consented, with an initiated phone verification. */
async function phoneFlow(): Promise<Flow> {
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
  await createVerification(db, environmentId, {
    id: verificationId,
    inquiryId: inquiry.id,
    type: 'phone_number',
  });
  return { session: { id: session.id, environmentId, inquiryId: inquiry.id }, verificationId };
}

const target = (flow: Flow) =>
  requireFlowVerification(deps, flow.session, flow.verificationId, {
    types: ['phone_number'],
    statuses: ['initiated', 'confirmed'],
  });

async function send(flow: Flow, using: ApiDependencies = deps) {
  return sendOtp(using, flow.session, await target(flow), { 'phone-number': NUMBER }, REQUEST);
}

async function confirm(flow: Flow, code: string) {
  return confirmOtp(deps, flow.session, await target(flow), { code }, REQUEST);
}

/** The code the sandbox sender sent last to the flow's verification. */
function sentCode(): string {
  const code = sms.sends.at(-1)?.context.code;
  if (code === undefined) {
    throw new Error('no code was sent');
  }
  return code;
}

const wrong = (code: string) => (code.startsWith('9') ? `0${code.slice(1)}` : `9${code.slice(1)}`);

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

const problemCode = (outcome: unknown) =>
  outcome instanceof Phase5ProblemError ? outcome.code : outcome;

describe('C53.6: the send and a redaction of the inquiry', () => {
  it('a send waits for the redaction, then refuses (410) and stores no code', async () => {
    const flow = await phoneFlow();
    const sent = sms.sends.length;

    const { waited, outcome } = await whileHeld(redacting(flow.session.inquiryId), () =>
      send(flow),
    );

    expect(waited).toBe(true);
    expect(outcome).toBeInstanceOf(RedactedError);
    expect(await listOtpChallenges(db, environmentId, flow.verificationId)).toEqual([]);
    expect(sms.sends).toHaveLength(sent);
  });

  it('a delivery recorded after a redaction committed keeps no provider message id', async () => {
    const flow = await phoneFlow();
    const redactingSender: SandboxSmsSender = {
      id: 'sandbox',
      sandbox: true,
      async send(message, context) {
        await sms.send(message, context);
        await redactInquiryRecords(db, environmentId, flow.session.inquiryId);
        return { providerMessageId: 'SM-synthetic-race' };
      },
    };

    await send(flow, { ...deps, providers: { sandbox: { sms: redactingSender }, production: {} } });

    const [challenge] = await listOtpChallenges(db, environmentId, flow.verificationId);
    expect(challenge).toMatchObject({ providerMessageId: null, hasDestination: false });
    expect(challenge?.redactedAt).not.toBeNull();
  });
});

describe('C53.6: the confirm, a redaction and a cancel', () => {
  it('a confirm waits for the redaction, then refuses (410) and confirms nothing', async () => {
    const flow = await phoneFlow();
    await send(flow);
    const code = sentCode();

    const { waited, outcome } = await whileHeld(redacting(flow.session.inquiryId), () =>
      confirm(flow, code),
    );

    expect(waited).toBe(true);
    expect(outcome).toBeInstanceOf(RedactedError);
    const [challenge] = await listOtpChallenges(db, environmentId, flow.verificationId);
    expect(challenge).toMatchObject({ status: 'sent', failedAttempts: 0 });
    expect((await getVerification(db, environmentId, flow.verificationId))?.status).toBe(
      'initiated',
    );
  });

  it('a confirm waits for a cancel, then refuses (409), the code closed', async () => {
    const flow = await phoneFlow();
    await send(flow);
    const code = sentCode();

    const { waited, outcome } = await whileHeld(
      async (tx) => {
        await lockInquiry(tx, environmentId, flow.session.inquiryId);
        await cancelInitiatedVerifications(
          tx,
          deps.events,
          environmentId,
          flow.session.inquiryId,
          new Date(),
        );
      },
      () => confirm(flow, code),
    );

    expect(waited).toBe(true);
    expect(outcome).toBeInstanceOf(ConflictError);
    const [challenge] = await listOtpChallenges(db, environmentId, flow.verificationId);
    expect(challenge?.status).toBe('superseded');
  });
});

describe('C55.5, C55.6: concurrent requests of one verification', () => {
  it('two right codes at once confirm once', async () => {
    const flow = await phoneFlow();
    await send(flow);
    const code = sentCode();

    const outcomes = await Promise.allSettled([confirm(flow, code), confirm(flow, code)]);

    const refused = outcomes.filter((outcome) => outcome.status === 'rejected');
    expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1);
    expect(refused.map((outcome) => problemCode(outcome.reason))).toEqual(['otp_already_confirmed']);
    const challenges = await listOtpChallenges(db, environmentId, flow.verificationId);
    expect(challenges.map((challenge) => [challenge.status, challenge.failedAttempts])).toEqual([
      ['confirmed', 0],
    ]);
  });

  it('six wrong codes at once count five attempts and exhaust the code', async () => {
    const flow = await phoneFlow();
    await send(flow);
    const code = wrong(sentCode());

    const outcomes = await Promise.allSettled(Array.from({ length: 6 }, () => confirm(flow, code)));

    const codes = outcomes.map((outcome) =>
      outcome.status === 'rejected' ? problemCode(outcome.reason) : 'confirmed',
    );
    expect(codes.filter((value) => value === 'otp_incorrect')).toHaveLength(5);
    expect(codes.filter((value) => value === 'otp_code_exhausted')).toHaveLength(1);
    const [challenge] = await listOtpChallenges(db, environmentId, flow.verificationId);
    expect(challenge).toMatchObject({ status: 'exhausted', failedAttempts: 5 });
    expect(
      (await getOtpVerificationState(db, environmentId, flow.verificationId))?.wrongEntries,
    ).toBe(5);
  });

  it('three sends at once store one code and send one message', async () => {
    const flow = await phoneFlow();
    const sent = sms.sends.length;

    const outcomes = await Promise.allSettled([send(flow), send(flow), send(flow)]);

    expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1);
    expect(
      outcomes
        .filter((outcome) => outcome.status === 'rejected')
        .map((outcome) => problemCode(outcome.reason)),
    ).toEqual(['otp_resend_too_soon', 'otp_resend_too_soon']);
    const challenges = await listOtpChallenges(db, environmentId, flow.verificationId);
    expect(challenges.map((challenge) => challenge.status)).toEqual(['sent']);
    expect(sms.sends.length - sent).toBe(1);
    expect((await getOtpVerificationState(db, environmentId, flow.verificationId))?.sends).toBe(1);
  });
});

describe('C55.6, C55.7: the limit records', () => {
  it('a refusal’s record waits for a redaction, then keeps counts and a reason only', async () => {
    const flow = await phoneFlow();
    const limiter = controllableLimiter();
    limiter.refusing.add('otp-inquiry-day');
    const refusing = { ...deps, rateLimiter: limiter };

    const { waited, outcome } = await whileHeld(redacting(flow.session.inquiryId), async () => {
      // The preconditions read before the redaction commits, as a request that raced it would.
      const read = await target(flow);
      return sendOtp(refusing, flow.session, read, { 'phone-number': NUMBER }, REQUEST);
    });

    expect(waited).toBe(true);
    expect(problemCode(outcome)).toBe('otp_rate_limited');
    expect(await getOtpVerificationState(db, environmentId, flow.verificationId)).toMatchObject({
      sends: 0,
      limitedReason: 'inquiry',
    });
  });

  it('concurrent trips of the SMS budget write one audit entry', async () => {
    const organization = await createOrganization(db, { id: newId('org'), name: 'Budget Org' });
    const budgetEnvironment = await createEnvironment(db, {
      id: newId('env'),
      organizationId: organization.id,
      kind: 'sandbox',
    });

    await Promise.all(
      Array.from({ length: 4 }, () => recordBudgetTrip(deps, budgetEnvironment.id, 200, REQUEST)),
    );

    const entries = (
      await listAuditLogs(db, budgetEnvironment.id, {
        resourceType: 'environment',
        resourceId: budgetEnvironment.id,
      })
    ).filter((entry) => entry.action === OTP_SMS_BUDGET_TRIPPED_AUDIT_ACTION);
    expect(entries).toHaveLength(1);
  });
});
