/**
 * Workflow 8C review K8-35: `caseChange` runs a transaction Postgres aborted as a deadlock or a
 * serialisation failure again, at most three times in all, and dispatches only the events of the run
 * that committed; any other error is thrown at once. The Postgres race itself is in
 * `queues/queues-races.integration.test.ts`.
 */
import type { Db } from '@openverify/db';
import { describe, expect, it } from 'vitest';
import { UNMASKED } from '../../auth/pii.js';
import {
  createRecordingAuditLogger,
  createRecordingEventPublisher,
  fixedClock,
} from '../../test-support/fakes.js';
import {
  CASE_TRANSACTION_ATTEMPTS,
  caseChange,
  type CaseActor,
  type CaseWriteDeps,
} from './shared.js';

const aborted = (code: string) =>
  Object.assign(new Error('Failed query'), { cause: Object.assign(new Error('x'), { code }) });

function depsOf() {
  const events = createRecordingEventPublisher();
  const dispatched: number[] = [];
  const deps: CaseWriteDeps = {
    db: { transaction: (work: (tx: Db) => Promise<unknown>) => work({} as Db) } as unknown as Db,
    events: {
      ...events,
      dispatch: (staged) => Promise.resolve(void dispatched.push(staged.length)),
    },
    audit: createRecordingAuditLogger(),
    clock: fixedClock(),
  };
  return { deps, dispatched };
}

const acting = {
  ctx: { environmentId: 'env_synthetic', organizationId: 'org_synthetic' },
  actor: { type: 'user', id: 'usr_synthetic' },
  mask: UNMASKED,
  principal: null,
} as unknown as CaseActor;

describe('caseChange on an aborted transaction (K8-35)', () => {
  it.each(['40P01', '40001'])(
    'runs it again after %s, and dispatches only the committed run',
    async (code) => {
      const { deps, dispatched } = depsOf();
      let runs = 0;
      const result = await caseChange(deps, acting, (unit) => {
        runs += 1;
        unit.staged.push({ id: `evt_${String(runs)}` } as never);
        return runs === 1 ? Promise.reject(aborted(code)) : Promise.resolve('done');
      });
      expect([result, runs, dispatched]).toEqual(['done', 2, [1]]);
    },
  );

  it('gives up after three runs in all', async () => {
    const { deps, dispatched } = depsOf();
    let runs = 0;
    await expect(
      caseChange(deps, acting, () => {
        runs += 1;
        return Promise.reject(aborted('40P01'));
      }),
    ).rejects.toThrow('Failed query');
    expect([runs, dispatched]).toEqual([CASE_TRANSACTION_ATTEMPTS, []]);
  });

  it('throws any other error at once', async () => {
    const { deps } = depsOf();
    let runs = 0;
    await expect(
      caseChange(deps, acting, () => {
        runs += 1;
        return Promise.reject(aborted('23505'));
      }),
    ).rejects.toThrow('Failed query');
    expect(runs).toBe(1);
  });
});
