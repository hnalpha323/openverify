/**
 * C152.2, C152.4, C152.8 (Workflow 9A, `api-flow-actions`): the action rows of a flow's `action`
 * steps, one per entry, written exactly once; finished once; the running entries listed for
 * `flow-action-sweep`; the latest entry of each step for the `workflows.<step id>` scope; the
 * account copies read before a redaction deletes the rows. PII-free: ids, keys and codes.
 *
 * Every value is synthetic.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  finishInquiryFlowActionInTx,
  getInquiryFlowAction,
  insertInquiryFlowActionInTx,
  listInquiryFlowActionCopies,
  listLatestInquiryFlowActions,
  listRunningInquiryFlowActions,
} from './index.js';
import {
  createTestDatabase,
  createTestInquiry,
  createTestTenant,
  testId,
  type TestDatabase,
} from '../testing.js';

let database: TestDatabase;

beforeAll(async () => {
  database = await createTestDatabase();
}, 120_000);

afterAll(async () => {
  await database.close();
});

const at = (seconds: number) => new Date(Date.UTC(2026, 10, 4, 12, 0, seconds));

async function seededInquiry() {
  const { environment } = await createTestTenant(database.db);
  const { inquiry } = await createTestInquiry(database.db, environment.id);
  return { environmentId: environment.id, inquiryId: inquiry.id };
}

describe('an action step entry (C152.8)', () => {
  it('is recorded once, running, and a repeat of the entry records nothing', async () => {
    const { environmentId, inquiryId } = await seededInquiry();
    const runId = testId('wfr');
    const first = await insertInquiryFlowActionInTx(database.db, environmentId, {
      inquiryId,
      stepId: 'run_check',
      entry: 1,
      workflowRunId: runId,
      enteredAt: at(1),
    });
    expect(first).toMatchObject({
      environmentId,
      inquiryId,
      stepId: 'run_check',
      entry: 1,
      workflowRunId: runId,
      status: 'running',
      errorType: null,
      targetAccountId: null,
      copiedKeys: [],
      enteredAt: at(1),
      finishedAt: null,
    });
    const repeat = await insertInquiryFlowActionInTx(database.db, environmentId, {
      inquiryId,
      stepId: 'run_check',
      entry: 1,
      enteredAt: at(9),
    });
    expect(repeat).toBeNull();
    expect(
      await getInquiryFlowAction(database.db, environmentId, {
        inquiryId,
        stepId: 'run_check',
        entry: 1,
      }),
    ).toEqual(first);
    expect(
      await getInquiryFlowAction(database.db, environmentId, {
        inquiryId,
        stepId: 'run_check',
        entry: 2,
      }),
    ).toBeNull();
  });

  it('belongs to its environment: another environment reads none of it', async () => {
    const { environmentId, inquiryId } = await seededInquiry();
    const other = await seededInquiry();
    await insertInquiryFlowActionInTx(database.db, environmentId, {
      inquiryId,
      stepId: 'tag',
      entry: 1,
      enteredAt: at(1),
    });
    const key = { inquiryId, stepId: 'tag', entry: 1 };
    expect(await getInquiryFlowAction(database.db, other.environmentId, key)).toBeNull();
    expect(await listLatestInquiryFlowActions(database.db, other.environmentId, inquiryId)).toEqual(
      [],
    );
  });

  it('finishes once, with its copy target and keys, and a second finish changes nothing', async () => {
    const { environmentId, inquiryId } = await seededInquiry();
    const accountId = testId('acc');
    const key = { inquiryId, stepId: 'copy_phone', entry: 1 };
    await insertInquiryFlowActionInTx(database.db, environmentId, { ...key, enteredAt: at(1) });
    const finished = await finishInquiryFlowActionInTx(database.db, environmentId, key, {
      status: 'completed',
      errorType: null,
      finishedAt: at(2),
      targetAccountId: accountId,
      copiedKeys: ['phone_number', 'email_address'],
    });
    expect(finished).toMatchObject({
      status: 'completed',
      errorType: null,
      finishedAt: at(2),
      targetAccountId: accountId,
      copiedKeys: ['phone_number', 'email_address'],
    });
    const again = await finishInquiryFlowActionInTx(database.db, environmentId, key, {
      status: 'errored',
      errorType: 'timeout',
      finishedAt: at(3),
    });
    expect(again).toBeNull();
    expect(await getInquiryFlowAction(database.db, environmentId, key)).toEqual(finished);
  });

  it('records why an entry took its error port', async () => {
    const { environmentId, inquiryId } = await seededInquiry();
    const key = { inquiryId, stepId: 'run_check', entry: 1 };
    await insertInquiryFlowActionInTx(database.db, environmentId, { ...key, enteredAt: at(1) });
    expect(
      await finishInquiryFlowActionInTx(database.db, environmentId, key, {
        status: 'errored',
        errorType: 'workflow_grant_widened',
        finishedAt: at(1),
      }),
    ).toMatchObject({ status: 'errored', errorType: 'workflow_grant_widened', copiedKeys: [] });
  });
});

describe('the running entries for flow-action-sweep (C152.2)', () => {
  it('lists running entries entered before the cutoff, oldest first, across environments', async () => {
    const a = await seededInquiry();
    const b = await seededInquiry();
    const cutoff = at(50);
    await insertInquiryFlowActionInTx(database.db, a.environmentId, {
      inquiryId: a.inquiryId,
      stepId: 'run_late',
      entry: 1,
      enteredAt: at(30),
    });
    await insertInquiryFlowActionInTx(database.db, b.environmentId, {
      inquiryId: b.inquiryId,
      stepId: 'run_early',
      entry: 1,
      enteredAt: at(20),
    });
    await insertInquiryFlowActionInTx(database.db, a.environmentId, {
      inquiryId: a.inquiryId,
      stepId: 'run_after',
      entry: 1,
      enteredAt: at(55),
    });
    await insertInquiryFlowActionInTx(database.db, a.environmentId, {
      inquiryId: a.inquiryId,
      stepId: 'run_done',
      entry: 1,
      enteredAt: at(10),
    });
    await finishInquiryFlowActionInTx(
      database.db,
      a.environmentId,
      { inquiryId: a.inquiryId, stepId: 'run_done', entry: 1 },
      { status: 'completed', errorType: null, finishedAt: at(11) },
    );
    const mine = <Row extends { inquiryId: string }>(rows: Row[]) =>
      rows.filter(({ inquiryId }) => inquiryId === a.inquiryId || inquiryId === b.inquiryId);
    const listed = mine(
      await listRunningInquiryFlowActions(database.db, { enteredBefore: cutoff, limit: 1_000 }),
    );
    expect(listed.map(({ environmentId, stepId }) => [environmentId, stepId])).toEqual([
      [b.environmentId, 'run_early'],
      [a.environmentId, 'run_late'],
    ]);
    const limited = await listRunningInquiryFlowActions(database.db, {
      enteredBefore: cutoff,
      limit: 1,
    });
    expect(limited).toHaveLength(1);
  });
});

describe('the latest entry of each action step (C152.2)', () => {
  it('reads the newest entry per step, by step id', async () => {
    const { environmentId, inquiryId } = await seededInquiry();
    for (const [stepId, entry, seconds] of [
      ['run_b', 1, 1],
      ['run_a', 1, 2],
      ['run_a', 2, 3],
    ] as const) {
      await insertInquiryFlowActionInTx(database.db, environmentId, {
        inquiryId,
        stepId,
        entry,
        enteredAt: at(seconds),
      });
    }
    const latest = await listLatestInquiryFlowActions(database.db, environmentId, inquiryId);
    expect(latest.map(({ stepId, entry }) => [stepId, entry])).toEqual([
      ['run_a', 2],
      ['run_b', 1],
    ]);
  });
});

describe('the account copies read before a redaction (C152.8, V08)', () => {
  it('lists each entry that copied, by step and entry, never another inquiry’s', async () => {
    const { environmentId, inquiryId } = await seededInquiry();
    const other = await seededInquiry();
    const target = testId('acc');
    const copy = async (inquiry: string, env: string, stepId: string, entry: number) => {
      const key = { inquiryId: inquiry, stepId, entry };
      await insertInquiryFlowActionInTx(database.db, env, { ...key, enteredAt: at(entry) });
      await finishInquiryFlowActionInTx(database.db, env, key, {
        status: 'completed',
        errorType: null,
        finishedAt: at(entry),
        targetAccountId: target,
        copiedKeys: ['phone_number'],
      });
    };
    await copy(inquiryId, environmentId, 'copy_phone', 2);
    await copy(inquiryId, environmentId, 'copy_phone', 1);
    await copy(other.inquiryId, other.environmentId, 'copy_phone', 1);
    await insertInquiryFlowActionInTx(database.db, environmentId, {
      inquiryId,
      stepId: 'tag',
      entry: 1,
      enteredAt: at(3),
    });
    expect(await listInquiryFlowActionCopies(database.db, environmentId, inquiryId)).toEqual([
      { stepId: 'copy_phone', entry: 1, targetAccountId: target, copiedKeys: ['phone_number'] },
      { stepId: 'copy_phone', entry: 2, targetAccountId: target, copiedKeys: ['phone_number'] },
    ]);
  });
});
