/**
 * C72.1, C73.7, C74.2, C74.5 (Workflow 6A Stage 3, `api-reports`): the report service behind
 * `routes/server/reports.ts` and the console routes: creation with its links (the C72.2 linking
 * scopes are the route's, checked before any lookup), reads, lists, tags, history, and the
 * monitoring actions (pause, resume, run). Every change of a redacted report answers 410
 * `report_redacted` (H23).
 *
 * Lock order (C73.7): the linked account (share-locked through `lockAbsorbingAccount`, so a
 * consolidation in flight is waited for), then the linked inquiry (`FOR UPDATE`, re-checking
 * `redacted_at`), then the report. A run is enqueued after the transaction that created it
 * commits; a lost enqueue is the sweep's to recover (C74.3 (a)).
 */
import {
  filterValues,
  idSchema,
  reportResourceTypeSchema,
  resolveReportTemplateConfig,
  tagInputSchema,
  type CreateReportBody,
  type ReportActionResource,
  type ReportResource,
  type ReportRunResource,
} from '@openverify/contracts';
import {
  fromReportResourceType,
  REPORT_REGISTRY,
  reportStatusSchema,
  type ReportOrigin,
  type ReportRunNote,
  type ReportType,
} from '@openverify/core';
import {
  applyReportTagOperation,
  countRecurringReports,
  createAccount,
  createReport as insertReport,
  DB_WATCHLIST_READS,
  getAccountType,
  getInquiry,
  getReport as findReport,
  getReportTemplate,
  getReportTemplateVersion,
  insertReportAction,
  insertReportRun,
  listReportActions,
  listReportMatches,
  listReportRuns,
  listReports,
  lockAbsorbingAccount,
  lockInquiry,
  lockRecurringReportCaps,
  reportRuns,
  scheduledMediaRunsPerDay,
  TagLimitError,
  updateReportState,
  type Account,
  type Db,
  type ReportRunRow,
  type StoredReport,
  type StoredReportMatch,
  type TagOperation,
  type WatchlistReads,
} from '@openverify/db';
import { and, desc, eq, isNotNull } from 'drizzle-orm';
import {
  BadRequestError,
  NotFoundError,
  RateLimitedError,
  RedactedError,
  ListProblemError,
  ReportProblemError,
  UnprocessableContentError,
} from '../../errors.js';
import type { StagedEvent } from '../../events/index.js';
import { rateLimitRules } from '../../plugins/rate-limit.js';
import { customListListProblems } from '../lists/report-view.js';
import { storedActorOf } from '../audit-log.js';
import { auditEntryOf, type ApiDependencies } from '../context.js';
import type { Acting } from '../inquiries.js';
import { accountResource } from '../accounts.js';
import { nextLink, pageRequest, withCursor, type PageQuery } from '../pagination.js';
import {
  reportActionResource,
  reportResource,
  reportRunResource,
  type ReportView,
} from './resources.js';
import { resolveTransactionRelationships } from '../transactions/relationships.js';

export const REPORTS_PATH = '/api/v1/reports';

/** The watchlist reads the services use (`api-watchlists`' repository); tests replace them. */
let watchlistReads: WatchlistReads = DB_WATCHLIST_READS;

/** Replaces the watchlist reads (tests only); returns a function that restores them. */
export function useWatchlistReads(reads: WatchlistReads): () => void {
  const previous = watchlistReads;
  watchlistReads = reads;
  return () => {
    watchlistReads = previous;
  };
}

/** The watchlist reads in use. */
export function currentWatchlistReads(): WatchlistReads {
  return watchlistReads;
}

// Reads -------------------------------------------------------------------------------------

/** The report type of a `report/<type>` resource type the schemas already checked. */
function reportTypeOf(resourceType: string): ReportType {
  const type = fromReportResourceType(resourceType);
  if (type === null) {
    throw new BadRequestError(`${resourceType} is not a report type.`);
  }
  return type;
}

