/**
 * KP11-15 (Workflow 11B, `dsar-export`; C241.1, C241.2, C287.2): the source redaction against a
 * pending redemption, over the **production** redaction hook (`connectRedactionHooks`) and the
 * production redemption port (`redemptionCrossTenant`), where 11A's race suite simulated the
 * redaction (`jobs/connect-redeem/redeem-races.integration.test.ts`). Each order on a real Postgres,
 * one transaction held while it holds its locks:
 *
 * - **redaction first:** the inquiry's records redacted and the hook run in one transaction, held;
 *   the job waits (on the source consent record the hook redacted, or the token it locked), and once
 *   the redaction commits it ends `source_redacted`;
 * - **job first:** the job holds the token FOR UPDATE; the redaction's hook waits on the token, the
 *   job copies the source as committed and redeems it, and the hook then changes nothing at the
 *   destination but stages `connect/share-token.source-redacted` there (C241.2).
 *
 * The redaction's transaction runs what `services/redaction.ts` runs for these rows:
 * `redactInquiryRecords`, then the hook. Synthetic rows only (rule 9).
 */
import { randomBytes } from 'node:crypto';
import { newId, type RedeemShareTokenBody } from '@openverify/contracts';
import {
  createDatabase,
  createConsentRecord,
  createKeyring,
  createVerification,
  getConsentRecord,
  redactInquiryRecords,
  runMigrations,
  setDefaultKeyring,
  setVerificationStatus,
  type Database,
} from '@openverify/db';
import {
  createIntegrationPool,
  createTestInquiry,
  createTestTenant,
  ifSet,
  startIntegrationPostgres,
} from '@openverify/db/testing';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { sql } from 'drizzle-orm';
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { UNMASKED } from '../../auth/pii.js';
import { createEventPublisher } from '../../events/index.js';
import { processConnectRedeem } from '../../jobs/connect-redeem/process.js';
import { deferred } from '../../jobs/connect-redeem/testing.js';
import { createCapturingLogger, createRecordingQueue } from '../../jobs/testing.js';
import { createInMemoryFileStorage } from '../../storage/index.js';
import { createWebhookDeliveryScheduler } from '../../webhooks/queue.js';
import type { ApiDependencies } from '../context.js';
import { createRedactionService } from '../redaction.js';
import { seedConnection, seedShareToken } from './consent.test-support.js';
import { connectRedactionHooks } from './redaction-hooks.js';
import {
  redeemShareTokenInTx,
  redemptionCrossTenant,
  type RedeemCaller,
  type RedemptionCrossTenant,
} from './redeem.js';

const keyring = createKeyring(randomBytes(32));
const NOW = new Date('2026-11-13T10:00:00.000Z');
const clock = { now: () => NOW };
/** Long enough for a statement that takes no lock to finish first. */
const WAIT_MS = 1_500;

let container: StartedPostgreSqlContainer | undefined;
let pool: Pool;
let db: Database;

beforeAll(async () => {
  container = await startIntegrationPostgres();
  pool = createIntegrationPool(container.getConnectionUri(), { max: 10 });
  db = createDatabase(pool);
  setDefaultKeyring(keyring);
  await runMigrations(db);
}, 180_000);

afterAll(async () => {
  setDefaultKeyring(undefined);
  await ifSet(pool)?.end();
  await container?.stop();
});

function must<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) {
    throw new Error('the test expected a value');
  }
  return value;
}

const sleep = (ms: number) =>
  new Promise((done) => {
    setTimeout(done, ms);
  });
const within = <T>(promise: Promise<T>, ms: number) =>
  Promise.race([
    promise.then(
      () => 'settled' as const,
      () => 'settled' as const,
    ),
    sleep(ms).then(() => 'pending' as const),
  ]);

const POLICY = {
  purpose: 'share.reuse-kyc',
  'source-types': ['inquiry', 'account', 'transaction', 'verification'],
  verifications: {
    types: ['government-id'],
    'extracted-data': true,
    'check-results': true,
    files: true,
  },
  fields: { inquiry: [], account: [], transaction: [] },
  biometric: false,
  peek: {},
  'attested-consent': 'all',
};
const CATEGORIES = ['identity-fields', 'check-results'];

async function consentRecord(
  environmentId: string,
  input: {
    side: 'source' | 'destination';
    connectionId: string;
    recipientOrganizationId: string;
    shareTokenId?: string;
    subject: { type: string; id: string };
  },
): Promise<string> {
  const id = newId('cnsr');
  await db.execute(sql`
    insert into consent_records (environment_id, id, side, outcome, purpose, subject_type, subject_id,
      connection_id, share_token_id, recipient_organization_id, recipient_name, data_categories,
      explicit_biometric, text_locale, text_keys, text_sha256, method, accepted_at, expires_at)
    values (${environmentId}, ${id}, ${input.side}, 'accepted', 'share.reuse-kyc',
      ${input.subject.type}, ${input.subject.id}, ${input.connectionId},
      ${input.shareTokenId ?? null}, ${input.recipientOrganizationId}, 'Example Partner',
      ${`{${CATEGORIES.join(',')}}`}::text[], false, 'en', '{share.consent.destination}'::text[],
      ${'c'.repeat(64)}, 'flow', ${NOW}, ${new Date('2026-12-31T00:00:00.000Z')})`);
  return id;
}

