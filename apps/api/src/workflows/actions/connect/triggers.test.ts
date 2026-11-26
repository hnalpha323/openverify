/**
 * C243.2 (Phase 11, Workflow 11A, `workflow-connect`): the three Connect triggers, end to end on the
 * real engine and the real event publisher (PGlite). `connect/share-token.inbound-created` (so a
 * destination can redeem on arrival), `consent-record.withdrawn` and
 * `connect/share-token.consent-withdrawn` (so either side can act on a withdrawal) are `trigger-event`
 * configs over their event names (Stage 1a amendment 48: no declaration of their own). An event
 * staged as the Connect services stage it (the golden sample's payload, with an empty cause, as the
 * counterparty writer stages it) reaches a delivery, the delivery starts a run, and the run's step
 * reads the token or record from the trigger. Each definition passes the publish checks. The share
 * token services are a fake here; `connect.integration.test.ts` drives the real ones. Every value
 * is synthetic.
 */
import { readFileSync } from 'node:fs';
import type { EventName, WorkflowDefinition } from '@openverify/contracts';
import { listWorkflowDeliveries, replaceWorkflowTriggers } from '@openverify/db';
import { seedWorkflow, seedWorkflowVersion } from '@openverify/db/testing';
import { checkDefinition } from '@openverify/workflow-engine';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createEventPublisher } from '../../../events/index.js';
import type { ConnectRedeemJob } from '../../../jobs/connect-queues.js';
import { createAllowAllRateLimiter } from '../../../test-support/fakes.js';
import { createWebhookDeliveryScheduler } from '../../../webhooks/queue.js';
import { WORKFLOW_ACTIONS } from '../../definitions/registry.js';
import {
  action,
  chain,
  createEngineHarness,
  drain,
  runOf,
  stepOf,
  type EngineHarness,
} from '../../engine/testing.js';
import { processWorkflowTrigger } from '../../triggers/deliver.js';
import { createConnectActionHandlers } from './handlers.js';
import type { ConnectActionPort, ShareTokenFacts } from './port.js';

const DESTINATION_CONSENT = 'cnsr_01M5CN0000000000000011W410';
const TEMPLATE = 'itmpl_01M5CN0000000000000011W600';

/** The golden sample of an event: its name and its payload. */
function sampleOf(file: string): { name: EventName; payload: Record<string, unknown> } {
  const document = JSON.parse(
    readFileSync(
      new URL(`../../../../../../contracts/fixtures/api/connect/${file}`, import.meta.url),
      'utf8',
    ),
  ) as { data: { attributes: { name: EventName; payload: Record<string, unknown> } } };
  return document.data.attributes;
}

interface Case {
  readonly event: EventName;
  readonly file: string;
  readonly step: Record<string, unknown>;
  readonly scope: string;
  /** The id the step read from the trigger. */
  readonly read: string;
}

const CASES: readonly Case[] = [
  {
    event: 'connect/share-token.inbound-created',
    file: 'event-share-token-inbound-created.json',
    step: action('redeem', 'redeem_share_token', {
      'share-token-id': '{{ trigger.id }}',
      meta: {
        'inquiry-template-id': TEMPLATE,
        'destination-consent-record-id': DESTINATION_CONSENT,
      },
    }),
    scope: 'connect-share-tokens:redeem',
    read: 'cnst_01M5CN0000000000000011A200',
  },
  {
    event: 'consent-record.withdrawn',
    file: 'event-consent-record-withdrawn.json',
    step: action('expire', 'expire_share_token', {
      'share-token-id': '{{ trigger.share-token.id }}',
    }),
    scope: 'connect-share-tokens:write',
    read: 'cnst_01M5CN0000000000000011A200',
  },
  {
    event: 'connect/share-token.consent-withdrawn',
    file: 'event-share-token-consent-withdrawn.json',
    step: action('expire', 'expire_share_token', { 'share-token-id': '{{ trigger.id }}' }),
    scope: 'connect-share-tokens:write',
    read: 'cnst_01M5CN0000000000000011A200',
  },
];

const definitionOf = ({ event, step }: Case): WorkflowDefinition =>
  chain([step], { trigger: { type: 'trigger-event', config: { events: [event] } } });

let harness: EngineHarness;
let triggerJobs: { environmentId: string; deliveryId: string }[];
const calls: { name: string; id: string }[] = [];
const enqueued: ConnectRedeemJob[] = [];

const answered = (id: string, status: ShareTokenFacts['attributes']['status']) =>
  Promise.resolve({
    token: {
      id,
      attributes: {
        status,
        'expires-at': '2026-11-03T12:10:00.000Z',
        'redeem-mode': null,
        'expiry-reason': status === 'expired' ? ('source_expired' as const) : null,
      },
    },
  });

