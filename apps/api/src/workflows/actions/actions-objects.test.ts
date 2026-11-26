/**
 * Workflow 8A Stage 3 (`api-actions`; C127.2-C127.9, outcomes 26, 27 and 33): the object actions on
 * the real engine: Run Report and its wait, Run Verification, the lists, the graph, accounts,
 * transactions and their children, Trust Device, and the generic actions per object type. Synthetic.
 */
import { defaultInquiryTemplateAttributes } from '@openverify/contracts';
import { reportConfigDefaultValues } from '@openverify/core';
import {
  createVerification,
  getAccount,
  getInquiry,
  getList,
  getReport,
  getTransaction,
  listAllWorkflowRunSteps,
  listInquiryVerifications,
  listTransactionChildren,
  openWorkflowStepValues,
  redactInquiryRecords,
  updateAccount,
  updateReportState,
} from '@openverify/db';
import {
  createTestInquiry,
  seedDevice,
  seedGraphQueryTemplate,
  seedList,
  seedOtpChallenge,
  seedReport,
  seedReportTemplate,
  seedTransaction,
  seedTransactionType,
  testId,
  type SeedReport,
} from '@openverify/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { UNMASKED } from '../../auth/pii.js';
import { processWorkflowWaitMatch } from '../../jobs/workflows/wait-match.js';
import { reportResourceOf } from '../../services/reports/reports.js';
import { checkDefinition } from '@openverify/workflow-engine';
import { WORKFLOW_ACTIONS } from '../definitions/registry.js';
import {
  definitionOf,
  drain,
  edge,
  output,
  runOf,
  stepOf as engineStepOf,
} from '../engine/testing.js';
import type { WorkflowMessage, WorkflowMessageContext } from './messaging/port.js';
import { action, chain, createActionHarness, stepOf, type ActionHarness } from './testing.js';

let harness: ActionHarness;
let production: ActionHarness;

beforeAll(async () => {
  harness = await createActionHarness();
  production = await createActionHarness({ environmentKind: 'production' });
}, 120_000);

afterAll(async () => {
  await harness.close();
  await production.close();
});

const inquiryOf = async (target = harness, flow?: Record<string, unknown>) =>
  (await createTestInquiry(target.db, target.environmentId, flow === undefined ? {} : { flow }))
    .inquiry;

const one = (key: string, config: Record<string, unknown>) => chain([action('step', key, config)]);

const outputOf = async (target: ActionHarness, runId: string, nodeId = 'step') =>
  openWorkflowStepValues(await engineStepOf(target, runId, nodeId)).output;

const REPORT_QUERY = { 'name-first': 'Avery', 'name-last': 'Synthetic' };

const transactionType = (target = harness, more: Record<string, unknown> = {}) =>
  seedTransactionType(target.db, target.environmentId, more);

async function transactionOf(target = harness) {
  const type = await transactionType(target);
  return seedTransaction(target.db, target.environmentId, {
    transactionTypeId: type.id,
    transactionTypeVersionId: type.versionId,
  });
}

describe('create_inquiry (C122.2)', () => {
  it('creates an inquiry with its step, and a transaction’s run makes it a child', async () => {
    const { template } = await createTestInquiry(harness.db, harness.environmentId);
    const transaction = await transactionOf();
    const run = await harness.run(one('create_inquiry', { 'inquiry-template-id': template.id }), {
      trigger: { id: transaction.id, status: 'created' },
    });
    expect(run.status).toBe('completed');
    const output = (await outputOf(harness, run.id)) as { 'inquiry-id': string };
    expect(output['inquiry-id']).toMatch(/^inq_/);
    expect(
      await listTransactionChildren(harness.db, harness.environmentId, transaction.id),
    ).toMatchObject([{ childId: output['inquiry-id'], childType: 'inquiry' }]);
    const { rows } = await harness.database.client.query<{ workflow_run_step_id: string }>(
      `select workflow_run_step_id from inquiries where id = $1`,
      [output['inquiry-id']],
    );
    expect(rows[0]?.workflow_run_step_id).toMatch(/^wfst_/);
  });

  it('refuses an unknown template', async () => {
    const run = await harness.run(
      one('create_inquiry', { 'inquiry-template-id': testId('itmpl') }),
    );
    expect(run).toMatchObject({ status: 'errored', errorCode: 'object_not_found' });
  });
});