/** The report with what its resource needs (matches for the types with review, its runs). */
export async function reportViewOf(db: Db, report: StoredReport): Promise<ReportView> {
  const reviewed = REPORT_REGISTRY[report.reportType].review === 'matches';
  const matches: StoredReportMatch[] = reviewed
    ? await listReportMatches(db, report.environmentId, report.id)
    : [];
  const runs: ReportRunRow[] = matches.some((match) => match.status === 'dismissed')
    ? await listReportRuns(db, report.environmentId, report.id)
    : [];
  // C105.7 (Workflow 7B): every report read and event goes through this view.
  const transactions = await resolveTransactionRelationships(db, report.environmentId, [report.id]);
  // C173.1 (Workflow 9B, api-cases-reports): the latest finished run's notes.
  const latestRunNotes = await latestFinishedRunNotes(db, report.environmentId, report.id);
  return {
    report,
    matches,
    runs,
    transactionId: transactions.get(report.id),
    ...(latestRunNotes === null ? {} : { latestRunNotes }),
  };
}

/**
 * C173.1 (Workflow 9B, `api-cases-reports`; K15): the note codes of the report's latest finished run
 * (`completed_at` set: `ready` or `errored`), newest by its creation; `null` while none finished. A
 * run still pending or running has written no notes, so it never hides the finished one.
 */
async function latestFinishedRunNotes(
  db: Db,
  environmentId: string,
  reportId: string,
): Promise<ReportRunNote[] | null> {
  const [latest] = await db
    .select({ notes: reportRuns.notes })
    .from(reportRuns)
    .where(
      and(
        eq(reportRuns.environmentId, environmentId),
        eq(reportRuns.reportId, reportId),
        isNotNull(reportRuns.completedAt),
      ),
    )
    .orderBy(desc(reportRuns.createdAt), desc(reportRuns.id))
    .limit(1);
  return latest === undefined ? null : (latest.notes as ReportRunNote[]);
}

/**
 * The report resource as `mask` lets its caller see it, from one snapshot: the report is read
 * again with its matches and runs in a read-only repeatable-read transaction. A run that commits
 * between a read of the report row and a read of its matches would otherwise leave `has-match`
 * disagreeing with the matches, which the response schema refuses (a poll during completion
 * answered 500 in the full validation's e2e after Workflow 6B).
 */
export async function reportResourceOf(
  db: Db,
  report: StoredReport,
  mask: Acting['mask'],
): Promise<ReportResource> {
  const view = await db.transaction(
    async (tx) =>
      reportViewOf(tx, (await findReport(tx, report.environmentId, report.id)) ?? report),
    { isolationLevel: 'repeatable read', accessMode: 'read only' },
  );
  return reportResource(view, mask);
}

/** @throws {NotFoundError} when the report is not in this environment. */
export async function findStoredReport(
  db: Db,
  environmentId: string,
  id: string,
  lock?: 'update' | 'share',
): Promise<StoredReport> {
  const report = await findReport(db, environmentId, id, { lock });
  if (report === null) {
    throw new NotFoundError(`Report ${id} was not found.`);
  }
  return report;
}

/** @throws {ReportProblemError} 410 `report_redacted` once the report is redacted (H23). */
export function assertNotRedacted(report: Pick<StoredReport, 'id' | 'redactedAt'>): void {
  if (report.redactedAt !== null) {
    throw new ReportProblemError('report_redacted', `Report ${report.id} was redacted.`);
  }
}

/** `GET /reports/:id`. */
export async function getReportResource(
  deps: Pick<ApiDependencies, 'db'>,
  environmentId: string,
  id: string,
  mask: Acting['mask'],
): Promise<ReportResource> {
  return reportResourceOf(deps.db, await findStoredReport(deps.db, environmentId, id), mask);
}

/**
 * `DELETE /reports/:id` (C73.5, `reports:redact`): the shared redaction service's `redactReport`
 * (its own transaction, the audit entry with counts, the events dispatched after commit), then
 * the redacted report. Idempotent: a second call changes nothing.
 * @throws {NotFoundError} when the report is not in this environment.
 */
export async function redactReportResource(
  deps: ApiDependencies,
  acting: Acting,
  id: string,
): Promise<ReportResource> {
  await deps.redaction.redactReport(acting.ctx, id, acting.actor);
  return getReportResource(deps, acting.ctx.environmentId, id, acting.mask);
}

