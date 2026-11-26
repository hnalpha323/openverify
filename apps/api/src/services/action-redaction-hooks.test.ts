/**
 * Workflow 8A Stage 1b (A) (C127.7, C128.1; F35, V25): every redaction of a decision's subject calls
 * `redactDecisionCommentsInTx`, in its own transaction, beside the run side; a transaction's calls
 * `redactTransactionChildrenInTx` too, and dispatches what that staged; and an item redaction reaches
 * the comments of the items it took. The hooks are recording fakes here; their behaviour is
 * `api-actions`'. Synthetic values.
 */
import {
  createTestDatabase,
  createTestInquiry,
  createTestTenant,
  seedList,
  seedListItem,
  seedTransaction,
  seedTransactionType,
  testId,
  type TestDatabase,
} from '@openverify/db/testing';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StagedEvent } from '../events/index.js';
import { createInMemoryFileStorage } from '../storage/index.js';
import {
  createFakeBiometricItemRedactor,
  createRecordingAuditLogger,
  createRecordingEventPublisher,
  fixedClock,
} from '../test-support/fakes.js';
import { afterListItemsRedactedInTx } from './lists/list-writes.js';
import { createRedactionService } from './redaction.js';

const hooks = vi.hoisted(() => ({ comments: vi.fn(), children: vi.fn(), listUpdated: vi.fn() }));
vi.mock('./decisions/redaction.js', () => ({ redactDecisionCommentsInTx: hooks.comments }));
vi.mock('../workflows/actions/transactions/children.js', () => ({
  redactTransactionChildrenInTx: hooks.children,
}));
vi.mock('../workflows/actions/lists/list-updated.js', () => ({
  stageListUpdated: hooks.listUpdated,
}));

const at = new Date('2026-11-02T12:00:00.000Z');
let database: TestDatabase;

beforeAll(async () => {
  database = await createTestDatabase();
}, 120_000);

afterAll(async () => {
  await database.close();
});

beforeEach(() => {
  hooks.comments.mockReset().mockResolvedValue(undefined);
  hooks.children.mockReset().mockResolvedValue({ staged: [], storageKeys: [] });
  hooks.listUpdated.mockReset().mockResolvedValue([]);
});

async function tenant() {
  const { organization, environment } = await createTestTenant(database.db);
  return {
    ctx: { organizationId: organization.id, environmentId: environment.id },
    environmentId: environment.id,
  };
}

function service(events = createRecordingEventPublisher()) {
  return createRedactionService({
    db: database.db,
    storage: createInMemoryFileStorage(),
    events,
    clock: fixedClock(at),
    audit: createRecordingAuditLogger(),
  });
}

async function transactionIn(environmentId: string): Promise<string> {
  const type = await seedTransactionType(database.db, environmentId);
  const { id } = await seedTransaction(database.db, environmentId, {
    transactionTypeId: type.id,
    transactionTypeVersionId: type.versionId,
  });
  return id;
}

const commentSubjects = () =>
  hooks.comments.mock.calls.map((call) => (call[1] as { subjectIds: string[] }).subjectIds);

describe('redactDecisionCommentsInTx (C128.1, V25)', () => {
  it('runs inside an inquiry’s redaction', async () => {
    const { ctx, environmentId } = await tenant();
    const { inquiry } = await createTestInquiry(database.db, environmentId);

    await service().redactInquiry(ctx, inquiry.id, null);

    expect(commentSubjects()).toContainEqual([inquiry.id]);
    expect(hooks.comments.mock.calls[0]?.[1]).toMatchObject({ environmentId, at });
  });

  it('runs inside an account’s redaction', async () => {
    const { ctx, environmentId } = await tenant();
    const { inquiry } = await createTestInquiry(database.db, environmentId);

    await service().redactAccount(ctx, inquiry.accountId, null);

    expect(commentSubjects()).toContainEqual([inquiry.accountId]);
  });

  it('runs inside a transaction’s redaction', async () => {
    const { ctx, environmentId } = await tenant();
    const id = await transactionIn(environmentId);

    await service().redactTransaction(ctx, id, null);

    expect(commentSubjects()).toContainEqual([id]);
  });

  it('reaches a re-run', async () => {
    const { ctx, environmentId } = await tenant();
    const { inquiry } = await createTestInquiry(database.db, environmentId);
    await service().redactInquiry(ctx, inquiry.id, null);
    hooks.comments.mockClear();

    await service().redactInquiry(ctx, inquiry.id, null);

    expect(commentSubjects()).toContainEqual([inquiry.id]);
  });

  it('rolls the redaction back when it fails', async () => {
    const { ctx, environmentId } = await tenant();
    const { inquiry } = await createTestInquiry(database.db, environmentId);
    hooks.comments.mockRejectedValue(new Error('synthetic'));

    await expect(service().redactInquiry(ctx, inquiry.id, null)).rejects.toThrow('synthetic');

    const rows = await database.client.query<{ redacted_at: Date | null }>(
      'select redacted_at from inquiries where id = $1',
      [inquiry.id],
    );
    expect(rows.rows).toEqual([{ redacted_at: null }]);
  });

  it('reaches the face and background items an inquiry was the source of', async () => {
    const { ctx, environmentId } = await tenant();
    const { inquiry } = await createTestInquiry(database.db, environmentId);
    const itemId = testId('lifc');
    const listId = testId('lst');
    const biometricItems = createFakeBiometricItemRedactor();
    biometricItems.changedLists = [{ listId, items: 1 }];
    biometricItems.redactedItemIds = [itemId];

    await createRedactionService({
      db: database.db,
      storage: createInMemoryFileStorage(),
      events: createRecordingEventPublisher(),
      clock: fixedClock(at),
      audit: createRecordingAuditLogger(),
      biometricItems,
    }).redactInquiry(ctx, inquiry.id, null);

    expect(commentSubjects()).toContainEqual([itemId]);
    expect(hooks.listUpdated.mock.calls[0]?.slice(2)).toEqual([
      environmentId,
      [{ listId, changeKind: 'items-redacted', items: 1 }],
    ]);
  });
});

