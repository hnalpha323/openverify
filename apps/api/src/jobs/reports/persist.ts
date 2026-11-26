/**
 * C74.1, C75.8, C84.2, C84.3 (Workflow 6A Stage 3, `api-reports`): what a run writes, in one
 * transaction under the C73.7 locks (the inquiry's account share-locked, then the inquiry, then
 * the report), fenced by the run's claim token: a lost claim rolls the whole result back.
 *
 * - The match state machine (`decideMatchTransition`) applied to every entry the run found, and to
 *   the report's live matches it did not find on a source it screened: still listed
 *   (`not_found`) or removed (`removed`, from the entry's `removed_at`).
 * - The report's columns (status, coverage, provenance, errors, the sealed result, the crypto
 *   index) and its schedule (`pause-on-match` and the resume after `resume-delay-minutes`).
 * - The initial run of a completion report links the inquiry's account (C84.2) and applies
 *   `on-report-match` (C84.3): a first open match, or an errored initial run, moves a `completed`
 *   inquiry to `needs_review`; a decided inquiry records `inquiry_already_decided`.
 * - Events: `.matched` once when the run brought an alert, then `.ready` or `.errored`, staged in
 *   the transaction and dispatched after commit.
 *
 * Match snapshot keys written here: `entry-key`, `content-hash`, `risk-data-hash`, `matched-name`
 * and `evidence-input`, beside what the type's job put in `FoundReportMatch.snapshot` (`entity`,
 * `list`, `match-types`, `qualifiers`, `components`; `services/reports/resources.ts`).
 */
import { newId, resolveReportConfig, resolveReportTemplateConfig } from '@openverify/contracts';
import {
  decideMatchTransition,
  REPORT_REGISTRY,
  reportEventName,
  type MatchDecision,
  type ReportType,
} from '@openverify/core';
import {
  countRecurringReports,
  finishReportRun,
  getEnvironment,
  getInquiry,
  getInquiryTemplateVersion,
  getReport,
  getReportRun,
  getReportTemplateVersion,
  insertReportMatch,
  linkReportAccount,
  listReportMatches,
  lockAbsorbingAccount,
  lockInquiry,
  reportCryptoAddressIndex,
  reportMatchEntryIndex,
  reportMatchEvidenceHash,
  scheduledMediaRunsPerDay,
  updateReportMatch,
  updateReportState,
  type Db,
  type Inquiry,
  type StoredReport,
  type StoredReportMatch,
} from '@openverify/db';
import { evidenceHashInput } from '@openverify/watchlist';
import { UNMASKED } from '../../auth/pii.js';
import type { StagedEvent } from '../../events/index.js';
import { transitionInquiryInTx } from '../../services/inquiries.js';
import { currentWatchlistReads, reportViewOf } from '../../services/reports/reports.js';
import { reportResource } from '../../services/reports/resources.js';
import type { FoundReportMatch, ReportRunResult } from '../report-types/index.js';
import type { ReportRunProcessorDeps, ReportRunProcessResult } from './run.js';

/** The run a persistence is about. */
export interface RunTarget {
  environmentId: string;
  reportId: string;
  runId: string;
}

/** The claim was lost: the transaction rolls back and the run's result is discarded. */
class LostClaimError extends Error {
  override name = 'LostClaimError';
}

/** What a run found, keyed (C73.2, C75.3). */
interface KeyedMatch {
  found: FoundReportMatch;
  entryIndex: string;
  evidenceHash: string;
  snapshot: Record<string, unknown>;
}

/** One write the plan makes. */
type MatchWrite =
  | { kind: 'insert'; keyed: KeyedMatch; decision: MatchDecision; lapsedFrom: string | null }
  | { kind: 'update'; row: StoredReportMatch; keyed: KeyedMatch | null; decision: MatchDecision };

interface MatchPlan {
  writes: MatchWrite[];
  notes: string[];
  /** Decisions that alert (`.matched`). */
  alerts: number;
  /** Some match is `open` afterwards. */
  hasMatch: boolean;
  /** Some open match is still unreviewed afterwards (`pause-on-match` resumes without one). */
  hasPendingOpen: boolean;
}

const asText = (value: unknown): string | null => (typeof value === 'string' ? value : null);

/** `<source>:<publisher id>` back into its parts (a source id holds no `:`). */
function entryOf(entryKey: string): { sourceId: string; entryId: string } | null {
  const at = entryKey.indexOf(':');
  return at <= 0 ? null : { sourceId: entryKey.slice(0, at), entryId: entryKey.slice(at + 1) };
}

