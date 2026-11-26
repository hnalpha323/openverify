/**
 * KP11-17, C251.1 (Workflow 11B, `quotas`): the recovery of pending share tokens whose
 * `connect-redeem` job was lost, over real rows on PGlite. A redemption's job is enqueued after its
 * commit and can be lost (a failed enqueue, or a duplicate id behind a rolled-back workflow attempt's
 * job); the job re-reads the token under its lock, so enqueuing it again is safe. The quota recovery
 * enqueues, under the token's own job id, every PENDING token ADMITTED more than two minutes ago in
 * its destination's environment, never a held one (C251.1: the cap holds it back) and never one
 * already redeemed, expired or failed. Synthetic ids only.
 */
import { newId } from '@openverify/contracts';
import { markQueueRowsAdmitted, type Db } from '@openverify/db';
import { createTestDatabase, createTestTenant, type TestDatabase } from '@openverify/db/testing';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ConnectRedeemJob } from '../../jobs/connect-queues.js';
import {
  QUOTA_RECOVERY_GRACE_MS,
  runQuotaRecovery,
  runQuotaSweep,
} from '../../jobs/quota-sweep.js';
import { fixedClock } from '../../test-support/fakes.js';
import { seedConnection, seedShareToken } from '../connect/consent.test-support.js';
import { createQuotaAdmissionDeps, quotaQueuePasses } from './queue-rows.js';

let database: TestDatabase;
let db: Db;

const T0 = new Date('2026-11-13T12:00:00.000Z');
const logger = { info: () => undefined, warn: () => undefined, error: () => undefined };

beforeAll(async () => {
  database = await createTestDatabase();
  db = database.db;
}, 120_000);

afterAll(async () => {
  await database.close();
});

async function consentRecord(
  environmentId: string,
  connectionId: string,
  recipientOrganizationId: string,
): Promise<string> {
  const id = newId('cnsr');
  await db.execute(sql`
    insert into consent_records (environment_id, id, side, outcome, purpose, subject_type, subject_id,
      connection_id, recipient_organization_id, recipient_name, data_categories, explicit_biometric,
      text_locale, text_keys, text_sha256, method, accepted_at, expires_at)
    values (${environmentId}, ${id}, 'source', 'accepted', 'share.reuse-kyc', 'inquiry',
      ${newId('inq')}, ${connectionId}, ${recipientOrganizationId}, 'Example Partner',
      '{identity-fields,check-results}'::text[], false, 'en', '{share.consent.source}'::text[],
      ${'a'.repeat(64)}, 'flow', ${T0.toISOString()}, ${new Date('2026-12-31T00:00:00.000Z').toISOString()})`);
  return id;
}

describe('the lost redemption recovery (KP11-17)', () => {
  it('enqueues again only admitted pending tokens past the grace, in their destination', async () => {
    const source = await createTestTenant(db);
    const destination = await createTestTenant(db);
    const connection = await seedConnection(db, {
      sourceOrganizationId: source.organization.id,
      destinationOrganizationId: destination.organization.id,
    });
    const token = async (status: 'created' | 'pending' | 'redeemed' | 'failed') =>
      seedShareToken(db, {
        sourceEnvironmentId: source.environment.id,
        destinationEnvironmentId: destination.environment.id,
        connection,
        consentRecordId: await consentRecord(
          source.environment.id,
          connection.id,
          destination.organization.id,
        ),
        status,
      });
    const lost = await token('pending');
    const recent = await token('pending');
    const held = await token('pending');
    const redeemed = await token('redeemed');
    const failed = await token('failed');
    const created = await token('created');
    const at = (ms: number) => new Date(T0.getTime() + ms);
    const destinationId = destination.environment.id;
    await markQueueRowsAdmitted(db, 'connect-redeem', destinationId, [lost, redeemed, failed], T0);
    await markQueueRowsAdmitted(
      db,
      'connect-redeem',
      destinationId,
      [recent],
      at(QUOTA_RECOVERY_GRACE_MS),
    );
    const clock = fixedClock(at(QUOTA_RECOVERY_GRACE_MS + 1));
    const jobs: ConnectRedeemJob[] = [];
    const passes = quotaQueuePasses({
      connectRedeems: {
        enqueueConnectRedeem: (job) => {
          jobs.push(job);
          return Promise.resolve();
        },
      },
    });

    await runQuotaRecovery({ db, clock, logger }, passes);
    expect(jobs).toEqual([{ environmentId: destinationId, shareTokenId: lost }]);
    expect(jobs.map((job) => job.shareTokenId)).not.toContain(created);

    // The held token is the fair sweep's: admitted under the destination's cap, then enqueued.
    jobs.length = 0;
    const deps = createQuotaAdmissionDeps({ db, clock, logger, limits: { ceiling: 50 } });
    await runQuotaSweep(deps, passes);
    expect(jobs).toEqual([{ environmentId: destinationId, shareTokenId: held }]);
  });
});
