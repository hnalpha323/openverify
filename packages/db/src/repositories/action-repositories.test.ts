/**
 * Workflow 8A Stage 3 (`api-actions`; C127.7, C127.9, C127.12, C128.1, C128.6): the decision record,
 * a transaction's children, the re-screen outbox and the device trust mark.
 *
 * - A comment is sealed to its row and comes back opened; a redaction nulls it and keeps every code.
 * - Decisions read newest first, ties by id; one human review opens at a time, and a user closes it.
 * - A child is written once, and reads from both sides.
 * - A re-screen request is written once per list version, and the sweep skips what it enqueued.
 * - A trust mark sets and clears whole, in its environment alone.
 *
 * Every value is synthetic.
 */
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, onTestFinished } from 'vitest';
import { createKeyring, setDefaultKeyring } from '../crypto.js';
import {
  createdAtClock,
  createTestDatabase,
  createTestTenant,
  seedDevice,
  seedInquiryDecision,
  seedList,
  seedTransaction,
  seedTransactionType,
  testId,
  wallClockStepsBack,
  type TestDatabase,
} from '../testing.js';
import { setDeviceTrust } from './device-trust.js';
import { getDevice } from './devices.js';
import {
  closePendingHumanReview,
  createInquiryDecision,
  findPendingHumanReview,
  getInquiryDecision,
  listDecisionsForSubjects,
  listInquiryDecisions,
  redactDecisionComments,
  type InquiryDecision,
} from './inquiry-decisions.js';
import {
  createListRescreenRequest,
  finishListRescreenRequest,
  listDueListRescreenRequests,
  markListRescreenRequestEnqueued,
} from './list-rescreen-requests.js';
import {
  listTransactionChildren,
  listTransactionsOfChild,
  recordTransactionChild,
} from './transaction-children.js';

let database: TestDatabase;

beforeAll(async () => {
  setDefaultKeyring(createKeyring(randomBytes(32)));
  database = await createTestDatabase();
}, 120_000);

afterAll(async () => {
  await database.close();
});

const at = new Date('2026-11-02T12:00:00.000Z');

async function tenant(): Promise<string> {
  const { environment } = await createTestTenant(database.db);
  return environment.id;
}

const decisionOf = async (environmentId: string, id: string): Promise<InquiryDecision> => {
  const decision = await getInquiryDecision(database.db, environmentId, id);
  if (decision === null) {
    throw new Error('no decision');
  }
  return decision;
};

const newDecision = (subjectId: string, id = testId('idec')) => ({
  id,
  kind: 'decline' as const,
  subjectType: 'inquiry' as const,
  subjectId,
  actorType: 'user' as const,
  actorId: testId('usr'),
});

describe('a decision record (C128.1)', () => {
  it('seals its comment to the row and reads it back opened', async () => {
    const environmentId = await tenant();
    const created = await createInquiryDecision(database.db, environmentId, {
      ...newDecision(testId('inq')),
      comment: 'synthetic reviewer note',
      solelyAutomated: false,
      decisionBasis: 'contract',
      contestRoute: { contact: 'review@example.com' },
      biometricBasis: 'explicit-consent',
      evidence: [
        {
          kind: 'check',
          id: null,
          name: 'id_expired',
          status: 'failed',
          tier: 'R',
          stage: 'ga',
          confidence: null,
        },
      ],
      pendingEvidence: [{ kind: 'report', id: testId('rep'), name: null }],
    });
    expect(created).toMatchObject({
      comment: 'synthetic reviewer note',
      solelyAutomated: false,
      decisionBasis: 'contract',
      biometricBasis: 'explicit-consent',
      needsReview: false,
      humanReviewPending: false,
    });
    const stored = await database.client.query<{ comment: string }>(
      `select comment from inquiry_decisions where id = $1`,
      [created.id],
    );
    expect(stored.rows[0]?.comment).not.toContain('synthetic reviewer note');
    expect(await decisionOf(environmentId, created.id)).toMatchObject({
      comment: 'synthetic reviewer note',
      evidence: [{ name: 'id_expired' }],
      pendingEvidence: [{ kind: 'report' }],
    });
  });

  it('answers null for an id of another environment', async () => {
    const environmentId = await tenant();
    const { id } = await seedInquiryDecision(database.db, environmentId);
    expect(await getInquiryDecision(database.db, await tenant(), id)).toBeNull();
  });

  it('lists a subject newest first, ties by id, a page at a time', async () => {
    onTestFinished(wallClockStepsBack());
    const environmentId = await tenant();
    const clock = createdAtClock(database.db);
    const subjectId = testId('inq');
    const first = await seedInquiryDecision(database.db, environmentId, { subjectId });
    const second = await seedInquiryDecision(database.db, environmentId, { subjectId });
    await clock.at('inquiry_decisions', first.id);
    await clock.at('inquiry_decisions', second.id);
    await seedInquiryDecision(database.db, environmentId);
    const page = await listInquiryDecisions(database.db, environmentId, subjectId, { size: 1 });
    expect(page.items.map(({ id }) => id)).toEqual([second.id]);
    expect(page.next).toBe(second.id);
    const rest = await listInquiryDecisions(database.db, environmentId, subjectId, {
      size: 1,
      after: second.id,
    });
    expect(rest.items.map(({ id }) => id)).toEqual([first.id]);
    expect(rest.next).toBeNull();
  });

  it('reads every decision of several subjects at once', async () => {
    const environmentId = await tenant();
    const [inquiryId, transactionId] = [testId('inq'), testId('txn')];
    const subjectIds = [inquiryId, transactionId];
    await seedInquiryDecision(database.db, environmentId, { subjectId: inquiryId });
    await seedInquiryDecision(database.db, environmentId, {
      subjectId: transactionId,
      subjectType: 'transaction',
    });
    await seedInquiryDecision(database.db, environmentId);
    const found = await listDecisionsForSubjects(database.db, environmentId, subjectIds);
    expect(found.map(({ subjectId }) => subjectId).sort()).toEqual([...subjectIds].sort());
    expect(await listDecisionsForSubjects(database.db, environmentId, [])).toEqual([]);
  });

  it('keeps every code through a redaction, and nulls the comment alone (P35, V25)', async () => {
    const environmentId = await tenant();
    const subjectId = testId('inq');
    const { id } = await createInquiryDecision(database.db, environmentId, {
      ...newDecision(subjectId),
      comment: 'synthetic reviewer note',
      decisionBasis: 'law',
    });
    const other = await createInquiryDecision(database.db, environmentId, {
      ...newDecision(testId('inq')),
      comment: 'a second synthetic note',
    });
    expect(await redactDecisionComments(database.db, environmentId, [subjectId])).toBe(1);
    expect(await decisionOf(environmentId, id)).toMatchObject({
      comment: null,
      decisionBasis: 'law',
      kind: 'decline',
      subjectId,
    });
    expect((await decisionOf(environmentId, other.id)).comment).toBe('a second synthetic note');
    expect(await redactDecisionComments(database.db, environmentId, [subjectId])).toBe(0);
    expect(await redactDecisionComments(database.db, environmentId, [])).toBe(0);
  });
});

