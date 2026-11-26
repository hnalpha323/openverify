/**
 * Workflow 7B Stage 1b (T): the hooks. `blind-index:rebuild` runs `rebuildTransactionFieldKeys`
 * (C105.4); `RedactionService.redactTransaction` runs its hook in one transaction, audits a first
 * redaction, and deletes the objects it names after the commit, a retry finishing what storage
 * refused (C105.5); the C16 pass redacts what is due and purges leftover objects; a `transaction`
 * event's filter subject is strict and a `transaction-type` event's has nothing to resolve (C107.4);
 * `TransactionProblemError` answers each code's status. Synthetic values.
 */
import { TRANSACTION_PROBLEM_CODES, TRANSACTION_PROBLEM_STATUSES } from '@openverify/contracts';
import { redactTransactionRecords, updateEnvironmentSettings } from '@openverify/db';
import {
  createTestTenant,
  seedTransaction,
  seedTransactionFile,
  seedTransactionType,
} from '@openverify/db/testing';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { runBlindIndexRebuild } from '../../scripts/blind-index-rebuild.js';
import { NotFoundError, TransactionProblemError } from '../errors.js';
import { createEventPublisher } from '../events/index.js';
import { eventFilterSubjects, toEventSubject } from '../events/subject.js';
import type { FileStorage, RedactionService } from '../ports.js';
import { createInMemoryFileStorage } from '../storage/index.js';
import { createRecordingAuditLogger, fixedClock } from '../test-support/fakes.js';
import { createWebhookDeliveryScheduler } from '../webhooks/queue.js';
import { createInquiryTestApi, type InquiryTestApi } from './inquiries.test-support.js';
import { createRedactionService, RedactionIncompleteError } from './redaction.js';
import { isRetentionIncomplete, runRetention } from './retention.js';
import { rebuildTransactionFieldKeys } from './transactions/rebuild.js';
import type { RedactTransactionInTx } from './transactions/redaction.js';

const hooks = vi.hoisted(() => ({
  rebuild: vi.fn(() => Promise.resolve({ scanned: 5, updated: 2 })),
  redact: vi.fn<RedactTransactionInTx>(),
  filters: vi.fn(),
}));
vi.mock('./transactions/rebuild.js', () => ({ rebuildTransactionFieldKeys: hooks.rebuild }));
vi.mock('./transactions/redaction.js', () => ({ redactTransactionInTx: hooks.redact }));
vi.mock('./transactions/filter-subjects.js', () => ({
  resolveTransactionFilterSubjects: hooks.filters,
}));

let api: InquiryTestApi;

beforeAll(async () => {
  api = await createInquiryTestApi();
});

afterAll(async () => {
  await api.close();
});

beforeEach(() => {
  hooks.redact.mockReset();
  hooks.filters.mockReset();
});

const NOW = new Date('2026-10-31T00:00:00.000Z');

describe('blind-index:rebuild and the transaction field keys (C105.4)', () => {
  it('runs rebuildTransactionFieldKeys and prints counts only', async () => {
    const lines: string[] = [];

    const result = await runBlindIndexRebuild({
      db: api.database.db,
      key: new Uint8Array(32).fill(3),
      args: { batchSize: 9 },
      out: (line) => lines.push(line),
    });

    expect(vi.mocked(rebuildTransactionFieldKeys).mock.lastCall?.slice(1)).toEqual([
      new Uint8Array(32).fill(3),
      { batchSize: 9 },
    ]);
    expect(result.transactions).toEqual({ scanned: 5, updated: 2 });
    expect(lines).toContain(
      'blind-index:rebuild: done: scanned 5 transaction field keys, re-indexed 2.',
    );
  });
});

function redactionService(
  overrides: { storage?: FileStorage; audit?: ReturnType<typeof createRecordingAuditLogger> } = {},
) {
  const storage = overrides.storage ?? createInMemoryFileStorage();
  const dispatched: unknown[] = [];
  const events = createEventPublisher({
    db: api.database.db,
    deliveries: createWebhookDeliveryScheduler({
      add: () => Promise.resolve(),
      close: () => Promise.resolve(),
    }),
  });
  const published = { ...events, dispatch: (staged: never[]) => events.dispatch(staged) };
  const audit = overrides.audit ?? createRecordingAuditLogger();
  const redaction = createRedactionService({
    db: api.database.db,
    storage,
    events: published,
    clock: fixedClock(NOW),
    audit,
  });
  return { redaction, storage, audit, dispatched };
}

