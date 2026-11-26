import { describe, expect, it } from 'vitest';
import {
  accountActionParameterSchema,
  buildAccountActionResource,
  createAccountActionBodySchema,
  listAccountActionsQuerySchema,
  runAccountActionBodySchema,
  runAccountActionDocumentSchema,
  updateAccountActionBodySchema,
} from './account-actions.js';
import { AT, LATER } from './test-support.js';

const ACTION = 'accac_01M5CM00000000000000000010';
const WFL = 'wfl_01M5CM00000000000000000001';
const WFR = 'wfr_01M5CM00000000000000000006';
const TYPE = 'acctp_01M5CJXHZMQ72CZPQ5Y3XGC48W';

describe('account actions (C118.7)', () => {
  it('binds a workflow to an account type, holding paths and never values', () => {
    const resource = buildAccountActionResource({
      id: ACTION,
      workflowId: WFL,
      accountTypeId: TYPE,
      label: 'Re-check the account',
      status: 'active',
      prefill: { reference_id: 'account.fields.reference_id' },
      createdAt: AT,
      updatedAt: LATER,
    });
    expect(resource.attributes.prefill).toEqual({ reference_id: 'account.fields.reference_id' });
    expect(resource.relationships['account-type'].data.id).toBe(TYPE);
  });

  it('creates with a workflow, an account type and a label', () => {
    const attributes = { 'workflow-id': WFL, 'account-type-id': TYPE, label: 'Check' };
    const parse = (value: object) =>
      createAccountActionBodySchema.safeParse({ data: { attributes: value } }).success;
    expect(parse(attributes)).toBe(true);
    expect(parse({ ...attributes, prefill: { a: 'account.fields.a' } })).toBe(true);
    expect(parse({ 'workflow-id': WFL, label: 'Check' })).toBe(false);
  });

  it('patches the label, the prefill and the status', () => {
    const parse = (attributes: object) =>
      updateAccountActionBodySchema.safeParse({ data: { attributes } }).success;
    expect(parse({ label: 'Renamed' })).toBe(true);
    expect(parse({ status: 'archived' })).toBe(true);
    expect(parse({})).toBe(false);
    expect(parse({ 'workflow-id': WFL })).toBe(false);
  });

  it('filters by workflow, account type and status', () => {
    const query = { 'filter[workflow-id]': WFL, 'filter[status]': 'active' };
    expect(listAccountActionsQuerySchema.parse(query)).toEqual(query);
    expect(listAccountActionsQuerySchema.safeParse({ 'filter[status]': 'paused' }).success).toBe(
      false,
    );
  });

  it('runs by the public body and answers the run', () => {
    const body = { data: { 'account-action-id': ACTION, parameters: { note: 'synthetic' } } };
    expect(runAccountActionBodySchema.parse(body)).toEqual(body);
    expect(runAccountActionBodySchema.safeParse({ data: { parameters: {} } }).success).toBe(false);
    const answer = { data: { 'workflow-run-id': WFR } };
    expect(runAccountActionDocumentSchema.parse(answer)).toEqual(answer);
  });

  it('marks a prefilled value PII, and takes null for one masked for this viewer (P38)', () => {
    const parameter = { name: 'email', type: 'string', required: true, 'prefilled-value': null };
    expect(accountActionParameterSchema.parse(parameter)).toEqual(parameter);
    expect(accountActionParameterSchema.shape['prefilled-value'].meta()).toEqual({ pii: true });
  });
});
