/**
 * C243.1 (Phase 11, Workflow 11A, `workflow-connect`): `create_share_token` and `expire_share_token`
 * over `api-connect`'s services (PGlite, the real engine), in the step's own transaction with the run
 * as the actor. A consent that does not cover the share is the service's `consent_required` with its
 * reason and pointer, and nothing is written. The source expires its token by a step, with the run
 * as the audit actor and `connect/share-token.expired` on both sides; a second expiry is
 * `share_token_not_expirable`, and a token of another organisation is the one 404, as an unknown one
 * is. A token a step creates is held by `connect.integration.test.ts` once the served creator has a
 * workflow form (the service serves a workflow-made token's creator as an API key today, which the
 * event payload refuses: carried as a contract deviation). The destination redeems an inbound token
 * by a step over `api-redeem`'s synchronous part (C243.4): with its destination consent record the
 * token is `pending`, the request is audited with the run as the actor and the `connect-redeem` job
 * is enqueued after the step; without a valid one the step is `consent_required`, the token stays
 * `created` and no job is enqueued. `cross-tenant.ts` has no `markInboundShareToken` yet (api-redeem's
 * contract deviation), so the accepted redemption runs over the production binding with that one
 * entry point written as it will be, as `api-redeem`'s own suite does. Every value is synthetic.
 */
import { newId } from '@openverify/contracts';
import { connectShareTokens } from '@openverify/db';
import {
  redemptionCrossTenant,
  type RedemptionCrossTenant,
} from '../../../services/connect/redeem.js';
import { createTestInquiry, createTestTenant } from '@openverify/db/testing';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, onTestFinished } from 'vitest';
import type { ConnectRedeemJob } from '../../../jobs/connect-queues.js';
import { createActionHandlerTable } from '../../engine/action-port.js';
import { RUN_WORKFLOW_HANDLER } from '../../engine/run-workflow.js';
import { stepOf } from '../../engine/testing.js';
import { stepOutputOf, useHandlers } from '../cases/testing.js';
import { OBJECT_ACTION_HANDLERS } from '../index.js';
import { action, chain, createActionHarness, type ActionHarness } from '../testing.js';
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

let harness: ActionHarness;
let share: SeededShare;
const enqueued: ConnectRedeemJob[] = [];

beforeAll(async () => {
  harness = await createActionHarness();
  useHandlers(
    harness,
    createActionHandlerTable([
      RUN_WORKFLOW_HANDLER,
      ...OBJECT_ACTION_HANDLERS,
      ...CONNECT_ACTION_HANDLERS,
    ]),
  );
  Object.assign(harness.services, {
    connect: { enabled: true },
    connectRedeems: {
      enqueueConnectRedeem: (job: ConnectRedeemJob) => {
        enqueued.push(job);
        return Promise.resolve();
      },
    },
  });
  share = await seedShare(harness.db, {
    source: { organizationId: harness.organizationId, environmentId: harness.environmentId },
  });
}, 120_000);

afterAll(async () => {
  await harness.close();
});

beforeEach(() => {
  enqueued.length = 0;
});

async function run(key: string, config: Record<string, unknown>) {
  const ran = await harness.run(chain([action('step', key, config)]), { grant: CONNECT_GRANT });
  const step = await stepOf(harness, ran.id, 'step');
  return { ...ran, step, output: await stepOutputOf(harness, ran.id) };
}

const tokenRow = async (id: string) =>
  (await harness.db.select().from(connectShareTokens).where(eq(connectShareTokens.id, id)))[0];

const eventsIn = async (environmentId: string, id: string) =>
  (
    await harness.database.client.query<{ name: string }>(
      'select name from events where environment_id = $1 and object_id = $2 order by name',
      [environmentId, id],
    )
  ).rows.map(({ name }) => name);

const auditOf = async (id: string) =>
  (
    await harness.database.client.query<{ action: string; actor_type: string; actor_id: string }>(
      `select action, actor_type, actor_id from audit_logs
        where environment_id = $1 and resource_id = $2 order by action`,
      [harness.environmentId, id],
    )
  ).rows;

const createConfig = async () => ({
  'connection-id': share.connectionId,
  'source-id': share.inquiryId,
  'consent-record-id': await seedConsent(harness.db, share),
  'expires-in-seconds': 86_400,
});

describe('create_share_token over the token service (C243.1, C232.1)', () => {
  it('refuses a consent that does not cover the share, writing nothing', async () => {
    const config = {
      ...(await createConfig()),
      'consent-record-id': await seedConsent(harness.db, share, {
        overrides: { dataCategories: ['contact-fields'], explicitBiometric: false },
      }),
    };
    const before = (await harness.db.select().from(connectShareTokens)).length;
    const ran = await run('create_share_token', config);

    expect(ran.step.errorCode).toBe('consent_required');
    expect(ran.output).toEqual({
      code: 'consent_required',
      reason: 'categories',
      pointers: ['/data/attributes/consent-record-id'],
    });
    expect((await harness.db.select().from(connectShareTokens)).length).toBe(before);
  });
});

