// @vitest-environment node
/**
 * C142.2 to C142.5, C142.7: the case page's server actions. Each validates its form with the
 * contract's schemas, calls the case's own route (or the held inquiry's, for a decision) as the
 * operator, refreshes the case page, and refuses without the permission the route needs, without
 * calling the API.
 */
import type { Permission } from '@openverify/core';
import { revalidatePath } from 'next/cache';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SESSION_COOKIE } from '../../../lib/session-cookie';
import { SESSION_TOKEN } from '../../../testing/api-fixtures';
import { routeApi, type RouteApi } from '../../../testing/api-routes';
import { fakeRequest } from '../../../testing/fake-request';
import { inquiry } from '../../../testing/lifecycle-fixtures';
import {
  REVIEWER_IDS as IDS,
  caseResource,
  comment,
  single,
} from '../../../testing/reviewer-fixtures';
import {
  addCaseComment,
  addCaseObjects,
  addCaseTag,
  assignCase,
  decideHeldInquiry,
  printCase,
  redactCase,
  redactCaseComment,
  removeCaseObject,
  removeCaseTag,
  runCaseAction,
  setCaseQueue,
  setCaseSla,
  setCaseStatus,
  setCaseTags,
  updateCaseFields,
} from './actions';

vi.mock('next/headers', () => import('../../../testing/fake-request').then((m) => m.nextHeaders));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

const CASE = `/cases/${IDS.case}`;
let api: RouteApi;

beforeEach(() => {
  vi.mocked(revalidatePath).mockReset();
  fakeRequest.reset();
  fakeRequest.cookies.set(SESSION_COOKIE, SESSION_TOKEN);
  api = routeApi();
  as(
    'cases:read',
    'cases:write',
    'cases:assign',
    'cases:redact',
    'inquiries:write',
    'workflows:trigger',
    'pii:view',
  );
  for (const action of [
    'set-status',
    'assign',
    'add-comment',
    'add-tag',
    'remove-tag',
    'set-tags',
    'add-objects',
    'remove-objects',
    'print',
  ]) {
    api.on('POST', `${CASE}/${action}`, 200, single(caseResource()));
  }
  api.on('PATCH', CASE, 200, single(caseResource()));
  api.on('DELETE', CASE, 200, single(caseResource({ redactedAt: new Date() })));
  api.on('POST', `/case-comments/${IDS.comment}/redact`, 200, single(comment({ message: null })));
  api.on('POST', `${CASE}/run-action`, 200, { data: { 'workflow-run-id': IDS.run } });
  for (const action of ['approve', 'decline', 'mark-for-review']) {
    api.on('POST', `/inquiries/${IDS.inquiry}/${action}`, 200, single(inquiry()));
  }
});

afterEach(() => {
  api.restore();
});

function as(...permissions: Permission[]) {
  api.me({ permissions });
}

function form(fields: Record<string, string | readonly string[]>): FormData {
  const data = new FormData();
  data.set('case-id', IDS.case);
  for (const [name, value] of Object.entries(fields)) {
    for (const each of typeof value === 'string' ? [value] : value) {
      data.append(name, each);
    }
  }
  return data;
}

const body = (method: string, path: string) => api.find(method, path)?.body;

