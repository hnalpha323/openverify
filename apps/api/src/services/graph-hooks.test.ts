/**
 * Workflow 7B Stage 1b (G): the graph hooks, each replaced by a spy that reads through the
 * transaction it is given (built by `api-graph` in Stage 3, whose own tests cover what they write).
 *
 * - The indexer (C101.3) at every account field write (`POST /accounts`, `PATCH /accounts/:id`, the
 *   account an inquiry creates with a reference id) and at every link of an inquiry to an account
 *   (`add-objects`, `remove-objects`), in the change's own transaction, so a failure rolls it back.
 * - Consolidation (C101.4) moves the absorbed accounts' rows after their inquiries moved.
 * - The inquiry's and the account's redaction (C101.4, C102.7) run their hooks in the redaction's
 *   transaction.
 * - `blind-index:rebuild` runs `rebuildGraphIndexes` (C101.5); a `graph-query` event's filter
 *   subject is strict (C107.4); `GraphProblemError` answers each code's status; the C16 pass redacts
 *   stored results past `graph-query-retention-days` (C102.7); `graph:reindex` and `graph:benchmark`
 *   parse their flags. Synthetic values.
 */
import { GRAPH_PROBLEM_CODES, GRAPH_PROBLEM_STATUSES } from '@openverify/contracts';
import type { Db } from '@openverify/db';
import {
  createTestTenant,
  openGraphQueryParams,
  seedGraphQuery,
  seedGraphQueryTemplate,
} from '@openverify/db/testing';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { runBlindIndexRebuild } from '../../scripts/blind-index-rebuild.js';
import {
  GraphBenchmarkUsageError,
  parseGraphBenchmarkArgs,
} from '../../scripts/graph-benchmark.js';
import {
  GraphReindexUsageError,
  main as reindex,
  parseGraphReindexArgs,
} from '../../scripts/graph-reindex.js';
import { GraphProblemError } from '../errors.js';
import { createEventPublisher } from '../events/index.js';
import { eventFilterSubjects } from '../events/subject.js';
import type { RedactionService } from '../ports.js';
import { createInMemoryFileStorage } from '../storage/index.js';
import { createRecordingAuditLogger, fixedClock } from '../test-support/fakes.js';
import { bearer, createInquiry, expectStatus } from '../test-support/harness.js';
import { createWebhookDeliveryScheduler } from '../webhooks/queue.js';
import type { GraphConsolidation } from './graph/consolidation.js';
import type { GraphAttributesInput, GraphIndexSource } from './graph/indexing.js';
import { createAccountsService } from './accounts.js';
import { createInquiryTestApi, type InquiryTestApi } from './inquiries.test-support.js';
import { createRedactionService } from './redaction.js';
import { runRetention } from './retention.js';

interface IndexCall {
  environmentId: string;
  accountId: string;
  source: GraphIndexSource;
  attributes: GraphAttributesInput;
  /** The account's reference id and the inquiry's account, as the transaction sees them. */
  referenceInTx: string | null;
  inquiryAccountInTx: string | null;
}

const hooks = vi.hoisted(() => ({
  index: [] as unknown[],
  moves: [] as unknown[],
  redactions: [] as unknown[],
  failIndex: false,
  rebuild: vi.fn(() => Promise.resolve({ scanned: 4, updated: 3 })),
  filters: vi.fn(),
}));

vi.mock('./graph/indexing.js', () => ({
  indexAccountAttributesInTx: async (
    tx: Db,
    environmentId: string,
    accountId: string,
    source: GraphIndexSource,
    attributes: GraphAttributesInput,
  ) => {
    const account = (await tx.execute(
      sql`select reference_id from accounts where id = ${accountId}`,
    )) as { rows: { reference_id: string | null }[] };
    const inquiry =
      source.type === 'inquiry'
        ? ((await tx.execute(sql`select account_id from inquiries where id = ${source.id}`)) as {
            rows: { account_id: string }[];
          })
        : { rows: [] };
    hooks.index.push({
      environmentId,
      accountId,
      source,
      attributes,
      referenceInTx: account.rows[0]?.reference_id ?? null,
      inquiryAccountInTx: inquiry.rows[0]?.account_id ?? null,
    } satisfies IndexCall);
    if (hooks.failIndex) {
      throw new TypeError('synthetic indexer failure');
    }
    return 1;
  },
}));
vi.mock('./graph/consolidation.js', () => ({
  moveGraphOnConsolidationInTx: async (tx: Db, move: GraphConsolidation) => {
    const moved = (await tx.execute(
      sql`select count(*)::int as count from inquiries where account_id = ${move.targetId}`,
    )) as { rows: { count: number }[] };
    hooks.moves.push({ move, inquiriesOnTarget: moved.rows[0]?.count });
    return 0;
  },
}));
vi.mock('./graph/redaction.js', () => ({
  redactInquiryGraphInTx: async (
    tx: Db,
    target: { environmentId: string; inquiryId: string; at: Date },
  ) => {
    const seen = (await tx.execute(
      sql`select redacted_at is not null as redacted from inquiries where id = ${target.inquiryId}`,
    )) as { rows: { redacted: boolean }[] };
    hooks.redactions.push({ kind: 'inquiry', target, redactedInTx: seen.rows[0]?.redacted });
    return { deletedRows: 0, scrubbedQueries: 0 };
  },
  redactAccountGraphInTx: async (
    tx: Db,
    target: { environmentId: string; accountId: string; at: Date },
  ) => {
    const seen = (await tx.execute(
      sql`select redacted_at is not null as redacted from accounts where id = ${target.accountId}`,
    )) as { rows: { redacted: boolean }[] };
    hooks.redactions.push({ kind: 'account', target, redactedInTx: seen.rows[0]?.redacted });
    return { deletedRows: 0, scrubbedQueries: 0 };
  },
}));
vi.mock('./graph/rebuild.js', () => ({ rebuildGraphIndexes: hooks.rebuild }));
vi.mock('./graph/filter-subjects.js', () => ({ resolveGraphQueryFilterSubjects: hooks.filters }));

