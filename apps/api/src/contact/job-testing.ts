/**
 * Test support for the phone and email jobs (C56): a database with a sandbox and a production
 * environment, the job's dependencies, and a submitted verification whose OTP rows say what a
 * test needs. Only tests import this file; every value is synthetic.
 */
import { randomBytes } from 'node:crypto';
import {
  createVerification,
  getVerification,
  otpDestinationIndex,
  setVerificationStatus,
  transitionInquiryStatus,
  type Db,
  type OtpLimitedReason,
  type VerificationWithChecks,
} from '@openverify/db';
import {
  createTestDatabase,
  createTestInquiry,
  createTestTenant,
  seedOtpChallenge,
  seedOtpVerificationState,
  testId,
  type TestDatabase,
} from '@openverify/db/testing';
import type { CreateInquiryTemplateAttributes } from '@openverify/contracts';
import { createEventPublisher } from '../events/index.js';
import type { ProcessVerificationDeps } from '../jobs/process-verification.js';
import {
  createCapturingLogger,
  createFakeVision,
  createMemoryStorage,
  createRecordingQueue,
} from '../jobs/testing.js';
import { otpTemplateAttributes } from '../services/otp/testing.js';
import { createWebhookDeliveryScheduler } from '../webhooks/queue.js';

export const JOB_NOW = new Date('2026-10-23T12:00:00.000Z');
export const BLIND_INDEX_KEY = new Uint8Array(randomBytes(32));

export interface ContactJobDatabase {
  database: TestDatabase;
  db: Db;
  sandboxId: string;
  productionId: string;
}

export async function contactJobDatabase(): Promise<ContactJobDatabase> {
  const database = await createTestDatabase();
  return {
    database,
    db: database.db,
    sandboxId: (await createTestTenant(database.db)).environment.id,
    productionId: (await createTestTenant(database.db, { kind: 'production' })).environment.id,
  };
}

/** The job's dependencies over `db`, with `overrides`. */
export function contactJobDeps(
  fixture: ContactJobDatabase,
  overrides: Partial<ProcessVerificationDeps> = {},
): ProcessVerificationDeps & { logger: ReturnType<typeof createCapturingLogger> } {
  const logger = createCapturingLogger();
  return {
    db: fixture.db,
    storage: createMemoryStorage(),
    keyring: fixture.database.keyring,
    vision: createFakeVision().client,
    events: createEventPublisher({
      db: fixture.db,
      deliveries: createWebhookDeliveryScheduler(createRecordingQueue()),
      logger,
    }),
    clock: { now: () => JOB_NOW },
    blindIndexKey: BLIND_INDEX_KEY,
    ...overrides,
    logger,
  };
}

export interface OtpRows {
  /** The destination of the code the rows hold. */
  destination: string;
  /** The code's status (`confirmed` by default). */
  status?: 'sent' | 'confirmed' | 'expired' | 'exhausted' | 'errored';
  /** No challenge at all. */
  noChallenge?: boolean;
  sends?: number;
  wrongEntries?: number;
  limitedReason?: OtpLimitedReason;
  /** The sender the code went through (`sandbox` by default). */
  provider?: string;
  /** No `otp_verification_states` row. */
  noState?: boolean;
}

/**
 * A pending inquiry of the OTP test template (or `attributes`) with a `submitted` verification of
 * `type` and the OTP rows `rows` describe.
 */
export async function submittedOtpVerification(
  fixture: ContactJobDatabase,
  environmentId: string,
  type: 'phone_number' | 'email_address',
  rows: OtpRows,
  attributes: CreateInquiryTemplateAttributes = otpTemplateAttributes(),
): Promise<{ inquiryId: string; verificationId: string }> {
  const { db } = fixture;
  const { inquiry } = await createTestInquiry(db, environmentId, {
    flow: attributes.flow,
    verificationConfig: attributes['verification-config'],
  });
  await transitionInquiryStatus(db, environmentId, inquiry.id, { from: 'created', to: 'pending' });
  const verificationId = testId('ver');
  await createVerification(db, environmentId, { id: verificationId, inquiryId: inquiry.id, type });
  const channel = type === 'phone_number' ? 'sms' : 'email';
  if (rows.noChallenge !== true) {
    const status = rows.status ?? 'confirmed';
    await seedOtpChallenge(db, environmentId, {
      verificationId,
      inquiryId: inquiry.id,
      channel,
      destination: rows.destination,
      destinationIndex: otpDestinationIndex(BLIND_INDEX_KEY, {
        environmentId,
        channel,
        destination: rows.destination,
      }),
      status,
      provider: rows.provider ?? (channel === 'sms' ? 'sandbox' : 'smtp'),
      sentAt: new Date(JOB_NOW.getTime() - 60_000),
      ...(status === 'confirmed' ? { confirmedAt: new Date(JOB_NOW.getTime() - 30_000) } : {}),
    });
  }
  if (rows.noState !== true) {
    await seedOtpVerificationState(db, environmentId, {
      verificationId,
      inquiryId: inquiry.id,
      sends: rows.sends ?? 1,
      wrongEntries: rows.wrongEntries ?? 0,
      ...(rows.limitedReason === undefined
        ? {}
        : { limitedAt: JOB_NOW, limitedReason: rows.limitedReason }),
    });
  }
  await setVerificationStatus(db, environmentId, verificationId, { to: 'submitted' });
  return { inquiryId: inquiry.id, verificationId };
}

/** The verification with its checks, after the job. */
export async function decided(
  fixture: ContactJobDatabase,
  environmentId: string,
  verificationId: string,
): Promise<VerificationWithChecks> {
  const verification = await getVerification(fixture.db, environmentId, verificationId);
  if (verification === null) {
    throw new Error('the verification is gone');
  }
  return verification;
}