describe('run_report (C127.2)', () => {
  const reportTemplate = () =>
    seedReportTemplate(harness.db, harness.environmentId, {
      config: { ...reportConfigDefaultValues('watchlist'), 'search-lists': ['ofac-sdn'] },
    });

  async function reportStep() {
    const template = await reportTemplate();
    const inquiry = await inquiryOf();
    const run = await harness.run(
      one('run_report', {
        'report-template-id': template.templateId,
        'inquiry-id': inquiry.id,
        fields: REPORT_QUERY,
      }),
    );
    expect(run.status).toBe('in_progress');
    const step = await stepOf(harness, run.id, 'step');
    const { rows } = await harness.database.client.query<{ id: string }>(
      `select id from reports where workflow_run_step_id = $1`,
      [step.id],
    );
    const [row] = rows;
    if (row === undefined) {
      throw new Error('no report');
    }
    return { runId: run.id, step, reportId: row.id };
  }

  /** The report ends, and its event resolves the wait, as the worker does. */
  async function resolve(reportId: string, status: 'ready' | 'errored', name: string) {
    await updateReportState(harness.db, harness.environmentId, reportId, {
      status,
      ...(status === 'errored' ? { errors: [{ code: 'execution_error' }] } : {}),
    });
    const report = await getReport(harness.db, harness.environmentId, reportId);
    const data = await reportResourceOf(harness.db, report as never, UNMASKED);
    const staged = await harness.db.transaction((tx) =>
      harness.events.stage(tx, {
        environmentId: harness.environmentId,
        name: name as never,
        payload: { data },
      }),
    );
    await harness.events.dispatch([staged]);
    for (const job of harness.waitMatches.jobs.splice(0)) {
      await processWorkflowWaitMatch(job, harness.deps);
    }
    await drain(harness);
  }

  it('creates the report with origin workflow, and waits for its terminal event', async () => {
    const { step, reportId } = await reportStep();
    expect(step.status).toBe('waiting');
    expect(step.waitEventNames).toEqual(['report/watchlist.ready', 'report/watchlist.errored']);
    expect((await getReport(harness.db, harness.environmentId, reportId))?.origin).toBe('workflow');
  });

  it('answers a ready report, each answer held until then (C127.2)', async () => {
    const { runId, reportId } = await reportStep();
    await resolve(reportId, 'ready', 'report/watchlist.ready');
    expect((await runOf(harness, runId)).status).toBe('completed');
    expect(await outputOf(harness, runId)).toMatchObject({
      'report-id': reportId,
      'report-type': 'watchlist',
      status: 'ready',
      'has-match': false,
      'match-count': 0,
      errors: [],
    });
  });

  it('never reads an errored report as no match', async () => {
    const { runId, reportId } = await reportStep();
    await resolve(reportId, 'errored', 'report/watchlist.errored');
    const run = await runOf(harness, runId);
    expect(run).toMatchObject({ status: 'errored', errorCode: 'report_errored' });
    expect(await outputOf(harness, runId)).toMatchObject({
      status: 'errored',
      'has-match': null,
      'match-count': null,
    });
  });

  it('ends a redacted account’s report with subject_redacted', async () => {
    const template = await reportTemplate();
    const inquiry = await inquiryOf();
    await redactInquiryRecords(harness.db, harness.environmentId, inquiry.id, { at: new Date() });
    const run = await harness.run(
      one('run_report', {
        'report-template-id': template.templateId,
        'inquiry-id': inquiry.id,
        fields: REPORT_QUERY,
      }),
    );
    expect(run).toMatchObject({ status: 'errored', errorCode: 'subject_redacted' });
  });

  it('names a missing template input', async () => {
    const template = await reportTemplate();
    const inquiry = await inquiryOf();
    const run = await harness.run(
      one('run_report', {
        'report-template-id': template.templateId,
        'inquiry-id': inquiry.id,
        fields: { unknown: 'value' },
      }),
    );
    expect(run).toMatchObject({ status: 'errored', errorCode: 'report_input_missing' });
  });
});

describe('rerun_report (C127.12)', () => {
  it('answers an empty selector with no match and no run', async () => {
    const list = await seedList(harness.db, harness.environmentId);
    const run = await harness.run(one('rerun_report', { selector: { 'list-id': list.id } }));
    expect(run.status).toBe('completed');
    expect(await outputOf(harness, run.id)).toEqual({
      reports: [],
      count: 0,
      'any-match': false,
      errored: [],
    });
  });

  it('ends a redacted account with subject_redacted', async () => {
    const inquiry = await inquiryOf();
    await harness.database.client.query(`update accounts set redacted_at = now() where id = $1`, [
      inquiry.accountId,
    ]);
    const run = await harness.run(
      one('rerun_report', { selector: { 'account-id': inquiry.accountId } }),
    );
    expect(run).toMatchObject({ status: 'errored', errorCode: 'subject_redacted' });
  });
});