const port: ConnectActionPort = {
  createShareToken: () => Promise.reject(new Error('not called here')),
  redeemShareToken: (_tx, _caller, id) => {
    calls.push({ name: 'redeem', id });
    return answered(id, 'pending');
  },
  expireShareToken: (_tx, _caller, id) => {
    calls.push({ name: 'expire', id });
    return answered(id, 'expired');
  },
};

beforeAll(async () => {
  harness = await createEngineHarness(createConnectActionHandlers(port));
  triggerJobs = [];
  const queue = {
    enqueueWorkflowTrigger: (job: { environmentId: string; deliveryId: string }) => {
      triggerJobs.push(job);
      return Promise.resolve();
    },
  };
  harness.deps.triggers = queue;
  const publisher = createEventPublisher({
    db: harness.db,
    deliveries: createWebhookDeliveryScheduler({
      add: () => Promise.resolve(),
      close: () => Promise.resolve(),
    }),
    workflowTriggers: queue,
  });
  Object.assign(harness.deps.services, {
    rateLimiter: createAllowAllRateLimiter(),
    events: publisher,
    connect: { enabled: true },
    connectRedeems: {
      enqueueConnectRedeem: (job: ConnectRedeemJob) => {
        enqueued.push(job);
        return Promise.resolve();
      },
    },
  });
  harness.events = publisher;
}, 120_000);

afterAll(async () => {
  await harness.close();
});

beforeEach(() => {
  calls.length = 0;
  enqueued.length = 0;
  triggerJobs.length = 0;
});

/** A running workflow listening to `event`, with the scope its step needs in its grant. */
async function listening(testCase: Case) {
  const { db, environmentId } = harness;
  const workflow = await seedWorkflow(db, environmentId, { status: 'running' });
  const version = await seedWorkflowVersion(db, environmentId, {
    workflowId: workflow.id,
    status: 'published',
    definition: definitionOf(testCase),
  });
  await harness.database.client.query(
    `update workflows set latest_published_version_id = $1 where id = $2`,
    [version.id, workflow.id],
  );
  await harness.database.client.query(`update workflow_versions set "grant" = $1 where id = $2`, [
    JSON.stringify({ scopes: [testCase.scope], pii: false }),
    version.id,
  ]);
  await replaceWorkflowTriggers(db, environmentId, workflow.id, [
    { kind: 'trigger-event', eventName: testCase.event, workflowVersionId: version.id },
  ]);
  return workflow.id;
}

describe('the Connect triggers (C243.2)', () => {
  it.each(CASES)('$event passes the publish checks with its step', (testCase) => {
    const check = checkDefinition(definitionOf(testCase), {
      kind: 'workflow',
      mode: 'publish',
      registry: WORKFLOW_ACTIONS,
    });

    expect(check.errors).toEqual([]);
  });

  it.each(CASES)(
    '$event, as Connect stages it, starts a run whose step reads it',
    async (testCase) => {
      const workflowId = await listening(testCase);
      const { name, payload } = sampleOf(testCase.file);
      expect(name).toBe(testCase.event);

      await harness.db.transaction((tx) =>
        harness.events.stage(tx, {
          environmentId: harness.environmentId,
          name,
          payload: payload as never,
          cause: {},
        }),
      );
      const [pending] = (
        await listWorkflowDeliveries(
          harness.db,
          harness.environmentId,
          { workflowIds: [workflowId] },
          {},
        )
      ).items;
      expect(pending?.eventName).toBe(testCase.event);
      if (pending === undefined) {
        throw new Error('no delivery');
      }
      await processWorkflowTrigger(
        { environmentId: harness.environmentId, deliveryId: pending.id },
        harness.deps,
      );
      await drain(harness);

      const [delivery] = (
        await listWorkflowDeliveries(
          harness.db,
          harness.environmentId,
          { workflowIds: [workflowId] },
          {},
        )
      ).items;
      expect(delivery?.status).toBe('run_created');
      const runId = delivery?.workflowRunId ?? '';
      expect((await runOf(harness, runId)).status).toBe('completed');
      const stepId = String(testCase.step.id);
      expect((await stepOf(harness, runId, stepId)).status).toBe('succeeded');
      expect(calls).toEqual([{ name: stepId, id: testCase.read }]);
      expect(enqueued).toEqual(
        testCase.event === 'connect/share-token.inbound-created'
          ? [{ environmentId: harness.environmentId, shareTokenId: testCase.read }]
          : [],
      );
    },
  );
});