export interface ListReportsQuery extends PageQuery {
  'filter[report-template-id]'?: string | undefined;
  'filter[status]'?: string | undefined;
  'filter[has-match]'?: 'true' | 'false' | undefined;
  'filter[account-id]'?: string | undefined;
  'filter[inquiry-id]'?: string | undefined;
  'filter[reference-id]'?: string | undefined;
  'filter[tag]'?: string | undefined;
  'filter[type]'?: string | undefined;
}

/** `GET /reports` (C72.1), newest first. `filter[has-match]=false` lists `ready` reports only. */
export async function listReportResources(
  deps: Pick<ApiDependencies, 'db'>,
  environmentId: string,
  query: ListReportsQuery,
  mask: Acting['mask'],
  path: string = REPORTS_PATH,
): Promise<{ data: ReportResource[]; links: { next: string | null } }> {
  const types = filterValues(query['filter[type]'], reportResourceTypeSchema)?.map(reportTypeOf);
  const page = await withCursor(() =>
    listReports(deps.db, environmentId, {
      ...pageRequest(query),
      reportTemplateId: filterValues(query['filter[report-template-id]'], idSchema('rptp')),
      status: filterValues(query['filter[status]'], reportStatusSchema),
      hasMatch:
        query['filter[has-match]'] === undefined
          ? undefined
          : query['filter[has-match]'] === 'true',
      accountId: filterValues(query['filter[account-id]'], idSchema('acc')),
      inquiryId: filterValues(query['filter[inquiry-id]'], idSchema('inq')),
      referenceId: query['filter[reference-id]'],
      tag: filterValues(query['filter[tag]'], tagInputSchema),
      reportType: types,
    }),
  );
  const data: ReportResource[] = [];
  for (const report of page.items) {
    data.push(await reportResourceOf(deps.db, report, mask));
  }
  const filters = Object.fromEntries(
    Object.entries(query).filter(([key]) => key.startsWith('filter[')),
  ) as Record<string, string | undefined>;
  return { data, links: { next: nextLink(path, filters, query, page.next) } };
}

/** The console's report list path (C72.3). */
export const DASHBOARD_REPORTS_PATH = '/api/v1/dashboard/reports';

/**
 * `GET /dashboard/reports/:id` (C72.3): the report masked for the operator, with every run and
 * action in `included`, newest first.
 * @throws {NotFoundError} when the report is not in this environment.
 */
export async function dashboardReportDocument(
  deps: Pick<ApiDependencies, 'db'>,
  environmentId: string,
  id: string,
  mask: Acting['mask'],
): Promise<{ data: ReportResource; included: (ReportRunResource | ReportActionResource)[] }> {
  const report = await findStoredReport(deps.db, environmentId, id);
  const runs = await listReportRuns(deps.db, environmentId, id);
  const actions = await listReportActions(deps.db, environmentId, id);
  const entries = [
    ...runs.map((run) => ({
      id: run.id,
      at: run.createdAt,
      resource: reportRunResource(report, run),
    })),
    ...actions.map((action) => ({
      id: action.id,
      at: action.createdAt,
      resource: reportActionResource(report, action, mask),
    })),
  ].sort((a, b) => b.at.getTime() - a.at.getTime() || (ulidOf(a.id) < ulidOf(b.id) ? 1 : -1));
  return {
    data: await reportResourceOf(deps.db, report, mask),
    included: entries.map((entry) => entry.resource),
  };
}

export interface ReportHistoryQuery {
  'page[after]'?: string | undefined;
  'page[size]'?: number | undefined;
}

/** The time-ordered part of an id (`rpr_` and `ract_` ids sort by it, not by prefix). */
const ulidOf = (id: string): string => id.slice(id.indexOf('_') + 1);