/** The run's matches keyed under the environment's blind-index subkey, one per entry. */
function keyed(
  key: Uint8Array,
  environmentId: string,
  query: Readonly<Record<string, unknown>>,
  matches: readonly FoundReportMatch[],
): KeyedMatch[] {
  const byEntry = new Map<string, KeyedMatch>();
  for (const found of matches) {
    const entryIndex = reportMatchEntryIndex(key, { environmentId, entryKey: found.entryKey });
    const evidenceInput = evidenceHashInput({
      entryKey: found.entryKey,
      contentHash: found.contentHash,
      listName: found.matchedName,
      query,
    });
    const candidate: KeyedMatch = {
      found,
      entryIndex,
      evidenceHash: reportMatchEvidenceHash(key, { environmentId, parts: [evidenceInput] }),
      snapshot: {
        ...found.snapshot,
        'entry-key': found.entryKey,
        'content-hash': found.contentHash,
        'risk-data-hash': found.riskDataHash,
        'matched-name': found.matchedName,
        'evidence-input': evidenceInput,
      },
    };
    const earlier = byEntry.get(entryIndex);
    if (earlier === undefined || earlier.found.score < found.score) {
      byEntry.set(entryIndex, candidate);
    }
  }
  return [...byEntry.values()];
}

/** C75.8: the writes of one run's findings and of the live matches it did not find. */
async function planMatches(
  tx: Db,
  deps: ReportRunProcessorDeps,
  report: StoredReport,
  environmentKind: 'sandbox' | 'production',
  result: ReportRunResult,
): Promise<MatchPlan> {
  const key = deps.blindIndexKey;
  if (key === undefined) {
    throw new Error('the worker has no blind index key for the report matches');
  }
  const existing = await listReportMatches(tx, report.environmentId, report.id);
  const found = keyed(key, report.environmentId, report.query ?? {}, result.matches);
  const writes: MatchWrite[] = [];
  const seen = new Set<string>();
  for (const match of found) {
    seen.add(match.entryIndex);
    const live = existing.find(
      (row) =>
        row.entryIndex === match.entryIndex && (row.status === 'open' || row.status === 'delisted'),
    );
    if (live !== undefined) {
      const decision = decideMatchTransition(live, {
        type: 'found',
        evidence: live.evidenceHash === match.evidenceHash ? 'same' : 'changed',
        riskData:
          asText(live.snapshot?.['risk-data-hash']) === match.found.riskDataHash
            ? 'same'
            : 'changed',
      });
      writes.push({ kind: 'update', row: live, keyed: match, decision });
      continue;
    }
    const dismissed = existing.filter(
      (row) => row.entryIndex === match.entryIndex && row.status === 'dismissed',
    );
    const newest = dismissed[0] ?? null;
    const decision = decideMatchTransition(newest, {
      type: 'found',
      evidence: dismissed.some((row) => row.evidenceHash === match.evidenceHash)
        ? 'same'
        : 'changed',
      riskData: 'same',
    });
    if (decision.action === 'create' || decision.action === 'lapse') {
      writes.push({
        kind: 'insert',
        keyed: match,
        decision,
        lapsedFrom: decision.action === 'lapse' ? (newest?.id ?? null) : null,
      });
    } else if (newest !== null) {
      writes.push({ kind: 'update', row: newest, keyed: null, decision });
    }
  }
  // Live matches this run did not find, on what it screened: still listed, or removed.
  const screened = new Set([
    ...result.sources.map((source) => source.sourceId),
    ...(result.listSources ?? []).map((source) => source['list-id']),
  ]);
  const missing = existing.filter(
    (row) =>
      (row.status === 'open' || row.status === 'delisted') &&
      row.entryIndex !== null &&
      !seen.has(row.entryIndex) &&
      (row.sourceId === null ? result.errors.length === 0 : screened.has(row.sourceId)),
  );
  const listed = missing.flatMap((row) => {
    const entry = entryOf(asText(row.snapshot?.['entry-key']) ?? '');
    return row.sourceId === null || entry === null || result.listSources !== undefined
      ? []
      : [entry];
  });
  const entries =
    listed.length === 0
      ? []
      : await currentWatchlistReads().loadEntries(tx, { environmentKind, entries: listed });
  for (const row of missing) {
    const entry = entryOf(asText(row.snapshot?.['entry-key']) ?? '');
    const stored =
      entry === null
        ? undefined
        : entries.find(
            (item) => item.sourceId === entry.sourceId && item.entryId === entry.entryId,
          );
    // An entry the store no longer holds was purged after its removal (C76.8).
    const gone = stored?.removedAt !== null;
    const removed = row.sourceId !== null && gone;
    writes.push({
      kind: 'update',
      row,
      keyed: null,
      decision: decideMatchTransition(row, { type: removed ? 'removed' : 'not_found' }),
    });
  }
  const after = new Map(existing.map((row) => [row.id, row]));
  let created = 0;
  let pendingCreated = 0;
  for (const write of writes) {
    if (write.kind === 'insert') {
      created += 1;
      pendingCreated += write.decision.reviewStatus === 'pending' ? 1 : 0;
    } else if (write.decision.status !== null) {
      after.set(write.row.id, {
        ...write.row,
        status: write.decision.status,
        reviewStatus: write.decision.reviewStatus ?? write.row.reviewStatus,
      });
    }
  }
  const rows = [...after.values()];
  return {
    writes,
    notes: [
      ...new Set(
        writes.flatMap((write) => (write.decision.note === null ? [] : [write.decision.note])),
      ),
    ],
    alerts: writes.filter((write) => write.decision.events.includes('matched')).length,
    hasMatch: created > 0 || rows.some((row) => row.status === 'open'),
    hasPendingOpen:
      pendingCreated > 0 ||
      rows.some((row) => row.status === 'open' && row.reviewStatus === 'pending'),
  };
}

