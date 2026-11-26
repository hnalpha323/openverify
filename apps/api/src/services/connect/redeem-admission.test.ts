/**
 * KP11-12, C234.2, C251.1 (Workflow 11B, `integration-11b`): `connect-redeem` is admitted under the
 * destination environment's cap. Every enqueue site (the server redeem and the flow's share-consent
 * accept through `enqueueRedemption`, and the `redeem_share_token` action's afterCommit) goes through
 * the quota admission: a pending token is stamped `admitted_at` and its job enqueued while the
 * destination is below its cap; at the cap it stays pending and unadmitted, nothing is enqueued, the
 * fair sweep admits it when a slot frees, and the lost-job recovery (KP11-17) leaves it alone while
 * it is held. Real rows on PGlite; synthetic ids only.
 */
import { newId } from '@openverify/contracts';
import { type Db } from '@openverify/db';
import { createTestDatabase, createTestTenant, type TestDatabase } from '@openverify/db/testing';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ConnectRedeemJob, ConnectRedeemQueue } from '../../jobs/connect-queues.js';
import {
  QUOTA_RECOVERY_GRACE_MS,
  runQuotaRecovery,
  runQuotaSweep,
} from '../../jobs/quota-sweep.js';
import { fixedClock } from '../../test-support/fakes.js';
import { createQuotaAdmissionDeps, quotaQueuePasses } from '../quotas/queue-rows.js';
import { seedConnection, seedShareToken } from './consent.test-support.js';
import { enqueueRedemption } from './redeem.js';

let database: TestDatabase;
let db: Db;

const T0 = new Date('2026-11-14T06:00:00.000Z');
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
      ${'b'.repeat(64)}, 'flow', ${T0.toISOString()}, ${new Date('2026-12-31T00:00:00.000Z').toISOString()})`);
  return id;
}

async function admittedAtOf(id: string): Promise<unknown> {
  const result = await db.execute(
    sql`select admitted_at from connect_share_tokens where id = ${id}`,
  );
  return (result as { rows: { admitted_at: unknown }[] }).rows[0]?.admitted_at;
}

function recordingProducer(): { queue: ConnectRedeemQueue; jobs: ConnectRedeemJob[] } {
  const jobs: ConnectRedeemJob[] = [];
  return {
    jobs,
    queue: {
      enqueueConnectRedeem: (job) => {
        jobs.push(job);
        return Promise.resolve();
      },
    },
  };
}

describe('connect-redeem under the destination cap (KP11-12)', () => {
  it('holds a redemption at the cap, the sweep admits it when a slot frees, and recovery leaves it alone', async () => {
    const source = await createTestTenant(db);
    const destination = await createTestTenant(db);
    const destinationId = destination.environment.id;
    const connection = await seedConnection(db, {
      sourceOrganizationId: source.organization.id,
      destinationOrganizationId: destination.organization.id,
    });
    const pending = async () =>
      seedShareToken(db, {
        sourceEnvironmentId: source.environment.id,
        destinationEnvironmentId: destinationId,
        connection,
        consentRecordId: await consentRecord(
          source.environment.id,
          connection.id,
          destination.organization.id,
        ),
        status: 'pending',
      });
    const first = await pending();
    const second = await pending();
    const { queue, jobs } = recordingProducer();
    const deps = {
      db,
      clock: fixedClock(T0),
      connectRedeems: queue,
      queueInFlightCapMax: 1,
    };

    await enqueueRedemption(deps, { environmentId: destinationId, shareTokenId: first });
    await enqueueRedemption(deps, { environmentId: destinationId, shareTokenId: second });

    // The first is admitted and enqueued; the second is held: pending, unstamped, not enqueued.
    expect(jobs).toEqual([{ environmentId: destinationId, shareTokenId: first }]);
    expect(await admittedAtOf(first)).not.toBeNull();
    expect(await admittedAtOf(second)).toBeNull();

    // The lost-job recovery, past its grace, enqueues nothing for a held token.
    const later = fixedClock(new Date(T0.getTime() + QUOTA_RECOVERY_GRACE_MS + 1_000));
    const passes = quotaQueuePasses({ connectRedeems: queue });
    await db.execute(sql`update connect_share_tokens set status = 'redeemed',
      redeemed_at = ${T0.toISOString()} where id = ${first}`);
    jobs.length = 0;
    await runQuotaRecovery({ db, clock: later, logger }, passes);
    expect(jobs).toEqual([]);
    expect(await admittedAtOf(second)).toBeNull();

    // A slot is free (the first redeemed): the fair sweep admits and enqueues the held one.
    await runQuotaSweep(
      createQuotaAdmissionDeps({ db, clock: later, logger, limits: { ceiling: 1 } }),
      passes,
    );
    expect(jobs).toEqual([{ environmentId: destinationId, shareTokenId: second }]);
    expect(await admittedAtOf(second)).not.toBeNull();
  });
});