/** `GET /reports/:id/history` (C74.2): runs and actions merged, newest first. */
export async function reportHistory(
  deps: Pick<ApiDependencies, 'db'>,
  environmentId: string,
  id: string,
  query: ReportHistoryQuery,
  mask: Acting['mask'],
): Promise<{ data: (ReportRunResource | ReportActionResource)[]; links: { next: string | null } }> {
  const report = await findStoredReport(deps.db, environmentId, id);
  const runs = await listReportRuns(deps.db, environmentId, id);
  const actions = await listReportActions(deps.db, environmentId, id);
  const entries = [
    ...runs.map((run) => ({
      id: run.id,
      at: run.createdAt,
      build: () => reportRunResource(report, run),
    })),
    ...actions.map((action) => ({
      id: action.id,
      at: action.createdAt,
      build: () => reportActionResource(report, action, mask),
    })),
  ].sort((a, b) => b.at.getTime() - a.at.getTime() || (ulidOf(a.id) < ulidOf(b.id) ? 1 : -1));
  const size = query['page[size]'] ?? 10;
  const after = query['page[after]'];
  let start = 0;
  if (after !== undefined) {
    const index = entries.findIndex((entry) => entry.id === after);
    if (index < 0) {
      throw new BadRequestError('page[after] does not name a run or action of this report.');
    }
    start = index + 1;
  }
  const page = entries.slice(start, start + size);
  const more = entries.length > start + size;
  const last = page.at(-1);
  return {
    data: page.map((entry) => entry.build()),
    links: {
      next:
        more && last !== undefined
          ? nextLink(`${REPORTS_PATH}/${id}/history`, {}, query, last.id)
          : null,
    },
  };
}

// Limits ------------------------------------------------------------------------------------

/**
 * C72.5 (P09): the `reports` policy, keyed by environment: creations and `run` calls per minute.
 * The limiter failing open, as C12 does.
 * @throws {RateLimitedError} 429 with `Retry-After` beyond the limit.
 */
export async function consumeReportRate(
  deps: Pick<ApiDependencies, 'rateLimiter' | 'reportLimits'>,
  environmentId: string,
): Promise<void> {
  const rule = rateLimitRules({ reports: deps.reportLimits.perMinute }).reports;
  let decision;
  try {
    decision = await deps.rateLimiter.consume(`reports:${environmentId}`, rule);
  } catch {
    return;
  }
  if (!decision.allowed) {
    throw new RateLimitedError(
      'This environment created or ran too many reports; retry later.',
      decision.retryAfterSeconds,
    );
  }
}

const MEDIA_TYPES: readonly ReportType[] = ['adverse-media', 'business-adverse-media'];

/**
 * C72.5: whether one more recurring report of `type` every `intervalDays` fits the environment's
 * caps: the recurring reports, and for media the scheduled media runs per day (V09).
 */
export async function recurringCapReached(
  db: Db,
  limits: ApiDependencies['reportLimits'],
  environmentId: string,
  type: ReportType,
  intervalDays: number,
): Promise<boolean> {
  if ((await countRecurringReports(db, environmentId)) >= limits.maxRecurringPerEnvironment) {
    return true;
  }
  if (MEDIA_TYPES.includes(type)) {
    const perDay = await scheduledMediaRunsPerDay(db, environmentId);
    return perDay + 1 / intervalDays > limits.maxMediaRunsPerDay;
  }
  return false;
}

// Creation ----------------------------------------------------------------------------------

/** The `report-run` job of a run, enqueued after commit; a failure is the sweep's to recover. */
export async function enqueueRun(
  deps: Pick<ApiDependencies, 'reportRuns'>,
  environmentId: string,
  reportId: string,
  runId: string,
): Promise<void> {
  try {
    await deps.reportRuns.enqueueReportRun({ environmentId, reportId, runId });
  } catch {
    // C74.3 (a): the run is claimable, so the next sweep enqueues it.
  }
}