/** Writes the plan's matches (after the run's fence held). */
async function applyMatches(
  tx: Db,
  environmentId: string,
  reportId: string,
  runId: string,
  plan: MatchPlan,
  at: Date,
): Promise<void> {
  for (const write of plan.writes) {
    const { decision } = write;
    if (write.kind === 'insert') {
      await insertReportMatch(tx, environmentId, {
        id: newId('rpm'),
        reportId,
        sourceId: write.keyed.found.sourceId,
        entryIndex: write.keyed.entryIndex,
        evidenceHash: write.keyed.evidenceHash,
        score: write.keyed.found.score,
        snapshot: write.keyed.snapshot,
        status: 'open',
        reviewStatus: 'pending',
        runId,
        lapsedFrom: write.lapsedFrom,
        at,
      });
      continue;
    }
    if (decision.action === 'not_applicable' || decision.action === 'refuse') {
      continue;
    }
    const match = write.keyed;
    const dismissal = write.row.snapshot?.dismissal;
    await updateReportMatch(tx, environmentId, write.row.id, {
      at,
      lastRunId: runId,
      ...(decision.status === null ? {} : { status: decision.status }),
      ...(decision.reviewStatus === null ? {} : { reviewStatus: decision.reviewStatus }),
      ...(decision.presentInLastRun === null
        ? {}
        : { presentInLastRun: decision.presentInLastRun }),
      ...(match === null ? {} : { score: match.found.score }),
      ...(decision.updateEvidence && match !== null
        ? { evidenceHash: match.evidenceHash, snapshot: match.snapshot }
        : {}),
      ...(decision.updateSnapshot && match !== null
        ? { snapshot: dismissal === undefined ? match.snapshot : { ...match.snapshot, dismissal } }
        : {}),
      ...(decision.setDelistedAt ? { delistedAt: at } : {}),
    });
  }
}

/** The version's `on-report-match` of the inquiry (C84.1), `none` when it cannot be read. */
async function onReportMatchOf(tx: Db, inquiry: Inquiry): Promise<'none' | 'needs_review'> {
  const version = await getInquiryTemplateVersion(
    tx,
    inquiry.environmentId,
    inquiry.inquiryTemplateVersionId,
  );
  if (version === null) {
    return 'none';
  }
  try {
    return resolveReportConfig(version.reportConfig)['on-report-match'];
  } catch {
    return 'none';
  }
}

const DECIDED = new Set(['approved', 'declined', 'needs_review']);

/** The provenance in the shape the report serves (`sources`). */
function servedSources(result: ReportRunResult): Record<string, unknown>[] {
  if (result.listSources !== undefined) {
    return result.listSources.map((source) => ({ ...source }));
  }
  return result.sources.map((source) => ({
    'source-id': source.sourceId,
    'sync-id': source.syncId,
    'published-at': source.publishedAt.toISOString(),
    'checked-at': source.checkedAt.toISOString(),
    sha256: source.sha256,
    origin: source.origin,
    attribution: source.attribution,
  }));
}

/**
 * Persists a completed run (or, with `failure`, a run that failed for good: its result is the
 * error alone and the report keeps its last result), fenced by `token`.
 */