describe('rescreen_account_reports (K8-7, C127.12, C140.5)', () => {
  const FUTURE = new Date('2999-01-01T00:00:00.000Z');

  /** An account whose fields say `name_last` is now `Changed`, and a published watchlist template. */
  async function accountWithTemplate() {
    const { accountId } = await inquiryOf();
    await updateAccount(harness.db, harness.environmentId, accountId, {
      fields: { name_first: 'Avery', name_last: 'Changed' },
    });
    const template = await seedReportTemplate(harness.db, harness.environmentId, {
      config: { ...reportConfigDefaultValues('watchlist'), 'search-lists': ['ofac-sdn'] },
    });
    return { accountId, template };
  }

  const monitored = (
    accountId: string,
    template: { templateId: string; versionId: string },
    more: Partial<SeedReport> = {},
  ) =>
    seedReport(harness.db, harness.environmentId, {
      ...template,
      accountId,
      status: 'ready',
      query: REPORT_QUERY,
      recurrenceIntervalDays: 30,
      nextRunAt: FUTURE,
      ...more,
    });

  const madeBy = async (runId: string) => {
    const step = await stepOf(harness, runId, 'step');
    const { rows } = await harness.database.client.query<{ id: string }>(
      `select id from reports where workflow_run_step_id = $1 order by id`,
      [step.id],
    );
    return rows.map(({ id }) => id);
  };

  it('screens the current value of each monitored report whose field changed, from its template', async () => {
    const { accountId, template } = await accountWithTemplate();
    const stale = await monitored(accountId, template);
    await monitored(accountId, template, {
      query: { 'name-first': 'Avery', 'name-last': 'Changed' },
    });
    await monitored(accountId, template, { nextRunAt: null, recurrenceIntervalDays: null });
    await monitored(accountId, template, { pausedAt: new Date() });

    const run = await harness.run(one('rescreen_account_reports', { 'account-id': accountId }));

    expect(run.status, run.errorCode ?? '').toBe('in_progress');
    const [made, ...more] = await madeBy(run.id);
    expect(more).toEqual([]);
    const report = await getReport(harness.db, harness.environmentId, made ?? '');
    expect(report).toMatchObject({
      origin: 'workflow',
      reportTemplateId: template.templateId,
      accountId,
      query: { 'name-first': 'Avery', 'name-last': 'Changed' },
    });
    expect(made).not.toBe(stale);
    expect((await stepOf(harness, run.id, 'step')).waitEventNames).toEqual([
      'report/watchlist.ready',
      'report/watchlist.errored',
    ]);

    await updateReportState(harness.db, harness.environmentId, made ?? '', { status: 'ready' });
    const ready = await getReport(harness.db, harness.environmentId, made ?? '');
    const data = await reportResourceOf(harness.db, ready as never, UNMASKED);
    const staged = await harness.db.transaction((tx) =>
      harness.events.stage(tx, {
        environmentId: harness.environmentId,
        name: 'report/watchlist.ready',
        payload: { data },
      }),
    );
    await harness.events.dispatch([staged]);
    for (const job of harness.waitMatches.jobs.splice(0)) {
      await processWorkflowWaitMatch(job, harness.deps);
    }
    await drain(harness);

    expect((await runOf(harness, run.id)).status).toBe('completed');
    expect(await outputOf(harness, run.id)).toEqual({
      reports: [{ 'report-id': made, status: 'ready', 'has-match': false }],
      count: 1,
      'monitored-count': 2,
      'any-match': false,
      errored: [],
    });
  });

  it('answers nothing re-screened with no answer, never no match', async () => {
    const { accountId, template } = await accountWithTemplate();
    await monitored(accountId, template, {
      query: { 'name-first': 'Avery', 'name-last': 'Changed' },
    });

    const run = await harness.run(one('rescreen_account_reports', { 'account-id': accountId }));

    expect(run.status, run.errorCode ?? '').toBe('completed');
    expect(await madeBy(run.id)).toEqual([]);
    expect(await outputOf(harness, run.id)).toEqual({
      reports: [],
      count: 0,
      'monitored-count': 1,
      'any-match': null,
      errored: [],
    });
  });

  it('refuses more monitored reports than its selector cap, making none', async () => {
    const { accountId, template } = await accountWithTemplate();
    for (let index = 0; index < 101; index += 1) {
      await monitored(accountId, template);
    }

    const run = await harness.run(one('rescreen_account_reports', { 'account-id': accountId }));

    expect(run).toMatchObject({ status: 'errored', errorCode: 'report_selector_limit' });
    expect(await madeBy(run.id)).toEqual([]);
  });

  it('ends a redacted account with subject_redacted, and an unknown one object_not_found', async () => {
    const { accountId } = await accountWithTemplate();
    await harness.database.client.query(`update accounts set redacted_at = now() where id = $1`, [
      accountId,
    ]);
    expect(
      await harness.run(one('rescreen_account_reports', { 'account-id': accountId })),
    ).toMatchObject({ status: 'errored', errorCode: 'subject_redacted' });
    expect(
      await harness.run(one('rescreen_account_reports', { 'account-id': testId('acc') })),
    ).toMatchObject({ status: 'errored', errorCode: 'object_not_found' });
  });
});

describe('run_verification (C127.3)', () => {
  const flowHolding = () => {
    const { flow } = defaultInquiryTemplateAttributes();
    const completion = flow.steps.findIndex((step) => step.type === 'completion');
    flow.steps.splice(completion, 0, {
      id: 'database',
      type: 'database',
      fields: ['name_first', 'name_last', 'birthdate', 'address_country_code'],
    } as never);
    return flow;
  };

  it('refuses a type the pinned flow does not hold', async () => {
    const inquiry = await inquiryOf(harness, defaultInquiryTemplateAttributes().flow);
    const run = await harness.run(
      one('run_verification', { 'inquiry-id': inquiry.id, type: 'database' }),
    );
    expect(run).toMatchObject({ status: 'errored', errorCode: 'verification_step_missing' });
  });

  it('refuses debug-forced-status outside a sandbox', async () => {
    const inquiry = await inquiryOf(production);
    const run = await production.run(
      one('run_verification', {
        'inquiry-id': inquiry.id,
        type: 'database',
        'debug-forced-status': 'passed',
      }),
    );
    expect(run).toMatchObject({ status: 'errored', errorCode: 'action_input_invalid' });
  });

  it('submits the verification, enqueues it, and waits for its terminal event', async () => {
    const inquiry = await inquiryOf(harness, flowHolding());
    const run = await harness.run(
      one('run_verification', {
        'inquiry-id': inquiry.id,
        type: 'database',
        inputs: { name_first: 'Avery' },
      }),
    );
    expect(run.status).toBe('in_progress');
    expect((await stepOf(harness, run.id, 'step')).waitEventNames).toEqual([
      'verification.passed',
      'verification.failed',
    ]);
    const [verification] = await listInquiryVerifications(
      harness.db,
      harness.environmentId,
      inquiry.id,
    );
    expect(verification).toMatchObject({ type: 'database', status: 'submitted' });
  });

  it('ends a forced sandbox verification with no pass flag', async () => {
    const inquiry = await inquiryOf(harness, flowHolding());
    const run = await harness.run(
      one('run_verification', {
        'inquiry-id': inquiry.id,
        type: 'database',
        'debug-forced-status': 'passed',
      }),
    );
    expect(await outputOf(harness, run.id)).toMatchObject({
      type: 'database',
      status: 'passed',
      sandbox: true,
      provider: null,
    });
  });
});

