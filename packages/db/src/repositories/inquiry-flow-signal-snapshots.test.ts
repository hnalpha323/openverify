/**
 * C150.5, C150.9 (Workflow 9A, `api-flow-actions`; V06, V09): the provisional signal snapshots of a
 * branch entry, written once per name (a repeated write keeps the first), and the branch entries an
 * inquiry waits at, which the snapshot job and `flow-action-sweep` read.
 *
 * Every value is synthetic.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  getWaitingBranchEntry,
  insertInquiryFlowSignalSnapshotsInTx,
  listInquiryFlowSignalSnapshots,
  listWaitingBranchEntries,
} from './index.js';
import {
  createTestDatabase,
  createTestInquiry,
  createTestTenant,
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

/** A step record entry, as the engine (`api-flow-engine`) writes it. */
async function enter(
  inquiry: { environmentId: string; inquiryId: string },
  seq: number,
  step: { id: string; type: string; enteredAt: Date; exited?: boolean },
) {
  await database.client.query(
    `insert into inquiry_flow_steps (environment_id, inquiry_id, seq, step_id, step_type, entered_at,
       exited_at, exit_port)
     values ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      inquiry.environmentId,
      inquiry.inquiryId,
      seq,
      step.id,
      step.type,
      step.enteredAt,
      step.exited === true ? step.enteredAt : null,
      step.exited === true ? 'next' : null,
    ],
  );
}

async function position(
  inquiry: { environmentId: string; inquiryId: string },
  stepId: string,
  state: 'active' | 'waiting' | 'ended',
) {
  await database.client.query(
    `update inquiries set flow_step_id = $3, flow_state = $4, flow_spec_version = 2
      where environment_id = $1 and id = $2`,
    [inquiry.environmentId, inquiry.inquiryId, stepId, state],
  );
}

describe('the snapshots of a branch entry (C150.9)', () => {
  it('writes each name once, keeps the first value, and lists them by name', async () => {
    const inquiry = await seededInquiry();
    await enter(inquiry, 1, { id: 'risk_route', type: 'branch', enteredAt: at(1) });
    const key = { inquiryId: inquiry.inquiryId, stepRecordSeq: 1 };
    const written = await insertInquiryFlowSignalSnapshotsInTx(
      database.db,
      inquiry.environmentId,
      key,
      [
        {
          name: 'inquiry/vpn_detected',
          value: true,
          tier: 'H',
          stage: 'beta',
          nullReason: null,
          computedAt: at(2),
        },
        {
          name: 'inquiry/bot_score',
          value: null,
          tier: 'H',
          stage: 'beta',
          nullReason: 'not_yet_collected',
          computedAt: at(2),
        },
      ],
    );
    expect(written.map(({ name }) => name).sort()).toEqual([
      'inquiry/bot_score',
      'inquiry/vpn_detected',
    ]);
    const again = await insertInquiryFlowSignalSnapshotsInTx(
      database.db,
      inquiry.environmentId,
      key,
      [
        {
          name: 'inquiry/vpn_detected',
          value: false,
          tier: 'H',
          stage: 'beta',
          nullReason: null,
          computedAt: at(3),
        },
      ],
    );
    expect(again).toEqual([]);
    const listed = await listInquiryFlowSignalSnapshots(database.db, inquiry.environmentId, key);
    expect(listed).toEqual([
      {
        environmentId: inquiry.environmentId,
        inquiryId: inquiry.inquiryId,
        stepRecordSeq: 1,
        name: 'inquiry/bot_score',
        value: null,
        tier: 'H',
        stage: 'beta',
        nullReason: 'not_yet_collected',
        computedAt: at(2),
      },
      {
        environmentId: inquiry.environmentId,
        inquiryId: inquiry.inquiryId,
        stepRecordSeq: 1,
        name: 'inquiry/vpn_detected',
        value: true,
        tier: 'H',
        stage: 'beta',
        nullReason: null,
        computedAt: at(2),
      },
    ]);
  });

  it('writes nothing for no snapshot, and another environment reads none', async () => {
    const inquiry = await seededInquiry();
    const other = await seededInquiry();
    await enter(inquiry, 1, { id: 'risk_route', type: 'branch', enteredAt: at(1) });
    const key = { inquiryId: inquiry.inquiryId, stepRecordSeq: 1 };
    expect(
      await insertInquiryFlowSignalSnapshotsInTx(database.db, inquiry.environmentId, key, []),
    ).toEqual([]);
    await insertInquiryFlowSignalSnapshotsInTx(database.db, inquiry.environmentId, key, [
      {
        name: 'inquiry/session_count',
        value: 1,
        tier: 'R',
        stage: 'ga',
        nullReason: null,
        computedAt: at(2),
      },
    ]);
    expect(await listInquiryFlowSignalSnapshots(database.db, other.environmentId, key)).toEqual([]);
  });
});

describe('the branch entry an inquiry waits at (C150.5, V09)', () => {
  it('is the open branch entry of a waiting position, and nothing else', async () => {
    const inquiry = await seededInquiry();
    await enter(inquiry, 1, { id: 'consent', type: 'consent', enteredAt: at(1), exited: true });
    await enter(inquiry, 2, { id: 'risk_route', type: 'branch', enteredAt: at(2) });
    await position(inquiry, 'risk_route', 'waiting');
    const { environmentId, inquiryId } = inquiry;
    expect(
      await getWaitingBranchEntry(database.db, environmentId, { inquiryId, stepRecordSeq: 2 }),
    ).toEqual({
      environmentId,
      inquiryId,
      stepRecordSeq: 2,
      stepId: 'risk_route',
      enteredAt: at(2),
    });
    // Not the entry it waits at, not a branch, or no longer waiting: none.
    expect(
      await getWaitingBranchEntry(database.db, environmentId, { inquiryId, stepRecordSeq: 1 }),
    ).toBeNull();
    await position(inquiry, 'risk_route', 'active');
    expect(
      await getWaitingBranchEntry(database.db, environmentId, { inquiryId, stepRecordSeq: 2 }),
    ).toBeNull();
  });

  it('is never a closed entry, or an action the inquiry waits at', async () => {
    const closed = await seededInquiry();
    await enter(closed, 1, { id: 'risk_route', type: 'branch', enteredAt: at(1), exited: true });
    await position(closed, 'risk_route', 'waiting');
    expect(
      await getWaitingBranchEntry(database.db, closed.environmentId, {
        inquiryId: closed.inquiryId,
        stepRecordSeq: 1,
      }),
    ).toBeNull();
    const action = await seededInquiry();
    await enter(action, 1, { id: 'run_check', type: 'action', enteredAt: at(1) });
    await position(action, 'run_check', 'waiting');
    expect(
      await getWaitingBranchEntry(database.db, action.environmentId, {
        inquiryId: action.inquiryId,
        stepRecordSeq: 1,
      }),
    ).toBeNull();
  });

  it('lists the waiting branch entries entered before the cutoff, oldest first', async () => {
    const late = await seededInquiry();
    const early = await seededInquiry();
    const after = await seededInquiry();
    const action = await seededInquiry();
    await enter(late, 1, { id: 'route_a', type: 'branch', enteredAt: at(30) });
    await position(late, 'route_a', 'waiting');
    await enter(early, 1, { id: 'route_b', type: 'branch', enteredAt: at(20) });
    await position(early, 'route_b', 'waiting');
    await enter(after, 1, { id: 'route_c', type: 'branch', enteredAt: at(55) });
    await position(after, 'route_c', 'waiting');
    await enter(action, 1, { id: 'run_check', type: 'action', enteredAt: at(10) });
    await position(action, 'run_check', 'waiting');
    const mine = new Set([late.inquiryId, early.inquiryId, after.inquiryId, action.inquiryId]);
    const listed = (
      await listWaitingBranchEntries(database.db, { enteredBefore: at(50), limit: 1_000 })
    ).filter(({ inquiryId }) => mine.has(inquiryId));
    expect(listed.map(({ inquiryId, stepId }) => [inquiryId, stepId])).toEqual([
      [early.inquiryId, 'route_b'],
      [late.inquiryId, 'route_a'],
    ]);
    expect(
      await listWaitingBranchEntries(database.db, { enteredBefore: at(50), limit: 1 }),
    ).toHaveLength(1);
  });
});
