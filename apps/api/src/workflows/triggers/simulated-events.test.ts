/**
 * C118.1: a simulated webhook event never starts a workflow, because it never passes through
 * `stage()`. This holds with the real publisher, whose hook would write a delivery. Synthetic values.
 */
import { listWorkflowDeliveries, replaceWorkflowTriggers } from '@openverify/db';
import { seedWorkflow, seedWorkflowVersion } from '@openverify/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createEventPublisher } from '../../events/index.js';
import { createTestApi, bearer, type TestApi } from '../../test-support/harness.js';
import { createWebhookDeliveryScheduler } from '../../webhooks/queue.js';

const EVENT = 'inquiry.approved';

let api: TestApi;

beforeAll(async () => {
  api = await createTestApi((defaults) => ({
    events: createEventPublisher({
      db: defaults.db,
      deliveries: createWebhookDeliveryScheduler({
        add: () => Promise.resolve(),
        close: () => Promise.resolve(),
      }),
    }),
  }));
});

afterAll(async () => {
  await api.close();
});

describe('a simulated event (C118.1)', () => {
  it('reaches its webhook and starts no workflow', async () => {
    const { environmentId, deps, token } = api;
    const workflow = await seedWorkflow(deps.db, environmentId, { status: 'running' });
    const version = await seedWorkflowVersion(deps.db, environmentId, {
      workflowId: workflow.id,
      status: 'published',
    });
    await replaceWorkflowTriggers(deps.db, environmentId, workflow.id, [
      { kind: 'trigger-event', eventName: EVENT, workflowVersionId: version.id },
    ]);
    const headers = bearer(token);
    const webhook = await api.app.inject({
      method: 'POST',
      url: '/api/v1/webhooks',
      headers,
      payload: {
        data: {
          type: 'webhook',
          attributes: {
            url: 'https://hooks.example.com/synthetic',
            'enabled-events': [EVENT],
          },
        },
      },
    });
    const { id } = webhook.json<{ data: { id: string } }>().data;

    const simulated = await api.app.inject({
      method: 'POST',
      url: `/api/v1/webhooks/${id}/simulate`,
      headers,
      payload: { meta: { 'event-name': EVENT } },
    });

    expect(simulated.statusCode).toBeLessThan(300);
    const { items } = await listWorkflowDeliveries(deps.db, environmentId, {}, {});
    expect(items).toEqual([]);
  });
});