describe('get_list_match (C127.4)', () => {
  it('answers false when every list was screened and nothing matched', async () => {
    const list = await seedList(harness.db, harness.environmentId, { kind: 'email-address' });
    const run = await harness.run(
      one('get_list_match', {
        'list-ids': [list.id],
        probe: { kind: 'email-address', value: 'person@example.com' },
      }),
    );
    expect(await outputOf(harness, run.id)).toEqual({
      matched: false,
      'null-reason': null,
      matches: [],
    });
  });

  it('never reads a list it could not read as not listed', async () => {
    const run = await harness.run(
      one('get_list_match', {
        'list-ids': [testId('lst')],
        probe: { kind: 'email-address', value: 'person@example.com' },
      }),
    );
    expect(run).toMatchObject({ status: 'errored', errorCode: 'list_unavailable' });
  });

  it('answers null with its reason under on-unscreened: null', async () => {
    const run = await harness.run(
      one('get_list_match', {
        'list-ids': [testId('lst')],
        probe: { kind: 'email-address', value: 'person@example.com' },
        'on-unscreened': 'null',
      }),
    );
    expect(await outputOf(harness, run.id)).toEqual({
      matched: null,
      'null-reason': 'list_archived',
      matches: [],
    });
  });

  it('finds an item the run added, with its evidence', async () => {
    const list = await seedList(harness.db, harness.environmentId, {
      kind: 'email-address',
      purpose: 'watch',
    } as never);
    const item = { kind: 'email-address', value: 'listed@example.com' };
    const run = await harness.run(
      chain([
        action('add', 'add_list_item', { 'list-id': list.id, item }),
        action('step', 'get_list_match', {
          'list-ids': [list.id],
          probe: { kind: 'email-address', value: 'listed@example.com' },
        }),
      ]),
    );
    expect(run.status).toBe('completed');
    expect(await outputOf(harness, run.id)).toMatchObject({
      matched: true,
      matches: [{ method: 'exact', tier: 'R', stage: 'ga', approximate: false }],
    });
  });
});

describe('add_list_item (C127.4)', () => {
  const add = (listId: string, more: Record<string, unknown> = {}) =>
    one('add_list_item', {
      'list-id': listId,
      item: { kind: 'email-address', value: 'person@example.com' },
      ...more,
    });

  it('writes the run as creator, bumps the version, and a block add leaves a record', async () => {
    const list = await seedList(harness.db, harness.environmentId, { kind: 'email-address' });
    const before = await getList(harness.db, harness.environmentId, list.id);
    const run = await harness.run(add(list.id));
    expect(run.status).toBe('completed');
    const output = (await outputOf(harness, run.id)) as {
      'list-item-id': string;
      'decision-id': string;
    };
    expect(output['decision-id']).toMatch(/^idec_/);
    expect((await getList(harness.db, harness.environmentId, list.id))?.version).toBe(
      (before?.version ?? 0) + 1,
    );
    expect(await harness.decisions(output['list-item-id'])).toMatchObject([
      { kind: 'adverse', subjectType: 'list-item' },
    ]);
  });

  it('reads a value already listed as no_change', async () => {
    const list = await seedList(harness.db, harness.environmentId, { kind: 'email-address' });
    await harness.run(add(list.id));
    const run = await harness.run(add(list.id));
    expect(await outputOf(harness, run.id)).toMatchObject({
      outcome: 'no_change',
      'decision-id': null,
    });
  });

  it('stops a production block add without a basis, and records it for review', async () => {
    const list = await seedList(production.db, production.environmentId, {
      kind: 'email-address',
    });
    const run = await production.run(add(list.id));
    expect(run).toMatchObject({ status: 'errored', errorCode: 'decision_basis_missing' });
    const { rows } = await production.database.client.query<{ needs_review: boolean }>(
      `select needs_review from inquiry_decisions where environment_id = $1 and error_code = $2`,
      [production.environmentId, 'decision_basis_missing'],
    );
    expect(rows).toEqual([{ needs_review: true }]);
  });

  it('refuses another kind of list', async () => {
    const list = await seedList(harness.db, harness.environmentId, { kind: 'phone-number' });
    const run = await harness.run(add(list.id));
    expect(run).toMatchObject({ status: 'errored', errorCode: 'list_kind_mismatch' });
  });
});

describe('sync_graph (C127.5, outcome 26)', () => {
  const sync = (accountId: string, more: Record<string, unknown> = {}) =>
    one('sync_graph', { 'account-id': accountId, 'timeout-seconds': 1, ...more });

  async function accountWithJob(status: string, lastErrorCode: string | null = null) {
    const inquiry = await inquiryOf();
    await harness.database.client.query(
      `insert into graph_index_jobs (environment_id, inquiry_id, trigger_status, status,
         last_error_code, indexed_at)
       values ($1, $2, 'completed', $3, $4, case when $3 = 'pending' then null else now() end)`,
      [harness.environmentId, inquiry.id, status, lastErrorCode],
    );
    return inquiry.accountId;
  }

  it('answers synced: true only when nothing is pending', async () => {
    const accountId = await accountWithJob('completed');
    const run = await harness.run(sync(accountId));
    expect(await outputOf(harness, run.id)).toEqual({ synced: true, mode: 'non-embedding' });
  });

  it('answers synced: true once the index catches up while it polls (C127.5)', async () => {
    const accountId = await accountWithJob('pending');
    const finished = harness.database.client.query(
      `update graph_index_jobs set status = 'completed', indexed_at = now()
         where environment_id = $1 and status = 'pending'`,
      [harness.environmentId],
    );
    const run = await harness.run(sync(accountId, { 'timeout-seconds': 5 }));
    await finished;
    expect(await outputOf(harness, run.id)).toEqual({ synced: true, mode: 'non-embedding' });
  });

  it('ends with graph_index_pending while a job is pending, by default', async () => {
    const accountId = await accountWithJob('pending');
    const run = await harness.run(sync(accountId));
    expect(run).toMatchObject({ status: 'errored', errorCode: 'graph_index_pending' });
  });

  it('answers synced: false under on-pending: continue', async () => {
    const accountId = await accountWithJob('pending');
    const run = await harness.run(sync(accountId, { 'on-pending': 'continue' }));
    expect(await outputOf(harness, run.id)).toMatchObject({ synced: false, 'pending-jobs': 1 });
  });

  it('ends with graph_index_failed at once for an errored job', async () => {
    const accountId = await accountWithJob('errored', 'graph_index_failed');
    const run = await harness.run(sync(accountId, { 'on-pending': 'continue' }));
    expect(run).toMatchObject({ status: 'errored', errorCode: 'graph_index_failed' });
  });

  it('reads a job skipped with graph_indexing_off as its kinds not indexed', async () => {
    const accountId = await accountWithJob('skipped', 'graph_indexing_off');
    const run = await harness.run(sync(accountId, { 'on-pending': 'continue' }));
    const output = (await outputOf(harness, run.id)) as {
      synced: boolean;
      'kinds-not-indexed': string[];
    };
    expect(output.synced).toBe(false);
    expect(output['kinds-not-indexed'].length).toBeGreaterThan(0);
  });
});

