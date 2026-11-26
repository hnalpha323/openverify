/**
 * C287.2 (Workflow 11A, `api-redeem` checkpoint 4): the redemption's races on a real Postgres, each
 * in both orders, one transaction held while it holds its locks and the other started against it:
 *
 * - **double redemption:** the second waits for the first (on the destination record or the token)
 *   and then answers 409 `share_token_already_redeemed`;
 * - **expiry:** a sweep that expired the token first makes the redemption 409 `share_token_expired`;
 *   a redemption that holds the token first is skipped by the sweep (`SKIP LOCKED`), and the token
 *   stays `pending`;
 * - **deactivation:** a deactivation first expires the token (409 `share_token_expired`); a
 *   redemption first leaves the token `pending` (the deactivation expires `created` tokens only) and
 *   the job ends `connection_inactive`;
 * - **withdrawal:** a withdrawal first makes the redemption 422 `consent_required` (`withdrawn`); a
 *   redemption first makes the withdrawal wait, and the job ends `consent_withdrawn`;
 * - **source redaction** (C241.1): a redaction that holds the source's tokens first makes the job end
 *   `source_redacted`; a job that holds the token first copies the source as it was committed, and
 *   the redaction then changes nothing at the destination (C241.2).
 *
 * The destination's write of the inbound token and the source read are `testing.ts`'s port (the two
 * entry points `cross-tenant.ts` lacks today); the deactivation, the expiry sweep and the withdrawal
 * run the real repositories and cross-tenant entry points. Synthetic rows only (rule 9).
 */
import { randomBytes } from 'node:crypto';
import { newId, type RedeemShareTokenBody } from '@openverify/contracts';
import {
  createDatabase,
  createKeyring,
  createVerification,
  expireDueShareTokens,
  lockConnectionForUpdate,
  lockConsentRecord,
  runMigrations,
  setDefaultKeyring,
  setVerificationStatus,
  updateConnection,
  withdrawConsentRecord,
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
import { seedConnection, seedShareToken } from '../../services/connect/consent.test-support.js';
import { crossTenant } from '../../services/connect/cross-tenant.js';
import { redeemShareTokenInTx, type RedeemCaller } from '../../services/connect/redeem.js';
import type { ApiDependencies } from '../../services/context.js';
import { createInMemoryFileStorage } from '../../storage/index.js';
import { createWebhookDeliveryScheduler } from '../../webhooks/queue.js';
import { createCapturingLogger, createRecordingQueue } from '../testing.js';
import { processConnectRedeem } from './process.js';
import { deferred, testRedemptionPort, type RedemptionHolds } from './testing.js';

const keyring = createKeyring(randomBytes(32));
const NOW = new Date('2026-11-12T10:00:00.000Z');
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

/** The value, or a failed test when it is missing. */
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
  source: { organizationId: string; environmentId: string; inquiryId: string };
  destination: { organizationId: string; environmentId: string };
  records: [string, string];
  templateId: string;
}

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
  const record = () =>
    consentRecord(destination.environment.id, {
      side: 'destination',
      connectionId: connection.id,
      recipientOrganizationId: destination.organization.id,
      shareTokenId: tokenId,
      subject: { type: 'share-token', id: tokenId },
    });
  return {
    tokenId,
    connectionId: connection.id,
    source: {
      organizationId: source.organization.id,
      environmentId: source.environment.id,
      inquiryId: inquiry.id,
    },
    destination: {
      organizationId: destination.organization.id,
      environmentId: destination.environment.id,
    },
    records: [await record(), await record()],
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
    actor: { type: 'api-key', id: 'key_01M5CN0000000000000011A360' },
    mask: UNMASKED,
    environmentKind: 'sandbox',
  },
  now: NOW,
});

const body = (s: Share, record = s.records[0]): RedeemShareTokenBody => ({
  meta: { 'inquiry-template-id': s.templateId, 'destination-consent-record-id': record },
});

