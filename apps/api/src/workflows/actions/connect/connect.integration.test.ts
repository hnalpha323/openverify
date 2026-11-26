/**
 * C243 (Phase 11, Workflow 11A, `workflow-connect`) against Postgres 17: Connect's steps over the real
 * share token services, each in the step's transaction with the run as the actor. The source expires
 * a token by a step (the run named in the source's audit, `connect/share-token.expired` on both
 * sides) and a repeated job changes nothing; a step's token create is refused with the service's
 * `consent_required` when the cited consent does not cover the share, and writes nothing. The
 * destination redeems an inbound token by a step (C243.4): with its destination consent record the
 * token is `pending`, the request is audited with the run as the actor and the job is enqueued after
 * the commit; without a valid record the step is `consent_required`, the token stays `created` and
 * nothing is enqueued. `cross-tenant.ts` has no `markInboundShareToken` yet (api-redeem's contract
 * deviation), so the accepted redemption runs over the production binding with that entry point
 * written as it will be. Every value is synthetic.
 */
import { randomBytes } from 'node:crypto';
import {
  connectShareTokens,
  createDatabase,
  createKeyring,
  runMigrations,
  setDefaultKeyring,
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
import { eq } from 'drizzle-orm';
import type { Pool } from 'pg';
import type { ConnectRedeemJob } from '../../../jobs/connect-queues.js';
import {
  redemptionCrossTenant,
  type RedemptionCrossTenant,
} from '../../../services/connect/redeem.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { processWorkflowStep } from '../../../jobs/workflows/step.js';
import { createAuditLogger } from '../../../services/audit-log.js';
import {
  action,
  chain,
  createEngineHarnessOnDatabase,
  drain,
  runOf,
  start,
  stepOf,
  type EngineHarness,
} from '../../engine/testing.js';
import { createConnectActionHandlers } from './handlers.js';
import { CONNECT_ACTION_HANDLERS } from './index.js';
import { createShareTokenServices } from './share-token-services.js';
import {
  CONNECT_GRANT,
  createTokenAsKey,
  seedConsent,
  seedShare,
  type SeededShare,
} from './testing.js';

const keyring = createKeyring(randomBytes(32));

let container: StartedPostgreSqlContainer | undefined;
let pool: Pool;
let db: Database;
let harness: EngineHarness;
let share: SeededShare;

beforeAll(async () => {
  container = await startIntegrationPostgres();
  pool = createIntegrationPool(container.getConnectionUri(), { max: 8 });
  db = createDatabase(pool);
  setDefaultKeyring(keyring);
  await runMigrations(db);
  const tenant = await createTestTenant(db, { kind: 'sandbox' });
  harness = createEngineHarnessOnDatabase(db, tenant, CONNECT_ACTION_HANDLERS);
  Object.assign(harness.deps.services, {
    audit: createAuditLogger(),
    connect: { enabled: true },
  });
  share = await seedShare(db, {
    source: { organizationId: tenant.organization.id, environmentId: tenant.environment.id },
  });
}, 180_000);

afterAll(async () => {
  setDefaultKeyring(undefined);
  await ifSet(pool)?.end();
  await container?.stop();
});

const tokenOf = async (id: string) =>
  (await db.select().from(connectShareTokens).where(eq(connectShareTokens.id, id)))[0];

const rows = async <Row>(text: string, values: unknown[]): Promise<Row[]> =>
  (await pool.query(text, values)).rows as Row[];

async function run(key: string, config: Record<string, unknown>) {
  const runId = await start(harness, chain([action('step', key, config)]), {
    grant: CONNECT_GRANT,
  });
  await drain(harness);
  return { runId, run: await runOf(harness, runId), step: await stepOf(harness, runId, 'step') };
}

describe('expire_share_token on Postgres (C243.1, C232.4)', () => {
  it('expires the token with the run as the actor, once', async () => {
    const id = await createTokenAsKey(db, harness.deps.services, share);

    const { runId, run: ran, step } = await run('expire_share_token', { 'share-token-id': id });

    expect(step.errorCode).toBeNull();
    expect(ran.status).toBe('completed');
    expect(await tokenOf(id)).toMatchObject({ status: 'expired', expiryReason: 'source_expired' });
    const events = await rows<{ environment_id: string; name: string }>(
      `select environment_id, name from events where object_id = $1 and name = $2
        order by environment_id`,
      [id, 'connect/share-token.expired'],
    );
    expect(events.map(({ environment_id: environment }) => environment).sort()).toEqual(
      [share.source.environmentId, share.destination.environmentId].sort(),
    );
    expect(
      await rows(
        `select actor_type from audit_logs where environment_id = $1 and resource_id = $2
          and action = 'connect-share-token.expired'`,
        [share.source.environmentId, id],
      ),
    ).toEqual([{ actor_type: 'workflow_run' }]);

    await processWorkflowStep(
      { environmentId: harness.environmentId, runId, stepId: step.id, attempt: step.attempt },
      harness.deps,
    );
    expect(
      await rows(`select count(*)::int as count from events where object_id = $1 and name = $2`, [
        id,
        'connect/share-token.expired',
      ]),
    ).toEqual([{ count: 2 }]);
  });
});

describe('create_share_token on Postgres (C243.1, C232.1)', () => {
  it('surfaces consent_required with its reason when the consent does not cover the share', async () => {
    const consentRecordId = await seedConsent(db, share, {
      overrides: { dataCategories: ['contact-fields'], explicitBiometric: false },
    });
    const before = (await db.select().from(connectShareTokens)).length;

    const { step } = await run('create_share_token', {
      'connection-id': share.connectionId,
      'source-id': share.inquiryId,
      'consent-record-id': consentRecordId,
    });

    expect(step.errorCode).toBe('consent_required');
    expect((await db.select().from(connectShareTokens)).length).toBe(before);
  });
});

/** The production binding, with the destination's write of its inbound token as the entry point's. */
const REDEMPTION: RedemptionCrossTenant = {
  ...redemptionCrossTenant,
  async markInboundShareToken(tx, caller, token, changes) {
    await tx.update(connectShareTokens).set(changes).where(eq(connectShareTokens.id, token.id));
    return redemptionCrossTenant.getInboundShareToken(tx, caller, token.id);
  },
};

describe('redeem_share_token on Postgres (C243.1, C243.4, C234.1)', () => {
  const enqueued: ConnectRedeemJob[] = [];

  /** The destination's engine, a token shared with it, and a template to clone into. */
  async function destination(redemption: RedemptionCrossTenant) {
    enqueued.length = 0;
    const id = await createTokenAsKey(db, harness.deps.services, share);
    const engine = createEngineHarnessOnDatabase(
      db,
      {
        organization: { id: share.destination.organizationId },
        environment: { id: share.destination.environmentId },
      },
      createConnectActionHandlers(createShareTokenServices(redemption)),
    );
    Object.assign(engine.deps.services, {
      audit: createAuditLogger(),
      connect: { enabled: true },
      connectRedeems: {
        enqueueConnectRedeem: (job: ConnectRedeemJob) => {
          enqueued.push(job);
          return Promise.resolve();
        },
      },
    });
    const { template } = await createTestInquiry(db, share.destination.environmentId);
    const redeem = async (consentRecordId: string) => {
      const runId = await start(
        engine,
        chain([
          action('step', 'redeem_share_token', {
            'share-token-id': id,
            meta: {
              'inquiry-template-id': template.id,
              'destination-consent-record-id': consentRecordId,
            },
          }),
        ]),
        { grant: CONNECT_GRANT },
      );
      await drain(engine);
      return { runId, step: await stepOf(engine, runId, 'step') };
    };
    return { id, redeem };
  }

  it('makes the token pending with a destination consent and enqueues its job', async () => {
    const { id, redeem } = await destination(REDEMPTION);
    const consentRecordId = await seedConsent(db, share, { side: 'destination', shareTokenId: id });

    const { runId, step } = await redeem(consentRecordId);

    expect(step.errorCode).toBeNull();
    expect(await tokenOf(id)).toMatchObject({
      status: 'pending',
      redeemMode: 'clone',
      destinationConsentRecordId: consentRecordId,
    });
    expect(enqueued).toEqual([
      { environmentId: share.destination.environmentId, shareTokenId: id },
    ]);
    expect(
      await rows(
        `select actor_type, actor_id from audit_logs where environment_id = $1 and resource_id = $2
          and action = 'connect-share-token.redeem-requested'`,
        [share.destination.environmentId, id],
      ),
    ).toEqual([{ actor_type: 'workflow_run', actor_id: runId }]);
  });

  it('is refused without a valid destination consent: the token stays created, no job', async () => {
    const { id, redeem } = await destination(redemptionCrossTenant);
    const otherToken = await seedConsent(db, share, {
      side: 'destination',
      shareTokenId: 'cnst_01M5CN0000000000000011W298',
    });

    const { step } = await redeem(otherToken);

    expect(step.errorCode).toBe('consent_required');
    expect(await tokenOf(id)).toMatchObject({ status: 'created' });
    expect(enqueued).toEqual([]);
  });
});