async function subject() {
  const { organization, environment } = await createTestTenant(api.database.db);
  const type = await seedTransactionType(api.database.db, environment.id);
  const transaction = await seedTransaction(api.database.db, environment.id, {
    transactionTypeId: type.id,
    transactionTypeVersionId: type.versionId,
    fields: { iban: { type: 'string', value: 'synthetic-iban' } },
  });
  const file = await seedTransactionFile(api.database.db, environment.id, {
    transactionId: transaction.id,
  });
  const ctx = { organizationId: organization.id, environmentId: environment.id, requestId: 'r-1' };
  return { ctx, transaction, file };
}

/** The hook as `api-transactions` will build it, over the real repository. */
function hookOverRecords(alreadyRedacted = false): RedactTransactionInTx {
  return async (tx, _deps, environmentId, transactionId, options) => {
    const redacted = await redactTransactionRecords(tx, environmentId, transactionId, {
      at: options.at,
    });
    return redacted === null
      ? null
      : {
          redactedAt: redacted.transaction.redactedAt ?? options.at,
          alreadyRedacted: alreadyRedacted || redacted.alreadyRedacted,
          files: redacted.files,
          storageKeys: [],
          staged: [],
          stubbedEvents: redacted.stubbedEvents,
        };
  };
}

const actor = { type: 'user', id: 'usr_01M5CK16P0D13FXHZSS4TCFBVH' } as const;