let api: InquiryTestApi;

beforeAll(async () => {
  api = await createInquiryTestApi();
});

afterAll(async () => {
  await api.close();
});

beforeEach(() => {
  hooks.index.length = 0;
  hooks.moves.length = 0;
  hooks.redactions.length = 0;
  hooks.failIndex = false;
  hooks.filters.mockReset();
});

const NOW = new Date('2026-11-01T00:00:00.000Z');

const call = (method: 'POST' | 'PATCH', url: string, payload: Record<string, unknown>) =>
  api.app.inject({ method, url: `/api/v1${url}`, headers: bearer(api.token), payload });

async function createAccount(attributes: Record<string, unknown> = {}): Promise<string> {
  const response = await call('POST', '/accounts', { data: { attributes } });
  expectStatus(response, 201);
  return response.json<{ data: { id: string } }>().data.id;
}

async function accountOf(inquiryId: string): Promise<string> {
  const { rows } = await api.database.client.query<{ account_id: string }>(
    'select account_id from inquiries where id = $1',
    [inquiryId],
  );
  return rows[0]?.account_id ?? '';
}

const indexCalls = () => hooks.index as IndexCall[];

describe('the indexer at the account field writes (C101.3)', () => {
  it('runs on POST /accounts with the fields and the reference id, in the transaction', async () => {
    const fields = { name_first: 'Synthetic', email_address: 'synthetic@example.com' };

    const id = await createAccount({ 'reference-id': 'synthetic-ref-1', fields });

    expect(indexCalls()).toEqual([
      {
        environmentId: api.environmentId,
        accountId: id,
        source: { type: 'account', id },
        attributes: { kind: 'account-fields', referenceId: 'synthetic-ref-1', fields },
        referenceInTx: 'synthetic-ref-1',
        inquiryAccountInTx: null,
      },
    ]);
  });

  it('runs on PATCH when the fields or the reference id change, with the account’s fields as stored', async () => {
    const id = await createAccount({ fields: { name_first: 'Synthetic' } });
    hooks.index.length = 0;

    expectStatus(
      await call('PATCH', `/accounts/${id}`, {
        data: {
          attributes: { fields: { name_last: 'Example' }, 'reference-id': 'synthetic-ref-2' },
        },
      }),
      200,
    );

    expect(indexCalls()).toEqual([
      expect.objectContaining({
        accountId: id,
        source: { type: 'account', id },
        attributes: {
          kind: 'account-fields',
          referenceId: 'synthetic-ref-2',
          fields: { name_first: 'Synthetic', name_last: 'Example' },
        },
        referenceInTx: 'synthetic-ref-2',
      }),
    ]);
  });

  it('does not run on a status change alone', async () => {
    const id = await createAccount();
    hooks.index.length = 0;

    expectStatus(
      await call('PATCH', `/accounts/${id}`, { data: { attributes: { status: 'archived' } } }),
      200,
    );

    expect(indexCalls()).toEqual([]);
  });

  it('rolls the write back when the indexer fails', async () => {
    hooks.failIndex = true;

    const response = await call('POST', '/accounts', {
      data: { attributes: { 'reference-id': 'synthetic-ref-rolled-back' } },
    });

    expect(response.statusCode).toBe(500);
    const { rows } = await api.database.client.query(
      'select id from accounts where reference_id = $1',
      ['synthetic-ref-rolled-back'],
    );
    expect(rows).toEqual([]);
  });

  it('runs for the account an inquiry creates with a reference id, and not without one', async () => {
    const accounts = createAccountsService({ events: api.deps.events });
    const ctx = { organizationId: api.organizationId, environmentId: api.environmentId };

    const accountId = await api.database.db.transaction((tx) =>
      accounts.resolveForInquiry(tx, ctx, { referenceId: 'synthetic-ref-3' }),
    );
    await api.database.db.transaction((tx) => accounts.resolveForInquiry(tx, ctx, {}));

    expect(indexCalls()).toEqual([
      expect.objectContaining({
        accountId,
        source: { type: 'account', id: accountId },
        attributes: { kind: 'account-fields', referenceId: 'synthetic-ref-3', fields: {} },
        referenceInTx: 'synthetic-ref-3',
      }),
    ]);
  });
});

