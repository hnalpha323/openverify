/**
 * C73.5 (F04): the shared redaction service calls the report redaction hooks of `api-reports`
 * (`services/reports/redaction.ts`): inside an inquiry's redaction transaction, inside an
 * account's and once more after it for the reports linked while it ran, and for one report
 * (`redactReport`, which the retention run and `DELETE /reports/:id` use). The events a hook
 * stages are dispatched after the commit. The hooks are replaced by recording fakes here; their
 * own behaviour is `api-reports`' to test. Synthetic values only.
 */
import { createAccount, type Db } from '@openverify/db';
import {
  createTestDatabase,
  createTestInquiry,
  createTestTenant,
  testId,
  type TestDatabase,
} from '@openverify/db/testing';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { NotFoundError } from '../errors.js';
import type { StagedEvent } from '../events/index.js';
import { createInMemoryFileStorage } from '../storage/index.js';
import {
  createRecordingAuditLogger,
  createRecordingEventPublisher,
  fixedClock,
  type RecordingAuditLogger,
  type RecordingEventPublisher,
} from '../test-support/fakes.js';
import type { PublishEventInput } from '../ports.js';
import type { ReportHookDeps } from './reports/hooks.js';
import { createRedactionService } from './redaction.js';

interface HookInput {
  environmentId: string;
  at: Date;
}

const hooks = vi.hoisted(() => ({
  inquiry: vi.fn(),
  account: vi.fn(),
  report: vi.fn(),
}));

vi.mock('./reports/redaction.js', () => ({
  redactInquiryReportsInTx: hooks.inquiry,
  redactAccountReportsInTx: hooks.account,
  redactReportInTx: hooks.report,
}));

let database: TestDatabase;
let events: RecordingEventPublisher;
let audit: RecordingAuditLogger;
const clock = fixedClock(new Date('2026-10-27T12:00:00.000Z'));

beforeAll(async () => {
  database = await createTestDatabase();
}, 60_000);

afterAll(async () => {
  await database.close();
});

/** A hook that stages one `report/watchlist.redacted` with the deps it was given. */
function stagingHook() {
  return async (tx: Db, deps: ReportHookDeps, input: HookInput): Promise<StagedEvent[]> => [
    await deps.events.stage(tx, {
      environmentId: input.environmentId,
      name: 'report/watchlist.redacted',
      // The recording publisher stores payloads as given; the shape is the hook's to get right.
      payload: {
        data: { type: 'report/watchlist', id: testId('rep'), attributes: {} },
      } as unknown as PublishEventInput['payload'],
    }),
  ];
}

beforeEach(() => {
  events = createRecordingEventPublisher();
  audit = createRecordingAuditLogger();
  hooks.inquiry.mockReset().mockImplementation(stagingHook());
  hooks.account.mockReset().mockImplementation(stagingHook());
  hooks.report.mockReset();
});

function service() {
  return createRedactionService({
    db: database.db,
    storage: createInMemoryFileStorage(),
    events,
    clock,
    audit,
  });
}

async function tenant() {
  const { organization, environment } = await createTestTenant(database.db);
  return { organizationId: organization.id, environmentId: environment.id };
}

const actor = { type: 'api-key', id: testId('key') } as const;

describe('C73.5: the redaction service calls the report hooks', () => {
  it("redacts an inquiry's reports in the inquiry's transaction and dispatches their events", async () => {
    const ctx = await tenant();
    const { inquiry } = await createTestInquiry(database.db, ctx.environmentId);

    await service().redactInquiry(ctx, inquiry.id, actor);

    expect(hooks.inquiry).toHaveBeenCalledTimes(1);
    expect(hooks.inquiry.mock.calls[0]?.[2]).toEqual({
      environmentId: ctx.environmentId,
      inquiryId: inquiry.id,
      at: clock.now(),
      // Owner decision 12: a cascade redacts as the system, whoever redacted the inquiry.
      actor: { actorType: 'system', actorId: null },
    });
    expect(events.named('report/watchlist.redacted')).toHaveLength(1);
  });

  it("redacts an account's reports in its transaction, then catches up on those linked meanwhile", async () => {
    const ctx = await tenant();
    const account = await createAccount(database.db, ctx.environmentId, { id: testId('acc') });

    await service().redactAccount(ctx, account.id, actor);

    expect(hooks.account).toHaveBeenCalledTimes(2);
    for (const call of hooks.account.mock.calls) {
      expect(call[2]).toEqual({
        environmentId: ctx.environmentId,
        accountId: account.id,
        at: clock.now(),
        actor: { actorType: 'system', actorId: null },
      });
    }
    expect(events.named('report/watchlist.redacted')).toHaveLength(2);
  });

  it('redacts one report, dispatches its event and audits it with counts', async () => {
    const ctx = await tenant();
    const reportId = testId('rep');
    hooks.report.mockImplementation(async (tx: Db, deps: ReportHookDeps, env: string) => ({
      alreadyRedacted: false,
      redactedAt: clock.now(),
      staged: await stagingHook()(tx, deps, { environmentId: env, at: clock.now() }),
      counts: { matches: 2, actions: 1 },
    }));

    const result = await service().redactReport(ctx, reportId, actor);

    expect(result).toEqual({ redactedAt: clock.now(), alreadyRedacted: false });
    expect(hooks.report.mock.calls[0]?.slice(2)).toEqual([
      ctx.environmentId,
      reportId,
      { at: clock.now(), actor: { actorType: 'api_key', actorId: actor.id } },
    ]);
    expect(events.named('report/watchlist.redacted')).toHaveLength(1);
    expect(audit.entries).toEqual([
      expect.objectContaining({
        action: 'report.redacted',
        resourceType: 'report',
        resourceId: reportId,
        metadata: { 'match-count': 2, 'action-count': 1 },
      }),
    ]);
  });

  it('names the run that redacts a report, never the system or an API key (C121.1)', async () => {
    const ctx = await tenant();
    const reportId = testId('rep');
    const run = testId('wfr');
    hooks.report.mockResolvedValueOnce({
      alreadyRedacted: false,
      redactedAt: clock.now(),
      staged: [],
      counts: { matches: 0, actions: 0 },
    });

    await service().redactReport(ctx, reportId, { type: 'workflow-run', id: run });

    expect(hooks.report.mock.calls.at(-1)?.slice(2)).toEqual([
      ctx.environmentId,
      reportId,
      { at: clock.now(), actor: { actorType: 'workflow_run', actorId: run } },
    ]);
  });

  it('records nothing again for a report already redacted, and answers 404 for an unknown one', async () => {
    const ctx = await tenant();
    const earlier = new Date('2026-10-01T00:00:00.000Z');
    hooks.report.mockResolvedValueOnce({
      alreadyRedacted: true,
      redactedAt: earlier,
      staged: [],
      counts: { matches: 0, actions: 0 },
    });

    expect(await service().redactReport(ctx, testId('rep'), null)).toEqual({
      redactedAt: earlier,
      alreadyRedacted: true,
    });
    expect(audit.entries).toEqual([]);
    // Retention redacts without an actor: the report's `redact` action names the system.
    expect(hooks.report.mock.calls[0]?.[4]).toEqual({
      at: clock.now(),
      actor: { actorType: 'system', actorId: null },
    });

    hooks.report.mockResolvedValueOnce(null);
    await expect(service().redactReport(ctx, testId('rep'), actor)).rejects.toThrow(NotFoundError);
  });
});
