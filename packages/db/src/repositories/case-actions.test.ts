/**
 * C140.1, C128.2, C121.6 (Workflow 8B, `api-case-workflows`): case actions with the templates each is
 * offered on, the case as a run reads it, what it holds, and the case template as a definition's
 * reference. Every value is synthetic.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createTestDatabase,
  createTestInquiry,
  createTestTenant,
  seedCase,
  seedCaseComment,
  seedCaseTemplate,
  seedReport,
  seedReportTemplate,
  seedWorkflow,
  testId,
  type TestDatabase,
} from '../testing.js';
import { createAccount, createAccountType } from './accounts.js';
import {
  WORKFLOW_CASE_HELD_SERVED,
  caseHoldsAnyOf,
  caseHoldsReportOfInquiry,
  createCaseAction,
  firstHeldInquiryAndAccount,
  getCaseAction,
  getWorkflowCase,
  listCaseActions,
  listCaseActionsForTemplate,
  missingCaseTemplates,
  updateCaseAction,
} from './case-actions.js';
import { createCaseAssignmentPolicyRow } from './case-policies.js';
import { createCaseQueueRow, updateCaseQueueRow } from './case-queues.js';
import { CASE_WORKFLOW_REFERENCE_KINDS } from './case-references.js';
import {
  findWorkflowReferences,
  readWorkflowReferences,
  type WorkflowReferenceKind,
} from './workflow-versions.js';

let database: TestDatabase;

beforeAll(async () => {
  database = await createTestDatabase();
}, 120_000);

afterAll(async () => {
  await database.close();
});

const db = () => database.db;
const tenant = async () => (await createTestTenant(database.db)).environment.id;
const query = (text: string, params: unknown[] = []) => database.client.query(text, params);

let keys = 0;
const nextKey = () => {
  keys += 1;
  return `CA${String(keys)}`;
};

async function newCase(environmentId: string, fields: Record<string, unknown> = {}) {
  const template = await seedCaseTemplate(db(), environmentId, { key: nextKey() });
  const created = await seedCase(db(), environmentId, {
    caseTemplateId: template.id,
    caseTemplateVersionId: template.versionId,
    key: template.key,
    number: 1,
    fields,
  });
  return { template, caseId: created.id, name: created.name };
}

const hold = (table: string, column: string, environmentId: string, caseId: string, id: string) =>
  query(
    `insert into ${table} (environment_id, case_id, ${column}, attached_by_type, attached_by_id)
     values ($1, $2, $3, 'user', $4)`,
    [environmentId, caseId, id, testId('usr')],
  );

describe('case actions (C140.1)', () => {
  it('creates one with its templates, reads, lists and updates it', async () => {
    const environmentId = await tenant();
    const workflow = await seedWorkflow(db(), environmentId);
    const one = await seedCaseTemplate(db(), environmentId, { key: nextKey() });
    const two = await seedCaseTemplate(db(), environmentId, { key: nextKey() });
    const id = testId('cact');
    const created = await createCaseAction(db(), environmentId, {
      id,
      workflowId: workflow.id,
      label: 'Escalate',
      prefill: { reference: 'case.fields.reference' },
      caseTemplateIds: [two.id, one.id],
    });
    expect(created).toMatchObject({
      id,
      workflowId: workflow.id,
      label: 'Escalate',
      status: 'active',
      placement: 'header',
      prefill: { reference: 'case.fields.reference' },
      caseTemplateIds: [one.id, two.id].sort(),
    });
    expect(await getCaseAction(db(), environmentId, id)).toMatchObject({ id });
    expect(await getCaseAction(db(), await tenant(), id)).toBeNull();

    const listed = await listCaseActions(
      db(),
      environmentId,
      { caseTemplateIds: [one.id] },
      { size: 10 },
    );
    expect(listed.items.map((item) => item.id)).toEqual([id]);
    expect(
      (await listCaseActions(db(), environmentId, { statuses: ['archived'] }, {})).items,
    ).toEqual([]);

    const updated = await updateCaseAction(db(), environmentId, id, {
      label: 'Review again',
      caseTemplateIds: [one.id],
      status: 'archived',
    });
    expect(updated).toMatchObject({
      label: 'Review again',
      status: 'archived',
      caseTemplateIds: [one.id],
    });
    expect(await updateCaseAction(db(), environmentId, testId('cact'), { label: 'x' })).toBeNull();
  });

  it('offers a template its active actions, oldest first', async () => {
    const environmentId = await tenant();
    const workflow = await seedWorkflow(db(), environmentId);
    const template = await seedCaseTemplate(db(), environmentId, { key: nextKey() });
    const ids = [testId('cact'), testId('cact'), testId('cact')];
    for (const [index, id] of ids.entries()) {
      await createCaseAction(db(), environmentId, {
        id,
        workflowId: workflow.id,
        label: `Action ${String(index)}`,
        prefill: {},
        caseTemplateIds: [template.id],
      });
      await query(`update case_actions set created_at = $1 where id = $2`, [
        new Date(Date.UTC(2026, 0, 1 + index)).toISOString(),
        id,
      ]);
    }
    await updateCaseAction(db(), environmentId, ids[1] ?? '', { status: 'archived' });
    const offered = await listCaseActionsForTemplate(db(), environmentId, template.id);
    expect(offered.map((row) => row.id)).toEqual([ids[0], ids[2]]);
  });

  it('names the templates this environment does not hold', async () => {
    const environmentId = await tenant();
    const held = await seedCaseTemplate(db(), environmentId, { key: nextKey() });
    const other = await seedCaseTemplate(db(), await tenant(), { key: nextKey() });
    const absent = testId('ctmpl');
    expect(await missingCaseTemplates(db(), environmentId, [held.id, other.id, absent])).toEqual(
      [other.id, absent].sort(),
    );
    expect(await missingCaseTemplates(db(), environmentId, [])).toEqual([]);
  });
});

describe('the case as a run reads it (C120.6, C129.2)', () => {
  it('opens its fields and names what it holds, newest first, with each kind’s total', async () => {
    const environmentId = await tenant();
    const { caseId, template } = await newCase(environmentId, {
      reference: { type: 'string', value: 'synthetic-ref' },
    });
    const { inquiry } = await createTestInquiry(db(), environmentId);
    const report = await seedReportTemplate(db(), environmentId);
    const reportId = await seedReport(db(), environmentId, {
      templateId: report.templateId,
      versionId: report.versionId,
      inquiryId: inquiry.id,
    });
    await hold('case_inquiries', 'inquiry_id', environmentId, caseId, inquiry.id);
    await hold('case_reports', 'report_id', environmentId, caseId, reportId);
    const comment = await seedCaseComment(db(), environmentId, { caseId });

    const read = await getWorkflowCase(db(), environmentId, caseId);
    expect(read?.row).toMatchObject({ id: caseId, caseTemplateId: template.id, status: 'open' });
    expect(read?.fields).toEqual({ reference: { type: 'string', value: 'synthetic-ref' } });
    expect(read?.held.inquiries).toEqual({ items: [inquiry.id], count: 1 });
    expect(read?.held.reports).toEqual({
      items: [{ id: reportId, reportType: 'watchlist' }],
      count: 1,
    });
    expect(read?.held.accounts).toEqual({ items: [], count: 0 });
    expect(read?.commentIds).toEqual([comment.id]);
    expect(await getWorkflowCase(db(), await tenant(), caseId)).toBeNull();
  });

  it('serves the newest 50 of a kind, and counts them all', async () => {
    const environmentId = await tenant();
    const { caseId } = await newCase(environmentId);
    const type = await createAccountType(db(), environmentId, {
      id: testId('acctp'),
      name: 'Synthetic',
    });
    const accountIds: string[] = [];
    for (let index = 0; index < WORKFLOW_CASE_HELD_SERVED + 2; index += 1) {
      const account = await createAccount(db(), environmentId, {
        id: testId('acc'),
        accountTypeId: type.id,
        referenceId: null,
        fields: {},
      });
      accountIds.push(account.id);
      await hold('case_accounts', 'account_id', environmentId, caseId, account.id);
      await query(`update case_accounts set created_at = $1 where account_id = $2`, [
        new Date(Date.UTC(2026, 0, 1, 0, index)).toISOString(),
        account.id,
      ]);
    }
    const read = await getWorkflowCase(db(), environmentId, caseId);
    expect(read?.held.accounts.count).toBe(WORKFLOW_CASE_HELD_SERVED + 2);
    expect(read?.held.accounts.items).toEqual(accountIds.slice(2).reverse());
  });

  it('reads a redacted case’s fields as null', async () => {
    const environmentId = await tenant();
    const { caseId } = await newCase(environmentId, { a: { type: 'string', value: 'x' } });
    await query(`update cases set fields = null, redacted_at = now() where id = $1`, [caseId]);
    const read = await getWorkflowCase(db(), environmentId, caseId);
    expect(read?.fields).toBeNull();
    expect(read?.row.redactedAt).not.toBeNull();
  });
});

describe('what a case holds (C128.2, C140.1)', () => {
  it('holds an object of any kind it was given, and a report of an inquiry', async () => {
    const environmentId = await tenant();
    const { caseId } = await newCase(environmentId);
    const { inquiry } = await createTestInquiry(db(), environmentId);
    const other = await createTestInquiry(db(), environmentId);
    const report = await seedReportTemplate(db(), environmentId);
    const reportId = await seedReport(db(), environmentId, {
      templateId: report.templateId,
      versionId: report.versionId,
      inquiryId: inquiry.id,
    });
    await hold('case_reports', 'report_id', environmentId, caseId, reportId);

    expect(await caseHoldsAnyOf(db(), environmentId, caseId, [reportId])).toBe(true);
    expect(await caseHoldsAnyOf(db(), environmentId, caseId, [inquiry.id])).toBe(false);
    expect(await caseHoldsAnyOf(db(), environmentId, caseId, [])).toBe(false);
    expect(await caseHoldsReportOfInquiry(db(), environmentId, caseId, inquiry.id)).toBe(true);
    expect(await caseHoldsReportOfInquiry(db(), environmentId, caseId, other.inquiry.id)).toBe(
      false,
    );
    expect(await caseHoldsAnyOf(db(), await tenant(), caseId, [reportId])).toBe(false);

    await hold('case_inquiries', 'inquiry_id', environmentId, caseId, inquiry.id);
    expect(await caseHoldsAnyOf(db(), environmentId, caseId, [inquiry.id])).toBe(true);
  });

  it('names the first inquiry and account it was given', async () => {
    const environmentId = await tenant();
    const { caseId } = await newCase(environmentId);
    expect(await firstHeldInquiryAndAccount(db(), environmentId, caseId)).toEqual({
      inquiryId: null,
      accountId: null,
    });
    const first = await createTestInquiry(db(), environmentId);
    const second = await createTestInquiry(db(), environmentId);
    await hold('case_inquiries', 'inquiry_id', environmentId, caseId, second.inquiry.id);
    await hold('case_inquiries', 'inquiry_id', environmentId, caseId, first.inquiry.id);
    await query(`update case_inquiries set created_at = $1 where inquiry_id = $2`, [
      new Date(Date.UTC(2025, 0, 1)).toISOString(),
      first.inquiry.id,
    ]);
    expect(await firstHeldInquiryAndAccount(db(), environmentId, caseId)).toEqual({
      inquiryId: first.inquiry.id,
      accountId: null,
    });
  });
});

describe('a case template is a reference of a definition (C121.6)', () => {
  it('names a template, a queue and an assignment policy', () => {
    expect(CASE_WORKFLOW_REFERENCE_KINDS).toEqual([
      'case-template',
      'case-queue',
      'case-assignment-policy',
    ]);
  });

  it('reads an environment’s active queues and its policies, by id and by name', async () => {
    const environmentId = await tenant();
    const queue = testId('cqueue');
    const archived = testId('cqueue');
    const policy = testId('cap');
    await db().transaction(async (tx) => {
      await createCaseQueueRow(tx, environmentId, {
        id: queue,
        name: 'Synthetic queue',
        caseAssignmentPolicyId: null,
      });
      await createCaseQueueRow(tx, environmentId, {
        id: archived,
        name: 'Synthetic old queue',
        caseAssignmentPolicyId: null,
      });
      await updateCaseQueueRow(tx, environmentId, archived, { archivedAt: new Date() });
      await createCaseAssignmentPolicyRow(tx, environmentId, {
        id: policy,
        name: 'Synthetic policy',
        distribution: 'round-robin',
        sort: 'created-at',
        agentIds: null,
        maxCapacity: null,
        sources: [],
      });
    });
    const queues = 'case-queue' as WorkflowReferenceKind;
    const policies = 'case-assignment-policy' as WorkflowReferenceKind;
    expect(await readWorkflowReferences(db(), environmentId, queues, [queue, archived])).toEqual([
      { id: queue, name: 'Synthetic queue' },
    ]);
    expect(await findWorkflowReferences(db(), environmentId, queues, 'Synthetic queue')).toEqual([
      { id: queue, name: 'Synthetic queue' },
    ]);
    expect(await readWorkflowReferences(db(), environmentId, policies, [policy])).toEqual([
      { id: policy, name: 'Synthetic policy' },
    ]);
    expect(await findWorkflowReferences(db(), environmentId, policies, 'Synthetic policy')).toEqual(
      [{ id: policy, name: 'Synthetic policy' }],
    );
    expect(await readWorkflowReferences(db(), await tenant(), queues, [queue])).toEqual([]);
  });

  it('reads an environment’s active templates, by id and by name', async () => {
    const kind = 'case-template' as WorkflowReferenceKind;
    const environmentId = await tenant();
    const template = await seedCaseTemplate(db(), environmentId, {
      key: nextKey(),
      name: 'Synthetic escalation',
    });
    const archived = await seedCaseTemplate(db(), environmentId, { key: nextKey() });
    await query(
      `update case_templates set status = 'archived', archived_at = now() where id = $1`,
      [archived.id],
    );
    const read = await readWorkflowReferences(db(), environmentId, kind, [
      template.id,
      archived.id,
    ]);
    expect(read).toEqual([{ id: template.id, name: 'Synthetic escalation' }]);
    expect(await findWorkflowReferences(db(), environmentId, kind, 'Synthetic escalation')).toEqual(
      [{ id: template.id, name: 'Synthetic escalation' }],
    );
  });
});
