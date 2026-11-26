/**
 * C118.1, C119.3 (F02; Workflow 8A Stage 1b (E)): the API's construction site gives the event
 * publisher its two schedulers, so an event a request stages wakes its deliveries and wait candidates
 * after the commit, and closes them with the rest.
 */
import { setDefaultKeyring } from '@openverify/db';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadConfig } from './config.js';
import { createContainer, type Container } from './container.js';
import { createRecordingQueue } from './test-support/fakes.js';
import { syntheticEnv } from './test-support/env.js';

const publisher = vi.hoisted(() => ({ options: [] as unknown[] }));
vi.mock('./events/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./events/index.js')>();
  return {
    ...actual,
    createEventPublisher: (options: Parameters<typeof actual.createEventPublisher>[0]) => {
      publisher.options.push(options);
      return actual.createEventPublisher(options);
    },
  };
});
vi.mock('./watchlists/reconcile.js', () => ({ reconcileWatchlistSources: vi.fn() }));
vi.mock('./network/reconcile.js', () => ({ reconcileNetworkSources: vi.fn() }));

const containers: Container[] = [];

afterEach(async () => {
  await Promise.all(containers.splice(0).map((container) => container.close()));
  setDefaultKeyring(undefined);
});

const fake = (member: string) => ({
  [member]: vi.fn(() => Promise.resolve()),
  close: vi.fn(() => Promise.resolve()),
});

describe('createContainer: the event publisher’s schedulers (F02)', () => {
  it('passes them, and closes them', async () => {
    publisher.options.length = 0;
    const workflowTriggers = fake('enqueueWorkflowTrigger');
    const workflowWaitMatches = fake('enqueueWorkflowWaitMatch');
    const listRescreens = fake('enqueueListRescreen');
    const container = createContainer(loadConfig(syntheticEnv({})), {
      verificationQueue: { ...createRecordingQueue(), close: vi.fn(() => Promise.resolve()) },
      webhookDeliveries: {
        scheduleDelivery: vi.fn(() => Promise.resolve()),
        close: vi.fn(() => Promise.resolve()),
      },
      workflowTriggers: workflowTriggers as never,
      workflowWaitMatches: workflowWaitMatches as never,
      listRescreens: listRescreens as never,
    });
    containers.push(container);

    expect(publisher.options[0]).toMatchObject({
      workflowTriggers,
      workflowSteps: workflowWaitMatches,
      listRescreens,
    });

    await container.close();
    containers.length = 0;
    expect(workflowTriggers.close).toHaveBeenCalled();
    expect(workflowWaitMatches.close).toHaveBeenCalled();
    expect(listRescreens.close).toHaveBeenCalled();
  });
});