const GRAPH_CONFIG = {
  parameters: [{ name: 'account', kind: 'account_id' }],
  start: [{ kind: 'account_id', value: '{{account}}' }],
  'connect-kinds': ['email_address'],
  'max-hops': 2,
  'node-limit': 100,
  'include-weak-kinds': false,
};

describe('run_graph_query (C127.5, outcome 27)', () => {
  it('answers submitted in asynchronous mode, with no count', async () => {
    const template = await seedGraphQueryTemplate(harness.db, harness.environmentId, {
      config: GRAPH_CONFIG,
    });
    const inquiry = await inquiryOf();
    const run = await harness.run(
      one('run_graph_query', {
        'graph-query-template-id': template.id,
        'account-id': inquiry.accountId,
        mode: 'asynchronous',
      }),
    );
    expect(run.status).toBe('completed');
    expect(await outputOf(harness, run.id)).toMatchObject({
      status: 'submitted',
      'account-count': null,
    });
  });

  it('maps a spent budget to a retryable rate limit, never a result', async () => {
    const template = await seedGraphQueryTemplate(harness.db, harness.environmentId, {
      config: GRAPH_CONFIG,
    });
    const inquiry = await inquiryOf();
    const limiter = harness.services.rateLimiter;
    Object.assign(harness.services, {
      rateLimiter: {
        ...limiter,
        consume: () => Promise.resolve({ allowed: false, retryAfterSeconds: 7 }),
      },
    });
    try {
      const run = await harness.run(
        one('run_graph_query', {
          'graph-query-template-id': template.id,
          'account-id': inquiry.accountId,
          mode: 'asynchronous',
        }),
      );
      expect(run.errorCode).toBe('rate_limited');
    } finally {
      Object.assign(harness.services, { rateLimiter: limiter });
    }
  });
});

describe('find_or_create_account (C127.6)', () => {
  it('finds by reference id, and creates once', async () => {
    const reference = `ref-${testId('acc')}`;
    const step = one('find_or_create_account', {
      'account-type-id': await accountType(),
      identifier: { kind: 'reference-id', value: reference },
    });
    const first = await harness.run(step);
    const created = (await outputOf(harness, first.id)) as { 'account-id': string };
    expect(created).toMatchObject({ outcome: 'created' });
    const second = await harness.run(step);
    expect(await outputOf(harness, second.id)).toEqual({
      'account-id': created['account-id'],
      outcome: 'found',
    });
  });

  it('finds by a declared field through a keyed digest, so the value is in no plain column', async () => {
    const value = `person-${testId('acc')}`;
    const step = one('find_or_create_account', {
      'account-type-id': await accountType(),
      identifier: { kind: 'field', 'field-key': 'name_first', value },
    });

    const first = await harness.run(step);
    const created = (await outputOf(harness, first.id)) as { 'account-id': string };
    const second = await harness.run(step);

    expect(await outputOf(harness, second.id)).toMatchObject({
      'account-id': created['account-id'],
      outcome: 'found',
    });
    const account = await getAccount(harness.db, harness.environmentId, created['account-id']);
    expect(account?.referenceId).toMatch(/^name_first:[0-9a-f]{64}$/);
  });
});

const accountType = async () => {
  const { rows } = await harness.database.client.query<{ id: string }>(
    `select id from account_types where environment_id = $1 limit 1`,
    [harness.environmentId],
  );
  const [row] = rows;
  if (row === undefined) {
    throw new Error('no account type');
  }
  return row.id;
};