const redeem = (s: Share, holds: RedemptionHolds = {}, record = s.records[0]) =>
  db.transaction((tx) =>
    redeemShareTokenInTx(tx, callerOf(s), s.tokenId, body(s, record), testRedemptionPort(holds)),
  );

const runJob = (s: Share, holds: RedemptionHolds = {}) =>
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
      crossTenant: testRedemptionPort(holds),
    },
  );

/** A hold: `reached` once the transaction is inside it, `release` to let it go on. */
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

const codeOf = async (work: Promise<unknown>) =>
  work.then(
    () => 'ok',
    (error: unknown) =>
      `${String((error as { code?: string }).code)}${
        (error as { reason?: string }).reason === undefined
          ? ''
          : `:${String((error as { reason?: string }).reason)}`
      }`,
  );

describe('double redemption (C287.2)', () => {
  it.each([
    ['the second cites the same destination record (waits on the record)', 0],
    ['the second cites another destination record (waits on the token)', 1],
  ] as const)(
    '%s: one pending, the other 409 share_token_already_redeemed',
    async (_name, other) => {
      const s = await share();
      const first = hold();
      const a = redeem(s, { afterMark: first.at });
      await first.reached;
      const b = codeOf(redeem(s, {}, s.records[other]));
      expect(await within(b, WAIT_MS)).toBe('pending');
      first.release();
      expect(await codeOf(a)).toBe('ok');
      expect(await b).toBe('share_token_already_redeemed');
      expect((await status(s.tokenId)).status).toBe('pending');
    },
  );
});

describe('redemption against expiry (C287.2)', () => {
  const sweep = (holdAt?: () => Promise<void>) =>
    db.transaction(async (tx) => {
      const expired = await expireDueShareTokens(tx, new Date(NOW.getTime() + 120_000), 500);
      await holdAt?.();
      return expired.map(({ id }) => id);
    });

  it('a sweep that expired the token first: the redemption waits, then 409 share_token_expired', async () => {
    const s = await share();
    const first = hold();
    const swept = sweep(first.at);
    await first.reached;
    const b = codeOf(redeem(s));
    expect(await within(b, WAIT_MS)).toBe('pending');
    first.release();
    expect(await swept).toContain(s.tokenId);
    expect(await b).toBe('share_token_expired');
  });

  it('a redemption that holds the token first: the sweep skips it, and it stays pending', async () => {
    const s = await share();
    const first = hold();
    const a = redeem(s, { afterMark: first.at });
    await first.reached;
    expect(await sweep()).not.toContain(s.tokenId);
    first.release();
    expect(await codeOf(a)).toBe('ok');
    expect(await sweep()).not.toContain(s.tokenId);
    expect((await status(s.tokenId)).status).toBe('pending');
  });
});

describe('redemption against deactivation (C231.4, C287.2)', () => {
  const deactivate = (s: Share, holdAt?: () => Promise<void>) =>
    db.transaction(async (tx) => {
      const connection = await lockConnectionForUpdate(
        tx,
        s.destination.organizationId,
        s.connectionId,
      );
      await updateConnection(tx, s.connectionId, {
        status: 'inactive',
        deactivatedAt: NOW,
        deactivatedBy: 'destination',
        updatedAt: NOW,
      });
      const expired = await crossTenant.expireTokensOnDeactivation(
        tx,
        {
          organizationId: s.destination.organizationId,
          environmentId: s.destination.environmentId,
          environmentKind: 'sandbox',
        },
        must(connection),
        NOW,
      );
      await holdAt?.();
      return expired.map(({ id }) => id);
    });

  it('a deactivation first: the redemption waits on the token, then 409 share_token_expired', async () => {
    const s = await share();
    const first = hold();
    const deactivation = deactivate(s, first.at);
    await first.reached;
    const b = codeOf(redeem(s));
    expect(await within(b, WAIT_MS)).toBe('pending');
    first.release();
    expect(await deactivation).toContain(s.tokenId);
    expect(['share_token_expired', 'connection_not_active']).toContain(await b);
  });

  it('a redemption first: the token stays pending, and the job ends connection_inactive', async () => {
    const s = await share();
    const first = hold();
    const a = redeem(s, { afterMark: first.at });
    await first.reached;
    const deactivation = deactivate(s);
    expect(await within(deactivation, WAIT_MS)).toBe('pending');
    first.release();
    expect(await codeOf(a)).toBe('ok');
    expect(await deactivation).not.toContain(s.tokenId);
    await expect(runJob(s)).resolves.toEqual({
      outcome: 'failed',
      failureReason: 'connection_inactive',
    });
  });
});

