/**
 * Workflow 8A Stage 3 (`api-actions`; C128.1, V25, Stage 1b amendment 37): the coverage owed per
 * subject type: redacting an inquiry, an account, a transaction or a list item, through the real
 * redaction services, keeps its decision's codes and nulls its comment, and nothing else's. Synthetic.
 */
import { getInquiryDecision, type Db } from '@openverify/db';
import {
  createTestDatabase,
  createTestInquiry,
  createTestTenant,
  seedInquiryDecision,
  seedList,
  seedListItem,
  seedTransaction,
  seedTransactionType,
  testId,
  type TestDatabase,
} from '@openverify/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createInMemoryFileStorage } from '../../storage/index.js';
import {
  createFakeBiometricItemRedactor,
  createRecordingAuditLogger,
  createRecordingEventPublisher,
  fixedClock,
} from '../../test-support/fakes.js';
import { afterListItemsRedactedInTx } from '../lists/list-writes.js';
import { createRedactionService } from '../redaction.js';

const at = new Date('2026-11-02T12:00:00.000Z');
const COMMENT = 'A synthetic reviewer note';
let database: TestDatabase;
let db: Db;

beforeAll(async () => {
  database = await createTestDatabase();
  db = database.db;
}, 120_000);

afterAll(async () => {
  await database.close();
});

async function fixture() {
  const { organization, environment } = await createTestTenant(db);
  const events = createRecordingEventPublisher();
  const service = createRedactionService({
    db,
    storage: createInMemoryFileStorage(),
    events,
    clock: fixedClock(at),
    audit: createRecordingAuditLogger(),
    biometricItems: createFakeBiometricItemRedactor(),
  });
  return {
    events,
    environmentId: environment.id,
    ctx: { organizationId: organization.id, environmentId: environment.id },
    service,
  };
}

const actor = { type: 'user', id: testId('usr') } as const;

async function expectCommentGone(environmentId: string, id: string, otherId: string) {
  expect(await getInquiryDecision(db, environmentId, id)).toMatchObject({
    comment: null,
    kind: 'decline',
  });
  expect((await getInquiryDecision(db, environmentId, otherId))?.comment).toBe(COMMENT);
}

describe('a redaction keeps the record and nulls its comment (V25)', () => {
  it('holds for an inquiry', async () => {
    const { environmentId, ctx, service } = await fixture();
    const { inquiry } = await createTestInquiry(db, environmentId);
    const decision = await seedInquiryDecision(db, environmentId, {
      subjectId: inquiry.id,
      comment: COMMENT,
    });
    const other = await seedInquiryDecision(db, environmentId, { comment: COMMENT });
    await service.redactInquiry(ctx, inquiry.id, actor);
    await expectCommentGone(environmentId, decision.id, other.id);
  });

  it('holds for an account', async () => {
    const { environmentId, ctx, service } = await fixture();
    const { inquiry } = await createTestInquiry(db, environmentId);
    const decision = await seedInquiryDecision(db, environmentId, {
      subjectId: inquiry.accountId,
      subjectType: 'account',
      comment: COMMENT,
    });
    const other = await seedInquiryDecision(db, environmentId, { comment: COMMENT });
    await service.redactAccount(ctx, inquiry.accountId, actor);
    await expectCommentGone(environmentId, decision.id, other.id);
  });

  it('holds for a transaction', async () => {
    const { environmentId, ctx, service } = await fixture();
    const type = await seedTransactionType(db, environmentId);
    const transaction = await seedTransaction(db, environmentId, {
      transactionTypeId: type.id,
      transactionTypeVersionId: type.versionId,
    });
    const decision = await seedInquiryDecision(db, environmentId, {
      subjectId: transaction.id,
      subjectType: 'transaction',
      comment: COMMENT,
    });
    const other = await seedInquiryDecision(db, environmentId, { comment: COMMENT });
    await service.redactTransaction(ctx, transaction.id, actor, { includeNever: false });
    await expectCommentGone(environmentId, decision.id, other.id);
  });

  it('holds for a list item', async () => {
    const { environmentId, events } = await fixture();
    const list = await seedList(db, environmentId);
    const item = await seedListItem(db, environmentId, { listId: list.id });
    const decision = await seedInquiryDecision(db, environmentId, {
      subjectId: item.id,
      subjectType: 'list-item',
      comment: COMMENT,
    });
    const other = await seedInquiryDecision(db, environmentId, { comment: COMMENT });
    await afterListItemsRedactedInTx(
      db,
      { events },
      environmentId,
      { changedLists: [], redactedItemIds: [item.id] },
      at,
    );
    await expectCommentGone(environmentId, decision.id, other.id);
  });
});