describe('set_relation and unset_relation (C127.7, outcome 33)', () => {
  const relation = (key: string, config: Record<string, unknown>) => one(key, config);

  it('relates two accounts, reads a repeat as no_change, and unsets it', async () => {
    const [first, second] = [await inquiryOf(), await inquiryOf()];
    const config = {
      'object-type': 'account',
      'object-id': first.accountId,
      'relation-key': 'spouse',
      'target-id': second.accountId,
    };
    const set = await harness.run(relation('set_relation', config));
    expect(await outputOf(harness, set.id)).toMatchObject({ outcome: 'applied' });
    const repeat = await harness.run(relation('set_relation', config));
    expect(await outputOf(harness, repeat.id)).toMatchObject({ outcome: 'no_change' });
    const unset = await harness.run(relation('unset_relation', config));
    expect(await outputOf(harness, unset.id)).toMatchObject({ outcome: 'applied' });
    const again = await harness.run(relation('unset_relation', config));
    expect(await outputOf(harness, again.id)).toMatchObject({ outcome: 'no_change' });
  });

  it('keeps a relation the type does not declare a step error', async () => {
    const transaction = await transactionOf();
    const run = await harness.run(
      relation('set_relation', {
        'object-type': 'transaction',
        'object-id': transaction.id,
        'relation-key': 'unknown',
        'target-id': (await inquiryOf()).accountId,
      }),
    );
    expect(run.status).toBe('errored');
    expect(run.errorCode).not.toBe('execution_error');
  });
});

describe('add_face_list_item (C127.4, C128.4)', () => {
  it('refuses before the biometric basis is acknowledged, and adds nothing', async () => {
    const list = await seedList(harness.db, harness.environmentId, { kind: 'face' });
    const inquiry = await inquiryOf();
    const run = await harness.run(
      one('add_face_list_item', { 'list-id': list.id, 'inquiry-id': inquiry.id }),
    );
    expect(run).toMatchObject({
      status: 'errored',
      errorCode: 'biometric_lists_not_acknowledged',
    });
  });

  it('stops a production block add without its basis, and sends the inquiry to review', async () => {
    const list = await seedList(production.db, production.environmentId, { kind: 'face' });
    const { inquiry } = await createTestInquiry(production.db, production.environmentId);
    const run = await production.run(
      one('add_face_list_item', { 'list-id': list.id, 'inquiry-id': inquiry.id }),
    );
    expect(run).toMatchObject({ status: 'errored', errorCode: 'decision_basis_missing' });
  });

  it('ends a redacted inquiry with subject_redacted', async () => {
    const list = await seedList(harness.db, harness.environmentId, { kind: 'face' });
    const inquiry = await inquiryOf();
    await redactInquiryRecords(harness.db, harness.environmentId, inquiry.id, { at: new Date() });
    const run = await harness.run(
      one('add_face_list_item', { 'list-id': list.id, 'inquiry-id': inquiry.id }),
    );
    expect(run).toMatchObject({ status: 'errored', errorCode: 'subject_redacted' });
  });
});

describe('the inquiry links (C126.8; P32, V23)', () => {
  const sent: { message: WorkflowMessage; scrub: readonly string[] }[] = [];
  const answer = { current: 'recorded' as 'recorded' | 'unknown' };

  beforeAll(() => {
    Object.assign(harness.services, {
      messenger: {
        send: (message: WorkflowMessage, context: WorkflowMessageContext) => {
          sent.push({ message, scrub: context.scrub });
          return Promise.resolve({
            delivery: answer.current,
            provider: 'sandbox',
            sandbox: true,
            'message-ref': null,
          });
        },
      },
    });
  });

  async function confirmedInquiry() {
    const inquiry = await inquiryOf();
    const verification = await createVerification(harness.db, harness.environmentId, {
      id: testId('ver'),
      inquiryId: inquiry.id,
      type: 'email_address',
    });
    await harness.database.client.query(
      `update verifications set status = 'passed' where id = $1`,
      [verification.id],
    );
    await seedOtpChallenge(harness.db, harness.environmentId, {
      verificationId: verification.id,
      inquiryId: inquiry.id,
      channel: 'email',
      destination: 'person@example.com',
      status: 'confirmed',
      confirmedAt: new Date(),
    });
    return inquiry;
  }

  const link = (id: string) => one('send_inquiry_link_email', { 'inquiry-id': id });

  it('sends only to the confirmed destination, and the token stays out of the output', async () => {
    const inquiry = await confirmedInquiry();
    const run = await harness.run(link(inquiry.id));
    expect(run.status).toBe('completed');
    const [delivered] = sent.splice(0);
    expect(delivered?.message).toMatchObject({
      kind: 'email',
      to: 'person@example.com',
      basis: 'confirmed',
      allowUnconfirmed: false,
    });
    const [token] = delivered?.scrub ?? [];
    const output = await outputOf(harness, run.id);
    expect(output).toMatchObject({ delivery: 'recorded', sandbox: true });
    expect(JSON.stringify(output)).not.toContain(token);
    const { rows } = await harness.database.client.query<{ id: string }>(
      `select id from one_time_links where inquiry_id = $1`,
      [inquiry.id],
    );
    expect(output).toMatchObject({ 'one-time-link-id': `otl_${String(rows[0]?.id)}` });
  });

  it('offers an SMS link the countries of the inquiry’s own template (C126.2)', async () => {
    const inquiry = await inquiryOf();
    const verification = await createVerification(harness.db, harness.environmentId, {
      id: testId('ver'),
      inquiryId: inquiry.id,
      type: 'phone_number',
    });
    await harness.database.client.query(
      `update verifications set status = 'passed' where id = $1`,
      [verification.id],
    );
    await seedOtpChallenge(harness.db, harness.environmentId, {
      verificationId: verification.id,
      inquiryId: inquiry.id,
      channel: 'sms',
      destination: '+15555550100',
      status: 'confirmed',
      confirmedAt: new Date(),
    });
    await harness.database.client.query(
      `update inquiry_template_versions set flow = $1 where id = $2`,
      [
        JSON.stringify({ steps: [{ type: 'phone_otp', allowedCountries: ['US', 'CA'] }] }),
        inquiry.inquiryTemplateVersionId,
      ],
    );

    const run = await harness.run(one('send_inquiry_link_sms', { 'inquiry-id': inquiry.id }));

    expect(run.status).toBe('completed');
    const [delivered] = sent.splice(0);
    expect(delivered?.message).toMatchObject({ kind: 'sms', templateCountries: ['US', 'CA'] });
  });

  it('never sends to an unconfirmed address', async () => {
    const inquiry = await inquiryOf();
    const run = await harness.run(link(inquiry.id));
    expect(run).toMatchObject({ status: 'errored', errorCode: 'recipient_not_allowed' });
    expect(sent).toEqual([]);
  });

  it('reports an unknown delivery as unknown, which blocks a resume', async () => {
    const inquiry = await confirmedInquiry();
    answer.current = 'unknown';
    try {
      const run = await harness.run(link(inquiry.id));
      expect(run).toMatchObject({ status: 'errored', errorCode: 'unknown_effect' });
    } finally {
      answer.current = 'recorded';
      sent.length = 0;
    }
  });

  it('ends a redacted inquiry with subject_redacted', async () => {
    const inquiry = await inquiryOf();
    await redactInquiryRecords(harness.db, harness.environmentId, inquiry.id, { at: new Date() });
    const run = await harness.run(link(inquiry.id));
    expect(run).toMatchObject({ status: 'errored', errorCode: 'subject_redacted' });
  });
});