describe('the indexer when an inquiry is linked to an account (C101.3)', () => {
  it('runs for each inquiry add-objects moves, after it moved', async () => {
    const inquiryId = await createInquiry(api, {});
    const target = await createAccount();
    hooks.index.length = 0;

    expectStatus(
      await call('POST', `/accounts/${target}/add-objects`, {
        meta: { objects: [{ type: 'inquiry', id: inquiryId }] },
      }),
      200,
    );

    expect(indexCalls()).toEqual([
      expect.objectContaining({
        accountId: target,
        source: { type: 'inquiry', id: inquiryId },
        attributes: { kind: 'inquiry-linked' },
        inquiryAccountInTx: target,
      }),
    ]);
  });

  it('runs for each inquiry remove-objects moves to an account of its own', async () => {
    const inquiryId = await createInquiry(api, {});
    const home = await accountOf(inquiryId);
    hooks.index.length = 0;

    expectStatus(
      await call('POST', `/accounts/${home}/remove-objects`, {
        meta: { objects: [{ type: 'inquiry', id: inquiryId }] },
      }),
      200,
    );

    const fresh = await accountOf(inquiryId);
    expect(fresh).not.toBe(home);
    expect(indexCalls()).toEqual([
      expect.objectContaining({
        accountId: fresh,
        source: { type: 'inquiry', id: inquiryId },
        attributes: { kind: 'inquiry-linked' },
        inquiryAccountInTx: fresh,
      }),
    ]);
  });
});

describe('consolidation moves the graph rows (C101.4)', () => {
  it('after the inquiries moved, under the consolidation’s locks', async () => {
    const inquiryId = await createInquiry(api, {});
    const source = await accountOf(inquiryId);
    const target = await createAccount();

    expectStatus(
      await call('POST', `/accounts/${target}/consolidate`, {
        meta: { 'source-account-ids': [source] },
      }),
      200,
    );

    expect(hooks.moves).toEqual([
      {
        move: { environmentId: api.environmentId, targetId: target, sourceIds: [source] },
        inquiriesOnTarget: 1,
      },
    ]);
  });
});

function redactionService() {
  const events = createEventPublisher({
    db: api.database.db,
    deliveries: createWebhookDeliveryScheduler({
      add: () => Promise.resolve(),
      close: () => Promise.resolve(),
    }),
  });
  return createRedactionService({
    db: api.database.db,
    storage: createInMemoryFileStorage(),
    events,
    clock: fixedClock(NOW),
    audit: createRecordingAuditLogger(),
  });
}

describe('the redaction hooks (C101.4, C102.7)', () => {
  const ctx = () => ({ organizationId: api.organizationId, environmentId: api.environmentId });

  it('runs the inquiry’s hook in its redaction’s transaction', async () => {
    const inquiryId = await createInquiry(api, {});

    await redactionService().redactInquiry(ctx(), inquiryId, null);

    expect(hooks.redactions).toEqual([
      {
        kind: 'inquiry',
        target: { environmentId: api.environmentId, inquiryId, at: NOW },
        redactedInTx: true,
      },
    ]);
  });

  it('runs the account’s hook after its inquiries’, in the account’s transaction', async () => {
    const inquiryId = await createInquiry(api, {});
    const accountId = await accountOf(inquiryId);

    await redactionService().redactAccount(ctx(), accountId, null);

    expect(hooks.redactions).toEqual([
      expect.objectContaining({ kind: 'inquiry', redactedInTx: true }),
      {
        kind: 'account',
        target: { environmentId: api.environmentId, accountId, at: NOW },
        redactedInTx: true,
      },
    ]);
  });
});

describe('blind-index:rebuild and the graph (C101.5)', () => {
  it('runs rebuildGraphIndexes and prints counts only', async () => {
    const lines: string[] = [];

    const result = await runBlindIndexRebuild({
      db: api.database.db,
      key: new Uint8Array(32).fill(5),
      args: { batchSize: 8 },
      out: (line) => lines.push(line),
    });

    expect(hooks.rebuild.mock.lastCall?.slice(1)).toEqual([
      new Uint8Array(32).fill(5),
      { batchSize: 8 },
    ]);
    expect(result.graph).toEqual({ scanned: 4, updated: 3 });
    expect(lines).toContain('blind-index:rebuild: done: scanned 4 graph rows, re-indexed 3.');
  });
});