export async function persistRunResult(
  deps: ReportRunProcessorDeps,
  target: RunTarget,
  token: string,
  result: ReportRunResult,
  options: { failure?: boolean } = {},
): Promise<ReportRunProcessResult> {
  const { db, events, clock } = deps;
  const { environmentId, reportId, runId } = target;
  const now = clock.now();
  const status: 'ready' | 'errored' = result.errors.length > 0 ? 'errored' : 'ready';
  const staged: StagedEvent[] = [];
  let outcome: ReportRunProcessResult;
  try {
    outcome = await db.transaction(async (tx) => {
      const run = await getReportRun(tx, environmentId, runId);
      const peek = await getReport(tx, environmentId, reportId);
      if (run === null || peek === null) {
        throw new LostClaimError();
      }
      const initial = run.runType === 'initial';
      const completion = peek.origin === 'inquiry_completion' && peek.inquiryId !== null;
      // C73.7: the inquiry's account (share), the inquiry, then the report.
      let inquiry: Inquiry | null = null;
      let accountId: string | null = null;
      if (completion && peek.inquiryId !== null) {
        const before = await getInquiry(tx, environmentId, peek.inquiryId);
        if (initial && before?.accountId != null) {
          const account = await lockAbsorbingAccount(tx, environmentId, { id: before.accountId });
          accountId = account !== null && account.redactedAt === null ? account.id : null;
        }
        await lockInquiry(tx, environmentId, peek.inquiryId);
        inquiry = await getInquiry(tx, environmentId, peek.inquiryId);
      }
      const report = await getReport(tx, environmentId, reportId, { lock: 'update' });
      if (report === null) {
        throw new LostClaimError();
      }
      if (report.redactedAt !== null) {
        // C73.5: a run that finishes after a redaction discards its result.
        const finished = await finishReportRun(tx, environmentId, runId, token, {
          status: 'errored',
          completedAt: now,
          matchCount: 0,
          newMatchCount: 0,
          sources: [],
          coverage: null,
          errors: [{ code: 'execution_error' }],
          notes: [],
        });
        if (!finished) {
          throw new LostClaimError();
        }
        return { outcome: 'completed' as const, status: 'errored' as const };
      }
      const environment = await getEnvironment(tx, environmentId);
      const environmentKind = environment?.kind ?? 'production';
      const reviewed = REPORT_REGISTRY[report.reportType].review === 'matches';
      const plan: MatchPlan = reviewed
        ? await planMatches(tx, deps, report, environmentKind, result)
        : { writes: [], notes: [], alerts: 0, hasMatch: false, hasPendingOpen: false };
      const notes = [...plan.notes];
      // C84.3: on-report-match, for completion reports only (P05).
      let decided = false;
      if (inquiry !== null) {
        const cause =
          !report.hasMatch && plan.hasMatch
            ? 'report_match'
            : initial && status === 'errored'
              ? 'report_errored'
              : null;
        const option = cause === null ? 'none' : await onReportMatchOf(tx, inquiry);
        if (cause !== null && option === 'needs_review') {
          if (inquiry.status === 'completed') {
            const moved = await transitionInquiryInTx(
              tx,
              { events, clock },
              inquiry,
              'needs_review',
            );
            if (moved !== null) {
              staged.push(...moved.staged);
              notes.push(cause);
            }
          } else if (DECIDED.has(inquiry.status)) {
            decided = true;
          }
        } else if (initial && (inquiry.status === 'approved' || inquiry.status === 'declined')) {
          decided = true;
        }
      }
      if (decided) {
        notes.push('inquiry_already_decided');
      }
      // C72.5: a completion report beyond a recurring cap runs once, without a schedule.
      const capped = initial && completion && (await beyondRecurringCaps(tx, deps, report));
      if (capped) {
        notes.push('recurring_limit');
      }
      const finished = await finishReportRun(tx, environmentId, runId, token, {
        status,
        completedAt: now,
        matchCount: result.matches.length,
        newMatchCount: plan.alerts,
        sources: servedSources(result),
        coverage: result.coverage,
        errors: result.errors,
        notes,
      });
      if (!finished) {
        throw new LostClaimError();
      }
      await applyMatches(tx, environmentId, reportId, runId, plan, now);
      if (initial && completion && accountId !== null) {
        await linkReportAccount(tx, environmentId, reportId, accountId);
      }
      const schedule = await scheduleAfterRun(tx, report, plan, now);
      const key = deps.blindIndexKey;
      await updateReportState(tx, environmentId, reportId, {
        status,
        hasMatch: plan.hasMatch,
        errors: result.errors,
        completedAt: now,
        ...(options.failure === true
          ? {}
          : {
              result: {
                ...result.result,
                ...(result.cryptoAddress === undefined
                  ? {}
                  : { 'canonical-address': result.cryptoAddress }),
              },
              coverage: result.coverage,
              unavailableFields: result.unavailableFields,
              sources: servedSources(result),
              matcherVersion: result.matcherVersion,
              provider: result.provider,
              thresholds: result.thresholds,
              notices: result.notices,
              ...(result.cryptoAddress === undefined || key === undefined
                ? {}
                : {
                    cryptoAddressIndex: reportCryptoAddressIndex(key, {
                      environmentId,
                      address: result.cryptoAddress,
                    }),
                  }),
            }),
        ...(initial && completion && accountId !== null && report.accountId === null
          ? { accountId }
          : {}),
        ...schedule,
        ...(capped ? { nextRunAt: null, recurrenceIntervalDays: null } : {}),
      });
      const updated = await getReport(tx, environmentId, reportId);
      if (updated !== null) {
        const payload = { data: reportResource(await reportViewOf(tx, updated), UNMASKED) };
        const type: ReportType = updated.reportType;
        if (plan.alerts > 0) {
          staged.push(
            await events.stage(tx, {
              environmentId,
              name: reportEventName(type, 'matched'),
              payload,
            }),
          );
        }
        staged.push(
          await events.stage(tx, {
            environmentId,
            name: reportEventName(type, status === 'ready' ? 'ready' : 'errored'),
            payload,
          }),
        );
      }
      return { outcome: 'completed' as const, status };
    });
  } catch (error) {
    if (error instanceof LostClaimError) {
      return { outcome: 'not_claimed' };
    }
    throw error;
  }
  await events.dispatch(staged);
  return outcome;
}

