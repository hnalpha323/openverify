/**
 * C143.1, C121.5 (Workflow 8A Stage 1b (E)): the engine's repeatable jobs run whenever the worker runs
 * the engine, each on its period, each calling its owner's function with the engine's deps.
 */
import type { Db } from '@openverify/db';
import { describe, expect, it, vi } from 'vitest';
import { createRefusingOutboundHttp } from '../../test-support/fakes.js';
import { createCapturingLogger } from '../testing.js';
import type { WorkflowWorkerDeps } from '../../workflows/worker.js';
import { phase8RepeatableJobs, type RepeatableJobDeps } from './index.js';

const sweeps = vi.hoisted(() => ({
  step: vi.fn(() => Promise.resolve()),
  waitMatch: vi.fn(() => Promise.resolve()),
  trigger: vi.fn(() => Promise.resolve()),
  schedule: vi.fn(() => Promise.resolve()),
  scheduledRuns: vi.fn(() => Promise.resolve()),
  rights: vi.fn(() => Promise.resolve()),
}));
vi.mock('../workflows/sweeps.js', () => ({
  runWorkflowStepSweep: sweeps.step,
  runWorkflowWaitMatchSweep: sweeps.waitMatch,
}));
vi.mock('./workflows.js', () => ({
  runWorkflowTriggerSweep: sweeps.trigger,
  runWorkflowScheduleSweep: sweeps.schedule,
  runScheduledRunsSweep: sweeps.scheduledRuns,
}));
vi.mock('./publisher-rights.js', () => ({ runPublisherRightsSweep: sweeps.rights }));

function deps(): RepeatableJobDeps {
  return {
    db: {} as Db,
    clock: { now: () => new Date('2026-11-02T00:00:00Z') },
    logger: createCapturingLogger(),
    outboundHttp: createRefusingOutboundHttp(),
  };
}

const engine = {} as WorkflowWorkerDeps;

describe('phase8RepeatableJobs (C143.1)', () => {
  it('schedules nothing without the engine', () => {
    expect(phase8RepeatableJobs(deps(), undefined)).toEqual([]);
  });

  it('schedules each job on its period', () => {
    expect(phase8RepeatableJobs(deps(), engine).map(({ name, repeat }) => [name, repeat])).toEqual([
      ['workflow-step-sweep', { every: 15_000 }],
      ['workflow-trigger-sweep', { every: 15_000 }],
      ['workflow-wait-match-sweep', { every: 15_000 }],
      ['workflow-schedule-sweep', { every: 15_000 }],
      ['workflow-scheduled-runs', { every: 15_000 }],
      ['publisher-rights', { every: 60_000 }],
    ]);
  });

  it('runs each job with the engine’s deps', async () => {
    const jobs = phase8RepeatableJobs(deps(), engine);

    await Promise.all(jobs.map((job) => job.run()));

    for (const sweep of Object.values(sweeps)) {
      expect(sweep).toHaveBeenCalledWith(engine);
    }
  });
});