describe('create_share_token, made by the step (C243.1; integration-11a)', () => {
  it('creates the token with the run as its creator, told on both sides', async () => {
    const ran = await run('create_share_token', await createConfig());

    expect(ran.step.errorCode).toBeNull();
    const id = (ran.output as { 'share-token-id': string })['share-token-id'];
    expect(ran.output).toMatchObject({ 'share-token-id': id, status: 'created' });
    expect(await tokenRow(id)).toMatchObject({ creatorType: 'workflow', creatorId: ran.id });
    expect(await eventsIn(harness.environmentId, id)).toContain(
      'connect/share-token.outbound-created',
    );
    expect(await eventsIn(share.destination.environmentId, id)).toContain(
      'connect/share-token.inbound-created',
    );
  });
});

describe('expire_share_token over the token service (C243.1, C232.4)', () => {
  it('expires the source’s token, and a second expiry is refused', async () => {
    const id = await createTokenAsKey(harness.db, harness.services, share);

    const expired = await run('expire_share_token', { 'share-token-id': id });
    expect(expired.status).toBe('completed');
    expect(expired.output).toEqual({
      'share-token-id': id,
      status: 'expired',
      'expiry-reason': 'source_expired',
    });
    expect(await tokenRow(id)).toMatchObject({ status: 'expired', expiryReason: 'source_expired' });
    expect(await eventsIn(harness.environmentId, id)).toContain('connect/share-token.expired');
    expect(await eventsIn(share.destination.environmentId, id)).toContain(
      'connect/share-token.expired',
    );
    expect(await auditOf(id)).toContainEqual(
      expect.objectContaining({
        action: 'connect-share-token.expired',
        actor_type: 'workflow_run',
        actor_id: expired.id,
      }),
    );

    const again = await run('expire_share_token', { 'share-token-id': id });
    expect(again.step.errorCode).toBe('share_token_not_expirable');
  });

  it('answers the one 404 for a token of another organisation, as for an unknown one', async () => {
    const other = await createTestTenant(harness.db, { kind: 'sandbox' });
    const theirs = await seedShare(harness.db, {
      source: { organizationId: other.organization.id, environmentId: other.environment.id },
      destination: share.destination,
    });
    const theirToken = await createTokenAsKey(harness.db, harness.services, theirs);

    for (const id of [theirToken, newId('cnst')]) {
      const ran = await run('expire_share_token', { 'share-token-id': id });
      expect(ran.step.errorCode, id).toBe('object_not_found');
    }
    expect(await tokenRow(theirToken)).toMatchObject({ status: 'created' });
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

const handlersWith = (redemption: RedemptionCrossTenant) =>
  createActionHandlerTable([
    RUN_WORKFLOW_HANDLER,
    ...OBJECT_ACTION_HANDLERS,
    ...createConnectActionHandlers(createShareTokenServices(redemption)),
  ]);

describe('redeem_share_token over the redemption service (C243.1, C243.4, C234.1)', () => {
  /** A token another organisation shares with this environment, and a template to clone into. */
  async function inbound() {
    const other = await createTestTenant(harness.db, { kind: 'sandbox' });
    const theirs = await seedShare(harness.db, {
      source: { organizationId: other.organization.id, environmentId: other.environment.id },
      destination: { organizationId: harness.organizationId, environmentId: harness.environmentId },
    });
    const id = await createTokenAsKey(harness.db, harness.services, theirs);
    const { template } = await createTestInquiry(harness.db, harness.environmentId);
    return { theirs, id, templateId: template.id };
  }

  it('makes the token pending with a destination consent, and enqueues the job after the step', async () => {
    const { theirs, id, templateId } = await inbound();
    const destinationConsent = await seedConsent(harness.db, theirs, {
      side: 'destination',
      shareTokenId: id,
    });
    useHandlers(harness, handlersWith(REDEMPTION));
    onTestFinished(() => {
      useHandlers(harness, handlersWith(redemptionCrossTenant));
    });

    const ran = await run('redeem_share_token', {
      'share-token-id': id,
      meta: {
        'inquiry-template-id': templateId,
        'destination-consent-record-id': destinationConsent,
      },
    });

    expect(ran.step.errorCode).toBeNull();
    expect(ran.output).toEqual({ 'share-token-id': id, status: 'pending', 'redeem-mode': 'clone' });
    expect(await tokenRow(id)).toMatchObject({
      status: 'pending',
      destinationConsentRecordId: destinationConsent,
    });
    expect(enqueued).toEqual([{ environmentId: harness.environmentId, shareTokenId: id }]);
    expect(await auditOf(id)).toContainEqual(
      expect.objectContaining({
        action: 'connect-share-token.redeem-requested',
        actor_type: 'workflow_run',
        actor_id: ran.id,
      }),
    );
  });

  it('is refused without a valid destination consent: the token stays created, no job', async () => {
    const { id, templateId } = await inbound();

    const ran = await run('redeem_share_token', {
      'share-token-id': id,
      meta: {
        'inquiry-template-id': templateId,
        'destination-consent-record-id': newId('cnsr'),
      },
    });

    expect(ran.step.errorCode).toBe('consent_required');
    expect(ran.output).toMatchObject({ code: 'consent_required', reason: 'missing' });
    expect(await tokenRow(id)).toMatchObject({ status: 'created' });
    expect(enqueued).toEqual([]);
  });
});
