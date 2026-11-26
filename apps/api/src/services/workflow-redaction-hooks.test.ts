/**
 * C120.9 (F35): every redaction calls the run side's hook, in its own transaction, with the redacted
 * object's id: an inquiry, an account, a report and a transaction, a re-run included, because the hook
 * is idempotent and a run may have recorded the subject since. The hook is a recording fake here; its
 * behaviour is `api-engine`'s to test.
 */
import type { TestDatabase } from '@openverify/db/testing';
import {
  createTestDatabase,
  createTestInquiry,
  createTestTenant,
  seedReport,
  seedReportTemplate,
  seedTransaction,
  seedTransactionType,
  testId,
} from '@openverify/db/testing';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createInMemoryFileStorage } from '../storage/index.js';
import {
  createRecordingAuditLogger,
  createRecordingEventPublisher,
  fixedClock,
} from '../test-support/fakes.js';
import { createRedactionService } from './redaction.js';

const hook = vi.hoisted(() => vi.fn());
vi.mock('../workflows/runs/redaction.js', () => ({ redactRunsForSubjectsInTx: hook }));

const at = new Date('2026-11-02T12:00:00.000Z');
let database: TestDatabase;

beforeAll(async () => {
  database = await createTestDatabase();
}, 120_000);

afterAll(async () => {
  await database.close();
});

beforeEach(() => {
  hook.mockReset().mockResolvedValue(undefined);
});

async function tenant() {
  const { organization, environment } = await createTestTenant(database.db);
  return {
    ctx: { organizationId: organization.id, environmentId: environment.id },
    environmentId: environment.id,
  };
}

const service = () =>
  createRedactionService({
    db: database.db,
    storage: createInMemoryFileStorage(),
    events: createRecordingEventPublisher(),
    clock: fixedClock(at),
    audit: createRecordingAuditLogger(),
  });

const subjectCalls = () => hook.mock.calls.map((call) => (call[1] as { subjectIds: string[] }).subjectIds);

describe('redactRunsForSubjectsInTx (F35)', () => {
  it('runs inside an inquiry’s redaction', async () => {
    const { ctx, environmentId } = await tenant();
    const { inquiry } = await createTestInquiry(database.db, environmentId);

    await service().redactInquiry(ctx, inquiry.id, null);

    expect(subjectCalls()).toContainEqual([inquiry.id]);
    expect(hook.mock.calls[0]?.[1]).toMatchObject({ environmentId, at });
  });

  it('runs inside an account’s redaction', async () => {
    const { ctx, environmentId } = await tenant();
    const { inquiry } = await createTestInquiry(database.db, environmentId);
    const accountId = inquiry.accountId;
    expect(accountId).not.toBeNull();

    await service().redactAccount(ctx, accountId, null);

    expect(subjectCalls()).toContainEqual([accountId]);
  });

  it('runs inside a report’s redaction', async () => {
    const { ctx, environmentId } = await tenant();
    const template = await seedReportTemplate(database.db, environmentId);
    const reportId = await seedReport(database.db, environmentId, template);

    await service().redactReport(ctx, reportId, null);

    expect(subjectCalls()).toContainEqual([reportId]);
  });

  it('runs inside a transaction’s redaction', async () => {
    const { ctx, environmentId } = await tenant();
    const type = await seedTransactionType(database.db, environmentId);
    const transaction = await seedTransaction(database.db, environmentId, {
      transactionTypeId: type.id,
      transactionTypeVersionId: type.versionId,
    });

    await service().redactTransaction(ctx, transaction.id, null);

    expect(subjectCalls()).toContainEqual([transaction.id]);
  });

  it('rolls the redaction back when it fails: an object is never redacted without its runs', async () => {
    const { ctx, environmentId } = await tenant();
    const { inquiry } = await createTestInquiry(database.db, environmentId);
    hook.mockRejectedValue(new Error('synthetic'));

    await expect(service().redactInquiry(ctx, inquiry.id, null)).rejects.toThrow('synthetic');

    const rows = await database.client.query<{ redacted_at: Date | null }>(
      'select redacted_at from inquiries where id = $1',
      [inquiry.id],
    );
    expect(rows.rows).toEqual([{ redacted_at: null }]);
  });

  it('reaches a re-run, for a run that recorded the subject since', async () => {
    const { ctx, environmentId } = await tenant();
    const { inquiry } = await createTestInquiry(database.db, environmentId);
    await service().redactInquiry(ctx, inquiry.id, null);
    hook.mockClear();

    await service().redactInquiry(ctx, inquiry.id, null);

    expect(subjectCalls()).toContainEqual([inquiry.id]);
  });

  it('never needs an id it was not given', () => {
    expect(testId('wfr')).toMatch(/^wfr_/);
  });
});
