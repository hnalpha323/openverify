/**
 * C243.2 (Phase 11, Workflow 11A, `workflow-connect`): the three Connect triggers on the events the
 * Connect services really stage (PGlite, the real engine and publisher), not on samples.
 *
 * - `connect/share-token.inbound-created`, staged in the destination by `api-connect`'s token create
 *   through the counterparty writer, starts the destination's workflow, whose redemption step reads
 *   the token from the trigger and reaches `api-redeem`'s service: without a destination consent
 *   record of that token the step is `consent_required` and the token stays `created` (C243.4: an
 *   automatic redemption still needs one).
 * - `consent-record.withdrawn`, staged in the record's environment by `api-consent`'s withdrawal,
 *   starts the source's workflow, which reads the record and its token.
 * - `connect/share-token.consent-withdrawn`, staged in the counterparty's environment when the
 *   source withdraws the consent of a redeemed share, starts the destination's workflow, which reads
 *   the token.
 *
 * Every value is synthetic.
 */
import { newId, type EventName, type WorkflowDefinition } from '@openverify/contracts';
import {
  connectShareTokens,
  listWorkflowDeliveries,
  replaceWorkflowTriggers,
} from '@openverify/db';
import { createTestInquiry, seedWorkflow, seedWorkflowVersion } from '@openverify/db/testing';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { ConnectRedeemJob } from '../../../jobs/connect-queues.js';
import { withdrawConsentRecordInTx } from '../../../services/connect/withdrawal.js';
import { action, chain, drain, outputsOf, runOf, stepOf } from '../../engine/testing.js';
import { processWorkflowTrigger } from '../../triggers/deliver.js';
import { createActionHarness, type ActionHarness } from '../testing.js';
import { useHandlers } from '../cases/testing.js';
import { createActionHandlerTable } from '../../engine/action-port.js';
import { RUN_WORKFLOW_HANDLER } from '../../engine/run-workflow.js';
import { OBJECT_ACTION_HANDLERS } from '../index.js';
import { CONNECT_ACTION_HANDLERS } from './index.js';
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
  // The harness's environment is the destination; the source is a tenant of its own.
  share = await seedShare(harness.db, {
    destination: { organizationId: harness.organizationId, environmentId: harness.environmentId },
  });
}, 120_000);

afterAll(async () => {
  await harness.close();
});

beforeEach(() => {
  enqueued.length = 0;
});

const services = () => harness.services as unknown as Parameters<typeof createTokenAsKey>[1];

/** A running workflow in `environmentId` listening to `event`, with Connect's scopes. */
async function listening(environmentId: string, event: EventName, definition: WorkflowDefinition) {
  const { db } = harness;
  const workflow = await seedWorkflow(db, environmentId, { status: 'running' });
  const version = await seedWorkflowVersion(db, environmentId, {
    workflowId: workflow.id,
    status: 'published',
    definition,
  });
  await harness.database.client.query(
    `update workflows set latest_published_version_id = $1 where id = $2`,
    [version.id, workflow.id],
  );
  await harness.database.client.query(`update workflow_versions set "grant" = $1 where id = $2`, [
    JSON.stringify(CONNECT_GRANT),
    version.id,
  ]);
  await replaceWorkflowTriggers(db, environmentId, workflow.id, [
    { kind: 'trigger-event', eventName: event, workflowVersionId: version.id },
  ]);
  return workflow.id;
}

const onEvent = (event: EventName, more: Partial<Record<keyof WorkflowDefinition, unknown>>) =>
  chain([], { trigger: { type: 'trigger-event', config: { events: [event] } }, ...more });

/** Plays the workflow's one delivery and the run it starts; the run's id. */
async function deliver(environmentId: string, workflowId: string): Promise<string> {
  const [pending] = (
    await listWorkflowDeliveries(harness.db, environmentId, { workflowIds: [workflowId] }, {})
  ).items;
  if (pending === undefined) {
    throw new Error('no delivery');
  }
  await processWorkflowTrigger({ environmentId, deliveryId: pending.id }, harness.deps);
  await drain(harness);
  const [delivery] = (
    await listWorkflowDeliveries(harness.db, environmentId, { workflowIds: [workflowId] }, {})
  ).items;
  expect(delivery?.status).toBe('run_created');
  return delivery?.workflowRunId ?? '';
}