describe('update_transaction_status (C127.7)', () => {
  it('moves the status, writes the run as reviewer, and is no_change on a repeat', async () => {
    const transaction = await transactionOf();
    const step = one('update_transaction_status', {
      'transaction-id': transaction.id,
      status: 'approved',
    });
    expect((await harness.run(step)).status).toBe('completed');
    expect((await getTransaction(harness.db, harness.environmentId, transaction.id))?.status).toBe(
      'approved',
    );
    const run = await harness.run(step);
    expect(await outputOf(harness, run.id)).toMatchObject({ outcome: 'no_change' });
    const { rows } = await harness.database.client.query<{ actor_type: string }>(
      `select actor_type from transaction_status_history where transaction_id = $1`,
      [transaction.id],
    );
    expect(rows.map(({ actor_type: type }) => type)).toContain('workflow_run');
  });

  it('records an adverse status, and stops it in production without a basis', async () => {
    const transaction = await transactionOf(production);
    const run = await production.run(
      one('update_transaction_status', {
        'transaction-id': transaction.id,
        status: 'declined',
      }),
    );
    expect(run).toMatchObject({ status: 'errored', errorCode: 'decision_basis_missing' });
    expect(
      (await getTransaction(production.db, production.environmentId, transaction.id))?.status,
    ).toBe('created');
    expect(await production.decisions(transaction.id)).toMatchObject([
      { kind: 'adverse', needsReview: true, errorCode: 'decision_basis_missing' },
    ]);
  });
});

describe('trust_device (C127.9)', () => {
  it('marks the device, names the run, and reads a repeat as no_change', async () => {
    const { id } = await seedDevice(harness.db, harness.environmentId);
    const step = one('trust_device', { 'device-id': id, 'trust-reason': 'known_customer' });
    const run = await harness.run(step);
    expect(await outputOf(harness, run.id)).toMatchObject({ outcome: 'applied' });
    const again = await harness.run(step);
    expect(await outputOf(harness, again.id)).toMatchObject({ outcome: 'no_change' });
  });
});

describe('the generic actions (C127.8)', () => {
  const tag = (type: string, id: string, key = 'tag_object') =>
    one(key, { 'object-type': type, 'object-id': id, tag: 'reviewed' });

  it('tags an inquiry, reads a repeat as no_change, and removes it', async () => {
    const inquiry = await inquiryOf();
    const first = await harness.run(tag('inquiry', inquiry.id));
    expect(await outputOf(harness, first.id)).toMatchObject({ outcome: 'applied', 'tag-count': 1 });
    const second = await harness.run(tag('inquiry', inquiry.id));
    expect(await outputOf(harness, second.id)).toMatchObject({ outcome: 'no_change' });
    const third = await harness.run(tag('inquiry', inquiry.id, 'remove_tag'));
    expect(await outputOf(harness, third.id)).toMatchObject({ 'tag-count': 0 });
  });

  it('tags an account and a transaction', async () => {
    const inquiry = await inquiryOf();
    const transaction = await transactionOf();
    expect((await harness.run(tag('account', inquiry.accountId))).status).toBe('completed');
    expect((await harness.run(tag('transaction', transaction.id))).status).toBe('completed');
    expect((await getAccount(harness.db, harness.environmentId, inquiry.accountId))?.tags).toEqual([
      'reviewed',
    ]);
  });

  it('ends on a redacted subject with subject_redacted', async () => {
    const inquiry = await inquiryOf();
    await redactInquiryRecords(harness.db, harness.environmentId, inquiry.id, { at: new Date() });
    const run = await harness.run(tag('inquiry', inquiry.id));
    expect(run).toMatchObject({ status: 'errored', errorCode: 'subject_redacted' });
  });

  it('copies what the target lacks', async () => {
    const from = await inquiryOf();
    const to = await inquiryOf();
    await harness.run(tag('inquiry', from.id));
    const run = await harness.run(
      one('copy_tags', {
        'from-object-type': 'inquiry',
        'from-object-id': from.id,
        'object-type': 'inquiry',
        'object-id': to.id,
      }),
    );
    expect(await outputOf(harness, run.id)).toMatchObject({ outcome: 'applied', 'tag-count': 1 });
  });

  it('fetches an object as an API client reads it', async () => {
    const inquiry = await inquiryOf();
    const run = await harness.run(
      one('fetch_object', { 'object-type': 'inquiry', 'object-id': inquiry.id }),
    );
    expect(await outputOf(harness, run.id)).toMatchObject({
      'object-id': inquiry.id,
      object: { type: 'inquiry', id: inquiry.id },
    });
  });

  it('updates a custom field and an attribute', async () => {
    const inquiry = await inquiryOf();
    const run = await harness.run(
      one('update_object', {
        'object-type': 'inquiry',
        'object-id': inquiry.id,
        field: 'reference-id',
        operator: 'set',
        value: 'ref-1',
      }),
    );
    expect(run.status).toBe('completed');
    expect((await getInquiry(harness.db, harness.environmentId, inquiry.id))?.referenceId).toBe(
      'ref-1',
    );
  });

  it('archives an account as an adverse step, with its record', async () => {
    const inquiry = await inquiryOf();
    const run = await harness.run(
      one('update_object', {
        'object-type': 'account',
        'object-id': inquiry.accountId,
        field: 'status',
        operator: 'set',
        value: 'archived',
      }),
    );
    expect(run.status).toBe('completed');
    expect(await harness.decisions(inquiry.accountId)).toMatchObject([{ kind: 'adverse' }]);
  });

  it('redacts through the service, and reads a redacted object as no_change', async () => {
    const inquiry = await inquiryOf();
    const step = one('redact_object', { 'object-type': 'inquiry', 'object-id': inquiry.id });
    expect((await harness.run(step)).status).toBe('completed');
    expect((await getInquiry(harness.db, harness.environmentId, inquiry.id))?.redactedAt).not.toBe(
      null,
    );
    const run = await harness.run(step);
    expect(await outputOf(harness, run.id)).toMatchObject({ outcome: 'no_change' });
  });

  it('keeps the steps of a run in the journal', async () => {
    const inquiry = await inquiryOf();
    const run = await harness.run(tag('inquiry', inquiry.id));
    await drain(harness);
    const steps = await listAllWorkflowRunSteps(harness.db, harness.environmentId, run.id);
    expect(steps.map(({ nodeId }) => nodeId)).toContain('step');
  });
});