describe('human review pending (C128.6)', () => {
  it('reads the open review, and a user closes it', async () => {
    const environmentId = await tenant();
    const subjectId = testId('inq');
    expect(await findPendingHumanReview(database.db, environmentId, subjectId)).toBeNull();
    const { id } = await createInquiryDecision(database.db, environmentId, {
      ...newDecision(subjectId),
      kind: 'reopen',
      humanReviewPending: true,
    });
    expect((await findPendingHumanReview(database.db, environmentId, subjectId))?.id).toBe(id);
    await closePendingHumanReview(database.db, environmentId, subjectId);
    expect(await findPendingHumanReview(database.db, environmentId, subjectId)).toBeNull();
    expect((await decisionOf(environmentId, id)).humanReviewPending).toBe(false);
  });
});

describe('a transaction child (C127.7)', () => {
  it('is written once and reads from both sides', async () => {
    const environmentId = await tenant();
    const type = await seedTransactionType(database.db, environmentId);
    const transaction = await seedTransaction(database.db, environmentId, {
      transactionTypeId: type.id,
      transactionTypeVersionId: type.versionId,
    });
    const child = {
      transactionId: transaction.id,
      childType: 'inquiry' as const,
      childId: testId('inq'),
      workflowRunId: testId('wfr'),
    };
    await recordTransactionChild(database.db, environmentId, child);
    await recordTransactionChild(database.db, environmentId, child);
    expect(await listTransactionChildren(database.db, environmentId, transaction.id)).toMatchObject(
      [{ childId: child.childId, childType: 'inquiry' }],
    );
    expect(await listTransactionsOfChild(database.db, environmentId, child.childId)).toMatchObject([
      { transactionId: transaction.id },
    ]);
    expect(await listTransactionChildren(database.db, await tenant(), transaction.id)).toEqual([]);
  });
});

describe('a list re-screen request (C127.12)', () => {
  it('is once per list version, and the sweep leaves what it enqueued recently', async () => {
    const environmentId = await tenant();
    const list = await seedList(database.db, environmentId);
    const key = { listId: list.id, listVersion: 2 };
    expect(await createListRescreenRequest(database.db, environmentId, key)).toBe(true);
    expect(await createListRescreenRequest(database.db, environmentId, key)).toBe(false);
    const now = new Date(Date.now() + 60_000);
    const due = await listDueListRescreenRequests(database.db, { now, limit: 500 });
    expect(due.filter(({ listId }) => listId === list.id)).toMatchObject([{ listVersion: 2 }]);
    await markListRescreenRequestEnqueued(database.db, environmentId, key, now);
    const after = await listDueListRescreenRequests(database.db, { now, limit: 500 });
    expect(after.filter(({ listId }) => listId === list.id)).toEqual([]);
    const later = new Date(now.getTime() + 600_000);
    const again = await listDueListRescreenRequests(database.db, { now: later, limit: 500 });
    expect(again.filter(({ listId }) => listId === list.id)).toHaveLength(1);
    await finishListRescreenRequest(database.db, environmentId, key, later);
    const finished = await listDueListRescreenRequests(database.db, { now: later, limit: 500 });
    expect(finished.filter(({ listId }) => listId === list.id)).toEqual([]);
  });
});

describe('the device trust mark (C127.9)', () => {
  it('sets whole, clears whole, and stays in its environment', async () => {
    const environmentId = await tenant();
    const { id } = await seedDevice(database.db, environmentId);
    const mark = {
      trustedAt: at,
      trustedByType: 'workflow-run' as const,
      trustedById: testId('wfr'),
      trustReason: 'known_customer',
    };
    expect(await setDeviceTrust(database.db, await tenant(), id, mark)).toBeNull();
    expect(await setDeviceTrust(database.db, environmentId, id, mark)).toMatchObject({
      trustedAt: at,
      trustedByType: 'workflow-run',
      trustReason: 'known_customer',
    });
    const cleared = await setDeviceTrust(database.db, environmentId, id, null);
    expect(cleared).toMatchObject({ trustedAt: null, trustedByType: null, trustReason: null });
    expect(await getDevice(database.db, environmentId, id)).toMatchObject({ trustedById: null });
  });
});