/** C74.5: `pause-on-match`, and the resume after `resume-delay-minutes` once nothing is unreviewed. */
const MEDIA_TYPES: ReadonlySet<ReportType> = new Set(['adverse-media', 'business-adverse-media']);

/**
 * C72.5: whether a recurring completion report takes the environment beyond its recurring cap,
 * or (a media type) beyond its scheduled media runs per day; both counts include the report.
 */
async function beyondRecurringCaps(
  tx: Db,
  deps: ReportRunProcessorDeps,
  report: StoredReport,
): Promise<boolean> {
  if (report.recurrenceIntervalDays === null || report.nextRunAt === null) {
    return false;
  }
  const { environmentId } = report;
  if ((await countRecurringReports(tx, environmentId)) > deps.limits.maxRecurringPerEnvironment) {
    return true;
  }
  return (
    MEDIA_TYPES.has(report.reportType) &&
    (await scheduledMediaRunsPerDay(tx, environmentId)) > deps.limits.maxMediaRunsPerDay
  );
}

async function scheduleAfterRun(
  tx: Db,
  report: StoredReport,
  plan: MatchPlan,
  now: Date,
): Promise<{ pausedAt?: Date | null; pausedReason?: 'match' | null; nextRunAt?: Date }> {
  if (report.nextRunAt === null && report.pausedAt === null) {
    return {};
  }
  const version = await getReportTemplateVersion(
    tx,
    report.environmentId,
    report.reportTemplateVersionId,
  );
  if (version === null) {
    return {};
  }
  const config = resolveReportTemplateConfig(report.reportType, version.config);
  if (config['pause-on-match'] === true && plan.alerts > 0 && report.pausedAt === null) {
    return { pausedAt: now, pausedReason: 'match' };
  }
  if (report.pausedReason === 'match' && !plan.hasPendingOpen) {
    const delay =
      typeof config['resume-delay-minutes'] === 'number' ? config['resume-delay-minutes'] : 0;
    return {
      pausedAt: null,
      pausedReason: null,
      nextRunAt: new Date(now.getTime() + delay * 60_000),
    };
  }
  return {};
}

/** The result of a run that failed for good (C74.1): `execution_error`, nothing screened. */
const FAILED_RESULT: ReportRunResult = Object.freeze({
  errors: [{ code: 'execution_error' as const }],
  sources: [],
  coverage: null,
  result: {},
  unavailableFields: [],
  provider: null,
  thresholds: null,
  notices: [],
  matcherVersion: null,
  matches: [],
});

/**
 * C74.1: ends the run `errored` with `execution_error`, fenced as completion is; its report takes
 * the status, keeps its last result and fires `.errored`. A lost claim writes nothing.
 */
export function endRunErrored(
  deps: ReportRunProcessorDeps,
  target: RunTarget,
  token: string,
): Promise<ReportRunProcessResult> {
  return persistRunResult(deps, target, token, FAILED_RESULT, { failure: true });
}