/** The account a new report links (C72.1): the given one, the reference id's, or a new one. */
async function linkedAccount(
  tx: Db,
  deps: ApiDependencies,
  acting: Acting,
  body: CreateReportBody,
  staged: StagedEvent[],
): Promise<Account | null> {
  const { environmentId } = acting.ctx;
  const accountId = body.data.attributes['account-id'];
  const meta = body.meta ?? {};
  const referenceId = meta['auto-create-account-reference-id'];
  const checked = (account: Account | null, what: string): Account => {
    if (account === null) {
      throw new NotFoundError(`${what} was not found.`);
    }
    if (account.redactedAt !== null) {
      throw new RedactedError(`Account ${account.id} was redacted.`);
    }
    return account;
  };
  if (accountId !== undefined) {
    return checked(
      await lockAbsorbingAccount(tx, environmentId, { id: accountId }),
      `Account ${accountId}`,
    );
  }
  if (referenceId !== undefined) {
    const existing = await lockAbsorbingAccount(tx, environmentId, { referenceId });
    if (existing !== null) {
      return checked(existing, 'The account');
    }
  }
  if (meta['auto-create-account'] === false) {
    return null;
  }
  const typeId = meta['auto-create-account-type-id'];
  if (typeId === undefined) {
    const id = await deps.accounts.resolveForInquiry(
      tx,
      acting.ctx,
      referenceId === undefined ? {} : { referenceId },
      staged,
    );
    return checked(await lockAbsorbingAccount(tx, environmentId, { id }), `Account ${id}`);
  }
  if ((await getAccountType(tx, environmentId, typeId)) === null) {
    throw new NotFoundError(`Account type ${typeId} was not found.`);
  }
  const account = await createAccount(tx, environmentId, {
    id: deps.ids.newId('acc'),
    accountTypeId: typeId,
    referenceId: referenceId ?? null,
  });
  staged.push(
    await deps.events.stage(tx, {
      environmentId,
      name: 'account.created',
      payload: { data: accountResource({ account, inquiryIds: [] }) },
    }),
  );
  return account;
}

/**
 * The interval's first boundary after `now`, counted from `from` (C74.3 (b)): `from` itself when
 * it is still ahead (a resume before the next run is due, R005), else the first `from + k`
 * intervals after now, `k >= 1`, so the schedule does not drift.
 */
export function nextBoundary(from: Date, intervalDays: number, now: Date): Date {
  if (from.getTime() > now.getTime()) {
    return from;
  }
  const step = intervalDays * 86_400_000;
  const passed = Math.floor((now.getTime() - from.getTime()) / step) + 1;
  return new Date(from.getTime() + passed * step);
}

/**
 * `POST /reports` (C72.1): pins the template's published version, links the account and the
 * inquiry under the C73.7 order, creates the report `pending` with its `initial` run, and enqueues
 * it after commit. The caller checked the scopes and validated the body.
 * @throws {ReportProblemError} 422 `report_template_not_published`, `report_type_mismatch`,
 *   `report_recurring_limit`.
 * @throws {RedactedError} 410 when the linked inquiry or account is redacted.
 * @throws {NotFoundError} for an unknown inquiry, account or account type.
 */
export async function createReportResource(
  deps: ApiDependencies,
  acting: Acting,
  body: CreateReportBody,
  origin: 'api' | 'dashboard' = 'api',
): Promise<StoredReport> {
  const { db } = deps;
  const { environmentId } = acting.ctx;
  const plan = await planReport(db, environmentId, body);
  await consumeReportRate(deps, environmentId);
  const staged: StagedEvent[] = [];
  const report = await db.transaction((tx) =>
    insertPlannedReportInTx(tx, deps, acting, body, origin, plan, staged),
  );
  await deps.events.dispatch(staged);
  const [run] = await listReportRuns(db, environmentId, report.id);
  if (run !== undefined) {
    await enqueueRun(deps, environmentId, report.id, run.id);
  }
  return report;
}

/**
 * {@link createReportResource} in the caller's transaction, for `run_report` with `origin: workflow`
 * (C127.2). It takes no `reports` token, and the caller dispatches `staged` after the commit, which
 * is also when it enqueues the initial run (`enqueueRun`).
 */
export async function createReportInTx(
  tx: Db,
  deps: ApiDependencies,
  acting: Acting,
  body: CreateReportBody,
  origin: ReportOrigin,
  staged: StagedEvent[],
): Promise<StoredReport> {
  const plan = await planReport(tx, acting.ctx.environmentId, body);
  return insertPlannedReportInTx(tx, deps, acting, body, origin, plan, staged);
}