describe('afterListItemsRedactedInTx (C127.12, V25)', () => {
  it('forgets the comments of what went, and stages the lists it changed', async () => {
    const { environmentId } = await tenant();
    const { id: listId } = await seedList(database.db, environmentId);
    const { id } = await seedListItem(database.db, environmentId, { listId });
    const staged: StagedEvent = { eventId: 'evt_synthetic', deliveries: [] };
    hooks.listUpdated.mockResolvedValue([staged]);
    const events = createRecordingEventPublisher();

    const answer = await database.db.transaction((tx) =>
      afterListItemsRedactedInTx(
        tx,
        { events },
        environmentId,
        { changedLists: [{ listId, items: 1 }], redactedItemIds: [id] },
        at,
      ),
    );

    expect(answer).toEqual([staged]);
    expect(hooks.comments.mock.calls[0]?.[1]).toEqual({ environmentId, subjectIds: [id], at });
    expect(hooks.listUpdated.mock.calls[0]?.slice(2)).toEqual([
      environmentId,
      [{ listId, changeKind: 'items-redacted', items: 1 }],
    ]);
  });

  it('owes nothing for a redaction that took nothing', async () => {
    const { environmentId } = await tenant();
    const events = createRecordingEventPublisher();

    const answer = await database.db.transaction((tx) =>
      afterListItemsRedactedInTx(
        tx,
        { events },
        environmentId,
        { changedLists: [], redactedItemIds: [] },
        at,
      ),
    );

    expect(answer).toEqual([]);
    expect(hooks.comments).not.toHaveBeenCalled();
    expect(hooks.listUpdated).not.toHaveBeenCalled();
  });
});

describe('redactTransactionChildrenInTx (C127.7, F35)', () => {
  it('runs inside a transaction’s redaction, with its id', async () => {
    const { ctx, environmentId } = await tenant();
    const id = await transactionIn(environmentId);

    await service().redactTransaction(ctx, id, null);

    expect(hooks.children).toHaveBeenCalledTimes(1);
    expect(hooks.children.mock.calls[0]?.[2]).toEqual({ environmentId, transactionId: id, at });
  });

  it('reaches a re-run, for a child a run created since', async () => {
    const { ctx, environmentId } = await tenant();
    const id = await transactionIn(environmentId);
    await service().redactTransaction(ctx, id, null);
    hooks.children.mockClear();

    await service().redactTransaction(ctx, id, null);

    expect(hooks.children).toHaveBeenCalledTimes(1);
  });

  it('dispatches what the cascade staged, after the commit', async () => {
    const { ctx, environmentId } = await tenant();
    const id = await transactionIn(environmentId);
    const events = createRecordingEventPublisher();
    hooks.children.mockImplementation(
      async (tx: Parameters<typeof events.stage>[0], deps: { events: typeof events }) => ({
        staged: [
          await deps.events.stage(tx, {
            environmentId,
            name: 'inquiry.redacted',
            payload: { data: { type: 'inquiry', id: testId('inq') } } as never,
          }),
        ],
        storageKeys: [],
      }),
    );

    await service(events).redactTransaction(ctx, id, null);

    expect(events.named('inquiry.redacted')).toHaveLength(1);
  });
});