describe('the graph-query filter subject (C107.4)', () => {
  it('is strict: a graph query fails any filter that is present', async () => {
    hooks.filters.mockResolvedValue([{}]);
    const payload = {
      data: { type: 'graph-query', id: 'grphq_01M5CK16P0D13FXHZSS4TCFBVH', attributes: {} },
    };

    const [subject] = await eventFilterSubjects(api.database.db, api.environmentId, [payload]);

    expect(subject).toEqual({ strict: true });
    expect(hooks.filters).toHaveBeenCalledWith(api.database.db, api.environmentId, [payload]);
  });
});

describe('GraphProblemError (C102, C103)', () => {
  it.each(GRAPH_PROBLEM_CODES)('answers %s with its status', (code) => {
    const error = new GraphProblemError(code, 'synthetic detail');
    expect(error.status).toBe(GRAPH_PROBLEM_STATUSES[code]);
    expect(error.code).toBe(code);
  });
});

describe('the C16 pass and the stored graph results (C102.7)', () => {
  const noRedaction: RedactionService = {
    redactInquiry: () => Promise.reject(new Error('unused')),
    redactAccount: () => Promise.reject(new Error('unused')),
    redactReport: () => Promise.reject(new Error('unused')),
    redactTransaction: () => Promise.reject(new Error('unused')),
    redactCase: () => Promise.reject(new Error('unused')),
  };

  it('redacts the results past graph-query-retention-days (30 by default) and reports the count', async () => {
    const { environment } = await createTestTenant(api.database.db);
    const template = await seedGraphQueryTemplate(api.database.db, environment.id);
    const seed = (createdAt: Date) =>
      seedGraphQuery(api.database.db, environment.id, {
        graphQueryTemplateId: template.id,
        graphQueryTemplateVersionId: template.versionId,
        createdAt,
      });
    const old = await seed(new Date('2026-09-01T00:00:00.000Z'));
    const recent = await seed(new Date('2026-10-25T00:00:00.000Z'));

    const report = await runRetention({
      db: api.database.db,
      storage: createInMemoryFileStorage(),
      redaction: noRedaction,
      clock: fixedClock(NOW),
    });

    expect(report.redactedGraphQueries).toBeGreaterThanOrEqual(1);
    expect(await openGraphQueryParams(api.database.db, environment.id, old.id)).toBeNull();
    expect(await openGraphQueryParams(api.database.db, environment.id, recent.id)).toEqual({
      email: 'synthetic@example.com',
    });
  });
});

describe('graph:reindex and graph:benchmark (C101.5, C101.8)', () => {
  it('parses one environment and a batch size, and refuses anything else', () => {
    expect(parseGraphReindexArgs([])).toEqual({ batchSize: 500 });
    expect(
      parseGraphReindexArgs(['--environment', 'env_01M5CK16P0D13FXHZSS4TCFBVH', '--batch-size=7']),
    ).toEqual({ environmentId: 'env_01M5CK16P0D13FXHZSS4TCFBVH', batchSize: 7 });
    expect(() => parseGraphReindexArgs(['--environment=acc_x'])).toThrow(GraphReindexUsageError);
    expect(() => parseGraphReindexArgs(['--batch-size=0'])).toThrow(GraphReindexUsageError);
    expect(() => parseGraphReindexArgs(['--all'])).toThrow(GraphReindexUsageError);
  });

  it('names a missing database without echoing a value', async () => {
    await expect(reindex([], { DATABASE_URL: 'mysql://nope' })).rejects.toThrow(
      'DATABASE_URL: must be a postgres:// URL',
    );
  });

  it('parses the benchmark’s size, runs, seed and database, and refuses anything else', () => {
    expect(parseGraphBenchmarkArgs([])).toEqual({
      accounts: 1_000_000,
      runs: 50,
      seed: 'graph-benchmark-1',
    });
    expect(
      parseGraphBenchmarkArgs([
        '--accounts=100000',
        '--runs',
        '5',
        '--seed=ci',
        '--database-url=postgres://localhost/scratch',
      ]),
    ).toEqual({
      accounts: 100_000,
      runs: 5,
      seed: 'ci',
      databaseUrl: 'postgres://localhost/scratch',
    });
    for (const argv of [['--accounts=10'], ['--runs=0'], ['--database-url=mysql://x'], ['--all']]) {
      expect(() => parseGraphBenchmarkArgs(argv)).toThrow(GraphBenchmarkUsageError);
    }
  });
});