interface ReportPlan {
  type: ReportType;
  template: NonNullable<Awaited<ReturnType<typeof getReportTemplate>>>;
  recurrence: number | null;
}

/** What a creation checks before it writes anything. */
async function planReport(
  db: Db,
  environmentId: string,
  body: CreateReportBody,
): Promise<ReportPlan> {
  const type = reportTypeOf(body.data.type);
  const attributes = body.data.attributes;
  const template = await getReportTemplate(db, environmentId, attributes['report-template-id']);
  if (template?.status !== 'active') {
    throw new ReportProblemError(
      'report_template_not_published',
      'The report template is unknown, archived or has no published version.',
      {
        errors: [
          {
            location: 'body',
            pointer: '/data/attributes/report-template-id',
            detail: 'must name an active report template with a published version',
          },
        ],
      },
    );
  }
  if (template.reportType !== type) {
    throw new ReportProblemError(
      'report_type_mismatch',
      `The report template is a ${template.reportType} template, not ${type}.`,
      {
        errors: [
          {
            location: 'body',
            pointer: '/data/type',
            detail: `must be report/${template.reportType} for this template`,
          },
        ],
      },
    );
  }
  const config = resolveReportTemplateConfig(type, template.currentVersion.config);
  if (type === 'custom-list') {
    // C106.2: a list on the query, or pinned on the template.
    const problems = await customListListProblems(db, environmentId, {
      pinned: config['list-ids'] as readonly string[] | null,
      asked: (attributes.query as { 'list-ids'?: readonly string[] })['list-ids'],
    });
    const [first] = problems;
    if (first !== undefined) {
      throw new ListProblemError(first.code, first.detail, {
        errors: problems.map(({ pointer, detail }) => ({ location: 'body', pointer, detail })),
      });
    }
  }
  const interval = config['recurrence-interval-days'];
  return { type, template, recurrence: typeof interval === 'number' ? interval : null };
}

/** The report's rows, under the caps' lock. */
async function insertPlannedReportInTx(
  tx: Db,
  deps: ApiDependencies,
  acting: Acting,
  body: CreateReportBody,
  origin: ReportOrigin,
  { type, template, recurrence }: ReportPlan,
  staged: StagedEvent[],
): Promise<StoredReport> {
  const { clock, ids } = deps;
  const { environmentId } = acting.ctx;
  const attributes = body.data.attributes;
  const now = clock.now();
  const query = attributes.query as Record<string, unknown>;
    // C72.5 (R002): the caps are read under the environment's cap lock, taken first, and the
    // insert commits before another creation reads them, so concurrent creations never overshoot.
    if (recurrence !== null) {
      await lockRecurringReportCaps(tx, environmentId);
      if (await recurringCapReached(tx, deps.reportLimits, environmentId, type, recurrence)) {
        throw new ReportProblemError(
          'report_recurring_limit',
          'The environment holds as many recurring reports as its limits allow.',
        );
      }
    }
    const account = await linkedAccount(tx, deps, acting, body, staged);
    const inquiryId = attributes['inquiry-id'] ?? null;
    if (inquiryId !== null) {
      if ((await lockInquiry(tx, environmentId, inquiryId)) === null) {
        throw new NotFoundError(`Inquiry ${inquiryId} was not found.`);
      }
      const inquiry = await getInquiry(tx, environmentId, inquiryId);
      if (inquiry?.redactedAt != null) {
        throw new RedactedError(`Inquiry ${inquiryId} was redacted.`);
      }
    }
    const created = await insertReport(tx, environmentId, {
      id: ids.newId('rep'),
      reportType: type,
      reportTemplateId: template.id,
      reportTemplateVersionId: template.currentVersion.id,
      origin,
      query,
      querySources: Object.fromEntries(Object.keys(query).map((field) => [field, 'request'])),
      inquiryId,
      accountId: account?.id ?? null,
      recurrenceIntervalDays: recurrence,
      nextRunAt: recurrence === null ? null : nextBoundary(now, recurrence, now),
      createdAt: now,
      initialRun: { id: ids.newId('rpr'), scheduledFor: now },
    });
    await deps.audit.record(
      tx,
      auditEntryOf(acting.ctx, acting.actor, {
        action: 'report.created',
        resourceType: 'report',
        resourceId: created.id,
        metadata: { 'report-type': type },
      }),
    );
    return created;
}

