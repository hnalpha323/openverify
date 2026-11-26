/**
 * K8-7 (C127.12, C140.5; ours): `rescreen_account_reports`. For each monitored report of the account
 * (`next_run_at` set, not paused, not redacted) whose query reads a field the account now holds
 * otherwise, a new report from the same template with the account's current value
 * (`origin: workflow`), then a wait for each, as `rerun_report` waits. A query member reads the
 * account field of the same name with `-` as `_`, as the report engine's query sources do
 * (`services/reports/completion.ts`). The old reports and their monitoring stay as they are. More
 * than 100 monitored reports is `report_selector_limit`, never a silent truncation; nothing
 * re-screened answers `any-match: null`, never `false`.
 */
import { isDeepStrictEqual } from 'node:util';
import { createReportBodySchema, type CreateReportBody } from '@openverify/contracts';
import {
  getAccount,
  getReports,
  listAccountReportIds,
  listReportRuns,
  type StoredReport,
} from '@openverify/db';
import {
  REPORT_ACTION_LIMITS,
  rescreenAccountReportsConfigSchema,
} from '@openverify/workflow-engine/actions';
import type { StagedEvent } from '../../../events/index.js';
import { createReportInTx, enqueueRun } from '../../../services/reports/reports.js';
import {
  ActionStepError,
  type ActionResult,
  type TransactionActionHandler,
} from '../../engine/action-port.js';
import { recordCreatedObjectInTx } from '../children.js';
import { apiDepsOf, configOf, refusing } from '../shared.js';
import { advance } from './rerun-report.js';

const LIMIT = REPORT_ACTION_LIMITS['selector-reports'].value;

const isMonitored = (report: StoredReport): boolean =>
  report.nextRunAt !== null && report.pausedAt === null && report.query !== null;

/** The query with each member the account now holds otherwise, or `null` when none changed. */
function currentQuery(
  query: Readonly<Record<string, unknown>>,
  fields: Readonly<Record<string, unknown>>,
): Record<string, unknown> | null {
  let changed = false;
  const next: Record<string, unknown> = { ...query };
  for (const [member, value] of Object.entries(query)) {
    const field = member.replaceAll('-', '_');
    if (Object.hasOwn(fields, field) && !isDeepStrictEqual(fields[field], value)) {
      next[member] = fields[field];
      changed = true;
    }
  }
  return changed ? next : null;
}

function bodyOf(report: StoredReport, accountId: string, query: Record<string, unknown>) {
  const parsed = createReportBodySchema.safeParse({
    data: {
      type: `report/${report.reportType}`,
      attributes: { 'report-template-id': report.reportTemplateId, 'account-id': accountId, query },
    },
  });
  if (parsed.success) {
    return { ok: true as const, body: parsed.data satisfies CreateReportBody };
  }
  const path = parsed.error.issues[0]?.path ?? [];
  return { ok: false as const, field: path.at(-1)?.toString() ?? 'query' };
}

export const RESCREEN_ACCOUNT_REPORTS_HANDLER: TransactionActionHandler = {
  key: 'rescreen_account_reports',
  version: 1,
  shape: 'transaction',
  async execute(tx, context): Promise<ActionResult> {
    const config = configOf(context, rescreenAccountReportsConfigSchema);
    const deps = apiDepsOf(context);
    const { environmentId } = context;
    const accountId = config['account-id'];
    const account = await getAccount(tx, environmentId, accountId);
    if (account === null) {
      throw new ActionStepError('object_not_found');
    }
    if (account.redactedAt !== null) {
      throw new ActionStepError('subject_redacted');
    }
    const ids = await listAccountReportIds(tx, environmentId, accountId);
    const monitored = (await getReports(tx, environmentId, ids)).filter(isMonitored);
    if (monitored.length > LIMIT) {
      return { kind: 'failed', code: 'report_selector_limit' };
    }
    const staged: StagedEvent[] = [];
    const made: { reportId: string; runId: string }[] = [];
    for (const report of monitored) {
      const query = currentQuery(report.query ?? {}, account.fields);
      if (query === null) {
        continue;
      }
      const built = bodyOf(report, accountId, query);
      if (!built.ok) {
        return { kind: 'failed', code: 'report_input_missing', output: { field: built.field } };
      }
      const created = await refusing(() =>
        createReportInTx(tx, deps, context.acting, built.body, 'workflow', staged),
      );
      await recordCreatedObjectInTx(tx, context, 'reports', {
        id: created.id,
        childType: 'report',
      });
      const [run] = await listReportRuns(tx, environmentId, created.id);
      if (run === undefined) {
        throw new ActionStepError('execution_error');
      }
      made.push({ reportId: created.id, runId: run.id });
    }
    const subjects = [
      { subjectId: accountId, source: 'read' as const },
      ...made.map(({ reportId }) => ({ subjectId: reportId, source: 'written' as const })),
    ];
    if (made.length === 0) {
      return {
        kind: 'succeeded',
        output: {
          reports: [],
          count: 0,
          'monitored-count': monitored.length,
          'any-match': null,
          errored: [],
        },
        subjects,
      };
    }
    const timeout = config['timeout-seconds'] ?? REPORT_ACTION_LIMITS['timeout-seconds'].value;
    const deadline = context.now.getTime() + timeout * 1_000;
    const reportIds = made.map(({ reportId }) => reportId);
    const next = await advance(tx, context, reportIds, deadline);
    return {
      ...withMonitored(next, monitored.length),
      staged,
      // The sweep is the outbox, so a lost enqueue only waits for it.
      afterCommit: async () => {
        for (const { reportId, runId } of made) {
          await enqueueRun(deps, environmentId, reportId, runId);
        }
      },
      subjects,
    };
  },
  async resume(tx, context, { carry }) {
    const next = await advance(
      tx,
      context,
      carry['report-ids'] as string[],
      carry.deadline as number,
    );
    return withMonitored(next, carry['monitored-count'] as number);
  },
};

/** `rerun_report`'s answer with this action's count, and the count carried through each wait. */
function withMonitored(result: ActionResult, monitoredCount: number): ActionResult {
  if (result.kind === 'waiting') {
    return { ...result, carry: { ...result.carry, 'monitored-count': monitoredCount } };
  }
  if (result.kind === 'succeeded') {
    return { ...result, output: { ...result.output, 'monitored-count': monitoredCount } };
  }
  return result;
}
