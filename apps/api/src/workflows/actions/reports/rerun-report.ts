/**
 * C127.12: `rerun_report`: a manual run of existing reports chosen by a server-side selector, then a
 * wait for each run's terminal event. More than 100 reports is `report_selector_limit`, never a silent
 * truncation. `any-match` is `null` unless every run is `ready`. A rerun repeats each report's original
 * query (C75.4). The engine waits on one key at a time, so the step waits for the reports in turn.
 * K8-6: the engine takes each wait's snapshot before this handler reads the reports, so a report
 * that finishes between that read and the wait still resolves it; it is never a false timeout.
 */
import {
  getAccount,
  getReports,
  listAccountReportIds,
  listMonitoredCustomListReports,
  type Db,
} from '@openverify/db';
import {
  rerunReportConfigSchema,
  REPORT_ACTION_LIMITS,
  type RerunReportConfig,
} from '@openverify/workflow-engine/actions';
import { changeReportMonitoringInTx, enqueueRun } from '../../../services/reports/reports.js';
import {
  ActionStepError,
  type ActionContext,
  type ActionResult,
  type TransactionActionHandler,
} from '../../engine/action-port.js';
import { apiDepsOf, configOf, refusing } from '../shared.js';

const LIMIT = REPORT_ACTION_LIMITS['selector-reports'].value;

async function selected(
  tx: Db,
  { environmentId }: ActionContext,
  { selector }: RerunReportConfig,
): Promise<readonly string[]> {
  if ('list-id' in selector) {
    return listMonitoredCustomListReports(tx, environmentId, selector['list-id']);
  }
  const account = await getAccount(tx, environmentId, selector['account-id']);
  if (account === null) {
    throw new ActionStepError('object_not_found');
  }
  if (account.redactedAt !== null) {
    throw new ActionStepError('subject_redacted');
  }
  return listAccountReportIds(tx, environmentId, selector['account-id']);
}

/**
 * The next report still running, or the step's answer when none is. `rescreen_account_reports`
 * waits for its new reports the same way.
 */
export async function advance(
  tx: Db,
  context: ActionContext,
  ids: readonly string[],
  deadline: number,
): Promise<ActionResult> {
  const reports = await getReports(tx, context.environmentId, ids);
  const pending = reports.find(({ status }) => status === 'pending');
  if (pending !== undefined) {
    const seconds = Math.max(1, Math.ceil((deadline - context.now.getTime()) / 1_000));
    return {
      kind: 'waiting',
      correlationKey: pending.id,
      events: [`report/${pending.reportType}.ready`, `report/${pending.reportType}.errored`],
      timeoutSeconds: seconds,
      timeoutCode: 'report_timed_out',
      carry: { 'report-ids': [...ids], deadline },
    };
  }
  const allReady = reports.every(({ status }) => status === 'ready');
  return {
    kind: 'succeeded',
    output: {
      reports: reports.map(({ id, status, hasMatch }) => ({
        'report-id': id,
        status,
        'has-match': status === 'ready' ? hasMatch : null,
      })),
      count: reports.length,
      'any-match': allReady ? reports.some(({ hasMatch }) => hasMatch) : null,
      errored: reports.filter(({ status }) => status === 'errored').map(({ id }) => id),
    },
  };
}

export const RERUN_REPORT_HANDLER: TransactionActionHandler = {
  key: 'rerun_report',
  version: 1,
  shape: 'transaction',
  async execute(tx, context) {
    const config = configOf(context, rerunReportConfigSchema);
    const deps = apiDepsOf(context);
    const { environmentId } = context;
    const ids = await selected(tx, context, config);
    if (ids.length > LIMIT) {
      return { kind: 'failed', code: 'report_selector_limit' };
    }
    const runs: { reportId: string; runId: string }[] = [];
    for (const reportId of ids) {
      const { runId } = await refusing(() =>
        changeReportMonitoringInTx(tx, deps, context.acting, reportId, 'run'),
      );
      if (runId !== null) {
        runs.push({ reportId, runId });
      }
    }
    const timeout = config['timeout-seconds'] ?? REPORT_ACTION_LIMITS['timeout-seconds'].value;
    const deadline = context.now.getTime() + timeout * 1_000;
    const next = await advance(tx, context, ids, deadline);
    return {
      ...next,
      afterCommit: async () => {
        for (const { reportId, runId } of runs) {
          await enqueueRun(deps, environmentId, reportId, runId);
        }
      },
      subjects: ids.map((subjectId) => ({ subjectId, source: 'written' as const })),
    };
  },
  resume: (tx, context, { carry }) =>
    advance(tx, context, carry['report-ids'] as string[], carry.deadline as number),
};
