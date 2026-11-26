/**
 * C251.2, Workflow 11B Stage 1a amendment 17 (integration-11b; quotas' deviation): Phase 8's
 * workflow-step admission reads the install ceiling `OPENVERIFY_QUEUE_IN_FLIGHT_CAP_MAX` too. The
 * effective cap is the lower of the stored value (the environment's own `queue_slots` cap, its
 * `workflow-in-flight-cap` setting, or the install's `OPENVERIFY_WORKFLOW_IN_FLIGHT_CAP`) and the
 * ceiling, so a value stored above it is clamped on read, never refused. PGlite.
 */
import type { ActionHandler } from './action-port.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  action,
  chain,
  createEngineHarness,
  publish,
  startOf,
  type EngineHarness,
} from './testing.js';

const tag: ActionHandler = {
  key: 'tag_object',
  version: 1,
  shape: 'transaction',
  execute: () =>
    Promise.resolve({
      kind: 'succeeded',
      output: { 'object-id': 'inq_01M5CK16P0D13FXHZSS4TCFBVH', outcome: 'applied', 'tag-count': 1 },
    }),
};

const tagStep = action('t', 'tag_object', { 'object-type': 'inquiry', tag: 'x' });

let harness: EngineHarness;

beforeAll(async () => {
  harness = await createEngineHarness([tag]);
}, 120_000);

afterAll(async () => {
  await harness.close();
});

describe('the workflow-step cap under the install ceiling (C251.2)', () => {
  it('clamps an environment’s own cap and its setting to the ceiling', async () => {
    await harness.database.client.query(
      `insert into queue_slots (environment_id, queue, in_flight_cap) values ($1, 'workflow-step', 3)`,
      [harness.environmentId],
    );
    harness.deps.services.queueInFlightCapMax = 1;
    const published = await publish(harness, chain([tagStep]));
    await startOf(harness, published);
    await startOf(harness, published);

    expect(harness.steps.jobs.length).toBe(1);
  });
});