const tokenOf = async (id: string) =>
  (await harness.db.select().from(connectShareTokens).where(eq(connectShareTokens.id, id)))[0];

/** The source's withdrawal of the consent `id`, through `api-consent`'s service. */
async function withdraw(id: string): Promise<void> {
  const { staged } = await harness.db.transaction((tx) =>
    withdrawConsentRecordInTx(tx, harness.services as never, {
      environmentId: share.source.environmentId,
      id,
      via: 'api',
      reason: 'subject-request',
      actor: {
        kind: 'principal',
        acting: {
          ctx: {
            organizationId: share.source.organizationId,
            environmentId: share.source.environmentId,
          },
          actor: { type: 'api-key', id: newId('key') },
          mask: {} as never,
          environmentKind: 'sandbox',
        },
      },
    }),
  );
  await harness.events.dispatch(staged);
}

describe('the Connect triggers as the services stage them (C243.2)', () => {
  it('inbound-created starts the destination’s redemption, refused without its consent (C243.4)', async () => {
    const { template } = await createTestInquiry(harness.db, harness.environmentId);
    const otherTokenConsent = await seedConsent(harness.db, share, {
      side: 'destination',
      shareTokenId: newId('cnst'),
    });
    const workflowId = await listening(
      harness.environmentId,
      'connect/share-token.inbound-created',
      chain(
        [
          action('redeem', 'redeem_share_token', {
            'share-token-id': '{{ trigger.id }}',
            meta: {
              'inquiry-template-id': template.id,
              'destination-consent-record-id': otherTokenConsent,
            },
          }),
        ],
        {
          trigger: {
            type: 'trigger-event',
            config: { events: ['connect/share-token.inbound-created'] },
          },
        },
      ),
    );

    const id = await createTokenAsKey(harness.db, services(), share);
    const runId = await deliver(harness.environmentId, workflowId);

    expect((await stepOf(harness, runId, 'redeem')).errorCode).toBe('consent_required');
    expect(await tokenOf(id)).toMatchObject({ status: 'created' });
    expect(enqueued).toEqual([]);
  });

  it('consent-record.withdrawn starts the source’s workflow with the record and its token', async () => {
    const workflowId = await listening(
      share.source.environmentId,
      'consent-record.withdrawn',
      onEvent('consent-record.withdrawn', {
        steps: [
          {
            id: 'output',
            type: 'output',
            name: 'Output',
            mappings: { record: '{{ trigger.id }}', token: '{{ trigger.share-token.id }}' },
          },
        ],
        outputs: [
          { name: 'record', pii: false },
          { name: 'token', pii: false },
        ],
      }),
    );
    const id = await createTokenAsKey(harness.db, services(), share);
    const cited = (await tokenOf(id))?.consentRecordId ?? '';

    await withdraw(cited);
    const runId = await deliver(share.source.environmentId, workflowId);

    expect(
      (await runOf({ ...harness, environmentId: share.source.environmentId }, runId)).status,
    ).toBe('completed');
    expect(
      await outputsOf({ ...harness, environmentId: share.source.environmentId }, runId),
    ).toEqual({ record: cited, token: id });
    expect(await tokenOf(id)).toMatchObject({
      status: 'expired',
      expiryReason: 'consent_withdrawn',
    });
  });

  it('share-token.consent-withdrawn reaches the destination of a redeemed share', async () => {
    const workflowId = await listening(
      harness.environmentId,
      'connect/share-token.consent-withdrawn',
      onEvent('connect/share-token.consent-withdrawn', {
        steps: [
          { id: 'output', type: 'output', name: 'Output', mappings: { token: '{{ trigger.id }}' } },
        ],
        outputs: [{ name: 'token', pii: false }],
      }),
    );
    const id = await createTokenAsKey(harness.db, services(), share);
    const now = new Date();
    await harness.db
      .update(connectShareTokens)
      .set({
        status: 'redeemed',
        pendingAt: now,
        redeemedAt: now,
        redeemMode: 'clone',
        updatedAt: now,
      })
      .where(eq(connectShareTokens.id, id));

    await withdraw((await tokenOf(id))?.consentRecordId ?? '');
    const runId = await deliver(harness.environmentId, workflowId);

    expect((await runOf(harness, runId)).status).toBe('completed');
    expect(await outputsOf(harness, runId)).toEqual({ token: id });
  });
});