describe('fetch_object answers the flattened view its check types (Workflow 8C review K8-17)', () => {
  /** `got` fetches the object, `choose` routes on one attribute of it, `hit` runs on a match. */
  const routingOn = (objectType: string, objectId: string, attribute: string, value: string) =>
    definitionOf(
      [
        action('got', 'fetch_object', { 'object-type': objectType, 'object-id': objectId }),
        {
          id: 'choose',
          type: 'conditional',
          name: 'Choose',
          routes: [
            {
              key: 'hit',
              label: 'Hit',
              condition: { '===': [{ var: `steps.got.output.object.${attribute}` }, value] },
            },
          ],
        },
        action('hit', 'calculate', { operator: 'add', operands: [1, 1] }),
        output(),
      ],
      [
        edge('trigger', 'got'),
        edge('got', 'choose'),
        edge('choose', 'hit', 'route:hit'),
        edge('choose', 'output', 'else'),
        edge('hit', 'output'),
      ],
    );

  const OBJECTS: readonly [string, () => Promise<{ id: string; status: string }>][] = [
    [
      'inquiry',
      async () => {
        const inquiry = await inquiryOf();
        await harness.database.client.query(
          `update inquiries set status = 'pending' where id = $1`,
          [inquiry.id],
        );
        return { id: inquiry.id, status: 'pending' };
      },
    ],
    [
      'account',
      async () => {
        const inquiry = await inquiryOf();
        const account = await getAccount(harness.db, harness.environmentId, inquiry.accountId);
        return { id: inquiry.accountId, status: String(account?.status) };
      },
    ],
    [
      'report',
      async () => {
        const inquiry = await inquiryOf();
        const template = await seedReportTemplate(harness.db, harness.environmentId);
        const reportId = await seedReport(harness.db, harness.environmentId, {
          ...template,
          inquiryId: inquiry.id,
          status: 'ready',
        });
        return { id: reportId, status: 'ready' };
      },
    ],
    [
      'transaction',
      async () => {
        const transaction = await transactionOf();
        const stored = await getTransaction(harness.db, harness.environmentId, transaction.id);
        return { id: transaction.id, status: String(stored?.status) };
      },
    ],
    [
      'verification',
      async () => {
        const inquiry = await inquiryOf();
        const verification = await createVerification(harness.db, harness.environmentId, {
          id: testId('ver'),
          inquiryId: inquiry.id,
          type: 'email_address',
        });
        await harness.database.client.query(
          `update verifications set status = 'passed' where id = $1`,
          [verification.id],
        );
        return { id: verification.id, status: 'passed' };
      },
    ],
  ];

  it.each(OBJECTS)('routes on the stored status of a fetched %s', async (objectType, make) => {
    const object = await make();
    const definition = routingOn(objectType, object.id, 'status', object.status);
    // A verification's view is untyped (PII whole and nullable), so the check refuses a literal
    // comparison on it; the run's read of it is still the flattened view.
    const check = checkDefinition(definition, {
      kind: 'workflow',
      mode: 'publish',
      registry: WORKFLOW_ACTIONS,
    });
    expect(check.errors.map(({ code }) => code)).toEqual(
      objectType === 'verification' ? ['pii_literal_in_condition', 'on_null_missing'] : [],
    );

    const run = await harness.run(definition);

    expect(run).toMatchObject({ status: 'completed', errorCode: null });
    expect(await outputOf(harness, run.id, 'choose')).toEqual({ route: 'hit' });
    expect(await outputOf(harness, run.id, 'got')).toMatchObject({
      object: { id: object.id, status: object.status },
    });
  });
});