/** C72.1 (P09): the `sync` waiters per environment in this process. */
const waiting = new Map<string, number>();

/**
 * `meta.processing-mode: sync`: waits up to `waitMs` for the initial run, polling the row and
 * holding no lock, then answers with the current state. Beyond `maxWaiting` waiters in the
 * environment it answers at once, as `async` does.
 */
export async function awaitInitialRun(
  db: Db,
  report: StoredReport,
  options: { waitMs: number; pollMs: number; maxWaiting: number },
): Promise<StoredReport> {
  const key = report.environmentId;
  const count = waiting.get(key) ?? 0;
  if (count >= options.maxWaiting) {
    return report;
  }
  waiting.set(key, count + 1);
  try {
    const deadline = Date.now() + options.waitMs;
    let current = report;
    while (current.status === 'pending' && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, options.pollMs));
      current = (await findReport(db, report.environmentId, report.id)) ?? current;
    }
    return current;
  } finally {
    const left = (waiting.get(key) ?? 1) - 1;
    if (left <= 0) {
      waiting.delete(key);
    } else {
      waiting.set(key, left);
    }
  }
}

// Tags --------------------------------------------------------------------------------------

/**
 * `add-tag`, `remove-tag` and `set-tags` (C9) under the report's row lock. Tags emit no report
 * event (parity); a change is audited.
 */
export async function changeReportTags(
  deps: ApiDependencies,
  acting: Acting,
  id: string,
  operation: TagOperation,
): Promise<ReportResource> {
  const { db } = deps;
  const report = await db.transaction((tx) =>
    changeReportTagsInTx(tx, deps, acting, id, operation),
  );
  return reportResourceOf(db, report, acting.mask);
}

/** {@link changeReportTags} in the caller's transaction (C117.5). */
export async function changeReportTagsInTx(
  tx: Db,
  deps: Pick<ApiDependencies, 'audit'>,
  acting: Pick<Acting, 'ctx' | 'actor'>,
  id: string,
  operation: TagOperation,
): Promise<StoredReport> {
  const { environmentId } = acting.ctx;
    const current = await findStoredReport(tx, environmentId, id, 'update');
    assertNotRedacted(current);
    let result;
    try {
      result = await applyReportTagOperation(tx, environmentId, id, operation);
    } catch (error) {
      if (error instanceof TagLimitError) {
        throw new UnprocessableContentError(error.message);
      }
      throw error;
    }
    if (result === null) {
      throw new NotFoundError(`Report ${id} was not found.`);
    }
    if (result.changed) {
      await deps.audit.record(
        tx,
        auditEntryOf(acting.ctx, acting.actor, {
          action: 'report.updated-tags',
          resourceType: 'report',
          resourceId: id,
          metadata: { operation: operation.kind },
        }),
      );
    }
    return result.report;
}

// Monitoring (C74.5) ------------------------------------------------------------------------

/** The report action's actor columns of the caller. */
export function actionActor(acting: Pick<Acting, 'actor'>): ReturnType<typeof storedActorOf> {
  return storedActorOf(acting.actor);
}

/** @throws {ReportProblemError} 409 `report_not_recurrable` for a type that does not recur. */
function assertRecurrable(report: StoredReport): void {
  if (!REPORT_REGISTRY[report.reportType].recurrable) {
    throw new ReportProblemError(
      'report_not_recurrable',
      `A ${report.reportType} report does not recur.`,
    );
  }
}

/** Whether a source the report's version selects applied a change after `since` (H19). */
async function sourcesChangedSince(db: Db, report: StoredReport, since: Date): Promise<boolean> {
  const version = await getReportTemplateVersion(
    db,
    report.environmentId,
    report.reportTemplateVersionId,
  );
  const lists = version?.config['search-lists'];
  const sourceIds = Array.isArray(lists)
    ? lists.filter((id): id is string => typeof id === 'string')
    : [];
  if (sourceIds.length === 0) {
    return false;
  }
  const states = await watchlistReads.getWatchlistSourceStates(db, sourceIds);
  return states.some(
    (state) => state.lastAppliedAt !== null && state.lastAppliedAt.getTime() > since.getTime(),
  );
}