interface Share {
  tokenId: string;
  connectionId: string;
  source: { environmentId: string; inquiryId: string };
  destination: { organizationId: string; environmentId: string };
  record: string;
  templateId: string;
}

/** A created token of a decided source inquiry, and a destination record citing it. */
async function share(): Promise<Share> {
  const source = await createTestTenant(db);
  const destination = await createTestTenant(db);
  const connection = await seedConnection(db, {
    sourceOrganizationId: source.organization.id,
    destinationOrganizationId: destination.organization.id,
    policy: POLICY,
  });
  const { inquiry } = await createTestInquiry(db, source.environment.id);
  const verificationId = newId('ver');
  await createVerification(db, source.environment.id, {
    id: verificationId,
    inquiryId: inquiry.id,
    type: 'government_id',
  });
  await setVerificationStatus(db, source.environment.id, verificationId, { to: 'submitted' });
  await setVerificationStatus(db, source.environment.id, verificationId, { to: 'passed' });
  const sourceRecord = await consentRecord(source.environment.id, {
    side: 'source',
    connectionId: connection.id,
    recipientOrganizationId: destination.organization.id,
    subject: { type: 'inquiry', id: inquiry.id },
  });
  const { template } = await createTestInquiry(db, destination.environment.id);
  const tokenId = await seedShareToken(db, {
    sourceEnvironmentId: source.environment.id,
    destinationEnvironmentId: destination.environment.id,
    connection,
    consentRecordId: sourceRecord,
    sourceType: 'inquiry',
    sourceId: inquiry.id,
    categories: CATEGORIES,
    expiresAt: new Date(NOW.getTime() + 60_000),
  });
  const record = await consentRecord(destination.environment.id, {
    side: 'destination',
    connectionId: connection.id,
    recipientOrganizationId: destination.organization.id,
    shareTokenId: tokenId,
    subject: { type: 'share-token', id: tokenId },
  });
  return {
    tokenId,
    connectionId: connection.id,
    source: { environmentId: source.environment.id, inquiryId: inquiry.id },
    destination: {
      organizationId: destination.organization.id,
      environmentId: destination.environment.id,
    },
    record,
    templateId: template.id,
  };
}

const callerOf = (s: Share): RedeemCaller => ({
  deps: {} as ApiDependencies,
  acting: {
    ctx: {
      organizationId: s.destination.organizationId,
      environmentId: s.destination.environmentId,
    },
    actor: { type: 'api-key', id: 'key_01M5CN0000000000000011B360' },
    mask: UNMASKED,
    environmentKind: 'sandbox',
  },
  now: NOW,
});

const body = (s: Share): RedeemShareTokenBody => ({
  meta: { 'inquiry-template-id': s.templateId, 'destination-consent-record-id': s.record },
});

/** The server redeem's synchronous part, through the production port: the token `pending`. */
const redeem = (s: Share) =>
  db.transaction((tx) => redeemShareTokenInTx(tx, callerOf(s), s.tokenId, body(s)));

/** The production port, with an optional hold once its source read holds the token FOR UPDATE. */
function heldPort(afterRead?: () => Promise<void>): RedemptionCrossTenant {
  return {
    ...redemptionCrossTenant,
    async readRedemptionSource(tx, caller, token) {
      const read = await redemptionCrossTenant.readRedemptionSource(tx, caller, token);
      await afterRead?.();
      return read;
    },
  };
}

const runJob = (s: Share, afterRead?: () => Promise<void>) =>
  processConnectRedeem(
    { environmentId: s.destination.environmentId, shareTokenId: s.tokenId },
    {
      db,
      clock,
      logger: createCapturingLogger(),
      keyring,
      storage: createInMemoryFileStorage(),
      events: createEventPublisher({
        db,
        deliveries: createWebhookDeliveryScheduler(createRecordingQueue()),
        logger: createCapturingLogger(),
      }),
      crossTenant: heldPort(afterRead),
    },
  );

/** The inquiry's redaction as `services/redaction.ts` runs it for these rows, with the hook. */
const redactSource = (s: Share, holdAt?: () => Promise<void>) =>
  db.transaction(async (tx) => {
    await redactInquiryRecords(tx, s.source.environmentId, s.source.inquiryId, { at: NOW });
    await connectRedactionHooks.inquiryRedactedInTx(tx, {
      environmentId: s.source.environmentId,
      id: s.source.inquiryId,
      at: NOW,
    });
    await holdAt?.();
  });