describe('the case page’s actions', () => {
  it('sets a status with its resolution, comment, status tag and lock version', async () => {
    const result = await setCaseStatus(
      null,
      form({
        status: 'declined',
        resolution: 'Declined',
        comment: 'Synthetic reason',
        'status-tag': 'document',
        'lock-version': '4',
      }),
    );

    expect(result).toEqual({ ok: true, data: undefined });
    expect(body('POST', `${CASE}/set-status`)).toEqual({
      meta: {
        status: 'declined',
        resolution: 'Declined',
        comment: 'Synthetic reason',
        'status-tag': 'document',
        'lock-version': 4,
      },
    });
    expect(revalidatePath).toHaveBeenCalledWith(CASE);
  });

  it('leaves out what the form left blank', async () => {
    await setCaseStatus(null, form({ status: 'pending', resolution: '', comment: '  ' }));

    expect(body('POST', `${CASE}/set-status`)).toEqual({ meta: { status: 'pending' } });
  });

  it('refuses a status change without cases:write, without calling the API', async () => {
    as('cases:read');

    const result = await setCaseStatus(null, form({ status: 'pending' }));

    expect(result.ok).toBe(false);
    expect(api.find('POST', `${CASE}/set-status`)).toBeUndefined();
  });

  it.each([
    ['to oneself', { 'user-id': IDS.me }, { 'user-id': IDS.me }],
    ['to a member', { 'user-id': IDS.colleague }, { 'user-id': IDS.colleague }],
    ['to nobody', { 'user-id': '' }, { 'user-id': null }],
  ])('assigns %s', async (_name, fields, meta) => {
    await assignCase(null, form({ ...fields, 'lock-version': '4' }));

    expect(body('POST', `${CASE}/assign`)).toEqual({ meta: { ...meta, 'lock-version': 4 } });
  });

  it('adds a comment, keeping its words as typed', async () => {
    const message = `  Synthetic note @[${IDS.colleague}]\nsecond line  `;

    await addCaseComment(null, form({ message }));

    expect(body('POST', `${CASE}/add-comment`)).toEqual({ meta: { message: message.trim() } });
  });

  it('redacts a comment through its own route', async () => {
    await redactCaseComment(null, form({ 'comment-id': IDS.comment }));

    expect(body('POST', `/case-comments/${IDS.comment}/redact`)).toEqual({});
    expect(revalidatePath).toHaveBeenCalledWith(CASE);
  });

  it('adds, removes and sets tags', async () => {
    await addCaseTag(null, form({ 'tag-name': 'synthetic-tag' }));
    await removeCaseTag(null, form({ 'tag-name': 'synthetic-tag' }));
    await setCaseTags(null, form({ 'tag-names': 'one, two' }));

    expect(body('POST', `${CASE}/add-tag`)).toEqual({ meta: { 'tag-name': 'synthetic-tag' } });
    expect(body('POST', `${CASE}/remove-tag`)).toEqual({ meta: { 'tag-name': 'synthetic-tag' } });
    expect(body('POST', `${CASE}/set-tags`)).toEqual({ meta: { 'tag-names': ['one', 'two'] } });
  });

  it('updates the fields as a JSON document, only with pii:view', async () => {
    await updateCaseFields(null, form({ fields: '{"full-name":"Synthetic Person"}' }));

    expect(body('PATCH', CASE)).toEqual({
      data: { type: 'case', attributes: { fields: { 'full-name': 'Synthetic Person' } } },
    });

    as('cases:read', 'cases:write');
    const refused = await updateCaseFields(null, form({ fields: '{}' }));
    expect(refused.ok).toBe(false);
  });

  it.each([
    ['moves the case to a queue', IDS.otherQueue, IDS.otherQueue],
    ['takes it out of every queue', '', null],
  ])('%s', async (_name, queue, expected) => {
    await setCaseQueue(null, form({ 'case-queue-id': queue }));

    expect(body('PATCH', CASE)).toEqual({
      data: { type: 'case', attributes: { 'case-queue-id': expected } },
    });
  });

  it.each([
    ['sets a deadline in hours', { amount: '3', unit: 'hours' }, 10_800],
    ['sets a deadline in days', { amount: '2', unit: 'days' }, 172_800],
    ['clears it', { clear: 'true' }, null],
  ])('%s', async (_name, fields, seconds) => {
    await setCaseSla(null, form(fields));

    expect(body('PATCH', CASE)).toEqual({ meta: { 'sla-expires-in-seconds': seconds } });
  });

  it('adds held objects by id and removes one', async () => {
    await addCaseObjects(null, form({ 'object-ids': `${IDS.inquiry}, ${IDS.account}` }));
    await removeCaseObject(null, form({ 'object-id': IDS.account }));

    expect(body('POST', `${CASE}/add-objects`)).toEqual({
      meta: { 'object-ids': [IDS.inquiry, IDS.account] },
    });
    expect(body('POST', `${CASE}/remove-objects`)).toEqual({
      meta: { 'object-ids': [IDS.account] },
    });
  });

  it('redacts the case only once the phrase is typed, with cases:redact', async () => {
    const refused = await redactCase(null, form({ confirmation: 'yes' }));
    expect(refused.ok).toBe(false);
    expect(api.find('DELETE', CASE)).toBeUndefined();

    const result = await redactCase(null, form({ confirmation: 'redact' }));
    expect(result.ok).toBe(true);
    expect(api.find('DELETE', CASE)).toBeDefined();
  });

  it('runs a case action with its parameters typed by the form, and answers the run', async () => {
    const result = await runCaseAction(
      null,
      form({
        'case-action-id': IDS.action,
        'parameter-type.reference': 'string',
        'parameter.reference': 'Synthetic reference',
        'parameter-type.priority': 'number',
        'parameter.priority': '2',
        'parameter-type.notify': 'boolean',
        'parameter.notify': 'true',
        'parameter-type.empty': 'string',
        'parameter.empty': '',
      }),
    );

    expect(result).toEqual({ ok: true, data: { runId: IDS.run } });
    expect(body('POST', `${CASE}/run-action`)).toEqual({
      data: {
        'case-action-id': IDS.action,
        parameters: { reference: 'Synthetic reference', priority: 2, notify: true },
      },
    });
  });

  it('sends a list and an object input as JSON values of their C115.3 types (R012)', async () => {
    const result = await runCaseAction(
      null,
      form({
        'case-action-id': IDS.action,
        'parameter-type.inquiries': 'list<id<inq>>',
        'parameter.inquiries': '["inq_01MB0000000000000000000001"]',
        'parameter-type.detail': 'object{a:string}',
        'parameter.detail': '{"a":"Synthetic"}',
        'parameter-type.due': 'datetime',
        'parameter.due': '2026-11-03T10:00',
      }),
    );

    expect(result).toEqual({ ok: true, data: { runId: IDS.run } });
    const sent = body('POST', `${CASE}/run-action`) as {
      data: { parameters: Record<string, unknown> };
    };
    expect(sent.data.parameters.inquiries).toEqual(['inq_01MB0000000000000000000001']);
    expect(sent.data.parameters.detail).toEqual({ a: 'Synthetic' });
    expect(sent.data.parameters.due).toMatch(/^2026-11-03T\d{2}:00:00\.000Z$/);
  });

  it('refuses a fraction for an integer and text for a number, by pointer, without calling the API (R012)', async () => {
    const result = await runCaseAction(
      null,
      form({
        'case-action-id': IDS.action,
        'parameter-type.priority': 'integer',
        'parameter.priority': '2.5',
        'parameter-type.score': 'number',
        'parameter.score': 'high',
      }),
    );

    expect(result.ok ? [] : result.problem.errors?.map((error) => error.pointer)).toEqual([
      '/data/parameters/priority',
      '/data/parameters/score',
    ]);
    expect(api.find('POST', `${CASE}/run-action`)).toBeUndefined();
  });

  it('refuses a case action without workflows:trigger', async () => {
    as('cases:read', 'cases:write');

    const result = await runCaseAction(null, form({ 'case-action-id': IDS.action }));

    expect(result.ok).toBe(false);
    expect(api.find('POST', `${CASE}/run-action`)).toBeUndefined();
  });

  it('records the print before the browser prints (C138.3)', async () => {
    const result = await printCase(null, form({}));

    expect(result.ok).toBe(true);
    expect(body('POST', `${CASE}/print`)).toEqual({});
  });

  it.each([
    ['approve', 'approve'],
    ['decline', 'decline'],
    ['mark-for-review', 'mark-for-review'],
  ])('decides the held inquiry (%s) through its own route', async (decision, route) => {
    await decideHeldInquiry(null, form({ 'inquiry-id': IDS.inquiry, action: decision }));

    expect(api.find('POST', `/inquiries/${IDS.inquiry}/${route}`)).toBeDefined();
    expect(revalidatePath).toHaveBeenCalledWith(CASE);
  });

  it('refuses a decision without inquiries:write', async () => {
    as('cases:read', 'cases:write');

    const result = await decideHeldInquiry(
      null,
      form({ 'inquiry-id': IDS.inquiry, action: 'approve' }),
    );

    expect(result.ok).toBe(false);
    expect(api.find('POST', `/inquiries/${IDS.inquiry}/approve`)).toBeUndefined();
  });
});