export type MonitoringAction = 'pause' | 'resume' | 'run';

/**
 * `POST /reports/:id/{pause,resume,run}` (C74.5) under the report's row lock, each with an
 * action:
 * - `pause` needs an upcoming run (409 `report_no_scheduled_run`) and keeps `next_run_at` for
 *   display;
 * - `resume` needs a paused report; when a selected source applied a change during the pause a
 *   `scheduled` run is due at once (H19), otherwise `next_run_at` becomes the next interval
 *   boundary after now;
 * - `run` inserts a `manual` run (allowed while paused) and counts toward the rate (429).
 */
export async function changeReportMonitoring(
  deps: ApiDependencies,
  acting: Acting,
  id: string,
  action: MonitoringAction,
): Promise<ReportResource> {
  const { db } = deps;
  const { environmentId } = acting.ctx;
  if (action === 'run') {
    const peek = await findStoredReport(db, environmentId, id);
    assertNotRedacted(peek);
    assertRecurrable(peek);
    await consumeReportRate(deps, environmentId);
  }
  const { report, runId } = await db.transaction((tx) =>
    changeReportMonitoringInTx(tx, deps, acting, id, action),
  );
  if (runId !== null) {
    await enqueueRun(deps, environmentId, id, runId);
  }
  return reportResourceOf(db, report, acting.mask);
}

/**
 * {@link changeReportMonitoring} in the caller's transaction, for `rerun_report`'s manual runs
 * (C127.12). It takes no `reports` token, and the caller enqueues `runId` after the commit.
 */
export async function changeReportMonitoringInTx(
  tx: Db,
  deps: Pick<ApiDependencies, 'clock' | 'ids' | 'audit'>,
  acting: Acting,
  id: string,
  action: MonitoringAction,
): Promise<{ report: StoredReport; runId: string | null }> {
  const { clock, ids } = deps;
  const { environmentId } = acting.ctx;
  const now = clock.now();
    const current = await findStoredReport(tx, environmentId, id, 'update');
    assertNotRedacted(current);
    assertRecurrable(current);
    let insertedRun: string | null = null;
    if (action === 'pause') {
      if (current.nextRunAt === null || current.pausedAt !== null) {
        throw new ReportProblemError(
          'report_no_scheduled_run',
          'Only a report with an upcoming run can be paused.',
        );
      }
      await updateReportState(tx, environmentId, id, { pausedAt: now, pausedReason: 'operator' });
    } else if (action === 'resume') {
      if (current.pausedAt === null) {
        throw new ReportProblemError('report_no_scheduled_run', 'The report is not paused.');
      }
      const interval = current.recurrenceIntervalDays;
      const changed = await sourcesChangedSince(tx, current, current.pausedAt);
      if (changed) {
        insertedRun = ids.newId('rpr');
        await insertReportRun(tx, environmentId, {
          id: insertedRun,
          reportId: id,
          runType: 'scheduled',
          scheduledFor: now,
        });
      }
      await updateReportState(tx, environmentId, id, {
        pausedAt: null,
        pausedReason: null,
        ...(interval === null
          ? {}
          : { nextRunAt: nextBoundary(current.nextRunAt ?? now, interval, now) }),
      });
    } else {
      insertedRun = ids.newId('rpr');
      await insertReportRun(tx, environmentId, {
        id: insertedRun,
        reportId: id,
        runType: 'manual',
        scheduledFor: now,
      });
    }
    await insertReportAction(tx, environmentId, {
      id: ids.newId('ract'),
      reportId: id,
      actionType: action,
      ...actionActor(acting),
      details: {},
      createdAt: now,
    });
    await deps.audit.record(
      tx,
      auditEntryOf(acting.ctx, acting.actor, {
        action: `report.${action === 'run' ? 'ran' : `${action}d`}`,
        resourceType: 'report',
        resourceId: id,
      }),
    );
    return { report: await findStoredReport(tx, environmentId, id), runId: insertedRun };
}
