/**
 * C127.2: Run Report: a report from a published template, `origin: workflow`, then a wait for its
 * terminal event. A timeout is always `report_timed_out`; an errored report is `report_errored` with
 * its codes, never `has-match: false`. A redacted subject answers `subject_redacted`. A missing
 * template input is `report_input_missing`, naming the field.
 */
import { createReportBodySchema, type CreateReportBody } from '@openverify/contracts';
import { getReport, getReportTemplate, listReportRuns, type Db } from '@openverify/db';
import {
  runReportConfigSchema,
  REPORT_ACTION_LIMITS,
  type RunReportConfig,
} from '@openverify/workflow-engine/actions';
import { createReportInTx, enqueueRun } from '../../../services/reports/reports.js';
import type { StagedEvent } from '../../../events/index.js';
import {
  ActionStepError,
  type ActionContext,
  type ActionResolution,
  type ActionResult,
  type TransactionActionHandler,
} from '../../engine/action-port.js';
import { recordCreatedObjectInTx } from '../children.js';
import { apiDepsOf, configOf, refusing } from '../shared.js';
import { reportOutputOf } from './output.js';

function bodyOf(
  config: RunReportConfig,
  type: string,
): { ok: true; body: CreateReportBody } | { ok: false; field: string } {
  const parsed = createReportBodySchema.safeParse({
    data: {
      type: `report/${type}`,
      attributes: {
        'report-template-id': config['report-template-id'],
        ...(config['inquiry-id'] === undefined ? {} : { 'inquiry-id': config['inquiry-id'] }),
        ...(config['account-id'] === undefined ? {} : { 'account-id': config['account-id'] }),
        query: config.fields ?? {},
      },
    },
  });
  if (parsed.success) {
    return { ok: true, body: parsed.data };
  }
  const path = parsed.error.issues[0]?.path ?? [];
  return { ok: false, field: path.at(-1)?.toString() ?? 'query' };
}

async function resumeReport(
  tx: Db,
  context: ActionContext,
  { carry }: ActionResolution,
): Promise<ActionResult> {
  const report = await getReport(tx, context.environmentId, carry['report-id'] as string);
  if (report === null) {
    return { kind: 'failed', code: 'object_not_found' };
  }
  const output = await reportOutputOf(tx, report);
  return report.status === 'errored'
    ? { kind: 'failed', code: 'report_errored', output }
    : { kind: 'succeeded', output };
}

export const RUN_REPORT_HANDLER: TransactionActionHandler = {
  key: 'run_report',
  version: 1,
  shape: 'transaction',
  async execute(tx, context) {
    const config = configOf(context, runReportConfigSchema);
    const deps = apiDepsOf(context);
    const { environmentId } = context;
    const template = await getReportTemplate(tx, environmentId, config['report-template-id']);
    if (template === null) {
      return { kind: 'failed', code: 'object_not_found' };
    }
    const built = bodyOf(config, template.reportType);
    if (!built.ok) {
      return { kind: 'failed', code: 'report_input_missing', output: { field: built.field } };
    }
    const staged: StagedEvent[] = [];
    const report = await refusing(() =>
      createReportInTx(tx, deps, context.acting, built.body, 'workflow', staged),
    );
    await recordCreatedObjectInTx(tx, context, 'reports', { id: report.id, childType: 'report' });
    const [run] = await listReportRuns(tx, environmentId, report.id);
    if (run === undefined) {
      throw new ActionStepError('execution_error');
    }
    const type = report.reportType;
    return {
      kind: 'waiting',
      correlationKey: report.id,
      events: [`report/${type}.ready`, `report/${type}.errored`],
      timeoutSeconds: config['timeout-seconds'] ?? REPORT_ACTION_LIMITS['timeout-seconds'].value,
      timeoutCode: 'report_timed_out',
      carry: { 'report-id': report.id },
      staged,
      // The sweep is the outbox, so a lost enqueue only waits for it.
      afterCommit: () => enqueueRun(deps, environmentId, report.id, run.id),
      subjects: [{ subjectId: report.id, source: 'written' }],
    };
  },
  resume: resumeReport,
};
