// @vitest-environment node
import type { Permission } from '@openverify/core';
import { revalidatePath } from 'next/cache';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SESSION_COOKIE } from '../../lib/session-cookie';
import { SESSION_TOKEN } from '../../testing/api-fixtures';
import { routeApi, type RouteApi } from '../../testing/api-routes';
import { fakeRequest } from '../../testing/fake-request';
import { WORKFLOW_IDS as IDS } from '../../testing/workflow-fixtures';
import {
  createAccountAction,
  createCaseAction,
  updateAccountAction,
  updateCaseAction,
} from './binding-actions';

vi.mock('next/headers', () => import('../../testing/fake-request').then((m) => m.nextHeaders));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

const ACCOUNT_TYPE = 'acctp_01MB0000000000000000000001';
const CASE_ACTION = 'cact_01MB0000000000000000000001';
let api: RouteApi;

beforeEach(() => {
  fakeRequest.reset();
  fakeRequest.cookies.set(SESSION_COOKIE, SESSION_TOKEN);
  api = routeApi();
  vi.mocked(revalidatePath).mockClear();
});

afterEach(() => {
  api.restore();
});

const as = (...permissions: Permission[]) => api.me({ permissions });
const formOf = (values: Record<string, string>) => {
  const data = new FormData();
  for (const [name, value] of Object.entries(values)) {
    data.set(name, value);
  }
  return data;
};
const accountAction = (id: string = IDS.accountAction) => ({
  data: {
    type: 'account-action',
    id,
    attributes: {
      label: 'Re-screen',
      status: 'active',
      prefill: {},
      'created-at': '2026-11-01T09:00:00.000Z',
      'updated-at': '2026-11-01T09:00:00.000Z',
    },
    relationships: {
      workflow: { data: { type: 'workflow', id: IDS.workflow } },
      'account-type': { data: { type: 'account-type', id: ACCOUNT_TYPE } },
    },
  },
});
const caseAction = () => ({
  data: {
    type: 'case-action',
    id: CASE_ACTION,
    attributes: {
      label: 'Escalate',
      status: 'active',
      placement: 'header',
      prefill: {},
      'created-at': '2026-11-01T09:00:00.000Z',
      'updated-at': '2026-11-01T09:00:00.000Z',
    },
    relationships: {
      workflow: { data: { type: 'workflow', id: IDS.workflow } },
      'case-templates': { data: [{ type: 'case-template', id: IDS.caseTemplate }] },
    },
  },
});

describe('account action bindings (C118.7, C141.7)', () => {
  it('binds a running workflow to an account type with a label and its prefill, answering the action', async () => {
    as('workflows:read', 'workflows:write');
    api.on('POST', '/account-actions', 201, accountAction());

    const result = await createAccountAction(
      null,
      formOf({
        'workflow-id': IDS.workflow,
        'account-type-id': ACCOUNT_TYPE,
        label: 'Re-screen',
        'prefill.reference': 'account.fields.reference',
        'prefill.reason': '',
      }),
    );

    expect(result).toEqual({ ok: true, data: { id: IDS.accountAction } });
    expect(api.find('POST', '/account-actions')?.body).toEqual({
      data: {
        type: 'account-action',
        attributes: {
          'workflow-id': IDS.workflow,
          'account-type-id': ACCOUNT_TYPE,
          label: 'Re-screen',
          prefill: { reference: 'account.fields.reference' },
        },
      },
    });
  });

  it('changes the label, the prefill and the status', async () => {
    as('workflows:read', 'workflows:write');
    api.on('PATCH', `/account-actions/${IDS.accountAction}`, 200, accountAction());

    await updateAccountAction(
      null,
      formOf({
        'account-action-id': IDS.accountAction,
        label: 'Re-screen now',
        status: 'archived',
        'prefill.reference': 'account.fields.reference',
      }),
    );

    expect(api.find('PATCH', `/account-actions/${IDS.accountAction}`)?.body).toEqual({
      data: {
        type: 'account-action',
        attributes: {
          label: 'Re-screen now',
          status: 'archived',
          prefill: { reference: 'account.fields.reference' },
        },
      },
    });
  });

  it('refuses an empty label at its pointer, and needs workflows:write', async () => {
    as('workflows:read', 'workflows:write');
    const empty = await createAccountAction(
      null,
      formOf({ 'workflow-id': IDS.workflow, 'account-type-id': ACCOUNT_TYPE, label: '' }),
    );
    expect(empty.ok ? [] : empty.problem.errors?.map((error) => error.pointer)).toEqual([
      '/data/attributes/label',
    ]);
    as('workflows:read', 'workflows:trigger');
    expect(
      (
        await createAccountAction(
          null,
          formOf({ 'workflow-id': IDS.workflow, 'account-type-id': ACCOUNT_TYPE, label: 'x' }),
        )
      ).ok,
    ).toBe(false);
    expect(api.all('POST', '/account-actions')).toHaveLength(0);
  });
});

describe('case action bindings (C140.1, C141.7)', () => {
  it('binds a running workflow to case templates with a label and its prefill', async () => {
    as('workflows:read', 'workflows:write');
    api.on('POST', '/case-actions', 201, caseAction());

    const result = await createCaseAction(
      null,
      formOf({
        'workflow-id': IDS.workflow,
        'case-template-ids': IDS.caseTemplate,
        label: 'Escalate',
        'prefill.inquiry': 'case.fields.inquiry',
      }),
    );

    expect(result).toEqual({ ok: true, data: { id: CASE_ACTION } });
    expect(api.find('POST', '/case-actions')?.body).toEqual({
      data: {
        type: 'case-action',
        attributes: {
          'workflow-id': IDS.workflow,
          'case-template-ids': [IDS.caseTemplate],
          label: 'Escalate',
          prefill: { inquiry: 'case.fields.inquiry' },
        },
      },
    });
  });

  it('changes the templates, the label and the status', async () => {
    as('workflows:read', 'workflows:write');
    api.on('PATCH', `/case-actions/${CASE_ACTION}`, 200, caseAction());

    await updateCaseAction(
      null,
      formOf({
        'case-action-id': CASE_ACTION,
        label: 'Escalate',
        status: 'active',
        'case-template-ids': IDS.caseTemplate,
      }),
    );

    expect(api.find('PATCH', `/case-actions/${CASE_ACTION}`)?.body).toEqual({
      data: {
        type: 'case-action',
        attributes: {
          label: 'Escalate',
          status: 'active',
          'case-template-ids': [IDS.caseTemplate],
          prefill: {},
        },
      },
    });
  });
});
