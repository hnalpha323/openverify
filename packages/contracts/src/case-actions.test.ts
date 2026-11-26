import { describe, expect, it } from 'vitest';
import {
  buildCaseActionResource,
  caseActionDocumentSchema,
  caseAvailableActionListDocumentSchema,
  createCaseActionBodySchema,
  listCaseActionsQuerySchema,
  runCaseActionBodySchema,
  runCaseActionDocumentSchema,
  updateCaseActionBodySchema,
} from './case-actions.js';
import { readFixture } from './test-support.js';

const WORKFLOW = 'wfl_01M5CM00000000000000000001';
const TEMPLATE = 'ctmpl_01M5CN00000000000000000002';
const ACTION = 'cact_01M5CN00000000000000000009';

const body = (attributes: Record<string, unknown>) => ({ data: { attributes } });
const created = (attributes: Record<string, unknown>) =>
  createCaseActionBodySchema.safeParse(
    body({ 'workflow-id': WORKFLOW, 'case-template-ids': [TEMPLATE], label: 'Do', ...attributes }),
  ).success;

describe('case actions (C140.1)', () => {
  it('builds the golden action', () => {
    const golden = caseActionDocumentSchema.parse(readFixture('api/case-action.json'));
    expect(
      buildCaseActionResource({
        id: ACTION,
        workflowId: WORKFLOW,
        caseTemplateIds: [TEMPLATE],
        label: golden.data.attributes.label,
        status: 'active',
        placement: 'header',
        prefill: golden.data.attributes.prefill,
        createdAt: new Date('2026-10-20T12:00:00.000Z'),
        updatedAt: new Date('2026-10-20T12:05:00.000Z'),
      }),
    ).toEqual(golden.data);
  });

  it('binds a workflow to templates; the header is the only placement (C145)', () => {
    expect(created({})).toBe(true);
    expect(created({ placement: 'header' })).toBe(true);
    expect(created({ placement: 'row' })).toBe(false);
    expect(created({ 'case-template-ids': [] })).toBe(false);
    expect(created({ 'case-template-ids': [TEMPLATE, TEMPLATE] })).toBe(false);
  });

  it('prefills from a path of the case, its inquiry or its account, never from a value', () => {
    expect(created({ prefill: { reason: 'case.fields.summary' } })).toBe(true);
    expect(created({ prefill: { reason: 'inquiry.fields.name-first' } })).toBe(true);
    expect(created({ prefill: { reason: 'account.fields.city' } })).toBe(true);
    expect(created({ prefill: { reason: 'trigger.fields.summary' } })).toBe(false);
    expect(created({ prefill: { reason: 'case.fields.' } })).toBe(false);
    expect(created({ prefill: { reason: 'a literal value' } })).toBe(false);
  });

  it('retires an action by archiving it, because there is no delete route', () => {
    const update = (attributes: Record<string, unknown>) =>
      updateCaseActionBodySchema.safeParse(body(attributes)).success;
    expect(update({ status: 'archived' })).toBe(true);
    expect(update({ status: 'deleted' })).toBe(false);
    expect(update({})).toBe(false);
  });

  it('runs an action with its parameters, and answers the run (C140.1)', () => {
    const run = { data: { 'case-action-id': ACTION, parameters: { reason: 'Synthetic' } } };
    expect(runCaseActionBodySchema.safeParse(run).success).toBe(true);
    expect(
      runCaseActionBodySchema.safeParse({
        data: { 'account-action-id': 'accac_01M5CM00000000000000000010' },
      }).success,
    ).toBe(false);
    expect(
      runCaseActionDocumentSchema.safeParse(readFixture('api/case-run-action.json')).success,
    ).toBe(true);
  });

  it("serves the form, prefilled under the viewer's mask (P38, H14)", () => {
    const golden = caseAvailableActionListDocumentSchema.parse(
      readFixture('api/case-available-actions.json'),
    );
    expect(golden.data[0]?.attributes.form[0]?.['prefilled-value']).toBe('Synthetic review note');
    const masked = structuredClone(readFixture('api/case-available-actions.json')) as {
      data: { attributes: { form: { 'prefilled-value': unknown }[] } }[];
    };
    for (const action of masked.data) {
      for (const input of action.attributes.form) {
        input['prefilled-value'] = null;
      }
    }
    expect(caseAvailableActionListDocumentSchema.safeParse(masked).success).toBe(true);
  });

  it('filters by workflow, template and status', () => {
    expect(
      listCaseActionsQuerySchema.safeParse({
        'filter[workflow-id]': WORKFLOW,
        'filter[case-template-id]': TEMPLATE,
        'filter[status]': 'active',
      }).success,
    ).toBe(true);
    expect(listCaseActionsQuerySchema.safeParse({ 'filter[status]': 'paused' }).success).toBe(
      false,
    );
  });
});