describe('redemption against withdrawal (C237.2, C287.2)', () => {
  const withdraw = (s: Share, holdAt?: () => Promise<void>) =>
    db.transaction(async (tx) => {
      await lockConsentRecord(tx, s.destination.environmentId, s.records[0], 'update');
      await withdrawConsentRecord(tx, s.destination.environmentId, s.records[0], {
        withdrawnAt: NOW,
        withdrawnVia: 'api',
      });
      await holdAt?.();
    });

  it('a withdrawal first: the redemption waits on the record, then 422 consent_required withdrawn', async () => {
    const s = await share();
    const first = hold();
    const withdrawal = withdraw(s, first.at);
    await first.reached;
    const b = codeOf(redeem(s));
    expect(await within(b, WAIT_MS)).toBe('pending');
    first.release();
    await withdrawal;
    expect(await b).toBe('consent_required:withdrawn');
    expect((await status(s.tokenId)).status).toBe('created');
  });

  it('a redemption first: the withdrawal waits, and the job ends consent_withdrawn', async () => {
    const s = await share();
    const first = hold();
    const a = redeem(s, { afterMark: first.at });
    await first.reached;
    const withdrawal = withdraw(s);
    expect(await within(withdrawal, WAIT_MS)).toBe('pending');
    first.release();
    expect(await codeOf(a)).toBe('ok');
    await withdrawal;
    await expect(runJob(s)).resolves.toEqual({
      outcome: 'failed',
      failureReason: 'consent_withdrawn',
    });
  });
});

describe('redemption against source redaction (C241.1, C241.2, C287.2)', () => {
  /** The source's redaction as C241.1 asks: the inquiry redacted, its tokens held FOR UPDATE. */
  const redactSource = (s: Share, holdAt?: () => Promise<void>) =>
    db.transaction(async (tx) => {
      await tx.execute(sql`update inquiries set redacted_at = ${NOW}
        where environment_id = ${s.source.environmentId} and id = ${s.source.inquiryId}`);
      await tx.execute(sql`select id from connect_share_tokens
        where environment_id = ${s.source.environmentId} and source_id = ${s.source.inquiryId}
        for update`);
      await holdAt?.();
    });

  it('a redaction first: the job waits on the token, then ends source_redacted', async () => {
    const s = await share();
    await redeem(s);
    const first = hold();
    const redaction = redactSource(s, first.at);
    await first.reached;
    const job = runJob(s);
    expect(await within(job, WAIT_MS)).toBe('pending');
    first.release();
    await redaction;
    await expect(job).resolves.toEqual({ outcome: 'failed', failureReason: 'source_redacted' });
  });

  it('a job first: the redaction waits, the copy is of the source as committed, and the token is redeemed', async () => {
    const s = await share();
    await redeem(s);
    const first = hold();
    const job = runJob(s, { afterTokenLock: first.at });
    await first.reached;
    const redaction = redactSource(s);
    expect(await within(redaction, WAIT_MS)).toBe('pending');
    first.release();
    await expect(job).resolves.toEqual({ outcome: 'redeemed' });
    await redaction;
    expect((await status(s.tokenId)).status).toBe('redeemed');
  });
});