describe('RedactionService.redactTransaction (C105.5)', () => {
  it('runs the hook with the time and the override, and answers its result', async () => {
    const { redaction } = redactionService();
    const { ctx, transaction } = await subject();
    hooks.redact.mockImplementation(hookOverRecords());

    const result = await redaction.redactTransaction(ctx, transaction.id, actor, {
      includeNever: true,
    });

    expect(result).toEqual({ redactedAt: NOW, alreadyRedacted: false });
    const [, deps, environmentId, id, options] = hooks.redact.mock.calls[0] ?? [];
    expect(deps?.clock.now()).toEqual(NOW);
    expect([environmentId, id, options]).toEqual([
      ctx.environmentId,
      transaction.id,
      { at: NOW, includeNever: true },
    ]);
  });

  it('leaves the never fields by default', async () => {
    const { redaction } = redactionService();
    const { ctx, transaction } = await subject();
    hooks.redact.mockImplementation(hookOverRecords());

    await redaction.redactTransaction(ctx, transaction.id, null);

    expect(hooks.redact.mock.calls[0]?.[4]).toEqual({ at: NOW, includeNever: false });
  });

  it('answers 404 for a transaction that is not there', async () => {
    const { redaction } = redactionService();
    const { ctx } = await subject();
    hooks.redact.mockResolvedValue(null);

    await expect(
      redaction.redactTransaction(ctx, 'txn_01M5CK16P0D13FXHZSS4TCFBVH', actor),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('deletes the objects after the commit and marks them', async () => {
    const { redaction, storage } = redactionService();
    const { ctx, transaction, file } = await subject();
    await storage.put(file.storageKey, new Uint8Array([1]));
    hooks.redact.mockImplementation(hookOverRecords());

    await redaction.redactTransaction(ctx, transaction.id, actor);

    expect(await storage.get(file.storageKey)).toBeNull();
    const rows = await api.database.client.query<{ deleted_at: unknown }>(
      `select deleted_at from transaction_files where id = $1`,
      [file.id],
    );
    expect(rows.rows[0]?.deleted_at).not.toBeNull();
  });

  it('throws 503 when storage refuses, and a retry finishes it', async () => {
    const working = createInMemoryFileStorage();
    const failing: FileStorage = {
      ...working,
      delete: () => Promise.reject(new Error('storage unavailable')),
    };
    const { ctx, transaction, file } = await subject();
    await working.put(file.storageKey, new Uint8Array([1]));
    hooks.redact.mockImplementation(hookOverRecords());

    await expect(
      redactionService({ storage: failing }).redaction.redactTransaction(
        ctx,
        transaction.id,
        actor,
      ),
    ).rejects.toBeInstanceOf(RedactionIncompleteError);
    const retried = await redactionService({ storage: working }).redaction.redactTransaction(
      ctx,
      transaction.id,
      actor,
    );

    expect(retried).toEqual({ redactedAt: NOW, alreadyRedacted: true });
    expect(await working.get(file.storageKey)).toBeNull();
  });

  it('audits a first redaction by a principal, with the override, and only the first', async () => {
    const audit = createRecordingAuditLogger();
    const { redaction } = redactionService({ audit });
    const { ctx, transaction } = await subject();
    hooks.redact.mockImplementation(hookOverRecords());

    await redaction.redactTransaction(ctx, transaction.id, actor, { includeNever: true });
    await redaction.redactTransaction(ctx, transaction.id, actor);

    expect(audit.entries).toEqual([
      expect.objectContaining({
        action: 'transaction.redacted',
        resourceType: 'transaction',
        resourceId: transaction.id,
        metadata: { 'include-never': true, 'file-count': 1, 'stubbed-event-count': 0 },
      }),
    ]);
  });

  it('audits a later run that takes the never fields: the override is what P21 asks to record', async () => {
    const audit = createRecordingAuditLogger();
    const { redaction } = redactionService({ audit });
    const { ctx, transaction } = await subject();
    hooks.redact.mockImplementation(hookOverRecords());

    await redaction.redactTransaction(ctx, transaction.id, actor);
    await redaction.redactTransaction(ctx, transaction.id, actor, { includeNever: true });

    expect(audit.entries.map((entry) => entry.metadata?.['include-never'])).toEqual([false, true]);
  });

  it('records no audit entry for a background job', async () => {
    const audit = createRecordingAuditLogger();
    const { redaction } = redactionService({ audit });
    const { ctx, transaction } = await subject();
    hooks.redact.mockImplementation(hookOverRecords());

    await redaction.redactTransaction(ctx, transaction.id, null);

    expect(audit.entries).toEqual([]);
  });
});

describe('the transaction steps of the C16 pass (C105.5)', () => {
  async function due() {
    const { organization, environment } = await createTestTenant(api.database.db);
    await updateEnvironmentSettings(api.database.db, environment.id, {
      'transaction-retention-days': 30,
    });
    const type = await seedTransactionType(api.database.db, environment.id);
    const transaction = await seedTransaction(api.database.db, environment.id, {
      transactionTypeId: type.id,
      transactionTypeVersionId: type.versionId,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
    });
    return { organization, environment, transaction };
  }

  const recording = (redact: RedactionService['redactTransaction']): RedactionService => ({
    redactInquiry: () => Promise.reject(new Error('unused')),
    redactAccount: () => Promise.reject(new Error('unused')),
    redactReport: () => Promise.reject(new Error('unused')),
    redactTransaction: redact,
    redactCase: () => Promise.reject(new Error('unused')),
  });

  it('redacts what is due, as the system, and reports the count', async () => {
    const { organization, environment, transaction } = await due();
    const redactedIds: unknown[][] = [];
    const redact: RedactionService['redactTransaction'] = async (ctx, id, by) => {
      redactedIds.push([ctx, id, by]);
      await redactTransactionRecords(api.database.db, environment.id, id, { at: NOW });
      return { redactedAt: NOW, alreadyRedacted: false };
    };

    const report = await runRetention({
      db: api.database.db,
      storage: createInMemoryFileStorage(),
      redaction: recording(redact),
      clock: fixedClock(NOW),
    });

    expect(redactedIds).toContainEqual([
      { organizationId: organization.id, environmentId: environment.id },
      transaction.id,
      null,
    ]);
    expect(report.redactedTransactions).toBeGreaterThanOrEqual(1);
  });

  it('goes on past one it cannot redact, and the run reads incomplete', async () => {
    const { environment, transaction } = await due();
    const warn = vi.fn();

    const report = await runRetention({
      db: api.database.db,
      storage: createInMemoryFileStorage(),
      redaction: recording(() => Promise.reject(new Error('synthetic failure'))),
      clock: fixedClock(NOW),
      logger: { info: vi.fn(), warn },
    });

    expect(report.failedTransactionRedactions).toBeGreaterThanOrEqual(1);
    expect(isRetentionIncomplete(report)).toBe(true);
    expect(warn).toHaveBeenCalledWith(
      { transactionId: transaction.id, environmentId: environment.id, error: 'Error' },
      'retention could not redact a transaction',
    );
    await redactTransactionRecords(api.database.db, environment.id, transaction.id);
  });

  it('purges the objects a redaction left behind; a file it cannot delete fails the run', async () => {
    const { environment, transaction } = await due();
    const file = await seedTransactionFile(api.database.db, environment.id, {
      transactionId: transaction.id,
    });
    await redactTransactionRecords(api.database.db, environment.id, transaction.id);
    const storage = createInMemoryFileStorage();
    await storage.put(file.storageKey, new Uint8Array([1]));
    const nothing = recording(() => Promise.reject(new Error('unused')));

    const refused = await runRetention({
      db: api.database.db,
      storage: { ...storage, delete: () => Promise.reject(new Error('storage unavailable')) },
      redaction: nothing,
      clock: fixedClock(NOW),
    });
    expect(refused.failedPurges).toBe(1);
    expect(isRetentionIncomplete(refused)).toBe(true);

    const finished = await runRetention({
      db: api.database.db,
      storage,
      redaction: nothing,
      clock: fixedClock(NOW),
    });
    expect(finished.purgedTransactionFiles).toBe(1);
    expect(finished.failedPurges).toBe(0);
    expect(await storage.get(file.storageKey)).toBeNull();
  });
});

describe('the strict filter subjects (C107.4, P03)', () => {
  const env = 'env_01M5CK16P0D13FXHZSS4TCFBVH';
  const transaction = { data: { type: 'transaction', id: 'txn_01M5CK16P0D13FXHZSS4TCFBVH' } };
  const type = { data: { type: 'transaction-type', id: 'txntp_01M5CK16P0D13FXHZSS4TCFBVH' } };

  it('resolves a transaction through its hook and marks it strict', async () => {
    hooks.filters.mockResolvedValueOnce([
      { accountTypeIds: ['acctp_1', 'acctp_2'], inquiryTemplateIds: ['itmpl_1'] },
    ]);

    const subjects = await eventFilterSubjects(api.database.db, env, [transaction]);

    expect(hooks.filters.mock.calls[0]?.slice(1)).toEqual([env, [transaction]]);
    expect(subjects).toEqual([
      { accountTypeIds: ['acctp_1', 'acctp_2'], inquiryTemplateIds: ['itmpl_1'], strict: true },
    ]);
    expect(toEventSubject(subjects[0])).toEqual({
      accountTypeIds: ['acctp_1', 'acctp_2'],
      inquiryTemplateIds: ['itmpl_1'],
      strict: true,
    });
  });

  it('marks a transaction with no link strict: it fails any filter that is present', async () => {
    hooks.filters.mockResolvedValueOnce([{}]);

    expect(await eventFilterSubjects(api.database.db, env, [transaction])).toEqual([
      { strict: true },
    ]);
  });

  it('marks a transaction type strict with nothing to resolve', async () => {
    expect(await eventFilterSubjects(api.database.db, env, [type])).toEqual([{ strict: true }]);
    expect(hooks.filters.mock.calls.length).toBe(0);
  });
});

describe('TransactionProblemError', () => {
  it.each(TRANSACTION_PROBLEM_CODES)('answers %s with its status and code', (code) => {
    const error = new TransactionProblemError(code, 'Synthetic detail.', {
      headers: { 'retry-after': '1' },
      errors: [{ location: 'body', pointer: '/meta', detail: 'synthetic' }],
    });

    expect(error.status).toBe(TRANSACTION_PROBLEM_STATUSES[code]);
    expect(error.code).toBe(code);
    expect(error.title === 'Unprocessable Content').toBe(error.status === 422);
  });
});