function hold() {
  const reached = deferred();
  const released = deferred();
  return {
    reached: reached.promise,
    release: released.resolve,
    at: async () => {
      reached.resolve();
      await released.promise;
    },
  };
}

async function status(id: string): Promise<{ status: string; failure_reason: string | null }> {
  const rows = await pool.query<{ status: string; failure_reason: string | null }>(
    'select status, failure_reason from connect_share_tokens where id = $1',
    [id],
  );
  return must(rows.rows[0]);
}

async function eventNames(environmentId: string): Promise<string[]> {
  const rows = await pool.query<{ name: string }>(
    'select name from events where environment_id = $1 order by name',
    [environmentId],
  );
  return rows.rows.map(({ name }) => name);
}

describe('the production redaction hook against a pending redemption (KP11-15, C241.1)', () => {
  it('a redaction first: the job waits, then ends source_redacted', async () => {
    const s = await share();
    await redeem(s);
    expect((await status(s.tokenId)).status).toBe('pending');
    const first = hold();
    const redaction = redactSource(s, first.at);
    await first.reached;
    const job = runJob(s);
    expect(await within(job, WAIT_MS)).toBe('pending');
    first.release();
    await redaction;
    await expect(job).resolves.toEqual({ outcome: 'failed', failureReason: 'source_redacted' });
    expect(await status(s.tokenId)).toEqual({
      status: 'failed',
      failure_reason: 'source_redacted',
    });
  });

  it('a job first: the hook waits on the token, the token is redeemed, and the destination hears source-redacted (C241.2)', async () => {
    const s = await share();
    await redeem(s);
    const first = hold();
    const job = runJob(s, first.at);
    await first.reached;
    const redaction = redactSource(s);
    expect(await within(redaction, WAIT_MS)).toBe('pending');
    first.release();
    await expect(job).resolves.toEqual({ outcome: 'redeemed' });
    await redaction;
    expect((await status(s.tokenId)).status).toBe('redeemed');
    expect(await eventNames(s.destination.environmentId)).toContain(
      'connect/share-token.source-redacted',
    );
  });

  it('KP11-14 (C236.10): the clone’s redaction at the destination clears its destination record’s evidence', async () => {
    const s = await share();
    // The destination record with sealed evidence, as the destination's flow witnesses it.
    const witnessed = newId('cnsr');
    await createConsentRecord(db, s.destination.environmentId, {
      id: witnessed,
      side: 'destination',
      outcome: 'accepted',
      purpose: 'share.reuse-kyc',
      subjectType: 'share-token',
      subjectId: s.tokenId,
      shareTokenId: s.tokenId,
      connectionId: s.connectionId,
      recipientOrganizationId: s.destination.organizationId,
      recipientName: 'Example Partner',
      dataCategories: CATEGORIES,
      textLocale: 'en',
      textKeys: ['share.consent.destination'],
      textSha256: 'd'.repeat(64),
      method: 'flow',
      acceptedAt: NOW,
      evidenceIp: '198.51.100.23',
      evidenceUserAgent: 'Mozilla/5.0 synthetic-clone-agent',
      expiresAt: new Date('2026-12-31T00:00:00.000Z'),
    });
    await db.transaction((tx) =>
      redeemShareTokenInTx(tx, callerOf(s), s.tokenId, {
        meta: {
          'inquiry-template-id': s.templateId,
          'destination-consent-record-id': witnessed,
        },
      }),
    );
    await expect(runJob(s)).resolves.toEqual({ outcome: 'redeemed' });
    const clone = must(
      (
        await pool.query<{ destination_id: string }>(
          'select destination_id from connect_share_tokens where id = $1',
          [s.tokenId],
        )
      ).rows[0],
    ).destination_id;
    const moved = must(await getConsentRecord(db, s.destination.environmentId, witnessed));
    expect(moved).toMatchObject({ subjectType: 'inquiry', subjectId: clone });
    expect(moved.evidenceIp).toBe('198.51.100.23');

    await createRedactionService({
      db,
      storage: createInMemoryFileStorage(),
      events: createEventPublisher({
        db,
        deliveries: createWebhookDeliveryScheduler(createRecordingQueue()),
      }),
      clock,
    }).redactInquiry(
      {
        organizationId: s.destination.organizationId,
        environmentId: s.destination.environmentId,
        requestId: 'req-kp11-14',
      },
      clone,
      null,
    );

    const after = must(await getConsentRecord(db, s.destination.environmentId, witnessed));
    expect(after).toMatchObject({
      redactedAt: NOW,
      subjectId: null,
      evidenceIp: null,
      evidenceUserAgent: null,
      shareTokenId: s.tokenId,
      textSha256: 'd'.repeat(64),
    });
  });

  it('a created token: the hook fails it source_redacted in the redaction', async () => {
    const s = await share();
    await redactSource(s);
    expect(await status(s.tokenId)).toEqual({
      status: 'failed',
      failure_reason: 'source_redacted',
    });
  });
});
